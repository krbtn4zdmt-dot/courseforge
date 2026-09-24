import "server-only";

import { z } from "zod";

import { fetchJson, ResearchError, type FetchFn } from "./http";

const TAVILY_URL = "https://api.tavily.com/search";
const TIMEOUT_MS = { basic: 15_000, advanced: 30_000 } as const;

export interface TavilySearchOptions {
  query: string;
  depth: "basic" | "advanced";
  maxResults?: number;
  includeRawContent?: boolean;
}

export interface TavilyResult {
  url: string;
  title: string;
  /** Tavily's short, query-focused snippet. */
  content: string;
  /** Full page text; null unless requested (and sometimes null even then). */
  rawContent: string | null;
  /** Tavily's own relevance score, 0–1. */
  score: number;
  publishedDate: string | null;
}

const TavilyResponseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().nullish(),
      content: z.string().nullish(),
      raw_content: z.string().nullish(),
      score: z.number().nullish(),
      published_date: z.string().nullish(),
    }),
  ),
});

export interface TavilyDeps {
  apiKey?: string;
  fetch?: FetchFn;
}

export async function searchTavily(opts: TavilySearchOptions, deps: TavilyDeps = {}): Promise<TavilyResult[]> {
  const apiKey = deps.apiKey ?? process.env.TAVILY_API_KEY;
  if (!apiKey) throw new ResearchError("tavily", "TAVILY_API_KEY is not set");

  const data = await fetchJson({
    service: "tavily",
    url: TAVILY_URL,
    schema: TavilyResponseSchema,
    timeoutMs: TIMEOUT_MS[opts.depth],
    fetch: deps.fetch,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: opts.query,
        search_depth: opts.depth,
        max_results: opts.maxResults ?? 5,
        include_raw_content: opts.includeRawContent ?? false,
        include_answer: false,
        include_images: false,
      }),
    },
  });

  return (data?.results ?? []).map((r) => ({
    url: r.url,
    title: r.title ?? r.url,
    content: r.content ?? "",
    rawContent: r.raw_content ?? null,
    score: r.score ?? 0,
    publishedDate: r.published_date ?? null,
  }));
}
