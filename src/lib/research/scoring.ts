// Source scoring and dedupe (docs/ARCHITECTURE.md → Research details).
// score = relevance (batched MODEL_FAST call) + domain credibility + recency (fast-moving topics only).
// Dedupe by canonical URL, then by Jaccard > 0.8 on 5-word shingles of the text.
import { callJson as defaultCallJson, type CallJsonOptions, type CallJsonResult } from "../llm/client";
import { relevancePrompt, type RelevanceItem } from "../pipeline/prompts/relevance";
import { relevanceRatingsSchema, type RelevanceRatings } from "../pipeline/schemas";

// ---------------------------------------------------------------------------
// Text helpers

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it", "of",
  "on", "or", "the", "to", "what", "when", "where", "who", "why", "with",
]);

/** Lowercase word tokens (letters and digits, any script). */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Share of the query's meaningful terms that appear in the text, 0–1. */
export function termOverlap(query: string, text: string): number {
  const terms = new Set(tokenize(query).filter((t) => t.length > 1 && !STOPWORDS.has(t)));
  if (terms.size === 0) return 0;
  const words = new Set(tokenize(text));
  let hits = 0;
  for (const t of terms) if (words.has(t)) hits++;
  return hits / terms.size;
}

// ---------------------------------------------------------------------------
// Domain credibility

/** Encyclopedias, major publications, official docs and reference sites. */
export const CREDIBLE_DOMAINS = [
  "wikipedia.org", "britannica.com", "worldhistory.org", "plato.stanford.edu", "iep.utm.edu",
  "nationalgeographic.com", "smithsonianmag.com", "bbc.com", "bbc.co.uk", "nytimes.com",
  "theguardian.com", "economist.com", "reuters.com", "apnews.com", "nature.com", "science.org",
  "scientificamerican.com", "khanacademy.org", "openstax.org", "jstor.org", "arxiv.org",
  "who.int", "mayoclinic.org", "clevelandclinic.org", "developer.mozilla.org", "learn.microsoft.com",
  "support.microsoft.com", "docs.python.org", "support.google.com",
] as const;

/** Low-quality Q&A, homework-help and content-farm sites. */
export const LOW_QUALITY_DOMAINS = [
  "answers.com", "ehow.com", "ezinearticles.com", "hubpages.com", "quora.com", "answers.yahoo.com",
  "brainly.com", "chegg.com", "coursehero.com", "studocu.com", "pinterest.com", "scribd.com",
  "wikihow.com", "reference.com",
] as const;

const CREDIBILITY = { credible: 0.9, institutional: 0.9, docs: 0.85, neutral: 0.5, lowQuality: 0.1 } as const;
const INSTITUTIONAL_SUFFIXES = [".edu", ".gov", ".mil", ".ac.uk", ".gov.uk", ".edu.au", ".gc.ca", ".europa.eu"];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** 0–1 domain credibility. Unknown domains are neutral (0.5). */
export function credibilityScore(url: string): number {
  const host = hostOf(url);
  if (!host) return 0;
  if (LOW_QUALITY_DOMAINS.some((d) => hostMatches(host, d))) return CREDIBILITY.lowQuality;
  if (CREDIBLE_DOMAINS.some((d) => hostMatches(host, d))) return CREDIBILITY.credible;
  if (INSTITUTIONAL_SUFFIXES.some((s) => host.endsWith(s))) return CREDIBILITY.institutional;
  if (/^(docs|developer|developers)\./.test(host)) return CREDIBILITY.docs;
  return CREDIBILITY.neutral;
}

// ---------------------------------------------------------------------------
// Recency and combined score

/** 1 within a year, falling to 0 at 5 years. Unknown dates are neutral (0.5). */
export function recencyScore(publishedDate: string | null, now: number): number {
  if (!publishedDate) return 0.5;
  const published = Date.parse(publishedDate);
  if (Number.isNaN(published)) return 0.5;
  const ageYears = (now - published) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.min(1, Math.max(0, 1 - Math.max(0, ageYears - 1) / 4));
}

export const SCORE_WEIGHTS = { relevance: 0.6, credibility: 0.3, recency: 0.1 } as const;

export type ScoreParts = {
  /** 0–1 from the relevance call; null when it wasn't run. */
  relevance: number | null;
  credibility: number;
  recency: number;
};

/**
 * Weighted 0–1 score. Recency counts only for fast-moving topics; parts that don't
 * count (recency when not fast-moving, relevance when unrated) have their weight
 * shared out proportionally among the rest.
 */
export function combineScore(parts: ScoreParts, { fastMoving = false }: { fastMoving?: boolean } = {}): number {
  const used: [number, number][] = [[SCORE_WEIGHTS.credibility, parts.credibility]];
  if (parts.relevance !== null) used.push([SCORE_WEIGHTS.relevance, parts.relevance]);
  if (fastMoving) used.push([SCORE_WEIGHTS.recency, parts.recency]);
  const total = used.reduce((sum, [w]) => sum + w, 0);
  return used.reduce((sum, [w, v]) => sum + (w / total) * v, 0);
}

export const MIN_SOURCES_PER_LESSON = 3;
export const MAX_SOURCES_PER_LESSON = 6;
export const GOOD_SCORE = 0.4;

/** Best first: every source scoring ≥ 0.4 up to 6, topped up to 3 if there are enough. */
export function topSources<T extends { score: number }>(sources: readonly T[]): T[] {
  const sorted = [...sources].sort((a, b) => b.score - a.score);
  const good = sorted.filter((s) => s.score >= GOOD_SCORE).slice(0, MAX_SOURCES_PER_LESSON);
  return good.length >= MIN_SOURCES_PER_LESSON ? good : sorted.slice(0, MIN_SOURCES_PER_LESSON);
}

// ---------------------------------------------------------------------------
// Dedupe

const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|igshid)$/i;

/** Normalized URL for dedupe: https, no www/fragment/tracking params/trailing slash, canonical Wikipedia and YouTube forms. */
export function canonicalUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url.trim();
  }
  let host = u.hostname.toLowerCase().replace(/^www\./, "");
  host = host.replace(/^([a-z-]+)\.m\.wikipedia\.org$/, "$1.wikipedia.org");
  if (host === "m.youtube.com") host = "youtube.com";
  if (host === "youtu.be") {
    const id = u.pathname.slice(1);
    return `https://youtube.com/watch?v=${id}`;
  }
  if (host === "youtube.com" && u.pathname === "/watch") {
    const id = u.searchParams.get("v");
    if (id) return `https://youtube.com/watch?v=${id}`;
  }
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params)}` : "";
  const pathname = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : "";
  return `https://${host}${pathname}${query}`;
}

export const SHINGLE_SIZE = 5;
export const NEAR_DUPLICATE_THRESHOLD = 0.8;

/** Set of 5-word shingles; texts shorter than 5 words give one shingle of the whole text. */
export function shingles(text: string, size = SHINGLE_SIZE): Set<string> {
  const words = tokenize(text);
  if (words.length === 0) return new Set();
  if (words.length < size) return new Set([words.join(" ")]);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Keeps the first of each duplicate, so sort best-first before calling.
 * Duplicates: same canonical URL, or Jaccard > 0.8 on 5-word shingles of `text`.
 */
export function dedupeSources<T extends { url: string; text: string }>(sources: readonly T[]): T[] {
  const seenUrls = new Set<string>();
  const kept: { source: T; shingles: Set<string> }[] = [];
  for (const source of sources) {
    const url = canonicalUrl(source.url);
    if (seenUrls.has(url)) continue;
    const sh = shingles(source.text);
    if (sh.size > 0 && kept.some((k) => jaccard(sh, k.shingles) > NEAR_DUPLICATE_THRESHOLD)) continue;
    seenUrls.add(url);
    kept.push({ source, shingles: sh });
  }
  return kept.map((k) => k.source);
}

// ---------------------------------------------------------------------------
// Relevance (one batched MODEL_FAST call per chunk)

export const RELEVANCE_BATCH_SIZE = 40;

type CallJsonFn = <T>(opts: CallJsonOptions<T>) => Promise<CallJsonResult<T>>;

export type RelevanceResult = {
  /** Relevance 0–1 by item id. */
  ratings: Map<string, number>;
  costUsd: number | null;
};

/** Rates each source 0–1 against its subtopic with MODEL_FAST, in batches of 40. */
export async function rateRelevance(
  items: readonly RelevanceItem[],
  { callJson = defaultCallJson }: { callJson?: CallJsonFn } = {},
): Promise<RelevanceResult> {
  const ratings = new Map<string, number>();
  let costUsd: number | null = 0;
  for (let i = 0; i < items.length; i += RELEVANCE_BATCH_SIZE) {
    const batch = items.slice(i, i + RELEVANCE_BATCH_SIZE);
    const { system, prompt } = relevancePrompt({ items: batch });
    const { data, usage } = await callJson<RelevanceRatings>({
      agent: "relevance",
      model: "fast",
      system,
      prompt,
      schema: relevanceRatingsSchema(batch.map((b) => b.id)),
      maxTokens: 4_000,
    });
    for (const r of data.ratings) ratings.set(r.id, r.relevance);
    costUsd = costUsd === null || usage.costUsd === null ? null : costUsd + usage.costUsd;
  }
  return { ratings, costUsd };
}
