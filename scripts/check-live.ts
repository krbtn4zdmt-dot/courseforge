// Live smoke test for the research clients (task 1.3).
// Usage: pnpm check:live ["topic"]   (default "Alexander the Great")
// Runs Tavily, Wikipedia and one YouTube search, scores and dedupes the web sources,
// and prints the top 5 plus the YouTube quota used. YouTube results are cached in .cache/.
import { createFileCache } from "../src/lib/research/cache";
import {
  canonicalUrl,
  combineScore,
  credibilityScore,
  dedupeSources,
  rateRelevance,
  recencyScore,
} from "../src/lib/research/scoring";
import { ResearchError } from "../src/lib/research/http";
import { searchTavily } from "../src/lib/research/tavily";
import { getWikipediaSummary, searchWikipedia } from "../src/lib/research/wikipedia";
import { createYouTubeClient } from "../src/lib/research/youtube";
import { loadLocalEnv } from "./loadEnv";

type Candidate = {
  id: string;
  url: string;
  title: string;
  type: "web" | "wiki";
  excerpt: string;
  text: string;
  publishedDate: string | null;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} is not set (see .env.example)`);
    process.exit(1);
  }
  return value;
}

async function wikipediaCandidates(topic: string): Promise<Candidate[]> {
  try {
    const pages = await searchWikipedia(topic, 2);
    const summaries = await Promise.all(pages.map((p) => getWikipediaSummary(p.key)));
    return summaries.flatMap((s, i) =>
      s && !s.isDisambiguation
        ? [{ id: `wiki${i}`, url: s.url, title: s.title, type: "wiki" as const, excerpt: s.extract, text: s.extract, publishedDate: null }]
        : [],
    );
  } catch (err) {
    if (err instanceof ResearchError) {
      console.warn(`! Wikipedia skipped: ${err.message.slice(0, 160)}`);
      return [];
    }
    throw err;
  }
}

async function main() {
  loadLocalEnv();
  const topic = process.argv.slice(2).join(" ").trim() || "Alexander the Great";
  const youtubeKey = requireEnv("YOUTUBE_API_KEY");
  requireEnv("TAVILY_API_KEY");
  const now = Date.now();
  console.log(`Research smoke test: "${topic}"\n`);

  const [tavily, wiki] = await Promise.all([searchTavily(topic, { depth: "basic" }), wikipediaCandidates(topic)]);
  const candidates: Candidate[] = [
    ...tavily.map((r, i) => ({
      id: `web${i}`,
      url: r.url,
      title: r.title,
      type: (new URL(r.url).hostname.endsWith("wikipedia.org") ? "wiki" : "web") as Candidate["type"],
      excerpt: r.content,
      text: r.content,
      publishedDate: r.publishedDate,
    })),
    ...wiki,
  ];
  console.log(`Tavily: ${tavily.length} results · Wikipedia: ${wiki.length} summaries`);

  let relevance: Map<string, number> | null = null;
  if (process.env.ANTHROPIC_API_KEY) {
    const result = await rateRelevance(
      candidates.map((c) => ({ id: c.id, subtopic: topic, title: c.title, excerpt: c.excerpt })),
    );
    relevance = result.ratings;
    console.log(`Relevance: rated ${relevance.size} sources with MODEL_FAST (cost $${result.costUsd?.toFixed(5) ?? "unknown"})`);
  } else {
    console.warn("! Relevance skipped: ANTHROPIC_API_KEY is not set, so scores use credibility only.");
  }

  const scored = candidates
    .map((c) => {
      const parts = {
        relevance: relevance?.get(c.id) ?? null,
        credibility: credibilityScore(c.url),
        recency: recencyScore(c.publishedDate, now),
      };
      return { ...c, parts, score: combineScore(parts) };
    })
    .sort((a, b) => b.score - a.score);
  const unique = dedupeSources(scored);
  console.log(`Dedupe: ${scored.length} → ${unique.length} sources\n`);

  console.log("Top 5 sources");
  unique.slice(0, 5).forEach((s, i) => {
    const rel = s.parts.relevance === null ? "  – " : s.parts.relevance.toFixed(2);
    console.log(
      `${i + 1}. ${s.score.toFixed(2)}  [rel ${rel} · cred ${s.parts.credibility.toFixed(2)}] (${s.type}) ${s.title}\n   ${canonicalUrl(s.url)}`,
    );
  });

  const youtube = createYouTubeClient({ apiKey: youtubeKey, cache: createFileCache(".cache/youtube") });
  const videos = await youtube.searchVideos(topic);
  console.log(`\nTop videos (3–25 min)`);
  if (videos.length === 0) console.log("   (none)");
  videos.slice(0, 3).forEach((v, i) => {
    const minutes = `${Math.floor(v.durationSeconds / 60)}:${String(v.durationSeconds % 60).padStart(2, "0")}`;
    console.log(`${i + 1}. ${v.score.toFixed(2)}  ${v.title} — ${v.channelTitle} (${minutes}, ${v.viewCount.toLocaleString("en-US")} views)\n   ${v.url}`);
  });

  const usage = youtube.usage();
  console.log(
    `\nYouTube quota: ${usage.quotaUnitsUsed} units used (${usage.searchesUsed} search${usage.searchesUsed === 1 ? "" : "es"}${usage.searchesUsed === 0 ? ", served from cache" : ""})${usage.quotaExhausted ? " · QUOTA EXHAUSTED" : ""}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `Error: ${err.message}` : err);
  process.exit(1);
});
