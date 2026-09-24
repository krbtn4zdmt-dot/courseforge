import "server-only";

// Source scoring and dedupe rules: docs/ARCHITECTURE.md, "Research details".
// Pure functions only; the LLM relevance rating lives in relevance.ts.

// ---------- Domain credibility ----------

const TRUSTED_DOMAINS = [
  // encyclopedias and reference
  "wikipedia.org", "britannica.com", "worldhistory.org", "plato.stanford.edu", "iep.utm.edu",
  // publications and public media
  "nature.com", "science.org", "scientificamerican.com", "nationalgeographic.com", "smithsonianmag.com",
  "bbc.co.uk", "bbc.com", "nytimes.com", "theguardian.com", "reuters.com", "apnews.com", "economist.com",
  // education
  "khanacademy.org", "ocw.mit.edu", "coursera.org", "edx.org",
  // official docs
  "support.microsoft.com", "learn.microsoft.com", "developer.mozilla.org", "docs.python.org",
  "support.google.com", "developer.apple.com", "support.apple.com",
  // health and science bodies
  "who.int", "nih.gov", "mayoclinic.org", "clevelandclinic.org",
];

const LOW_QUALITY_DOMAINS = [
  "ehow.com", "answers.com", "reference.com", "ask.com", "quora.com", "pinterest.com",
  "wikihow.com", "brainly.com", "chegg.com", "coursehero.com", "studocu.com", "scribd.com",
];

const TRUSTED_SUFFIXES = [".edu", ".gov", ".mil", ".ac.uk", ".edu.au", ".gov.uk", ".int"];

export const CREDIBILITY = { trusted: 0.9, neutral: 0.5, low: 0.2 } as const;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** 0–1: boost for .edu/.gov, official docs and major references; penalty for content farms. */
export function domainCredibility(url: string): number {
  const host = hostOf(url);
  if (!host) return CREDIBILITY.low;
  if (LOW_QUALITY_DOMAINS.some((d) => matchesDomain(host, d))) return CREDIBILITY.low;
  if (TRUSTED_SUFFIXES.some((s) => host.endsWith(s))) return CREDIBILITY.trusted;
  if (TRUSTED_DOMAINS.some((d) => matchesDomain(host, d))) return CREDIBILITY.trusted;
  return CREDIBILITY.neutral;
}

// ---------- Recency and combined score ----------

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/** 1 for the past year, falling linearly to 0.2 at 5+ years; 0.5 when the date is unknown. */
export function recencyScore(publishedDate: string | null | undefined, now: Date): number {
  const published = publishedDate ? Date.parse(publishedDate) : NaN;
  if (!Number.isFinite(published)) return 0.5;
  const years = Math.max(0, (now.getTime() - published) / YEAR_MS);
  if (years <= 1) return 1;
  return Math.max(0.2, 1 - ((years - 1) / 4) * 0.8);
}

export interface SourceScoreParts {
  credibility: number;
  relevance: number;
  /** Only for fast-moving topics. */
  recency?: number;
}

export function combineSourceScore({ credibility, relevance, recency }: SourceScoreParts): number {
  const score =
    recency === undefined
      ? 0.6 * relevance + 0.4 * credibility
      : 0.5 * relevance + 0.3 * credibility + 0.2 * recency;
  return round3(clamp01(score));
}

// ---------- Videos ----------

export interface VideoScoreInput {
  title: string;
  query: string;
  viewCount: number;
  subscriberCount: number | null;
  publishedAt: string;
}

/** log10(n) / log10(ceiling), clamped to 0–1. */
export function logScale(n: number, ceiling: number): number {
  if (n <= 1) return 0;
  return clamp01(Math.log10(n) / Math.log10(ceiling));
}

const STOPWORDS = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "for", "on", "how", "what", "is", "with", "by"]);

function contentWords(text: string): string[] {
  return words(text).filter((w) => !STOPWORDS.has(w));
}

/** Share of the query's content words that appear in the title. */
export function titleRelevance(title: string, query: string): number {
  const queryWords = [...new Set(contentWords(query))];
  if (!queryWords.length) return 0;
  const titleWords = new Set(contentWords(title));
  return queryWords.filter((w) => titleWords.has(w)).length / queryWords.length;
}

/** Views (to 10M) 0.35, channel subscribers (to 5M) 0.25, title relevance 0.3, recency 0.1. */
export function scoreVideo(v: VideoScoreInput, now: Date): number {
  const score =
    0.35 * logScale(v.viewCount, 10_000_000) +
    0.25 * (v.subscriberCount === null ? 0.3 : logScale(v.subscriberCount, 5_000_000)) +
    0.3 * titleRelevance(v.title, v.query) +
    0.1 * recencyScore(v.publishedAt, now);
  return round3(clamp01(score));
}

// ---------- Dedupe ----------

const TRACKING_PARAMS = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|igshid|si)$/i;

/** Comparison key for a URL: no scheme difference, www, fragment, tracking params or trailing slash. */
export function canonicalUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url.trim().toLowerCase();
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...parsed.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  const pathname = parsed.pathname.replace(/\/+$/, "") || "";
  return `${host}${parsed.port ? `:${parsed.port}` : ""}${pathname}${query}`;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Set of n-word shingles (default 5). Texts shorter than n words yield one shingle of the whole text. */
export function shingles(text: string, n = 5): Set<string> {
  const w = words(text);
  if (w.length === 0) return new Set();
  if (w.length < n) return new Set([w.join(" ")]);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const s of a) if (b.has(s)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export const NEAR_DUPLICATE_THRESHOLD = 0.8;

export interface DedupableSource {
  url: string;
  score: number;
  /** Text compared for near-duplicates: grounding when present, else the excerpt. */
  text: string;
}

/**
 * Removes duplicates by canonical URL, then near-duplicates (Jaccard > 0.8 on 5-word shingles).
 * Keeps the higher-scored copy; output is sorted by score, highest first.
 */
export function dedupeSources<T extends DedupableSource>(sources: readonly T[]): T[] {
  const byScore = [...sources].sort((a, b) => b.score - a.score);
  const kept: { source: T; shingles: Set<string> }[] = [];
  const seenUrls = new Set<string>();
  for (const source of byScore) {
    const key = canonicalUrl(source.url);
    if (seenUrls.has(key)) continue;
    const sh = shingles(source.text);
    if (sh.size > 0 && kept.some((k) => jaccard(k.shingles, sh) > NEAR_DUPLICATE_THRESHOLD)) continue;
    seenUrls.add(key);
    kept.push({ source, shingles: sh });
  }
  return kept.map((k) => k.source);
}

/** Top `max` sources by score (ARCHITECTURE.md keeps 3–6 per lesson). */
export function rankSources<T extends { score: number }>(sources: readonly T[], max = 6): T[] {
  return [...sources].sort((a, b) => b.score - a.score).slice(0, max);
}

// ---------- helpers ----------

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
