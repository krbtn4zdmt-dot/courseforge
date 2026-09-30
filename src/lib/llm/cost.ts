// Token → $ cost estimates and per-call logging.

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** USD per 1M tokens. */
export type ModelPrice = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

// Keyed by the model IDs used in MODEL_SMART / MODEL_FAST.
// TODO: confirm current prices at https://www.anthropic.com/pricing (last checked 2026-09-25).
// Cache writes are the 5-minute TTL rate (1.25x input).
export const PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** Looks up a model's price, ignoring a trailing date snapshot (e.g. `-20251001`). */
export function priceFor(model: string): ModelPrice | null {
  return PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, "")] ?? null;
}

/** Estimated cost in USD, or null when the model has no price entry. */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const micro =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheReadTokens * price.cacheRead +
    usage.cacheWriteTokens * price.cacheWrite;
  return micro / 1_000_000;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Adds two costs; unknown (null) stays unknown. */
export function addCost(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

export type LlmCallStatus =
  | "ok"
  | "validation_failed"
  | "refused"
  | "truncated"
  | "request_failed";

/** One line per callJson invocation. Shaped like the `llm_calls` table for Phase 2. */
export type LlmCallLog = TokenUsage & {
  event: "llm_call";
  agent: string;
  model: string;
  servedModel: string | null;
  status: LlmCallStatus;
  attempts: number;
  costUsd: number | null;
  durationMs: number;
};

export function logLlmCall(entry: LlmCallLog): void {
  console.info(JSON.stringify(entry));
}
