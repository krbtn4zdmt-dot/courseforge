import "server-only";

import { z } from "zod";

import { fetchJson, type FetchFn } from "./http";

const TIMEOUT_MS = 8_000;

export interface WikipediaSummary {
  title: string;
  url: string;
  extract: string;
  description: string | null;
}

export interface WikipediaOptions {
  lang?: string;
  fetch?: FetchFn;
  contactEmail?: string;
}

const SummaryResponse = z.object({
  type: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  extract: z.string(),
  content_urls: z.object({ desktop: z.object({ page: z.string() }) }),
});

const TitleSearchResponse = z.object({
  pages: z.array(z.object({ key: z.string(), title: z.string() })),
});

/** Wikimedia's API policy requires a descriptive User-Agent with contact info. */
export function wikipediaUserAgent(contactEmail = process.env.CONTACT_EMAIL): string {
  return `CourseForge/0.1 (${contactEmail || "contact not configured"})`;
}

function headers(opts: WikipediaOptions) {
  return { "User-Agent": wikipediaUserAgent(opts.contactEmail), Accept: "application/json" };
}

/** Page summary by exact title. Null when the page doesn't exist or is a disambiguation page. */
export async function getWikipediaSummary(title: string, opts: WikipediaOptions = {}): Promise<WikipediaSummary | null> {
  const lang = opts.lang ?? "en";
  const data = await fetchJson({
    service: "wikipedia",
    url: `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    schema: SummaryResponse,
    timeoutMs: TIMEOUT_MS,
    fetch: opts.fetch,
    init: { headers: headers(opts) },
    nullOn: [404],
  });
  if (!data || data.type === "disambiguation") return null;
  return {
    title: data.title,
    url: data.content_urls.desktop.page,
    extract: data.extract,
    description: data.description ?? null,
  };
}

/** Best-matching page title for a free-text query, or null. */
export async function findWikipediaTitle(query: string, opts: WikipediaOptions = {}): Promise<string | null> {
  const lang = opts.lang ?? "en";
  const data = await fetchJson({
    service: "wikipedia",
    url: `https://${lang}.wikipedia.org/w/rest.php/v1/search/title?${new URLSearchParams({ q: query, limit: "1" })}`,
    schema: TitleSearchResponse,
    timeoutMs: TIMEOUT_MS,
    fetch: opts.fetch,
    init: { headers: headers(opts) },
  });
  return data?.pages[0]?.title ?? null;
}

/** Search then summarize: the usual entry point for a planner entity or subtopic name. */
export async function searchWikipedia(query: string, opts: WikipediaOptions = {}): Promise<WikipediaSummary | null> {
  const title = await findWikipediaTitle(query, opts);
  return title ? getWikipediaSummary(title, opts) : null;
}
