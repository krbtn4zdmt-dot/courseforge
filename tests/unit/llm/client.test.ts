import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { LlmCallLog } from "@/lib/llm/cost";
import {
  backoffMs,
  createLlmClient,
  isRetryableError,
  LlmConfigError,
  LlmRefusalError,
  LlmTruncatedError,
  LlmValidationError,
  parseJsonOutput,
} from "@/lib/llm/client";

import { textMessage, VALID_LESSON } from "../../fixtures/llm/messages";

const LessonSchema = z.object({
  title: z.string().min(1),
  minutes: z.number().int().min(10).max(25),
  keyTerms: z.array(z.string()).min(1),
});

const ENV = { MODEL_SMART: "claude-sonnet-5-5", MODEL_FAST: "claude-haiku-4-5-20251001" };

type Step = BetaMessage | Error;

/** Fake SDK: returns (or throws) each step in order and records every request. */
function setup(steps: Step[], env: Record<string, string | undefined> = ENV) {
  const requests: MessageCreateParamsNonStreaming[] = [];
  const create = vi.fn(async (params: MessageCreateParamsNonStreaming) => {
    // Snapshot: the client mutates its messages array between attempts.
    requests.push(structuredClone(params));
    const step = steps.shift();
    if (!step) throw new Error("fake SDK: no more responses");
    if (step instanceof Error) throw step;
    return step;
  });
  const sleep = vi.fn(async () => {});
  const logs: LlmCallLog[] = [];
  const client = createLlmClient({
    messages: { create },
    env,
    sleep,
    random: () => 0,
    log: (entry) => logs.push(entry),
  });
  const call = (overrides: { model?: "smart" | "fast" } = {}) =>
    client.callJson({
      agent: "lessonWriter",
      model: overrides.model ?? "smart",
      system: "You write lessons. Respond with JSON only.",
      prompt: "Write a lesson about Gaugamela.",
      schema: LessonSchema,
    });
  return { call, create, requests, sleep, logs };
}

const connectionError = () => new Anthropic.APIConnectionError({ message: "socket hang up" });
const overloaded = () => new Anthropic.InternalServerError(529, undefined, "Overloaded", new Headers());
const badRequest = () => new Anthropic.BadRequestError(400, undefined, "bad request", new Headers());

describe("callJson", () => {
  it("returns validated data with usage and cost on success", async () => {
    const { call, requests, logs } = setup([textMessage(JSON.stringify(VALID_LESSON))]);

    const result = await call();

    expect(result.data).toEqual(VALID_LESSON);
    expect(result.usage).toMatchObject({
      model: "claude-sonnet-5-5",
      attempts: 1,
      inputTokens: 1_000,
      outputTokens: 500,
    });
    // 1000 * $2/M + 500 * $10/M
    expect(result.usage.costUsd).toBeCloseTo(0.007, 10);

    const [request] = requests;
    expect(request?.model).toBe("claude-sonnet-5-5");
    expect(request?.system).toBe("You write lessons. Respond with JSON only.");
    expect(request?.messages).toEqual([{ role: "user", content: "Write a lesson about Gaugamela." }]);
    expect(request?.output_config?.format?.type).toBe("json_schema");

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: "llm_call", agent: "lessonWriter", status: "ok", attempts: 1 });
  });

  it("uses MODEL_FAST for the fast tier and skips the fallback beta for Haiku", async () => {
    const { call, requests } = setup([
      textMessage(JSON.stringify(VALID_LESSON), { model: "claude-haiku-4-5-20251001" }),
    ]);

    const result = await call({ model: "fast" });

    expect(requests[0]?.model).toBe("claude-haiku-4-5-20251001");
    expect(requests[0]?.betas).toBeUndefined();
    expect(requests[0]?.fallbacks).toBeUndefined();
    expect(result.usage.costUsd).toBeCloseTo(0.0035, 10);
  });

  it("enables default refusal fallbacks for Sonnet 5.5", async () => {
    const { call, requests } = setup([textMessage(JSON.stringify(VALID_LESSON))]);

    await call();

    expect(requests[0]?.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(requests[0]?.fallbacks).toBe("default");
  });

  it("retries once with the error appended when the output is not valid JSON", async () => {
    const { call, requests, logs } = setup([
      textMessage('{"title": "Gaugamela", "minutes": 15,'),
      textMessage(JSON.stringify(VALID_LESSON)),
    ]);

    const result = await call();

    expect(result.data).toEqual(VALID_LESSON);
    expect(result.usage.attempts).toBe(2);
    expect(result.usage.inputTokens).toBe(2_000);
    expect(result.usage.costUsd).toBeCloseTo(0.014, 10);

    const retry = requests[1];
    expect(retry?.messages).toHaveLength(3);
    expect(retry?.messages[1]?.role).toBe("assistant");
    expect(retry?.messages[2]).toMatchObject({ role: "user" });
    expect(String(retry?.messages[2]?.content)).toContain("Invalid JSON");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: "ok", attempts: 2 });
  });

  it("retries once with the Zod errors appended when the JSON fails the schema", async () => {
    const { call, requests } = setup([
      textMessage(JSON.stringify({ ...VALID_LESSON, minutes: 40 })),
      textMessage(JSON.stringify(VALID_LESSON)),
    ]);

    const result = await call();

    expect(result.data).toEqual(VALID_LESSON);
    const feedback = String(requests[1]?.messages[2]?.content);
    expect(feedback).toContain("did not match the required JSON schema");
    expect(feedback).toContain("minutes");
  });

  it("throws LlmValidationError when the retry is also invalid", async () => {
    const { call, create, logs } = setup([
      textMessage("not json"),
      textMessage(JSON.stringify({ ...VALID_LESSON, keyTerms: [] })),
    ]);

    const error = await call().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmValidationError);
    expect((error as LlmValidationError).message).toContain("keyTerms");
    expect((error as LlmValidationError).lastOutput).toContain('"keyTerms":[]');
    expect(create).toHaveBeenCalledTimes(2);
    expect(logs[0]).toMatchObject({ status: "validation_failed", attempts: 2 });
  });

  it("retries network errors with exponential backoff", async () => {
    const { call, create, sleep } = setup([
      connectionError(),
      overloaded(),
      textMessage(JSON.stringify(VALID_LESSON)),
    ]);

    const result = await call();

    expect(result.data).toEqual(VALID_LESSON);
    expect(create).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1_000], [2_000]]);
    expect(result.usage.attempts).toBe(1);
  });

  it("gives up after 3 network retries and rethrows the last error", async () => {
    const { call, create, sleep, logs } = setup([
      connectionError(),
      connectionError(),
      connectionError(),
      connectionError(),
    ]);

    await expect(call()).rejects.toBeInstanceOf(Anthropic.APIConnectionError);
    expect(create).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[1_000], [2_000], [4_000]]);
    expect(logs[0]).toMatchObject({ status: "request_failed", attempts: 0, costUsd: 0 });
  });

  it("does not retry non-retryable API errors", async () => {
    const { call, create, sleep } = setup([badRequest()]);

    await expect(call()).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    expect(create).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws LlmRefusalError on a refusal without retrying", async () => {
    const { call, create, logs } = setup([
      textMessage("", { stopReason: "refusal", refusalCategory: "cyber" }),
    ]);

    const error = await call().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmRefusalError);
    expect((error as LlmRefusalError).category).toBe("cyber");
    expect(create).toHaveBeenCalledTimes(1);
    expect(logs[0]).toMatchObject({ status: "refused" });
  });

  it("throws LlmTruncatedError when output hits max_tokens", async () => {
    const { call, create } = setup([textMessage('{"title": "Gaug', { stopReason: "max_tokens" })]);

    await expect(call()).rejects.toBeInstanceOf(LlmTruncatedError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("throws LlmConfigError when the model env var is missing", async () => {
    const { call, create } = setup([], { MODEL_FAST: "claude-haiku-4-5" });

    await expect(call()).rejects.toThrow(new LlmConfigError("MODEL_SMART is not set (see .env.example)"));
    expect(create).not.toHaveBeenCalled();
  });

  it("prices each iteration by its own model when a fallback model served the response", async () => {
    const { call, logs } = setup([
      textMessage(JSON.stringify(VALID_LESSON), {
        model: "claude-haiku-4-5",
        iterations: [
          {
            type: "message",
            model: null,
            input_tokens: 1_000,
            output_tokens: 100,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          {
            type: "fallback_message",
            model: "claude-haiku-4-5",
            input_tokens: 1_000,
            output_tokens: 400,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        ],
      }),
    ]);

    const result = await call();

    // Sonnet: 1000*$2/M + 100*$10/M = 0.003; Haiku: 1000*$1/M + 400*$5/M = 0.003
    expect(result.usage.costUsd).toBeCloseTo(0.006, 10);
    expect(logs[0]).toMatchObject({ model: "claude-sonnet-5-5", servedModel: "claude-haiku-4-5" });
  });

  it("reports unknown cost as null for an unpriced model", async () => {
    const { call } = setup(
      [textMessage(JSON.stringify(VALID_LESSON), { model: "claude-future-9" })],
      { MODEL_SMART: "claude-future-9", MODEL_FAST: "claude-haiku-4-5" },
    );

    const result = await call();

    expect(result.usage.costUsd).toBeNull();
  });
});

describe("parseJsonOutput", () => {
  it("accepts JSON wrapped in a code fence", () => {
    const text = "```json\n" + JSON.stringify(VALID_LESSON) + "\n```";
    expect(parseJsonOutput(text, LessonSchema)).toEqual({ ok: true, data: VALID_LESSON });
  });

  it("reports invalid JSON", () => {
    const result = parseJsonOutput("{oops", LessonSchema);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/^Invalid JSON/);
  });
});

describe("isRetryableError", () => {
  it.each([
    ["connection error", connectionError(), true],
    ["timeout", new Anthropic.APIConnectionTimeoutError(), true],
    ["429", new Anthropic.RateLimitError(429, undefined, "slow down", new Headers()), true],
    ["500", new Anthropic.InternalServerError(500, undefined, "oops", new Headers()), true],
    ["529", overloaded(), true],
    ["400", badRequest(), false],
    ["401", new Anthropic.AuthenticationError(401, undefined, "no key", new Headers()), false],
    ["user abort", new Anthropic.APIUserAbortError(), false],
    ["plain Error", new Error("boom"), false],
  ])("%s -> %s", (_label, error, expected) => {
    expect(isRetryableError(error)).toBe(expected);
  });
});

describe("backoffMs", () => {
  it("doubles each retry and adds jitter", () => {
    expect([0, 1, 2].map((n) => backoffMs(n, () => 0))).toEqual([1_000, 2_000, 4_000]);
    expect(backoffMs(0, () => 0.999)).toBe(1_249);
  });
});
