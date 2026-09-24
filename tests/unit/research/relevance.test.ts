import { afterEach, describe, expect, it, vi } from "vitest";

import type { callJson } from "@/lib/llm/client";
import { RelevanceOutputSchema } from "@/lib/pipeline/schemas";
import { DEFAULT_RELEVANCE, rateRelevance, RELEVANCE_BATCH_SIZE } from "@/lib/research/relevance";

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, subtopic: "Early life", title: `Title ${i + 1}`, snippet: "..." }));

afterEach(() => vi.restoreAllMocks());

describe("rateRelevance", () => {
  it("batches up to 25 sources per MODEL_FAST call", async () => {
    const call = vi.fn(async (opts: Parameters<typeof callJson>[0]) => {
      const ids = [...opts.prompt.matchAll(/^id: (\S+)$/gm)].map((m) => m[1]!);
      return { scores: ids.map((id) => ({ id, relevance: 0.8 })) };
    }) as unknown as typeof callJson;

    const scores = await rateRelevance({ topic: "Alexander the Great", items: items(30), callJsonFn: call });

    expect(call).toHaveBeenCalledTimes(2);
    const first = vi.mocked(call).mock.calls[0]![0];
    expect(first).toMatchObject({ agent: "relevance", model: "fast", schema: RelevanceOutputSchema });
    expect([...first.prompt.matchAll(/^id: /gm)]).toHaveLength(RELEVANCE_BATCH_SIZE);
    expect(scores.size).toBe(30);
    expect(scores.get("s30")).toBe(0.8);
  });

  it("falls back to 0.5 for skipped ids and ignores unknown ones", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const call = vi.fn(async () => ({
      scores: [
        { id: "s1", relevance: 0.9 },
        { id: "s99", relevance: 1 },
      ],
    })) as unknown as typeof callJson;

    const scores = await rateRelevance({ topic: "t", items: items(2), callJsonFn: call });
    expect(scores).toEqual(new Map([["s1", 0.9], ["s2", DEFAULT_RELEVANCE]]));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("s2"));
  });

  it("runs batches in parallel and falls back to 0.5 only for a failed batch", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let inFlight = 0;
    let peak = 0;
    const call = vi.fn(async (opts: Parameters<typeof callJson>[0]) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const ids = [...opts.prompt.matchAll(/^id: (\S+)$/gm)].map((m) => m[1]!);
      if (ids.includes("s26")) throw new Error("validation failed twice");
      return { scores: ids.map((id) => ({ id, relevance: 0.9 })) };
    }) as unknown as typeof callJson;

    const scores = await rateRelevance({ topic: "t", items: items(60), callJsonFn: call }); // 3 batches
    expect(peak).toBe(3);
    expect(scores.get("s1")).toBe(0.9);
    expect(scores.get("s26")).toBe(DEFAULT_RELEVANCE); // second batch (s26–s50) failed
    expect(scores.get("s50")).toBe(DEFAULT_RELEVANCE);
    expect(scores.get("s51")).toBe(0.9);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("a batch of 25 failed"));
  });

  it("makes no call for an empty list", async () => {
    const call = vi.fn() as unknown as typeof callJson;
    expect((await rateRelevance({ topic: "t", items: [], callJsonFn: call })).size).toBe(0);
    expect(call).not.toHaveBeenCalled();
  });
});
