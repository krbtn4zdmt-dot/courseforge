import "server-only";

import { mapWithConcurrency } from "@/lib/concurrency";
import type { CallJsonOptions } from "@/lib/llm/client";
import { createFileCache } from "@/lib/research/cache";
import { makeExcerpt, termsFrom, trimGrounding } from "@/lib/research/grounding";
import { DEFAULT_RELEVANCE, rateRelevance } from "@/lib/research/relevance";
import { canonicalUrl, combineSourceScore, dedupeSources, domainCredibility, rankSources, scoreVideo } from "@/lib/research/scoring";
import { searchTavily } from "@/lib/research/tavily";
import { findWikipediaTitles, getWikipediaSummary, type WikipediaSummary } from "@/lib/research/wikipedia";
import { createYouTubeClient, type YouTubeVideo } from "@/lib/research/youtube";

import type { PlannerOutput, ResearcherOutput, Source } from "./schemas";

// Researcher: docs/AGENTS.md §3 and ARCHITECTURE.md "Generation strategy" / "Research details".
// light: one Tavily basic query per subtopic (its first), no raw content, no YouTube (syllabus preview).
// deep: the remaining queries (Tavily advanced + raw content), YouTube, Wikipedia (after confirm).

export const CONCURRENCY = 5;
export const MAX_TEXT_SOURCES_PER_SUBTOPIC = 6;
export const MAX_VIDEOS_PER_SUBTOPIC = 3;
const RESULTS_PER_QUERY = 5;

export type ResearchMode = "light" | "deep";

export interface ResearchInput {
  topic: string;
  plan: PlannerOutput;
  mode: ResearchMode;
  /** Light-mode output to merge into when mode is "deep". */
  previous?: ResearcherOutput;
  language?: string;
}

export interface ResearchDeps {
  searchTavily?: typeof searchTavily;
  findWikipediaTitles?: typeof findWikipediaTitles;
  getWikipediaSummary?: typeof getWikipediaSummary;
  rateRelevance?: typeof rateRelevance;
  /** One YouTube client per course (it holds the search cap). */
  youtube?: Pick<ReturnType<typeof createYouTubeClient>, "searchVideos">;
  onUsage?: CallJsonOptions<unknown>["onUsage"];
  now?: () => Date;
}

export interface ResearchStats {
  mode: ResearchMode;
  webQueries: number;
  failedQueries: string[];
  wikipediaLookups: number;
  youtubeUnits: number;
  youtubeQuotaExhausted: boolean;
  /** Set when the YouTube search failed outright (e.g. a bad key); lessons ship without videos. */
  youtubeError: string | null;
  /** Set when relevance batches failed; their sources were scored with neutral relevance. */
  relevanceError: string | null;
  durationMs: number;
}

interface Candidate extends Source {
  id: string;
  subtopic: string;
  /** Snippet shown to the relevance rater. */
  snippet: string;
}

const DOCS_HOST = /^(docs|developer|learn|support)\./;

export function sourceTypeFor(url: string): Source["type"] {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host.endsWith("wikipedia.org")) return "wiki";
  if (host === "youtube.com" || host === "youtu.be") return "video";
  return DOCS_HOST.test(host) ? "docs" : "web";
}

/** Which Tavily queries each mode runs. */
export function webQueriesFor(plan: PlannerOutput, mode: ResearchMode): { subtopic: string; query: string }[] {
  return plan.searchQueries.flatMap(({ subtopic, queries }) =>
    (mode === "light" ? queries.slice(0, 1) : queries.slice(1)).map((query) => ({ subtopic, query })),
  );
}

function videoToSource(video: YouTubeVideo, query: string, now: Date): Source {
  return {
    url: video.url,
    title: video.title,
    type: "video",
    score: scoreVideo({ ...video, query }, now),
    excerpt: `${video.channelTitle} · ${Math.round(video.durationSeconds / 60)} min`,
    grounding: null,
  };
}

const WIKIPEDIA_CANDIDATES = 3;

/**
 * One Wikipedia page per subtopic, searched as "<topic> <subtopic>". "<topic> Early life" and "<topic> Legacy"
 * both rank the topic's main article first, so each subtopic takes its best-ranked page not already taken.
 */
async function wikipediaPages(
  topic: string,
  subtopics: string[],
  deps: ResearchDeps,
): Promise<{ subtopic: string; page: WikipediaSummary }[]> {
  const findTitles = deps.findWikipediaTitles ?? findWikipediaTitles;
  const summarize = deps.getWikipediaSummary ?? getWikipediaSummary;
  const candidates = await mapWithConcurrency(subtopics, CONCURRENCY, async (subtopic) => {
    try {
      return await findTitles(`${topic} ${subtopic}`, { limit: WIKIPEDIA_CANDIDATES });
    } catch (err) {
      console.warn(`[researcher] Wikipedia search failed for "${subtopic}": ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  });
  const taken = new Set<string>();
  const picks = subtopics.flatMap((subtopic, i) => {
    const title = candidates[i]!.find((t) => !taken.has(t));
    if (!title) return [];
    taken.add(title);
    return [{ subtopic, title }];
  });
  const pages = await mapWithConcurrency(picks, CONCURRENCY, async ({ subtopic, title }) => {
    try {
      const page = await summarize(title);
      return page ? { subtopic, page } : null;
    } catch (err) {
      console.warn(`[researcher] Wikipedia summary failed for "${title}": ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });
  return pages.filter((p): p is { subtopic: string; page: WikipediaSummary } => p !== null);
}

/** Deep-mode videos per subtopic. Failures other than quota are recorded in stats, never thrown: videos are optional. */
async function searchVideosFor(input: ResearchInput, deps: ResearchDeps, now: Date, stats: ResearchStats): Promise<Map<string, Source[]>> {
  const videosBySubtopic = new Map<string, Source[]>();
  const videoJobs = input.plan.subtopics
    .filter((s) => s.importance <= 2)
    .map((s) => ({ subtopic: s.name, query: input.plan.searchQueries.find((q) => q.subtopic === s.name)!.queries[0]! }));
  try {
    const youtube = deps.youtube ?? createYouTubeClient({ cache: createFileCache() });
    const yt = await youtube.searchVideos(videoJobs.map((j) => j.query), { language: input.language ?? "en" });
    stats.youtubeUnits = yt.unitsUsed;
    stats.youtubeQuotaExhausted = yt.quotaExhausted;
    for (const job of videoJobs) {
      videosBySubtopic.set(job.subtopic, (yt.videosByQuery[job.query] ?? []).map((v) => videoToSource(v, job.query, now)));
    }
  } catch (err) {
    stats.youtubeError = err instanceof Error ? err.message : String(err);
    console.warn(`[researcher] YouTube search failed; lessons will have no videos: ${stats.youtubeError}`);
  }
  return videosBySubtopic;
}

/** Dedupe (URL, then near-duplicate text) and keep the top `max` by score. */
function topDeduped(sources: Source[], max: number, textOf: (s: Source) => string): Source[] {
  const wrapped = sources.map((source) => ({ source, url: source.url, score: source.score, text: textOf(source) }));
  return rankSources(dedupeSources(wrapped), max).map((w) => w.source);
}

function stripCandidate({ url, title, type, score, excerpt, grounding }: Candidate): Source {
  return { url, title, type, score, excerpt, grounding };
}

export async function research(input: ResearchInput, deps: ResearchDeps = {}): Promise<{ output: ResearcherOutput; stats: ResearchStats }> {
  const started = Date.now();
  const now = deps.now?.() ?? new Date();
  const tavily = deps.searchTavily ?? searchTavily;
  const deep = input.mode === "deep";
  const stats: ResearchStats = {
    mode: input.mode,
    webQueries: 0,
    failedQueries: [],
    wikipediaLookups: 0,
    youtubeUnits: 0,
    youtubeQuotaExhausted: false,
    youtubeError: null,
    relevanceError: null,
    durationMs: 0,
  };
  const candidates: Candidate[] = [];
  const add = (c: Omit<Candidate, "id" | "score">) => {
    if (URL.canParse(c.url)) candidates.push({ ...c, id: `c${candidates.length + 1}`, score: 0 });
  };

  // Web search
  const jobs = webQueriesFor(input.plan, input.mode);
  stats.webQueries = jobs.length;
  const webResults = await mapWithConcurrency(jobs, CONCURRENCY, async (job) => {
    try {
      return await tavily({ query: job.query, depth: deep ? "advanced" : "basic", maxResults: RESULTS_PER_QUERY, includeRawContent: deep });
    } catch (err) {
      console.warn(`[researcher] query failed: "${job.query}": ${err instanceof Error ? err.message : String(err)}`);
      stats.failedQueries.push(job.query);
      return null;
    }
  });
  if (jobs.length > 0 && stats.failedQueries.length === jobs.length) {
    // Deep mode can fall back to the light results; with nothing to fall back on, there is no course.
    if (!input.previous?.some((p) => p.sources.length)) {
      throw new Error(`[researcher] all ${jobs.length} ${input.mode} web queries failed`);
    }
    console.warn(`[researcher] all ${jobs.length} deep web queries failed; falling back to the light-mode sources (excerpts only)`);
  }
  // YouTube: importance 1–2 subtopics, first query each. Started once the web search has worked (so a failed
  // course spends no quota) and runs alongside Wikipedia and relevance.
  const videosPromise = deep ? searchVideosFor(input, deps, now, stats) : Promise.resolve(new Map<string, Source[]>());

  webResults.forEach((results, i) => {
    const { subtopic, query } = jobs[i]!;
    for (const r of results ?? []) {
      if (!URL.canParse(r.url)) continue;
      add({
        subtopic,
        url: r.url,
        title: r.title,
        type: sourceTypeFor(r.url),
        excerpt: makeExcerpt(r.content || r.title),
        grounding: deep && r.rawContent ? trimGrounding(r.rawContent, termsFrom(subtopic, query)) : null,
        snippet: r.content,
      });
    }
  });

  // Wikipedia: importance-1 subtopics of knowledge and hybrid topics, one distinct page each
  if (deep && input.plan.topicType !== "skill") {
    const wikiSubtopics = input.plan.subtopics.filter((s) => s.importance === 1).map((s) => s.name);
    stats.wikipediaLookups = wikiSubtopics.length;
    for (const { subtopic, page } of await wikipediaPages(input.topic, wikiSubtopics, deps)) {
      add({ subtopic, url: page.url, title: `${page.title} (Wikipedia)`, type: "wiki", excerpt: makeExcerpt(page.extract), grounding: page.extract, snippet: page.extract });
    }
  }

  // Relevance and score. Failed batches fall back to neutral relevance and are recorded.
  if (candidates.length) {
    const { scores, failedBatches } = await (deps.rateRelevance ?? rateRelevance)({
      topic: input.topic,
      items: candidates.map((c) => ({ id: c.id, subtopic: c.subtopic, title: c.title, snippet: c.snippet })),
      onUsage: deps.onUsage,
    });
    if (failedBatches.length) stats.relevanceError = `${failedBatches.length} batch(es) failed: ${failedBatches[0]}`;
    for (const c of candidates) {
      c.score = combineSourceScore({ credibility: domainCredibility(c.url), relevance: scores.get(c.id) ?? DEFAULT_RELEVANCE });
    }
  }

  // YouTube results (started before the web search; they don't depend on it)
  const videosBySubtopic = await videosPromise;

  // Merge, dedupe and keep the top sources per subtopic
  const output: ResearcherOutput = input.plan.subtopics.map(({ name }) => {
    const fresh = candidates.filter((c) => c.subtopic === name).map(stripCandidate);
    const freshUrls = new Set(fresh.map((s) => canonicalUrl(s.url)));
    const previous = (input.previous?.find((p) => p.subtopic === name)?.sources ?? []).filter(
      (s) => !freshUrls.has(canonicalUrl(s.url)), // deep results replace light ones for the same page
    );
    const all = [...fresh, ...previous];
    const texts = all.filter((s) => s.type !== "video");
    const videos = [...all.filter((s) => s.type === "video"), ...(videosBySubtopic.get(name) ?? [])];
    return {
      subtopic: name,
      sources: [
        ...topDeduped(texts, MAX_TEXT_SOURCES_PER_SUBTOPIC, (src) => src.grounding ?? src.excerpt),
        ...topDeduped(videos, MAX_VIDEOS_PER_SUBTOPIC, () => ""),
      ],
    };
  });

  stats.durationMs = Date.now() - started;
  return { output, stats };
}
