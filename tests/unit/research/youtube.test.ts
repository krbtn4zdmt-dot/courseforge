import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryCache } from "@/lib/research/cache";
import { ResearchError } from "@/lib/research/http";
import {
  CACHE_TTL_MS,
  createYouTubeClient,
  decodeEntities,
  isQuotaError,
  MAX_SEARCHES_PER_COURSE,
  parseIsoDuration,
} from "@/lib/research/youtube";

import {
  channelsBody,
  jsonResponse,
  mockFetch,
  searchBody,
  videosBody,
  type FakeVideo,
} from "../../fixtures/research/mockFetch";
import keyInvalid from "../../fixtures/research/youtube.keyInvalid.json";
import quotaExceeded from "../../fixtures/research/youtube.quotaExceeded.json";

/** A fake YouTube API: each query returns `perQuery` videos with ids "<query>-<n>". */
function fakeYouTube(opts: { perQuery?: number; video?: (id: string) => Partial<FakeVideo>; quotaAfterSearches?: number } = {}) {
  const calls = { search: [] as string[], videos: [] as string[][], channels: [] as string[][] };
  const fetch = mockFetch((url) => {
    const endpoint = url.pathname.split("/").pop();
    if (endpoint === "search") {
      if (opts.quotaAfterSearches !== undefined && calls.search.length >= opts.quotaAfterSearches) {
        return jsonResponse(quotaExceeded, 403);
      }
      const q = url.searchParams.get("q")!;
      calls.search.push(q);
      const slug = q.replace(/\s+/g, "_");
      return jsonResponse(
        searchBody(
          Array.from({ length: opts.perQuery ?? 2 }, (_, i) => ({
            id: `${slug}-${i}`,
            channelId: `chan-${i % 3}`,
            ...opts.video?.(`${slug}-${i}`),
          })),
        ),
      );
    }
    if (endpoint === "videos") {
      const ids = url.searchParams.get("id")!.split(",");
      calls.videos.push(ids);
      return jsonResponse(videosBody(ids.map((id) => ({ id, ...opts.video?.(id) }))));
    }
    if (endpoint === "channels") {
      const ids = url.searchParams.get("id")!.split(",");
      calls.channels.push(ids);
      return jsonResponse(channelsBody(ids, ["chan-2"]));
    }
    return undefined;
  });
  return { fetch, calls };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("searchVideos", () => {
  it("searches, then fetches details once and returns scored-ready videos", async () => {
    const { fetch, calls } = fakeYouTube();
    const yt = createYouTubeClient({ apiKey: "k", cache: createMemoryCache(), fetch });
    const res = await yt.searchVideos(["alexander the great"], { language: "fr" });

    const [video] = res.videosByQuery["alexander the great"]!;
    expect(video).toEqual({
      videoId: "alexander_the_great-0",
      url: "https://www.youtube.com/watch?v=alexander_the_great-0",
      title: "Video alexander_the_great-0",
      channelId: "chan-0",
      channelTitle: "History Channel & Co",
      publishedAt: "2023-05-01T00:00:00Z",
      durationSeconds: 600,
      viewCount: 100_000,
      subscriberCount: 250_000,
    });
    expect(calls.search).toEqual(["alexander the great"]);
    expect(res).toMatchObject({ unitsUsed: 102, liveSearches: 1, cachedSearches: 0, quotaExhausted: false });

    const searchUrl = new URL(fetch.mock.calls[0]![0] as string);
    expect(Object.fromEntries(searchUrl.searchParams)).toMatchObject({
      part: "snippet",
      type: "video",
      maxResults: "10",
      relevanceLanguage: "fr",
      videoEmbeddable: "true",
      key: "k",
    });
  });

  it("keeps only 3–25 minute videos", async () => {
    const durations: Record<string, string> = { "q-0": "PT2M59S", "q-1": "PT3M", "q-2": "PT25M", "q-3": "PT25M1S", "q-4": "PT1H" };
    const { fetch } = fakeYouTube({ perQuery: 5, video: (id) => ({ duration: durations[id] }) });
    const yt = createYouTubeClient({ apiKey: "k", cache: createMemoryCache(), fetch });
    const res = await yt.searchVideos(["q"]);
    expect(res.videosByQuery.q!.map((v) => v.videoId)).toEqual(["q-1", "q-2"]);
  });

  it("reports hidden subscriber counts as null", async () => {
    const { fetch } = fakeYouTube({ perQuery: 3 });
    const yt = createYouTubeClient({ apiKey: "k", cache: createMemoryCache(), fetch });
    const res = await yt.searchVideos(["q"]);
    expect(res.videosByQuery.q![2]!.subscriberCount).toBeNull();
  });

  it(`stops at ${MAX_SEARCHES_PER_COURSE} live searches per course, across calls`, async () => {
    const { fetch, calls } = fakeYouTube();
    const yt = createYouTubeClient({ apiKey: "k", cache: createMemoryCache(), fetch });
    const first = await yt.searchVideos(["q1", "q2", "q3", "q4", "q5"]);
    const second = await yt.searchVideos(["q6", "q7", "q8", "q9", "q10"]);

    expect(calls.search).toHaveLength(8);
    expect(first.skippedQueries).toEqual([]);
    expect(second.skippedQueries).toEqual(["q9", "q10"]);
    expect(second.videosByQuery.q10).toEqual([]);
    expect(yt.stats()).toMatchObject({ liveSearches: 8, unitsUsed: 8 * 100 + 2 + 2 });
  });

  it("serves repeat queries from the cache without a search or counting toward the cap", async () => {
    const cache = createMemoryCache();
    const { fetch, calls } = fakeYouTube();
    await createYouTubeClient({ apiKey: "k", cache, fetch }).searchVideos(["Excel  PivotTables"]);

    const yt = createYouTubeClient({ apiKey: "k", cache, fetch });
    const res = await yt.searchVideos(["excel pivottables"]);
    expect(calls.search).toHaveLength(1);
    expect(res).toMatchObject({ liveSearches: 0, cachedSearches: 1, unitsUsed: 0 });
    expect(res.videosByQuery["excel pivottables"]).toHaveLength(2);
  });

  it("expires cached results after 7 days", async () => {
    let now = 0;
    const cache = createMemoryCache(() => now);
    const { fetch, calls } = fakeYouTube();
    await createYouTubeClient({ apiKey: "k", cache, fetch }).searchVideos(["q"]);
    now = CACHE_TTL_MS + 1;
    await createYouTubeClient({ apiKey: "k", cache, fetch }).searchVideos(["q"]);
    expect(calls.search).toHaveLength(2);
  });

  it("batches video and channel details 50 ids per call", async () => {
    const { fetch, calls } = fakeYouTube({ perQuery: 10 });
    const yt = createYouTubeClient({ apiKey: "k", cache: createMemoryCache(), fetch });
    const res = await yt.searchVideos(["q1", "q2", "q3", "q4", "q5", "q6"]); // 60 videos

    expect(calls.videos.map((ids) => ids.length)).toEqual([50, 10]);
    expect(calls.channels).toEqual([["chan-0", "chan-1", "chan-2"]]);
    expect(res.unitsUsed).toBe(6 * 100 + 2 + 1);
  });

  it("returns no videos, not an error, when quota runs out", async () => {
    const { fetch, calls } = fakeYouTube({ quotaAfterSearches: 1 });
    const yt = createYouTubeClient({ apiKey: "k", cache: createMemoryCache(), fetch });
    const res = await yt.searchVideos(["q1", "q2", "q3"]);

    expect(calls.search).toEqual(["q1"]);
    expect(res.quotaExhausted).toBe(true);
    expect(res.videosByQuery.q1).toHaveLength(2);
    expect(res.videosByQuery.q2).toEqual([]);
    expect(res.skippedQueries).toEqual(["q2", "q3"]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("quota exhausted"));
  });

  it("returns no videos when quota runs out on the first search", async () => {
    const { fetch } = fakeYouTube({ quotaAfterSearches: 0 });
    const yt = createYouTubeClient({ apiKey: "k", cache: createMemoryCache(), fetch });
    const res = await yt.searchVideos(["q1"]);
    expect(res).toMatchObject({ videosByQuery: { q1: [] }, quotaExhausted: true, skippedQueries: ["q1"] });
  });

  it("throws on other API errors (e.g. a bad key)", async () => {
    const fetch = mockFetch(() => jsonResponse(keyInvalid, 400));
    const yt = createYouTubeClient({ apiKey: "bad", cache: createMemoryCache(), fetch });
    await expect(yt.searchVideos(["q"])).rejects.toThrow(ResearchError);
  });

  it("throws when no API key is configured", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");
    const yt = createYouTubeClient({ cache: createMemoryCache(), fetch: mockFetch() });
    await expect(yt.searchVideos(["q"])).rejects.toThrow("YOUTUBE_API_KEY is not set");
    vi.unstubAllEnvs();
  });
});

describe("helpers", () => {
  it("parseIsoDuration", () => {
    expect(parseIsoDuration("PT10M")).toBe(600);
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("P1DT1S")).toBe(86_401);
    expect(parseIsoDuration("P0D")).toBe(0);
    expect(parseIsoDuration("10 minutes")).toBeNaN();
    expect(parseIsoDuration("PT")).toBeNaN();
  });

  it("decodeEntities", () => {
    expect(decodeEntities("Tom &amp; Jerry&#39;s &quot;Best&quot; &lt;3")).toBe(`Tom & Jerry's "Best" <3`);
  });

  it("isQuotaError only matches 403 quota reasons", () => {
    expect(isQuotaError(new ResearchError("youtube", "x", 403, quotaExceeded))).toBe(true);
    expect(isQuotaError(new ResearchError("youtube", "x", 400, keyInvalid))).toBe(false);
    expect(isQuotaError(new ResearchError("youtube", "x", 403, "forbidden"))).toBe(false);
    expect(isQuotaError(new Error("x"))).toBe(false);
  });
});
