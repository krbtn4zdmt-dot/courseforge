import { describe, expect, it, vi } from "vitest";

import type { CallJsonOptions } from "@/lib/llm/client";
import {
  canonicalUrl,
  combineScore,
  credibilityScore,
  dedupeSources,
  jaccard,
  rateRelevance,
  recencyScore,
  shingles,
  termOverlap,
  tokenize,
  topSources,
} from "@/lib/research/scoring";

const NOW = Date.parse("2026-09-30T00:00:00Z");

describe("text helpers", () => {
  it("tokenizes letters and digits in any script", () => {
    expect(tokenize("Battle of Gaugamela (331 BC) — Γαυγάμηλα!")).toEqual(["battle", "of", "gaugamela", "331", "bc", "γαυγάμηλα"]);
  });

  it("measures query-term overlap, ignoring stopwords", () => {
    expect(termOverlap("the battle of gaugamela", "Gaugamela: the battle explained")).toBe(1);
    expect(termOverlap("battle of gaugamela", "Battle of Issus")).toBe(0.5);
    expect(termOverlap("of the", "anything")).toBe(0);
  });
});

describe("credibilityScore", () => {
  it.each([
    ["https://en.wikipedia.org/wiki/Alexander_the_Great", 0.9],
    ["https://www.britannica.com/biography/Alexander-the-Great", 0.9],
    ["https://history.stanford.edu/courses", 0.9],
    ["https://www.nasa.gov/missions", 0.9],
    ["https://www.ox.ac.uk/research", 0.9],
    ["https://docs.github.com/en/actions", 0.85],
    ["https://developer.apple.com/documentation", 0.85],
    ["https://some-history-blog.com/alexander", 0.5],
    ["https://www.quora.com/Who-was-Alexander", 0.1],
    ["https://www.coursehero.com/file/123", 0.1],
    ["not a url", 0],
  ])("%s → %s", (url, score) => {
    expect(credibilityScore(url)).toBe(score);
  });

  it("matches whole domain labels, not substrings", () => {
    expect(credibilityScore("https://notwikipedia.org/x")).toBe(0.5);
    expect(credibilityScore("https://fakeedu.com/x")).toBe(0.5);
  });
});

describe("recencyScore", () => {
  it.each([
    ["2026-06-01", 1],
    ["2025-09-30", 1],
    ["2023-09-30", 0.5],
    ["2020-01-01", 0],
    [null, 0.5],
    ["not a date", 0.5],
  ])("%s → %s", (date, expected) => {
    expect(recencyScore(date, NOW)).toBeCloseTo(expected, 2);
  });
});

describe("combineScore", () => {
  it("weights relevance 0.6 and credibility 0.3, sharing out recency's weight when the topic isn't fast-moving", () => {
    // 0.6/0.9 × 1 + 0.3/0.9 × 0.5
    expect(combineScore({ relevance: 1, credibility: 0.5, recency: 0 })).toBeCloseTo(0.8333, 4);
  });

  it("adds recency at 0.1 for fast-moving topics", () => {
    expect(combineScore({ relevance: 1, credibility: 0.5, recency: 0 }, { fastMoving: true })).toBeCloseTo(0.75, 4);
    expect(combineScore({ relevance: 1, credibility: 0.5, recency: 1 }, { fastMoving: true })).toBeCloseTo(0.85, 4);
  });

  it("falls back to credibility (and recency) when relevance wasn't rated", () => {
    expect(combineScore({ relevance: null, credibility: 0.9, recency: 0 })).toBeCloseTo(0.9, 4);
    expect(combineScore({ relevance: null, credibility: 0.9, recency: 0.5 }, { fastMoving: true })).toBeCloseTo(0.8, 4);
  });

  it("stays within 0–1", () => {
    expect(combineScore({ relevance: 1, credibility: 1, recency: 1 }, { fastMoving: true })).toBeCloseTo(1, 10);
    expect(combineScore({ relevance: 0, credibility: 0, recency: 0 }, { fastMoving: true })).toBe(0);
  });
});

describe("topSources", () => {
  const s = (score: number) => ({ score });

  it("keeps sources scoring ≥ 0.4, best first, up to 6", () => {
    const picked = topSources([0.5, 0.9, 0.3, 0.7, 0.45, 0.8, 0.6, 0.65].map(s));
    expect(picked.map((x) => x.score)).toEqual([0.9, 0.8, 0.7, 0.65, 0.6, 0.5]);
  });

  it("tops up to 3 when fewer score well", () => {
    expect(topSources([0.2, 0.9, 0.1, 0.3].map(s)).map((x) => x.score)).toEqual([0.9, 0.3, 0.2]);
  });

  it("returns what there is when there are fewer than 3", () => {
    expect(topSources([0.2].map(s))).toHaveLength(1);
    expect(topSources([])).toEqual([]);
  });
});

describe("canonicalUrl", () => {
  it.each([
    ["http://www.Example.com/Path/", "https://example.com/Path"],
    ["https://example.com/a?utm_source=x&b=2&a=1&fbclid=z#section", "https://example.com/a?a=1&b=2"],
    ["https://example.com/", "https://example.com"],
    ["https://en.m.wikipedia.org/wiki/Alexander_the_Great", "https://en.wikipedia.org/wiki/Alexander_the_Great"],
    ["https://youtu.be/abc123?t=30", "https://youtube.com/watch?v=abc123"],
    ["https://m.youtube.com/watch?v=abc123&list=PL1", "https://youtube.com/watch?v=abc123"],
    ["not a url ", "not a url"],
  ])("%s → %s", (url, canonical) => {
    expect(canonicalUrl(url)).toBe(canonical);
  });
});

describe("shingles and jaccard", () => {
  it("builds 5-word shingles", () => {
    expect(shingles("one two three four five six")).toEqual(new Set(["one two three four five", "two three four five six"]));
    expect(shingles("too short")).toEqual(new Set(["too short"]));
    expect(shingles("")).toEqual(new Set());
  });

  it("computes Jaccard similarity", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3, 10);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe("dedupeSources", () => {
  const passage =
    "Alexander the Great led the Macedonian army across the Hellespont in 334 BC and defeated the Persian satraps at the Granicus river before marching south along the coast of Asia Minor";

  it("drops the same page under a different URL form, keeping the first", () => {
    const kept = dedupeSources([
      { url: "https://en.wikipedia.org/wiki/Alexander_the_Great", text: "a", id: 1 },
      { url: "http://en.m.wikipedia.org/wiki/Alexander_the_Great/", text: "b", id: 2 },
    ]);
    expect(kept.map((k) => k.id)).toEqual([1]);
  });

  it("drops near-duplicate text (Jaccard > 0.8 on 5-word shingles)", () => {
    const kept = dedupeSources([
      { url: "https://a.com/1", text: passage, id: 1 },
      { url: "https://b.com/copy", text: `${passage} today`, id: 2 },
      { url: "https://c.com/other", text: "The Battle of Gaugamela was fought in 331 BC near modern Erbil in Iraq between two great armies", id: 3 },
    ]);
    expect(kept.map((k) => k.id)).toEqual([1, 3]);
  });

  it("keeps texts that only partly overlap", () => {
    const half = passage.split(" ").slice(0, 16).join(" ");
    const kept = dedupeSources([
      { url: "https://a.com/1", text: passage, id: 1 },
      { url: "https://b.com/2", text: `${half} and then something entirely different happened in a completely new story`, id: 2 },
    ]);
    expect(kept).toHaveLength(2);
  });

  it("doesn't treat empty texts as duplicates of each other", () => {
    expect(dedupeSources([{ url: "https://a.com", text: "" }, { url: "https://b.com", text: "" }])).toHaveLength(2);
  });
});

describe("rateRelevance", () => {
  const items = [
    { id: "s1", subtopic: "Battle of Gaugamela", title: "Gaugamela - Wikipedia", excerpt: "The battle took place in 331 BC." },
    { id: "s2", subtopic: "Battle of Gaugamela", title: "Best pasta recipes", excerpt: "Cook the pasta." },
  ];

  it("makes one MODEL_FAST call per batch and maps ratings by id", async () => {
    const callJson = vi.fn(async (opts: CallJsonOptions<unknown>) => ({
      data: opts.schema.parse({ ratings: [{ id: "s1", relevance: 0.95 }, { id: "s2", relevance: 0 }] }),
      usage: { model: "claude-haiku-4-5", attempts: 1, costUsd: 0.001, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }));

    const result = await rateRelevance(items, { callJson: callJson as never });

    expect(result.ratings).toEqual(new Map([["s1", 0.95], ["s2", 0]]));
    expect(result.costUsd).toBeCloseTo(0.001, 10);
    expect(callJson).toHaveBeenCalledTimes(1);
    expect(callJson.mock.calls[0]![0]).toMatchObject({ agent: "relevance", model: "fast" });
    expect(callJson.mock.calls[0]![0].prompt).toContain("id: s2");
  });

  it("gives the client a schema that rejects missing or unknown ids (so the client retries)", async () => {
    const callJson = vi.fn(async (opts: CallJsonOptions<unknown>) => {
      const bad = opts.schema.safeParse({ ratings: [{ id: "s1", relevance: 0.9 }, { id: "s9", relevance: 0.1 }] });
      expect(bad.success).toBe(false);
      expect(bad.error?.message).toContain("Missing ratings for: s2");
      expect(bad.error?.message).toContain('Unknown id \\"s9\\"');
      throw new Error("stop");
    });
    await expect(rateRelevance(items, { callJson: callJson as never })).rejects.toThrow("stop");
  });

  it("batches large inputs in chunks of 40", async () => {
    const many = Array.from({ length: 85 }, (_, i) => ({ id: `s${i}`, subtopic: "t", title: "x", excerpt: "y" }));
    const callJson = vi.fn(async (opts: CallJsonOptions<unknown>) => {
      const ids = [...opts.prompt.matchAll(/^id: (\S+)$/gm)].map((m) => m[1]);
      return {
        data: { ratings: ids.map((id) => ({ id, relevance: 0.5 })) },
        usage: { model: "m", attempts: 1, costUsd: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
    });
    const result = await rateRelevance(many, { callJson: callJson as never });
    expect(callJson).toHaveBeenCalledTimes(3);
    expect(result.ratings.size).toBe(85);
    expect(result.costUsd).toBeNull();
  });
});
