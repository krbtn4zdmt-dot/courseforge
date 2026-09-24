// Research smoke test (task 1.3): pnpm research:smoke "Alexander the Great"
// Needs TAVILY_API_KEY, YOUTUBE_API_KEY, ANTHROPIC_API_KEY and MODEL_FAST (from .env.local).
import { parseArgs } from "node:util";

import { formatCostUsd, type LlmCallLog } from "@/lib/llm/cost";
import { createFileCache } from "@/lib/research/cache";
import { rateRelevance } from "@/lib/research/relevance";
import { combineSourceScore, dedupeSources, domainCredibility, rankSources, scoreVideo } from "@/lib/research/scoring";
import { searchTavily, type TavilyResult } from "@/lib/research/tavily";
import { searchWikipedia } from "@/lib/research/wikipedia";
import { createYouTubeClient } from "@/lib/research/youtube";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { top: { type: "string", default: "5" } },
});
const topic = positionals[0] ?? "Alexander the Great";
const top = Number(values.top);
const now = new Date();

interface Candidate {
  id: string;
  url: string;
  title: string;
  kind: "web" | "wiki";
  snippet: string;
  text: string;
  score: number;
  credibility: number;
  relevance: number;
}

function row(cells: (string | number)[], widths: number[]): string {
  return cells.map((c, i) => String(c).slice(0, widths[i]).padEnd(widths[i]!)).join("  ");
}

async function main() {
  const started = Date.now();
  const llmLogs: LlmCallLog[] = [];
  console.log(`Research smoke test: "${topic}"\n`);

  const queries = [topic, `${topic} explained`];
  const [advanced, basic, wiki] = await Promise.all([
    searchTavily({ query: queries[0]!, depth: "advanced", maxResults: 5, includeRawContent: true }),
    searchTavily({ query: queries[1]!, depth: "basic", maxResults: 5 }),
    searchWikipedia(topic),
  ]);

  const web: TavilyResult[] = [...advanced, ...basic];
  const candidates: Candidate[] = web.map((r, i) => ({
    id: `s${i + 1}`,
    url: r.url,
    title: r.title,
    kind: "web",
    snippet: r.content,
    text: r.rawContent ?? r.content,
    score: 0,
    credibility: 0,
    relevance: 0,
  }));
  if (wiki) {
    candidates.push({
      id: `s${candidates.length + 1}`,
      url: wiki.url,
      title: `${wiki.title} (Wikipedia)`,
      kind: "wiki",
      snippet: wiki.extract,
      text: wiki.extract,
      score: 0,
      credibility: 0,
      relevance: 0,
    });
  }
  console.log(`Tavily: ${advanced.length} advanced + ${basic.length} basic results; Wikipedia: ${wiki ? wiki.title : "none"}`);

  const { scores: relevance } = await rateRelevance({
    topic,
    items: candidates.map((c) => ({ id: c.id, subtopic: topic, title: c.title, snippet: c.snippet })),
    onUsage: (log) => llmLogs.push(log),
  });
  for (const c of candidates) {
    c.relevance = relevance.get(c.id)!;
    c.credibility = domainCredibility(c.url);
    c.score = combineSourceScore({ credibility: c.credibility, relevance: c.relevance });
  }
  const deduped = dedupeSources(candidates);
  console.log(`Scored ${candidates.length} sources; ${candidates.length - deduped.length} removed as duplicates.\n`);

  const widths = [5, 11, 10, 4, 48, 60];
  console.log(`Top ${top} sources`);
  console.log(row(["score", "credibility", "relevance", "type", "title", "url"], widths));
  for (const c of rankSources(deduped, top)) {
    console.log(row([c.score.toFixed(3), c.credibility, c.relevance, c.kind, c.title, c.url], widths));
  }

  const youtube = createYouTubeClient({ cache: createFileCache() });
  const yt = await youtube.searchVideos(queries, { language: "en" });
  const videos = Object.entries(yt.videosByQuery)
    .flatMap(([query, list]) => list.map((v) => ({ ...v, score: scoreVideo({ ...v, query }, now) })))
    .sort((a, b) => b.score - a.score);
  const uniqueVideos = [...new Map(videos.map((v) => [v.videoId, v])).values()].slice(0, top);

  console.log(`\nTop ${uniqueVideos.length} videos`);
  const vWidths = [5, 6, 10, 10, 44, 24];
  console.log(row(["score", "min", "views", "subs", "title", "channel"], vWidths));
  for (const v of uniqueVideos) {
    console.log(
      row(
        [v.score.toFixed(3), (v.durationSeconds / 60).toFixed(1), v.viewCount, v.subscriberCount ?? "hidden", v.title, v.channelTitle],
        vWidths,
      ),
    );
  }

  const llmCost = llmLogs.reduce((sum, l) => sum + (l.costUsd ?? 0), 0);
  console.log(
    `\nYouTube quota: ${yt.unitsUsed} units (${yt.liveSearches} live searches, ${yt.cachedSearches} cached` +
      `${yt.quotaExhausted ? ", QUOTA EXHAUSTED" : ""}${yt.skippedQueries.length ? `, skipped: ${yt.skippedQueries.join(" | ")}` : ""})`,
  );
  console.log(`LLM: ${llmLogs.length} call(s), ${formatCostUsd(llmCost)}`);
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
