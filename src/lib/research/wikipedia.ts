// Wikipedia REST client: page search and article summaries.
// Wikimedia's API policy requires a descriptive User-Agent with contact information.
import { z } from "zod";

import { fetchJson, type FetchFn } from "./http";

export const WIKIPEDIA_USER_AGENT = "CourseForge/0.1 (https://github.com/krbtn4zdmt-dot/courseforge)";
export const WIKIPEDIA_TIMEOUT_MS = 10_000;

export type WikipediaPage = { title: string; key: string; description: string | null };

export type WikipediaSummary = {
  title: string;
  url: string;
  description: string | null;
  extract: string;
  /** Last edit time, ISO 8601. */
  timestamp: string | null;
  isDisambiguation: boolean;
};

const SearchResponseSchema = z.object({
  pages: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      description: z.string().nullish(),
    }),
  ),
});

const SummaryResponseSchema = z.object({
  type: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  extract: z.string(),
  timestamp: z.string().nullish(),
  content_urls: z.object({ desktop: z.object({ page: z.string() }) }),
});

export function createWikipediaClient({ fetch = globalThis.fetch, lang = "en" }: { fetch?: FetchFn; lang?: string } = {}) {
  const base = `https://${lang}.wikipedia.org`;
  const init: RequestInit = { headers: { "User-Agent": WIKIPEDIA_USER_AGENT, Accept: "application/json" } };

  async function search(query: string, limit = 3): Promise<WikipediaPage[]> {
    const url = `${base}/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=${limit}`;
    const body = await fetchJson(url, {
      provider: "wikipedia",
      fetch,
      timeoutMs: WIKIPEDIA_TIMEOUT_MS,
      schema: SearchResponseSchema,
      init,
    });
    return (body?.pages ?? []).map((p) => ({ title: p.title, key: p.key, description: p.description ?? null }));
  }

  /** Summary of one article, or null when it doesn't exist. `title` may be a title or a page key. */
  async function summary(title: string): Promise<WikipediaSummary | null> {
    const key = encodeURIComponent(title.trim().replace(/ /g, "_"));
    const body = await fetchJson(`${base}/api/rest_v1/page/summary/${key}`, {
      provider: "wikipedia",
      fetch,
      timeoutMs: WIKIPEDIA_TIMEOUT_MS,
      schema: SummaryResponseSchema,
      init,
      nullOnStatus: [404],
    });
    if (!body) return null;
    return {
      title: body.title,
      url: body.content_urls.desktop.page,
      description: body.description ?? null,
      extract: body.extract,
      timestamp: body.timestamp ?? null,
      isDisambiguation: body.type === "disambiguation",
    };
  }

  return { search, summary };
}

const defaultClient = createWikipediaClient();

export const searchWikipedia = defaultClient.search;
export const getWikipediaSummary = defaultClient.summary;
