import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

import { estimateCostUsd, logUsage, type LlmCallLog, type TokenUsage } from "./cost";

export type ModelTier = "smart" | "fast";

export interface CallJsonOptions<T> {
  /** Agent name, used for logging and cost tracking (e.g. "planner"). */
  agent: string;
  /** Resolved to MODEL_SMART or MODEL_FAST. */
  model: ModelTier;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** Constrain the response to the schema via the API's structured outputs. Default true. */
  structuredOutput?: boolean;
  /** Called once per callJson, success or failure, with totals across all attempts. */
  onUsage?: (log: LlmCallLog) => void;
}

export class LlmConfigError extends Error {
  override name = "LlmConfigError";
}

export class LlmValidationError extends Error {
  override name = "LlmValidationError";
  constructor(
    readonly agent: string,
    readonly issues: string[],
    readonly rawText: string,
  ) {
    super(`[${agent}] LLM output failed validation after retry:\n${issues.join("\n---\n")}`);
  }
}

export class LlmRefusalError extends Error {
  override name = "LlmRefusalError";
  constructor(
    readonly agent: string,
    readonly explanation: string | null,
  ) {
    super(`[${agent}] model refused the request${explanation ? `: ${explanation}` : ""}`);
  }
}

type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export interface LlmClientDeps {
  createMessage: CreateMessage;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const MAX_NETWORK_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;
const DEFAULT_MAX_TOKENS = 16_000;

export function resolveModel(tier: ModelTier): string {
  const envVar = tier === "smart" ? "MODEL_SMART" : "MODEL_FAST";
  const model = process.env[envVar];
  if (!model) throw new LlmConfigError(`${envVar} is not set (see .env.example)`);
  return model;
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true; // includes timeouts
  if (err instanceof Anthropic.APIError && typeof err.status === "number") {
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }
  return false;
}

/** Exponential backoff with jitter: ~1s, 2s, 4s. Honors a longer retry-after header. */
export function backoffMs(attempt: number, err: unknown, random: () => number): number {
  const exp = BASE_BACKOFF_MS * 2 ** attempt;
  const jittered = exp * (0.75 + random() * 0.5);
  const retryAfter =
    err instanceof Anthropic.APIError ? Number(err.headers?.get("retry-after")) : NaN;
  return Number.isFinite(retryAfter) ? Math.max(jittered, retryAfter * 1_000) : jittered;
}

export function stripCodeFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return match?.[1] ?? text.trim();
}

type ParseResult<T> = { ok: true; data: T } | { ok: false; issue: string };

export function parseJsonOutput<T>(text: string, schema: z.ZodType<T>): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(text));
  } catch (err) {
    return { ok: false, issue: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    return { ok: false, issue: `Schema validation failed:\n${issues}` };
  }
  return { ok: true, data: result.data };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function retryMessages(prompt: string, rawText: string, issue: string): Anthropic.MessageParam[] {
  const correction = `Your previous response failed validation:\n${issue}\n\nRespond with corrected JSON only.`;
  if (!rawText.trim()) return [{ role: "user", content: `${prompt}\n\n${correction}` }];
  return [
    { role: "user", content: prompt },
    { role: "assistant", content: rawText },
    { role: "user", content: correction },
  ];
}

export function createLlmClient(deps: LlmClientDeps) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;

  async function createWithRetry(
    params: Anthropic.MessageCreateParamsNonStreaming,
    agent: string,
    onAttempt: () => void,
  ): Promise<Anthropic.Message> {
    for (let retry = 0; ; retry++) {
      onAttempt();
      try {
        return await deps.createMessage(params);
      } catch (err) {
        if (!isRetryableError(err) || retry >= MAX_NETWORK_RETRIES) throw err;
        const delay = backoffMs(retry, err, random);
        console.warn(
          `[llm] ${agent}: ${err instanceof Error ? err.message : String(err)}; ` +
            `retry ${retry + 1}/${MAX_NETWORK_RETRIES} in ${Math.round(delay)}ms`,
        );
        await sleep(delay);
      }
    }
  }

  async function callJson<T>(opts: CallJsonOptions<T>): Promise<T> {
    const model = resolveModel(opts.model);
    const started = Date.now();
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let attempts = 0;
    let ok = false;

    const baseParams = {
      model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: opts.system,
      ...(opts.structuredOutput !== false && {
        output_config: {
          format: { type: "json_schema" as const, schema: zodOutputFormat(opts.schema).schema },
        },
      }),
    };

    async function attempt(messages: Anthropic.MessageParam[]) {
      const message = await createWithRetry({ ...baseParams, messages }, opts.agent, () => {
        attempts++;
      });
      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;
      if (message.stop_reason === "refusal") {
        throw new LlmRefusalError(opts.agent, message.stop_details?.explanation ?? null);
      }
      const rawText = textOf(message);
      if (message.stop_reason === "max_tokens") {
        return { rawText, result: { ok: false, issue: "Output was cut off at max_tokens." } as const };
      }
      return { rawText, result: parseJsonOutput(rawText, opts.schema) };
    }

    try {
      const first = await attempt([{ role: "user", content: opts.prompt }]);
      if (first.result.ok) {
        ok = true;
        return first.result.data;
      }
      console.warn(`[llm] ${opts.agent}: invalid output, retrying once. ${first.result.issue}`);
      const second = await attempt(retryMessages(opts.prompt, first.rawText, first.result.issue));
      if (second.result.ok) {
        ok = true;
        return second.result.data;
      }
      throw new LlmValidationError(
        opts.agent,
        [first.result.issue, second.result.issue],
        second.rawText,
      );
    } finally {
      const log: LlmCallLog = {
        agent: opts.agent,
        model,
        ...usage,
        costUsd: estimateCostUsd(model, usage),
        attempts,
        durationMs: Date.now() - started,
        ok,
      };
      logUsage(log);
      opts.onUsage?.(log);
    }
  }

  return { callJson };
}

let defaultClient: ReturnType<typeof createLlmClient> | undefined;

/**
 * The single entry point for LLM calls. Retries are handled here, so the SDK's own are off.
 * Requests stream under the hood: the SDK refuses non-streaming calls whose max_tokens could
 * take over 10 minutes (~21k tokens), and long syllabi need more than that.
 */
export function callJson<T>(opts: CallJsonOptions<T>): Promise<T> {
  if (!defaultClient) {
    const anthropic = new Anthropic({ maxRetries: 0 });
    defaultClient = createLlmClient({ createMessage: (params) => anthropic.messages.stream(params).finalMessage() });
  }
  return defaultClient.callJson(opts);
}
