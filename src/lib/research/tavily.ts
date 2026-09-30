// Tavily web search client.
import { z } from "zod";

import { fetchJson, ResearchError, type FetchFn } from "./http";

export type TavilyDepth = "basic" | "advanced";

export type TavilyResult = {
  url: string;
  title: string;
  /** Tavily's relevant snippet. */
  content: string;
  /** Full page text (advanced only); trimmed into `grounding` by the researcher. */
  rawContent: string | null;
  publishedDate: string | null;
  /** Tavily's own relevance score, 0–1. */
  tavilyScore: number;
};

export type TavilySearchOptions = { depth: TavilyDepth; maxResults?: number };

export const TAVILY_URL = "https://api.tavily.com/search";
export const TAVILY_TIMEOUT_MS: Record<TavilyDepth, number> = { basic: 15_000, advanced: 30_000 };
export const DEFAULT_MAX_RESULTS = 5;

const TavilyResponseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      content: z.string(),
      score: z.number(),
      raw_content: z.string().nullish(),
      published_date: z.string().nullish(),
    }),
  ),
});

function errorReason(body: unknown): string | null {
  const parsed = z.object({ detail: z.object({ error: z.string() }) }).safeParse(body);
  return parsed.success ? parsed.data.detail.error : null;
}

export function createTavilyClient({ apiKey, fetch = globalThis.fetch }: { apiKey: string; fetch?: FetchFn }) {
  async function search(query: string, { depth, maxResults = DEFAULT_MAX_RESULTS }: TavilySearchOptions): Promise<TavilyResult[]> {
    const body = await fetchJson(TAVILY_URL, {
      provider: "tavily",
      fetch,
      timeoutMs: TAVILY_TIMEOUT_MS[depth],
      schema: TavilyResponseSchema,
      errorReason,
      init: {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          search_depth: depth,
          max_results: maxResults,
          include_raw_content: depth === "advanced" ? "text" : false,
          include_answer: false,
        }),
      },
    });
    if (!body) throw new ResearchError("tavily", "empty response");
    return body.results.map((r) => ({
      url: r.url,
      title: r.title,
      content: r.content,
      rawContent: r.raw_content ?? null,
      publishedDate: r.published_date ?? null,
      tavilyScore: r.score,
    }));
  }
  return { search };
}

/** Searches with TAVILY_API_KEY from the environment. */
export function searchTavily(query: string, opts: TavilySearchOptions): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new ResearchError("tavily", "TAVILY_API_KEY is not set (see .env.example)");
  return createTavilyClient({ apiKey }).search(query, opts);
}
