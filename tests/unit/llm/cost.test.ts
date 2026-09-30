import { describe, expect, it } from "vitest";

import { addCost, addUsage, estimateCostUsd, priceFor, ZERO_USAGE } from "@/lib/llm/cost";

describe("priceFor", () => {
  it("finds a model by exact ID", () => {
    expect(priceFor("claude-sonnet-5-5")?.input).toBe(2);
  });

  it("ignores a trailing date snapshot", () => {
    expect(priceFor("claude-haiku-4-5-20251001")).toEqual(priceFor("claude-haiku-4-5"));
  });

  it("returns null for an unknown model", () => {
    expect(priceFor("gpt-4o")).toBeNull();
  });
});

describe("estimateCostUsd", () => {
  it("prices input, output, and cache tokens per million", () => {
    const cost = estimateCostUsd("claude-sonnet-5-5", {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 500_000,
      cacheWriteTokens: 200_000,
    });
    // 2 + 1 + 0.1 + 0.5
    expect(cost).toBeCloseTo(3.6, 10);
  });

  it("prices Haiku with the dated model ID", () => {
    const cost = estimateCostUsd("claude-haiku-4-5-20251001", {
      ...ZERO_USAGE,
      inputTokens: 2_000,
      outputTokens: 1_000,
    });
    expect(cost).toBeCloseTo(0.007, 10);
  });

  it("returns null for an unknown model", () => {
    expect(estimateCostUsd("mystery-model", ZERO_USAGE)).toBeNull();
  });
});

describe("addUsage / addCost", () => {
  it("sums each token field", () => {
    const a = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 };
    expect(addUsage(a, a)).toEqual({ inputTokens: 2, outputTokens: 4, cacheReadTokens: 6, cacheWriteTokens: 8 });
  });

  it("keeps unknown cost unknown", () => {
    expect(addCost(0.5, 0.25)).toBe(0.75);
    expect(addCost(0.5, null)).toBeNull();
    expect(addCost(null, 0.5)).toBeNull();
  });
});
