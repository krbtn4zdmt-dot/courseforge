import { describe, expect, it, vi } from "vitest";

import { estimateCostUsd, formatCostUsd } from "@/lib/llm/cost";

describe("estimateCostUsd", () => {
  it("prices Sonnet 5 input and output tokens separately", () => {
    // 1M in at $2 + 0.5M out at $10 = $7
    expect(estimateCostUsd("claude-sonnet-5", { inputTokens: 1_000_000, outputTokens: 500_000 })).toBeCloseTo(7);
  });

  it("prices both Haiku 4.5 IDs the same", () => {
    const usage = { inputTokens: 10_000, outputTokens: 2_000 };
    expect(estimateCostUsd("claude-haiku-4-5", usage)).toBeCloseTo(0.02);
    expect(estimateCostUsd("claude-haiku-4-5-20251001", usage)).toBeCloseTo(0.02);
  });

  it("returns null and warns once for an unknown model", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(estimateCostUsd("claude-unknown", { inputTokens: 1, outputTokens: 1 })).toBeNull();
    expect(estimateCostUsd("claude-unknown", { inputTokens: 1, outputTokens: 1 })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("formatCostUsd", () => {
  it("formats known and unknown costs", () => {
    expect(formatCostUsd(0.0123456)).toBe("$0.01235");
    expect(formatCostUsd(null)).toBe("$?");
  });
});
