import { describe, expect, it } from "vitest";

import {
  canonicalUrl,
  combineSourceScore,
  CREDIBILITY,
  dedupeSources,
  domainCredibility,
  jaccard,
  logScale,
  rankSources,
  recencyScore,
  scoreVideo,
  shingles,
  titleRelevance,
} from "@/lib/research/scoring";

const now = new Date("2026-09-24T00:00:00Z");

describe("domainCredibility", () => {
  it.each([
    ["https://history.stanford.edu/alexander", CREDIBILITY.trusted],
    ["https://www.nasa.gov/black-holes", CREDIBILITY.trusted],
    ["https://www.ox.ac.uk/research", CREDIBILITY.trusted],
    ["https://en.wikipedia.org/wiki/Alexander_the_Great", CREDIBILITY.trusted],
    ["https://support.microsoft.com/en-us/office/sum", CREDIBILITY.trusted],
    ["https://www.britannica.com/biography/Alexander-the-Great", CREDIBILITY.trusted],
    ["https://someblog.example.com/post", CREDIBILITY.neutral],
    ["https://www.ehow.com/how_123", CREDIBILITY.low],
    ["https://www.quora.com/Who-was-Alexander", CREDIBILITY.low],
    ["not a url", CREDIBILITY.low],
  ])("%s -> %s", (url, expected) => {
    expect(domainCredibility(url)).toBe(expected);
  });

  it("does not match lookalike domains", () => {
    expect(domainCredibility("https://notwikipedia.org/x")).toBe(CREDIBILITY.neutral);
    expect(domainCredibility("https://wikipedia.org.evil.com/x")).toBe(CREDIBILITY.neutral);
  });
});

describe("recencyScore", () => {
  it("is 1 within a year, decays to 0.2 at 5 years, 0.5 when unknown", () => {
    expect(recencyScore("2026-03-01", now)).toBe(1);
    expect(recencyScore("2023-09-24", now)).toBeCloseTo(0.6, 1);
    expect(recencyScore("2015-01-01", now)).toBe(0.2);
    expect(recencyScore(null, now)).toBe(0.5);
    expect(recencyScore("not a date", now)).toBe(0.5);
  });
});

describe("combineSourceScore", () => {
  it("weights relevance 0.6 and credibility 0.4", () => {
    expect(combineSourceScore({ credibility: 0.9, relevance: 1 })).toBe(0.96);
    expect(combineSourceScore({ credibility: 0.2, relevance: 0.5 })).toBe(0.38);
  });

  it("weights 0.5 / 0.3 / 0.2 when recency applies", () => {
    expect(combineSourceScore({ credibility: 0.5, relevance: 1, recency: 0.2 })).toBe(0.69);
  });

  it("prefers a relevant neutral source over an irrelevant trusted one", () => {
    const relevantBlog = combineSourceScore({ credibility: CREDIBILITY.neutral, relevance: 0.9 });
    const offTopicEdu = combineSourceScore({ credibility: CREDIBILITY.trusted, relevance: 0.2 });
    expect(relevantBlog).toBeGreaterThan(offTopicEdu);
  });
});

describe("video scoring", () => {
  it("logScale", () => {
    expect(logScale(10_000_000, 10_000_000)).toBe(1);
    expect(logScale(1_000, 1_000_000)).toBeCloseTo(0.5);
    expect(logScale(0, 100)).toBe(0);
    expect(logScale(1e9, 1e6)).toBe(1);
  });

  it("titleRelevance ignores stopwords and case", () => {
    expect(titleRelevance("Alexander the Great: Conqueror", "alexander the great")).toBe(1);
    expect(titleRelevance("The Life of Alexander", "alexander the great")).toBe(0.5);
    expect(titleRelevance("Unrelated", "the")).toBe(0);
  });

  it("ranks a popular, on-topic video above an obscure off-topic one", () => {
    const base = { query: "alexander the great", publishedAt: "2024-01-01T00:00:00Z" };
    const good = scoreVideo({ ...base, title: "Alexander the Great explained", viewCount: 2_000_000, subscriberCount: 1_000_000 }, now);
    const weak = scoreVideo({ ...base, title: "My vacation vlog", viewCount: 300, subscriberCount: 50 }, now);
    expect(good).toBeGreaterThan(0.7);
    expect(weak).toBeLessThan(0.3);
    expect(scoreVideo({ ...base, title: "x", viewCount: 0, subscriberCount: null }, now)).toBeGreaterThan(0);
  });
});

describe("canonicalUrl", () => {
  it("treats scheme, www, fragments, tracking params and trailing slashes as equal", () => {
    const expected = "britannica.com/biography/alexander";
    expect(canonicalUrl("https://www.britannica.com/biography/alexander/")).toBe(expected);
    expect(canonicalUrl("http://britannica.com/biography/alexander#early-life")).toBe(expected);
    expect(canonicalUrl("https://britannica.com/biography/alexander?utm_source=x&fbclid=y")).toBe(expected);
  });

  it("keeps meaningful query params, sorted", () => {
    expect(canonicalUrl("https://example.com/watch?v=abc&t=10&utm_medium=z")).toBe("example.com/watch?t=10&v=abc");
  });

  it("keeps path case (paths can be case-sensitive)", () => {
    expect(canonicalUrl("https://en.wikipedia.org/wiki/Alexander_the_Great")).toBe("en.wikipedia.org/wiki/Alexander_the_Great");
  });
});

describe("shingles and jaccard", () => {
  it("builds 5-word shingles, ignoring case and punctuation", () => {
    expect([...shingles("Alexander, the Great, was king of Macedon.")]).toEqual([
      "alexander the great was king",
      "the great was king of",
      "great was king of macedon",
    ]);
    expect([...shingles("Too short")]).toEqual(["too short"]);
    expect(shingles("").size).toBe(0);
  });

  it("jaccard of identical, disjoint and partial sets", () => {
    const a = new Set(["1", "2", "3", "4"]);
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, new Set(["5"]))).toBe(0);
    expect(jaccard(a, new Set(["1", "2", "3", "5"]))).toBe(3 / 5);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe("dedupeSources", () => {
  const text =
    "Alexander the Great was king of Macedon from 336 to 323 BCE and built one of the largest empires of the ancient world, stretching from Greece to northwestern India.";

  it("drops a lower-scored copy of the same canonical URL", () => {
    const out = dedupeSources([
      { url: "http://www.site.com/a/", score: 0.5, text: "one" },
      { url: "https://site.com/a?utm_source=x", score: 0.8, text: "two" },
    ]);
    expect(out).toEqual([{ url: "https://site.com/a?utm_source=x", score: 0.8, text: "two" }]);
  });

  it("drops near-duplicate text (Jaccard > 0.8) and keeps the higher score", () => {
    const syndicated = `${text} Read more.`;
    const out = dedupeSources([
      { url: "https://a.com/1", score: 0.6, text },
      { url: "https://b.com/2", score: 0.9, text: syndicated },
      { url: "https://c.com/3", score: 0.7, text: "A completely different article about Persian history and the Achaemenid kings." },
    ]);
    expect(out.map((s) => s.url)).toEqual(["https://b.com/2", "https://c.com/3"]);
  });

  it("keeps texts that overlap at or below the threshold", () => {
    const half = text.split(" ").slice(0, 16).join(" ");
    const out = dedupeSources([
      { url: "https://a.com/1", score: 0.6, text },
      { url: "https://b.com/2", score: 0.9, text: `${half} and then something else entirely different follows here now` },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("rankSources", () => {
  it("returns the top N by score", () => {
    const sources = [0.2, 0.9, 0.5, 0.7, 0.1, 0.8, 0.3].map((score) => ({ score }));
    expect(rankSources(sources).map((s) => s.score)).toEqual([0.9, 0.8, 0.7, 0.5, 0.3, 0.2]);
    expect(rankSources(sources, 3).map((s) => s.score)).toEqual([0.9, 0.8, 0.7]);
  });
});
