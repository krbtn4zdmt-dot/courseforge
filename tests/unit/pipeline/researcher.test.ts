import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mapWithConcurrency,
  MAX_TEXT_SOURCES_PER_SUBTOPIC,
  MAX_VIDEOS_PER_SUBTOPIC,
  research,
  sourceTypeFor,
  webQueriesFor,
  type ResearchDeps,
} from "@/lib/pipeline/researcher";
import { ResearcherOutputSchema, type PlannerOutput } from "@/lib/pipeline/schemas";
import type { rateRelevance } from "@/lib/research/relevance";
import type { searchTavily, TavilyResult } from "@/lib/research/tavily";
import type { searchWikipedia } from "@/lib/research/wikipedia";
import type { YouTubeSearchResult, YouTubeVideo } from "@/lib/research/youtube";

import { excelPlan } from "../../fixtures/agents/builders";

const now = new Date("2026-09-24T00:00:00Z");

const knowledgePlan: PlannerOutput = {
  topicType: "knowledge",
  sensitiveDomain: null,
  subtopics: [
    { name: "Early life", importance: 1, prerequisites: [] },
    { name: "Conquest of Persia", importance: 2, prerequisites: ["Early life"] },
    { name: "Legacy", importance: 3, prerequisites: [] },
  ],
  searchQueries: [
    { subtopic: "Early life", queries: ["alexander early life", "alexander aristotle tutor"] },
    { subtopic: "Conquest of Persia", queries: ["alexander persia conquest", "battle of gaugamela", "darius iii alexander"] },
    { subtopic: "Legacy", queries: ["alexander legacy hellenistic", "alexander legacy today"] },
  ],
  commonMisconceptions: [],
};

/** Tavily fake: 3 results per query, URLs derived from the query. */
function fakeTavily(opts: { fail?: string[] } = {}) {
  return vi.fn(async ({ query, depth, includeRawContent }: Parameters<typeof searchTavily>[0]): Promise<TavilyResult[]> => {
    if (opts.fail?.includes(query)) throw new Error("HTTP 502");
    const slug = query.replace(/\s+/g, "-");
    return [0, 1, 2].map((i) => ({
      url: `https://site${i}.example.com/${slug}`,
      title: `${query} ${i}`,
      content: `About ${query}, result ${i}. More detail here.`,
      rawContent: includeRawContent ? `Intro about ${query} number ${i} with plenty of detail words.\n\nFooter links and cookie notices here now.` : null,
      score: 0.9,
      publishedDate: null,
    })).concat(depth === "basic" ? [] : []);
  });
}

const fakeRelevance = vi.fn(async ({ items }: Parameters<typeof rateRelevance>[0]) => new Map(items.map((it, i) => [it.id, i % 2 ? 0.6 : 0.9])));

const video = (id: string, query: string, views: number): YouTubeVideo => ({
  videoId: id,
  url: `https://www.youtube.com/watch?v=${id}`,
  title: `${query} video`,
  channelId: "c",
  channelTitle: "Chan",
  publishedAt: "2024-01-01T00:00:00Z",
  durationSeconds: 600,
  viewCount: views,
  subscriberCount: 100_000,
});

function fakeYouTube(videosPerQuery = 5) {
  return {
    searchVideos: vi.fn(async (queries: string[]): Promise<YouTubeSearchResult> => ({
      videosByQuery: Object.fromEntries(queries.map((q) => [q, Array.from({ length: videosPerQuery }, (_, i) => video(`${q.length}-${i}`, q, 1000 * 10 ** i))])),
      unitsUsed: queries.length * 100 + 2,
      liveSearches: queries.length,
      cachedSearches: 0,
      quotaExhausted: false,
      skippedQueries: [],
    })),
  };
}

const fakeWikipedia = vi.fn(async (query: string) => ({
  title: query,
  url: `https://en.wikipedia.org/wiki/${query.replace(/ /g, "_")}`,
  extract: `${query} is covered by this encyclopedia article. It has several sentences.`,
  description: null,
})) as unknown as typeof searchWikipedia;

function deps(extra: Partial<ResearchDeps> = {}): ResearchDeps {
  return {
    searchTavily: fakeTavily() as unknown as typeof searchTavily,
    rateRelevance: fakeRelevance as unknown as typeof rateRelevance,
    searchWikipedia: fakeWikipedia,
    youtube: fakeYouTube(),
    now: () => now,
    ...extra,
  };
}

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("webQueriesFor", () => {
  it("light uses each subtopic's first query; deep uses the rest", () => {
    expect(webQueriesFor(knowledgePlan, "light").map((j) => j.query)).toEqual([
      "alexander early life",
      "alexander persia conquest",
      "alexander legacy hellenistic",
    ]);
    expect(webQueriesFor(knowledgePlan, "deep").map((j) => j.query)).toEqual([
      "alexander aristotle tutor",
      "battle of gaugamela",
      "darius iii alexander",
      "alexander legacy today",
    ]);
  });
});

describe("research: light mode", () => {
  it("runs one basic query per subtopic, no raw content, no YouTube or Wikipedia", async () => {
    const d = deps();
    const { output, stats } = await research({ topic: "Alexander the Great", plan: knowledgePlan, mode: "light" }, d);

    const tavily = vi.mocked(d.searchTavily!);
    expect(tavily).toHaveBeenCalledTimes(3);
    for (const [opts] of tavily.mock.calls) expect(opts).toMatchObject({ depth: "basic", includeRawContent: false, maxResults: 5 });
    expect(d.youtube!.searchVideos).not.toHaveBeenCalled();
    expect(fakeWikipedia).not.toHaveBeenCalled();

    expect(ResearcherOutputSchema.safeParse(output).success).toBe(true);
    expect(output.map((o) => o.subtopic)).toEqual(["Early life", "Conquest of Persia", "Legacy"]);
    const sources = output.flatMap((o) => o.sources);
    expect(sources).toHaveLength(9);
    expect(sources.every((s) => s.grounding === null && s.type === "web")).toBe(true);
    expect(stats).toMatchObject({ mode: "light", webQueries: 3, failedQueries: [], youtubeUnits: 0 });
  });

  it("scores with relevance and credibility, highest first, with a short excerpt", async () => {
    const { output } = await research({ topic: "t", plan: knowledgePlan, mode: "light" }, deps());
    // relevance alternates 0.9 / 0.6 across candidates, neutral credibility 0.5: 0.74 or 0.56
    expect(output[0]!.sources.map((s) => s.score)).toEqual([0.74, 0.74, 0.56]);
    expect(output[0]!.sources[0]!.excerpt).toBe("About alexander early life, result 0. More detail here.");
  });

  it("keeps going when some queries fail, and records them", async () => {
    const d = deps({ searchTavily: fakeTavily({ fail: ["alexander legacy hellenistic"] }) as unknown as typeof searchTavily });
    const { output, stats } = await research({ topic: "t", plan: knowledgePlan, mode: "light" }, d);
    expect(stats.failedQueries).toEqual(["alexander legacy hellenistic"]);
    expect(output[2]!.sources).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 502"));
  });

  it("throws when every query fails", async () => {
    const all = webQueriesFor(knowledgePlan, "light").map((j) => j.query);
    const d = deps({ searchTavily: fakeTavily({ fail: all }) as unknown as typeof searchTavily });
    await expect(research({ topic: "t", plan: knowledgePlan, mode: "light" }, d)).rejects.toThrow("all 3 light web queries failed");
  });
});

describe("research: deep mode", () => {
  it("runs the remaining queries with raw content, trims grounding, adds Wikipedia and YouTube", async () => {
    const d = deps();
    const { output, stats } = await research({ topic: "Alexander the Great", plan: knowledgePlan, mode: "deep" }, d);

    const tavily = vi.mocked(d.searchTavily!);
    expect(tavily.mock.calls.map(([o]) => o.query)).toEqual(webQueriesFor(knowledgePlan, "deep").map((j) => j.query));
    for (const [opts] of tavily.mock.calls) expect(opts).toMatchObject({ depth: "advanced", includeRawContent: true });

    // Wikipedia: importance-1 subtopics only
    expect(vi.mocked(fakeWikipedia).mock.calls.map(([q]) => q)).toEqual(["Alexander the Great Early life"]);
    // YouTube: importance 1–2 subtopics, first query each
    expect(d.youtube!.searchVideos).toHaveBeenCalledWith(["alexander early life", "alexander persia conquest"], { language: "en" });

    const early = output[0]!.sources;
    expect(early.filter((s) => s.type === "wiki")).toHaveLength(1);
    expect(early.find((s) => s.type === "wiki")!.title).toBe("Alexander the Great Early life (Wikipedia)");
    expect(early.find((s) => s.type === "web")!.grounding).toMatch(/^Intro about alexander aristotle tutor/);
    expect(early.find((s) => s.type === "web")!.grounding).not.toContain("cookie");
    expect(early.filter((s) => s.type === "video")).toHaveLength(MAX_VIDEOS_PER_SUBTOPIC);
    expect(output[2]!.sources.filter((s) => s.type === "video")).toHaveLength(0); // Legacy is importance 3
    expect(stats).toMatchObject({ mode: "deep", webQueries: 4, wikipediaLookups: 1, youtubeUnits: 202 });
    expect(ResearcherOutputSchema.safeParse(output).success).toBe(true);
  });

  it("ranks videos by score and keeps the top 3", async () => {
    const { output } = await research({ topic: "t", plan: knowledgePlan, mode: "deep" }, deps());
    const videos = output[0]!.sources.filter((s) => s.type === "video");
    expect(videos.map((v) => v.score)).toEqual([...videos.map((v) => v.score)].sort((a, b) => b - a));
    expect(videos[0]!.excerpt).toBe("Chan · 10 min");
  });

  it("skips Wikipedia for skill topics", async () => {
    await research({ topic: "Excel", plan: excelPlan, mode: "deep" }, deps());
    expect(fakeWikipedia).not.toHaveBeenCalled();
  });

  it("merges with light results, preferring the deep copy of the same page", async () => {
    const light = await research({ topic: "t", plan: knowledgePlan, mode: "light" }, deps());
    const sameUrlTavily = vi.fn(async ({ includeRawContent }: Parameters<typeof searchTavily>[0]) => [
      {
        url: "https://site0.example.com/alexander-early-life/", // same page as a light result
        title: "Deep copy",
        content: "Deep copy of the page.",
        rawContent: includeRawContent ? "Alexander early life in detail, a long paragraph of text." : null,
        score: 0.9,
        publishedDate: null,
      },
    ]) as unknown as typeof searchTavily;

    const { output } = await research(
      { topic: "t", plan: knowledgePlan, mode: "deep", previous: light.output },
      deps({ searchTavily: sameUrlTavily, youtube: fakeYouTube(0) }),
    );
    const early = output[0]!.sources.filter((s) => s.type !== "wiki");
    const copies = early.filter((s) => s.url.includes("site0.example.com/alexander-early-life"));
    expect(copies).toHaveLength(1);
    expect(copies[0]!.title).toBe("Deep copy");
    expect(copies[0]!.grounding).toContain("Alexander early life in detail");
    expect(early.length).toBeGreaterThan(1); // other light sources kept
  });

  it("caps text sources per subtopic", async () => {
    const many = vi.fn(async ({ query }: Parameters<typeof searchTavily>[0]) =>
      Array.from({ length: 10 }, (_, i) => ({
        url: `https://s${i}.example.com/${query.length}`,
        title: `t${i}`,
        content: `Completely distinct content number ${i} for ${query} with unique words ${"x".repeat(i)}.`,
        rawContent: null,
        score: 1,
        publishedDate: null,
      })),
    ) as unknown as typeof searchTavily;
    const { output } = await research({ topic: "t", plan: knowledgePlan, mode: "light" }, deps({ searchTavily: many }));
    expect(output[0]!.sources).toHaveLength(MAX_TEXT_SOURCES_PER_SUBTOPIC);
  });
});

describe("helpers", () => {
  it("sourceTypeFor", () => {
    expect(sourceTypeFor("https://en.wikipedia.org/wiki/X")).toBe("wiki");
    expect(sourceTypeFor("https://docs.python.org/3/")).toBe("docs");
    expect(sourceTypeFor("https://support.microsoft.com/en-us/office")).toBe("docs");
    expect(sourceTypeFor("https://www.youtube.com/watch?v=1")).toBe("video");
    expect(sourceTypeFor("https://www.britannica.com/x")).toBe("web");
  });

  it("mapWithConcurrency keeps order and never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 70]);
    expect(peak).toBe(3);
  });
});
