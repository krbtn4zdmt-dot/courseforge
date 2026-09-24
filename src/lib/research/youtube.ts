import "server-only";

import { z } from "zod";

import { DAY_MS, normalizeQuery, type ResearchCache } from "./cache";
import { fetchJson, ResearchError, type FetchFn } from "./http";

// Quota plan: docs/ARCHITECTURE.md, "Research details" > YouTube.

const API = "https://www.googleapis.com/youtube/v3";
const TIMEOUT_MS = 10_000;
export const MAX_SEARCHES_PER_COURSE = 8;
export const UNITS = { search: 100, videos: 1, channels: 1 } as const;
export const CACHE_TTL_MS = 7 * DAY_MS;
export const MIN_DURATION_S = 3 * 60;
export const MAX_DURATION_S = 25 * 60;
const IDS_PER_BATCH = 50;
const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded"]);

export interface YouTubeVideo {
  videoId: string;
  url: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: number;
  /** null when the channel hides it. */
  subscriberCount: number | null;
}

export interface YouTubeSearchResult {
  /** Keyed by the query as given. Queries skipped or failed map to []. */
  videosByQuery: Record<string, YouTubeVideo[]>;
  unitsUsed: number;
  liveSearches: number;
  cachedSearches: number;
  quotaExhausted: boolean;
  /** Queries that got no search because of the per-course cap or exhausted quota. */
  skippedQueries: string[];
}

// ---------- API response shapes ----------

const SearchResponse = z.object({
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

const VideosResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      contentDetails: z.object({ duration: z.string() }),
      statistics: z.object({ viewCount: z.string().optional() }),
    }),
  ),
});

const ChannelsResponse = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        statistics: z.object({
          subscriberCount: z.string().optional(),
          hiddenSubscriberCount: z.boolean().optional(),
        }),
      }),
    )
    .default([]),
});

const ErrorBody = z.object({
  error: z.object({ errors: z.array(z.object({ reason: z.string() })).optional() }),
});

// ---------- pure helpers ----------

/** ISO 8601 duration ("PT1H2M3S", "P1DT2H") to seconds; NaN if unparseable. */
export function parseIsoDuration(iso: string): number {
  const m = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m || iso === "P" || iso === "PT") return NaN;
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return d! * 86_400 + h! * 3_600 + min! * 60 + s!;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };

/** search.list snippets HTML-escape titles. */
export function decodeEntities(text: string): string {
  return text.replace(/&(amp|quot|#39|lt|gt);/g, (e) => ENTITIES[e] ?? e);
}

export function isQuotaError(err: unknown): boolean {
  if (!(err instanceof ResearchError) || err.status !== 403) return false;
  const body = ErrorBody.safeParse(err.body);
  return body.success && (body.data.error.errors ?? []).some((e) => QUOTA_REASONS.has(e.reason));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------- client ----------

export interface YouTubeClientOptions {
  cache: ResearchCache;
  apiKey?: string;
  fetch?: FetchFn;
  maxSearches?: number;
}

type SearchHit = z.infer<typeof SearchResponse>["items"][number] & { id: { videoId: string } };

/** One client per course: the search cap and unit count span every call on the instance. */
export function createYouTubeClient(opts: YouTubeClientOptions) {
  const apiKey = opts.apiKey ?? process.env.YOUTUBE_API_KEY;
  const maxSearches = opts.maxSearches ?? MAX_SEARCHES_PER_COURSE;
  const state = { unitsUsed: 0, liveSearches: 0, quotaExhausted: false };

  async function get<T>(endpoint: string, params: Record<string, string>, schema: z.ZodType<T>, units: number) {
    if (!apiKey) throw new ResearchError("youtube", "YOUTUBE_API_KEY is not set");
    const url = `${API}/${endpoint}?${new URLSearchParams({ ...params, key: apiKey })}`;
    state.unitsUsed += units; // YouTube charges failed requests too
    return (await fetchJson({ service: "youtube", url, schema, timeoutMs: TIMEOUT_MS, fetch: opts.fetch }))!;
  }

  /** Runs `fn`; on a quota error marks quota exhausted and returns undefined. Other errors throw. */
  async function quotaSafe<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      state.quotaExhausted = true;
      return undefined;
    }
  }

  async function fetchDetails(hits: SearchHit[]) {
    const videoIds = [...new Set(hits.map((h) => h.id.videoId))];
    const channelIds = [...new Set(hits.map((h) => h.snippet.channelId))];
    const videos = new Map<string, z.infer<typeof VideosResponse>["items"][number]>();
    const subscribers = new Map<string, number | null>();

    for (const ids of chunk(videoIds, IDS_PER_BATCH)) {
      const res = await quotaSafe(() =>
        get("videos", { part: "contentDetails,statistics", id: ids.join(","), maxResults: "50" }, VideosResponse, UNITS.videos),
      );
      if (!res) return undefined;
      for (const v of res.items) videos.set(v.id, v);
    }
    for (const ids of chunk(channelIds, IDS_PER_BATCH)) {
      const res = await quotaSafe(() =>
        get("channels", { part: "statistics", id: ids.join(","), maxResults: "50" }, ChannelsResponse, UNITS.channels),
      );
      if (!res) return undefined;
      for (const c of res.items) {
        const hidden = c.statistics.hiddenSubscriberCount || c.statistics.subscriberCount === undefined;
        subscribers.set(c.id, hidden ? null : Number(c.statistics.subscriberCount));
      }
    }
    return { videos, subscribers };
  }

  function toVideo(hit: SearchHit, details: NonNullable<Awaited<ReturnType<typeof fetchDetails>>>): YouTubeVideo | null {
    const v = details.videos.get(hit.id.videoId);
    if (!v) return null; // deleted or private since the search
    const durationSeconds = parseIsoDuration(v.contentDetails.duration);
    if (!(durationSeconds >= MIN_DURATION_S && durationSeconds <= MAX_DURATION_S)) return null;
    return {
      videoId: hit.id.videoId,
      url: `https://www.youtube.com/watch?v=${hit.id.videoId}`,
      title: decodeEntities(hit.snippet.title),
      channelId: hit.snippet.channelId,
      channelTitle: decodeEntities(hit.snippet.channelTitle),
      publishedAt: hit.snippet.publishedAt,
      durationSeconds,
      viewCount: Number(v.statistics.viewCount ?? 0),
      subscriberCount: details.subscribers.get(hit.snippet.channelId) ?? null,
    };
  }

  async function searchVideos(queries: string[], { language = "en" } = {}): Promise<YouTubeSearchResult> {
    const unitsBefore = state.unitsUsed;
    const liveBefore = state.liveSearches;
    const videosByQuery: Record<string, YouTubeVideo[]> = {};
    const skippedQueries: string[] = [];
    const pending: { query: string; key: string; hits: SearchHit[] }[] = [];
    let cachedSearches = 0;

    for (const query of queries) {
      if (query in videosByQuery) continue;
      const key = `youtube:v1:${language}:${normalizeQuery(query)}`;
      const cached = await opts.cache.get<YouTubeVideo[]>(key);
      if (cached) {
        videosByQuery[query] = cached;
        cachedSearches++;
        continue;
      }
      videosByQuery[query] = [];
      if (state.quotaExhausted || state.liveSearches >= maxSearches) {
        skippedQueries.push(query);
        continue;
      }
      state.liveSearches++;
      const res = await quotaSafe(() =>
        get(
          "search",
          {
            part: "snippet",
            type: "video",
            q: query,
            maxResults: "10",
            relevanceLanguage: language,
            videoEmbeddable: "true",
            safeSearch: "moderate",
          },
          SearchResponse,
          UNITS.search,
        ),
      );
      if (!res) {
        skippedQueries.push(query);
        continue;
      }
      const hits = res.items.filter((i): i is SearchHit => Boolean(i.id.videoId));
      pending.push({ query, key, hits });
    }

    const allHits = pending.flatMap((p) => p.hits);
    const details = allHits.length ? await fetchDetails(allHits) : undefined;
    if (details) {
      for (const p of pending) {
        const videos = p.hits.map((h) => toVideo(h, details)).filter((v): v is YouTubeVideo => v !== null);
        videosByQuery[p.query] = videos;
        await opts.cache.set(p.key, videos, CACHE_TTL_MS);
      }
    } else if (allHits.length) {
      skippedQueries.push(...pending.map((p) => p.query));
    }

    if (skippedQueries.length) {
      console.warn(
        `[youtube] ${skippedQueries.length} quer${skippedQueries.length === 1 ? "y" : "ies"} got no videos ` +
          `(${state.quotaExhausted ? "quota exhausted" : `cap of ${maxSearches} searches per course`}): ${skippedQueries.join(" | ")}`,
      );
    }

    return {
      videosByQuery,
      unitsUsed: state.unitsUsed - unitsBefore,
      liveSearches: state.liveSearches - liveBefore,
      cachedSearches,
      quotaExhausted: state.quotaExhausted,
      skippedQueries,
    };
  }

  return {
    searchVideos,
    /** Totals across every call on this client (i.e. this course). */
    stats: () => ({ ...state }),
  };
}
