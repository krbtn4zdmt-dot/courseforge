// YouTube Data API v3 client. Quota-bound: one client per course, capped at 8 searches.
// Per search: search.list (100 units) + videos.list (1) + channels.list (1).
// Results are cached by normalized query for 7 days; cached searches cost nothing.
// When quota runs out, searches return no videos instead of failing the course.
import { z } from "zod";

import type { Cache } from "./cache";
import { fetchJson, ResearchError, type FetchFn } from "./http";
import { termOverlap } from "./scoring";

export const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_TIMEOUT_MS = 10_000;
export const MAX_SEARCHES_PER_COURSE = 8;
export const QUOTA_UNITS = { search: 100, videos: 1, channels: 1 } as const;
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_DURATION_S = 3 * 60;
export const MAX_DURATION_S = 25 * 60;
export const SEARCH_MAX_RESULTS = 10;

/** Weights for scoreVideo; they sum to 1. */
export const VIDEO_SCORE_WEIGHTS = { title: 0.4, views: 0.3, subscribers: 0.2, recency: 0.1 } as const;

const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded"]);

export type YouTubeVideo = {
  videoId: string;
  url: string;
  title: string;
  channelTitle: string;
  durationSeconds: number;
  viewCount: number;
  subscriberCount: number;
  publishedAt: string;
  score: number;
};

export type YouTubeUsage = {
  searchesUsed: number;
  quotaUnitsUsed: number;
  quotaExhausted: boolean;
  /** Queries that got no videos because of the search cap or exhausted quota. */
  skippedQueries: string[];
};

const SearchSchema = z.object({
  items: z.array(
    z.object({
      id: z.object({ videoId: z.string().optional() }),
      snippet: z.object({
        title: z.string(),
        channelId: z.string(),
        channelTitle: z.string(),
        publishedAt: z.string(),
      }),
    }),
  ),
});

const VideosSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      contentDetails: z.object({ duration: z.string() }),
      statistics: z.object({ viewCount: z.string().optional() }).optional(),
    }),
  ),
});

const ChannelsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      statistics: z.object({ subscriberCount: z.string().optional() }).optional(),
    }),
  ),
});

function errorReason(body: unknown): string | null {
  const parsed = z
    .object({ error: z.object({ errors: z.array(z.object({ reason: z.string() })).min(1) }) })
    .safeParse(body);
  return parsed.success ? parsed.data.error.errors[0]!.reason : null;
}

/** ISO 8601 duration (e.g. "PT1H2M3S", "P1DT2H") to seconds; null if unparseable. */
export function parseIsoDuration(iso: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m || iso === "P" || iso.endsWith("T")) return null;
  const [d, h, min, s] = m.slice(1).map((v) => Number(v ?? 0)) as [number, number, number, number];
  return ((d * 24 + h) * 60 + min) * 60 + s;
}

export function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 0–1 score from log-scaled views and subscribers, recency, and title match. No like ratio. */
export function scoreVideo(
  v: { title: string; viewCount: number; subscriberCount: number; publishedAt: string },
  query: string,
  now: number,
): number {
  const views = clamp01(Math.log10(v.viewCount + 1) / 7); // 10M views → 1
  const subscribers = clamp01(Math.log10(v.subscriberCount + 1) / 7); // 10M subscribers → 1
  const ageYears = (now - Date.parse(v.publishedAt)) / (365.25 * 24 * 60 * 60 * 1000);
  const recency = Number.isFinite(ageYears) ? clamp01(1 - ageYears / 10) : 0.5; // 10+ years → 0
  const title = termOverlap(query, v.title);
  const w = VIDEO_SCORE_WEIGHTS;
  return w.title * title + w.views * views + w.subscribers * subscribers + w.recency * recency;
}

export type YouTubeClientOptions = {
  apiKey: string;
  cache: Cache;
  fetch?: FetchFn;
  maxSearches?: number;
  relevanceLanguage?: string;
  now?: () => number;
  warn?: (message: string) => void;
};

export function createYouTubeClient(opts: YouTubeClientOptions) {
  const fetch = opts.fetch ?? globalThis.fetch;
  const maxSearches = opts.maxSearches ?? MAX_SEARCHES_PER_COURSE;
  const lang = opts.relevanceLanguage ?? "en";
  const now = opts.now ?? Date.now;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const usage: YouTubeUsage = { searchesUsed: 0, quotaUnitsUsed: 0, quotaExhausted: false, skippedQueries: [] };

  async function get<T>(endpoint: string, params: Record<string, string>, schema: z.ZodType<T>, units: number): Promise<T> {
    const qs = new URLSearchParams({ ...params, key: opts.apiKey });
    // Every call is charged, whatever the outcome.
    usage.quotaUnitsUsed += units;
    const body = await fetchJson(`${YOUTUBE_API}/${endpoint}?${qs}`, {
      provider: "youtube",
      fetch,
      timeoutMs: YOUTUBE_TIMEOUT_MS,
      schema,
      errorReason,
    });
    if (!body) throw new ResearchError("youtube", `empty ${endpoint} response`);
    return body;
  }

  async function fetchVideos(query: string): Promise<YouTubeVideo[]> {
    const search = await get(
      "search",
      { part: "snippet", type: "video", q: query, maxResults: String(SEARCH_MAX_RESULTS), relevanceLanguage: lang },
      SearchSchema,
      QUOTA_UNITS.search,
    );
    const hits = search.items.flatMap((i) => (i.id.videoId ? [{ videoId: i.id.videoId, ...i.snippet }] : []));
    if (hits.length === 0) return [];

    const videos = await get(
      "videos",
      { part: "contentDetails,statistics", id: hits.map((h) => h.videoId).join(",") },
      VideosSchema,
      QUOTA_UNITS.videos,
    );
    const channelIds = [...new Set(hits.map((h) => h.channelId))];
    const channels = await get(
      "channels",
      { part: "statistics", id: channelIds.join(",") },
      ChannelsSchema,
      QUOTA_UNITS.channels,
    );

    const details = new Map(videos.items.map((v) => [v.id, v]));
    const subscribers = new Map(channels.items.map((c) => [c.id, Number(c.statistics?.subscriberCount ?? 0)]));
    const at = now();
    return hits
      .flatMap((h) => {
        const detail = details.get(h.videoId);
        const durationSeconds = detail ? parseIsoDuration(detail.contentDetails.duration) : null;
        if (durationSeconds === null || durationSeconds < MIN_DURATION_S || durationSeconds > MAX_DURATION_S) return [];
        const video = {
          videoId: h.videoId,
          url: `https://www.youtube.com/watch?v=${h.videoId}`,
          title: h.title,
          channelTitle: h.channelTitle,
          durationSeconds,
          viewCount: Number(detail?.statistics?.viewCount ?? 0),
          subscriberCount: subscribers.get(h.channelId) ?? 0,
          publishedAt: h.publishedAt,
        };
        return [{ ...video, score: scoreVideo(video, query, at) }];
      })
      .sort((a, b) => b.score - a.score);
  }

  /** Scored 3–25 minute videos for a query, best first. Returns [] when capped or out of quota. */
  async function searchVideos(query: string): Promise<YouTubeVideo[]> {
    const key = `youtube:v1:${lang}:${normalizeQuery(query)}`;
    const cached = await opts.cache.get<YouTubeVideo[]>(key);
    if (cached) return cached;

    if (usage.quotaExhausted || usage.searchesUsed >= maxSearches) {
      usage.skippedQueries.push(query);
      warn(
        `youtube: skipped "${query}" (${usage.quotaExhausted ? "quota exhausted" : `search cap of ${maxSearches} reached`})`,
      );
      return [];
    }

    usage.searchesUsed++;
    let videos: YouTubeVideo[];
    try {
      videos = await fetchVideos(query);
    } catch (err) {
      if (err instanceof ResearchError && err.reason !== null && QUOTA_REASONS.has(err.reason)) {
        usage.quotaExhausted = true;
        usage.skippedQueries.push(query);
        warn(`youtube: quota exhausted (${err.reason}); "${query}" and later searches get no videos`);
        return [];
      }
      throw err;
    }
    await opts.cache.set(key, videos, CACHE_TTL_MS);
    return videos;
  }

  return { searchVideos, usage: (): YouTubeUsage => ({ ...usage, skippedQueries: [...usage.skippedQueries] }) };
}
