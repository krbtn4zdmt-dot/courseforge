import { describe, expect, it, vi } from "vitest";

import { createMemoryCache } from "@/lib/research/cache";
import { ResearchError } from "@/lib/research/http";
import {
  CACHE_TTL_MS,
  createYouTubeClient,
  normalizeQuery,
  parseIsoDuration,
  scoreVideo,
} from "@/lib/research/youtube";

import { fakeFetch, type Route } from "../../fixtures/research/fetch";
import badKey from "../../fixtures/research/youtube.badKey.json";
import channels from "../../fixtures/research/youtube.channels.json";
import quotaExceeded from "../../fixtures/research/youtube.quotaExceeded.json";
import search from "../../fixtures/research/youtube.search.json";
import videos from "../../fixtures/research/youtube.videos.json";

const NOW = Date.parse("2026-09-30T00:00:00Z");
const OK_ROUTES: Route[] = [
  { match: "/youtube/v3/search", body: search },
  { match: "/youtube/v3/videos", body: videos },
  { match: "/youtube/v3/channels", body: channels },
];

function setup(routes: Route[] = OK_ROUTES, maxSearches?: number) {
  let now = NOW;
  const { fetch, calls } = fakeFetch(routes);
  const warn = vi.fn();
  const cache = createMemoryCache(() => now);
  const client = createYouTubeClient({ apiKey: "key", cache, fetch, now: () => now, warn, maxSearches });
  return { client, calls, warn, advance: (ms: number) => (now += ms) };
}

describe("parseIsoDuration", () => {
  it.each([
    ["PT12M30S", 750],
    ["PT1H5M", 3900],
    ["PT45S", 45],
    ["P1DT2H", 93600],
    ["P0D", 0],
    ["PT", null],
    ["P", null],
    ["12:30", null],
  ])("%s → %s", (iso, seconds) => {
    expect(parseIsoDuration(iso)).toBe(seconds);
  });
});

describe("scoreVideo", () => {
  const base = { title: "Battle of Gaugamela explained", viewCount: 1_000_000, subscriberCount: 500_000, publishedAt: "2025-09-30T00:00:00Z" };

  it("is 0–1 and rewards title match, views, subscribers and recency", () => {
    const s = scoreVideo(base, "battle of gaugamela", NOW);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(scoreVideo({ ...base, title: "Cooking pasta" }, "battle of gaugamela", NOW)).toBeLessThan(s);
    expect(scoreVideo({ ...base, viewCount: 100 }, "battle of gaugamela", NOW)).toBeLessThan(s);
    expect(scoreVideo({ ...base, subscriberCount: 10 }, "battle of gaugamela", NOW)).toBeLessThan(s);
    expect(scoreVideo({ ...base, publishedAt: "2012-01-01T00:00:00Z" }, "battle of gaugamela", NOW)).toBeLessThan(s);
  });

  it("caps at 1 for a perfect video", () => {
    const perfect = { title: "gaugamela", viewCount: 1e9, subscriberCount: 1e9, publishedAt: "2026-09-29T00:00:00Z" };
    expect(scoreVideo(perfect, "gaugamela", NOW)).toBeCloseTo(1, 2);
  });
});

describe("youtube client", () => {
  it("returns scored 3–25 minute videos, best first, and tracks quota", async () => {
    const { client, calls } = setup();
    const results = await client.searchVideos("Battle of Gaugamela");

    // vidShort (1 min) and vidLong (65 min) are filtered out; the channel result is ignored.
    expect(results.map((v) => v.videoId)).toEqual(["vidGood", "vidOther"]);
    expect(results[0]).toMatchObject({
      url: "https://www.youtube.com/watch?v=vidGood",
      durationSeconds: 750,
      viewCount: 2_500_000,
      subscriberCount: 1_200_000,
      channelTitle: "History Explained",
    });
    expect(results[1]).toMatchObject({ viewCount: 0, subscriberCount: 0 });
    expect(client.usage()).toEqual({ searchesUsed: 1, quotaUnitsUsed: 102, quotaExhausted: false, skippedQueries: [] });

    const searchUrl = new URL(calls[0]!.url);
    expect(searchUrl.searchParams.get("type")).toBe("video");
    expect(searchUrl.searchParams.get("maxResults")).toBe("10");
    expect(searchUrl.searchParams.get("relevanceLanguage")).toBe("en");
    // One videos.list for all ids and one channels.list for the distinct channels.
    expect(new URL(calls[1]!.url).searchParams.get("id")).toBe("vidGood,vidShort,vidLong,vidOther");
    expect(new URL(calls[2]!.url).searchParams.get("id")).toBe("chanA,chanB,chanC");
  });

  it("serves repeat queries from the cache for 7 days, at no quota cost", async () => {
    const { client, calls, advance } = setup();
    await client.searchVideos("Battle of Gaugamela");
    const cached = await client.searchVideos("  battle OF   gaugamela ");
    expect(cached.map((v) => v.videoId)).toEqual(["vidGood", "vidOther"]);
    expect(calls).toHaveLength(3);
    expect(client.usage()).toMatchObject({ searchesUsed: 1, quotaUnitsUsed: 102 });

    advance(CACHE_TTL_MS + 1);
    await client.searchVideos("Battle of Gaugamela");
    expect(calls).toHaveLength(6);
  });

  it("stops at 8 searches per course and returns no videos after that", async () => {
    const { client, calls, warn } = setup();
    for (let i = 1; i <= 8; i++) await client.searchVideos(`query ${i}`);
    expect(await client.searchVideos("query 9")).toEqual([]);
    expect(calls.filter((c) => c.url.includes("/search?"))).toHaveLength(8);
    expect(client.usage()).toMatchObject({ searchesUsed: 8, quotaUnitsUsed: 816, skippedQueries: ["query 9"] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("search cap of 8"));
  });

  it("respects a custom search cap", async () => {
    const { client } = setup(OK_ROUTES, 1);
    await client.searchVideos("a");
    expect(await client.searchVideos("b")).toEqual([]);
  });

  it("returns no videos (not an error) when quota runs out, and stops calling the API", async () => {
    const { client, calls, warn } = setup([{ match: "/youtube/v3/search", status: 403, body: quotaExceeded }]);
    expect(await client.searchVideos("a")).toEqual([]);
    expect(await client.searchVideos("b")).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(client.usage()).toEqual({ searchesUsed: 1, quotaUnitsUsed: 100, quotaExhausted: true, skippedQueries: ["a", "b"] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("quota exhausted (quotaExceeded)"));
  });

  it("treats quota running out mid-search the same way", async () => {
    const { client } = setup([
      { match: "/youtube/v3/search", body: search },
      { match: "/youtube/v3/videos", status: 403, body: quotaExceeded },
    ]);
    expect(await client.searchVideos("a")).toEqual([]);
    expect(client.usage()).toMatchObject({ quotaExhausted: true, quotaUnitsUsed: 101 });
  });

  it("throws other API errors", async () => {
    const { client } = setup([{ match: "/youtube/v3/search", status: 400, body: badKey }]);
    const error = await client.searchVideos("a").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResearchError);
    expect(error).toMatchObject({ provider: "youtube", status: 400, reason: "badRequest" });
    expect(client.usage().quotaExhausted).toBe(false);
  });

  it("handles a search with no video results", async () => {
    const { client, calls } = setup([{ match: "/youtube/v3/search", body: { items: [] } }]);
    expect(await client.searchVideos("zzzz")).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(client.usage().quotaUnitsUsed).toBe(100);
  });

  it("normalizes queries for the cache key", () => {
    expect(normalizeQuery("  Battle   OF Gaugamela ")).toBe("battle of gaugamela");
  });
});
