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

  it("makes no call for an empty list", async () => {
    const call = vi.fn() as unknown as typeof callJson;
    expect((await rateRelevance({ topic: "t", items: [], callJsonFn: call })).size).toBe(0);
    expect(call).not.toHaveBeenCalled();
  });
});
