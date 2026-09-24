import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  backoffMs,
  createLlmClient,
  LlmConfigError,
  LlmRefusalError,
  LlmValidationError,
  MAX_NETWORK_RETRIES,
  stripCodeFence,
  type CallJsonOptions,
} from "@/lib/llm/client";
import type { LlmCallLog } from "@/lib/llm/cost";
import {
  fencedQuizJson,
  malformedJson,
  mockMessage,
  quizSchema,
  schemaInvalidQuizJson,
  validQuizJson,
} from "../../fixtures/llm/messages";

type Params = Anthropic.MessageCreateParamsNonStreaming;

function setup(responses: Array<Anthropic.Message | Error>) {
  const createMessage = vi.fn<(params: Params) => Promise<Anthropic.Message>>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("mock: no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  const client = createLlmClient({ createMessage, sleep, random: () => 0.5 });
  return { client, createMessage, sleep };
}

function opts(overrides: Partial<CallJsonOptions<unknown>> = {}) {
  return {
    agent: "examiner",
    model: "smart" as const,
    system: "You write quiz questions.",
    prompt: "Write one question about Excel SUM.",
    schema: quizSchema,
    ...overrides,
  };
}

const connectionError = () => new Anthropic.APIConnectionError({ message: "socket hang up" });
const serverError = (status = 500) =>
  new Anthropic.InternalServerError(status, undefined, "server error", new Headers());

beforeEach(() => {
  vi.stubEnv("MODEL_SMART", "claude-sonnet-5");
  vi.stubEnv("MODEL_FAST", "claude-haiku-4-5-20251001");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("callJson: success", () => {
  it("returns validated data and sends the resolved model, system prompt and schema", async () => {
    const { client, createMessage } = setup([mockMessage(validQuizJson)]);
    const data = await client.callJson(opts());

    expect(data).toEqual(JSON.parse(validQuizJson));
    expect(createMessage).toHaveBeenCalledTimes(1);
    const params = createMessage.mock.calls[0]![0];
    expect(params.model).toBe("claude-sonnet-5");
    expect(params.system).toBe("You write quiz questions.");
    expect(params.messages).toEqual([{ role: "user", content: "Write one question about Excel SUM." }]);
    expect(params.output_config?.format?.type).toBe("json_schema");
    expect(params.output_config?.format?.schema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["question", "options", "correctIndex"]),
    });
  });

  it("uses MODEL_FAST for the fast tier", async () => {
    const { client, createMessage } = setup([mockMessage(validQuizJson)]);
    await client.callJson(opts({ model: "fast" }));
    expect(createMessage.mock.calls[0]![0].model).toBe("claude-haiku-4-5-20251001");
  });

  it("omits output_config when structured output is off, and accepts fenced JSON", async () => {
    const { client, createMessage } = setup([mockMessage(fencedQuizJson)]);
    const data = await client.callJson(opts({ structuredOutput: false }));
    expect(data).toEqual(JSON.parse(validQuizJson));
    expect(createMessage.mock.calls[0]![0].output_config).toBeUndefined();
  });

  it("reports tokens and cost through onUsage", async () => {
    const { client } = setup([mockMessage(validQuizJson)]);
    const logs: LlmCallLog[] = [];
    await client.callJson(opts({ onUsage: (l) => logs.push(l) }));

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      agent: "examiner",
      model: "claude-sonnet-5",
      inputTokens: 1_000,
      outputTokens: 200,
      attempts: 1,
      ok: true,
    });
    // 1,000 × $2/M + 200 × $10/M
    expect(logs[0]!.costUsd).toBeCloseTo(0.004);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("agent=examiner"));
  });
});

describe("callJson: validation retry", () => {
  it("retries once after invalid JSON, appending the parse error", async () => {
    const { client, createMessage } = setup([mockMessage(malformedJson), mockMessage(validQuizJson)]);
    const data = await client.callJson(opts());

    expect(data).toEqual(JSON.parse(validQuizJson));
    expect(createMessage).toHaveBeenCalledTimes(2);
    const retry = createMessage.mock.calls[1]![0].messages;
    expect(retry).toHaveLength(3);
    expect(retry[1]).toEqual({ role: "assistant", content: malformedJson });
    expect(retry[2]!.content).toMatch(/Invalid JSON/);
    expect(retry[2]!.content).toMatch(/Respond with corrected JSON only/);
  });

  it("retries once after a Zod failure, appending the schema issues", async () => {
    const { client, createMessage } = setup([
      mockMessage(schemaInvalidQuizJson),
      mockMessage(validQuizJson),
    ]);
    await client.callJson(opts());

    const correction = createMessage.mock.calls[1]![0].messages[2]!.content as string;
    expect(correction).toMatch(/Schema validation failed/);
    expect(correction).toMatch(/question:/);
    expect(correction).toMatch(/options:/);
  });

  it("retries a max_tokens cut-off from scratch with double the budget", async () => {
    const { client, createMessage } = setup([
      mockMessage('{"question": "What', { stop_reason: "max_tokens" }),
      mockMessage(validQuizJson),
    ]);
    await client.callJson(opts({ maxTokens: 8_000 }));
    const [first, second] = createMessage.mock.calls.map(([p]) => p);
    expect(first!.max_tokens).toBe(8_000);
    expect(second!.max_tokens).toBe(16_000);
    expect(second!.messages).toHaveLength(1);
    expect(second!.messages[0]!.content).toMatch(/cut off at the output limit/);
  });

  it("caps the doubled budget at 64k", async () => {
    const { client, createMessage } = setup([mockMessage("{", { stop_reason: "max_tokens" }), mockMessage(validQuizJson)]);
    await client.callJson(opts({ maxTokens: 40_000 }));
    expect(createMessage.mock.calls[1]![0].max_tokens).toBe(64_000);
  });

  it("appends the error to the prompt when the invalid reply was empty", async () => {
    const { client, createMessage } = setup([mockMessage(""), mockMessage(validQuizJson)]);
    await client.callJson(opts());
    const retry = createMessage.mock.calls[1]![0].messages;
    expect(retry).toHaveLength(1);
    expect(retry[0]!.content).toMatch(/^Write one question about Excel SUM\.\n\nYour previous response failed/);
  });

  it("throws LlmValidationError when the retry is also invalid, logging the failure", async () => {
    const { client, createMessage } = setup([
      mockMessage(malformedJson),
      mockMessage(schemaInvalidQuizJson),
    ]);
    const logs: LlmCallLog[] = [];
    const err = (await client
      .callJson(opts({ onUsage: (l) => logs.push(l) }))
      .catch((e: unknown) => e)) as LlmValidationError;

    expect(err).toBeInstanceOf(LlmValidationError);
    expect(err.agent).toBe("examiner");
    expect(err.issues).toHaveLength(2);
    expect(err.rawText).toBe(schemaInvalidQuizJson);
    expect(createMessage).toHaveBeenCalledTimes(2);
    expect(logs[0]).toMatchObject({ ok: false, attempts: 2, inputTokens: 2_000, outputTokens: 400 });
  });
});

describe("callJson: network retries", () => {
  it("retries connection and 5xx errors with exponential backoff, then succeeds", async () => {
    const { client, createMessage, sleep } = setup([
      connectionError(),
      serverError(529),
      mockMessage(validQuizJson),
    ]);
    await expect(client.callJson(opts())).resolves.toEqual(JSON.parse(validQuizJson));
    expect(createMessage).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000]);
  });

  it("retries rate limits", async () => {
    const rateLimit = new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers());
    const { client, createMessage } = setup([rateLimit, mockMessage(validQuizJson)]);
    await client.callJson(opts());
    expect(createMessage).toHaveBeenCalledTimes(2);
  });

  it(`gives up after ${MAX_NETWORK_RETRIES} retries and rethrows the last error`, async () => {
    const { client, createMessage, sleep } = setup([
      connectionError(),
      connectionError(),
      connectionError(),
      serverError(503),
    ]);
    const logs: LlmCallLog[] = [];
    const err = await client.callJson(opts({ onUsage: (l) => logs.push(l) })).catch((e) => e);

    expect(err).toBeInstanceOf(Anthropic.InternalServerError);
    expect(createMessage).toHaveBeenCalledTimes(MAX_NETWORK_RETRIES + 1);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000, 4_000]);
    expect(logs[0]).toMatchObject({ ok: false, attempts: 4, inputTokens: 0 });
  });

  it("retries an overloaded error sent mid-stream (no HTTP status)", async () => {
    const midStream = new Anthropic.APIError(undefined, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, undefined, new Headers(), "overloaded_error");
    const { client, createMessage } = setup([midStream, mockMessage(validQuizJson)]);
    await expect(client.callJson(opts())).resolves.toEqual(JSON.parse(validQuizJson));
    expect(createMessage).toHaveBeenCalledTimes(2);
  });

  it("does not retry a mid-stream invalid_request_error", async () => {
    const midStream = new Anthropic.APIError(undefined, { type: "error", error: { type: "invalid_request_error" } }, undefined, new Headers(), "invalid_request_error");
    const { client, createMessage } = setup([midStream, mockMessage(validQuizJson)]);
    await expect(client.callJson(opts())).rejects.toBe(midStream);
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 400", async () => {
    const badRequest = new Anthropic.BadRequestError(400, undefined, "bad schema", new Headers());
    const { client, createMessage } = setup([badRequest, mockMessage(validQuizJson)]);
    await expect(client.callJson(opts())).rejects.toBe(badRequest);
    expect(createMessage).toHaveBeenCalledTimes(1);
  });
});

describe("callJson: other failures", () => {
  it("throws LlmRefusalError without retrying", async () => {
    const refusal = mockMessage("", {
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: null, explanation: "Not allowed." },
    } as Partial<Anthropic.Message>);
    const { client, createMessage } = setup([refusal, mockMessage(validQuizJson)]);
    await expect(client.callJson(opts())).rejects.toThrow(LlmRefusalError);
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  it("throws LlmConfigError when the model env var is missing", async () => {
    vi.stubEnv("MODEL_SMART", "");
    const { client, createMessage } = setup([mockMessage(validQuizJson)]);
    await expect(client.callJson(opts())).rejects.toThrow(LlmConfigError);
    expect(createMessage).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("stripCodeFence removes json fences and leaves bare JSON alone", () => {
    expect(stripCodeFence(fencedQuizJson)).toBe(validQuizJson);
    expect(stripCodeFence("```\n{}\n```")).toBe("{}");
    expect(stripCodeFence(`  ${validQuizJson}  `)).toBe(validQuizJson);
  });

  it("backoffMs honors a longer retry-after header", () => {
    const err = new Anthropic.RateLimitError(429, undefined, "slow down", new Headers({ "retry-after": "10" }));
    expect(backoffMs(0, err, () => 0.5)).toBe(10_000);
    expect(backoffMs(2, connectionError(), () => 0.5)).toBe(4_000);
  });
});
