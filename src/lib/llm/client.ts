// Single LLM wrapper: model selection, retries, JSON parsing, Zod validation, token/cost logging.
// Every LLM call in the app goes through callJson.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type {
  BetaMessage,
  BetaMessageParam,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";

import {
  addCost,
  addUsage,
  estimateCostUsd,
  logLlmCall,
  ZERO_USAGE,
  type LlmCallLog,
  type LlmCallStatus,
  type TokenUsage,
} from "./cost";

export type ModelTier = "smart" | "fast";

export type CallJsonOptions<T> = {
  /** Agent name for logs, e.g. "planner". */
  agent: string;
  model: ModelTier;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
};

export type CallUsage = TokenUsage & {
  /** The model ID the request asked for. */
  model: string;
  /** Number of API responses received (including the validation retry). */
  attempts: number;
  costUsd: number | null;
};

export type CallJsonResult<T> = { data: T; usage: CallUsage };

export class LlmError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
export class LlmConfigError extends LlmError {}
export class LlmValidationError extends LlmError {
  constructor(
    message: string,
    readonly lastOutput: string,
  ) {
    super(message);
  }
}
export class LlmRefusalError extends LlmError {
  constructor(
    message: string,
    readonly category: string | null,
  ) {
    super(message);
  }
}
export class LlmTruncatedError extends LlmError {}

/** The one SDK method the client uses; tests pass a fake. */
export type MessagesApi = {
  create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage>;
};

export type LlmClientDeps = {
  messages: MessagesApi;
  env?: Record<string, string | undefined>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (entry: LlmCallLog) => void;
};

export const MODEL_ENV_VARS: Record<ModelTier, string> = {
  smart: "MODEL_SMART",
  fast: "MODEL_FAST",
};
export const DEFAULT_MAX_TOKENS = 16_000;
export const MAX_NETWORK_RETRIES = 3;
export const BASE_BACKOFF_MS = 1_000;
const MAX_JITTER_MS = 250;

// Models that accept `fallbacks: "default"`: if a safety classifier declines, the API
// reruns the request on a fallback model inside the same call.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const DEFAULT_FALLBACK_MODELS = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

export function resolveModel(
  tier: ModelTier,
  env: Record<string, string | undefined>,
): string {
  const name = MODEL_ENV_VARS[tier];
  const model = env[name]?.trim();
  if (!model) throw new LlmConfigError(`${name} is not set (see .env.example)`);
  return model;
}

/** Connection errors, timeouts, 408, 429 and 5xx (including 529 overloaded). */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError && typeof err.status === "number") {
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }
  return false;
}

/** Exponential backoff: 1s, 2s, 4s, plus up to 250ms jitter. */
export function backoffMs(retry: number, random: () => number): number {
  return BASE_BACKOFF_MS * 2 ** retry + Math.floor(random() * MAX_JITTER_MS);
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Parses model text as JSON and validates it. Tolerates a ```json fence. */
export function parseJsonOutput<T>(text: string, schema: z.ZodType<T>): ParseResult<T> {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(unfenced);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const result = schema.safeParse(json);
  if (!result.success) return { ok: false, error: z.prettifyError(result.error) };
  return { ok: true, data: result.data };
}

export function validationRetryPrompt(error: string): string {
  return [
    "Your previous response did not match the required JSON schema.",
    "",
    "Problems:",
    error,
    "",
    "Respond again with the corrected JSON only.",
  ].join("\n");
}

function tokenUsage(usage: BetaMessage["usage"]): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/** Cost of one response. When a fallback model served it, prices each iteration by its own model. */
function responseCost(response: BetaMessage, requestedModel: string): number | null {
  const iterations = response.usage.iterations ?? [];
  if (!iterations.some((it) => it.type === "fallback_message")) {
    return estimateCostUsd(response.model, tokenUsage(response.usage));
  }
  let cost: number | null = 0;
  for (const it of iterations) {
    if (it.type !== "message" && it.type !== "fallback_message") continue;
    cost = addCost(
      cost,
      estimateCostUsd(it.model ?? requestedModel, {
        inputTokens: it.input_tokens,
        outputTokens: it.output_tokens,
        cacheReadTokens: it.cache_read_input_tokens,
        cacheWriteTokens: it.cache_creation_input_tokens,
      }),
    );
  }
  return cost;
}

function responseText(response: BetaMessage): string {
  return response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
}

export function createLlmClient(deps: LlmClientDeps) {
  const env = deps.env ?? process.env;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const log = deps.log ?? logLlmCall;

  async function createWithRetry(params: MessageCreateParamsNonStreaming): Promise<BetaMessage> {
    for (let retry = 0; ; retry++) {
      try {
        return await deps.messages.create(params);
      } catch (err) {
        if (retry >= MAX_NETWORK_RETRIES || !isRetryableError(err)) throw err;
        await sleep(backoffMs(retry, random));
      }
    }
  }

  async function callJson<T>(opts: CallJsonOptions<T>): Promise<CallJsonResult<T>> {
    const model = resolveModel(opts.model, env);
    const startedAt = Date.now();
    const messages: BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
    // Constrain decoding to the schema's JSON shape. Zod still validates afterwards,
    // since some rules (min/max, refinements) can't be expressed in the API schema.
    const { type, schema } = zodOutputFormat(opts.schema);
    const fallback = DEFAULT_FALLBACK_MODELS.has(model)
      ? { betas: [FALLBACK_BETA], fallbacks: "default" as const }
      : {};

    let tokens = ZERO_USAGE;
    let costUsd: number | null = 0;
    let attempts = 0;
    let servedModel: string | null = null;

    const usage = (): CallUsage => ({ ...tokens, model, attempts, costUsd });
    const record = (status: LlmCallStatus) =>
      log({
        event: "llm_call",
        agent: opts.agent,
        model,
        servedModel,
        status,
        attempts,
        ...tokens,
        costUsd,
        durationMs: Date.now() - startedAt,
      });

    for (let validationRetry = 0; ; validationRetry++) {
      let response: BetaMessage;
      try {
        response = await createWithRetry({
          model,
          max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
          system: opts.system,
          messages,
          output_config: { format: { type, schema } },
          ...fallback,
        });
      } catch (err) {
        record("request_failed");
        throw err;
      }

      attempts++;
      servedModel = response.model;
      tokens = addUsage(tokens, tokenUsage(response.usage));
      costUsd = addCost(costUsd, responseCost(response, model));

      if (response.stop_reason === "refusal") {
        record("refused");
        const category = response.stop_details?.category ?? null;
        throw new LlmRefusalError(
          `${opts.agent}: model declined the request (category: ${category ?? "none"})`,
          category,
        );
      }
      if (response.stop_reason === "max_tokens") {
        record("truncated");
        throw new LlmTruncatedError(
          `${opts.agent}: output hit max_tokens (${opts.maxTokens ?? DEFAULT_MAX_TOKENS}) before the JSON was complete`,
        );
      }

      const text = responseText(response);
      const parsed = parseJsonOutput(text, opts.schema);
      if (parsed.ok) {
        record("ok");
        return { data: parsed.data, usage: usage() };
      }
      if (validationRetry >= 1) {
        record("validation_failed");
        throw new LlmValidationError(
          `${opts.agent}: output failed validation after a retry:\n${parsed.error}`,
          text,
        );
      }
      messages.push(
        { role: "assistant", content: response.content },
        { role: "user", content: validationRetryPrompt(parsed.error) },
      );
    }
  }

  return { callJson };
}

let defaultClient: ReturnType<typeof createLlmClient> | null = null;

/** Calls the model configured for `opts.model` and returns Zod-validated JSON plus usage. */
export function callJson<T>(opts: CallJsonOptions<T>): Promise<CallJsonResult<T>> {
  // SDK retries are off; createWithRetry owns the retry policy.
  defaultClient ??= createLlmClient({ messages: new Anthropic({ maxRetries: 0 }).beta.messages });
  return defaultClient.callJson(opts);
}
