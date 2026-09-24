import "server-only";

import { callJson } from "@/lib/llm/client";
import { mapWithConcurrency } from "@/lib/concurrency";
import { buildRelevancePrompt, type RelevanceItem } from "@/lib/pipeline/prompts/relevance";
import { RelevanceOutputSchema } from "@/lib/pipeline/schemas";

export const RELEVANCE_BATCH_SIZE = 25;
export const DEFAULT_RELEVANCE = 0.5;
const BATCH_CONCURRENCY = 3;

export interface RateRelevanceOptions {
  topic: string;
  items: RelevanceItem[];
  /** Injected in tests. */
  callJsonFn?: typeof callJson;
  onUsage?: Parameters<typeof callJson>[0]["onUsage"];
}

/**
 * One MODEL_FAST call per batch of up to 25 sources, rating each 0–1 against its subtopic.
 * Batches run up to 3 at a time. Returns id → relevance. Items the model skips, or whose batch fails, get 0.5 and a warning.
 */
export interface RelevanceResult {
  scores: Map<string, number>;
  /** Error messages of failed batches; their items scored DEFAULT_RELEVANCE. */
  failedBatches: string[];
}

export async function rateRelevance(opts: RateRelevanceOptions): Promise<RelevanceResult> {
  const call = opts.callJsonFn ?? callJson;
  const scores = new Map<string, number>();
  const failedBatches: string[] = [];

  const batches: RelevanceItem[][] = [];
  for (let i = 0; i < opts.items.length; i += RELEVANCE_BATCH_SIZE) batches.push(opts.items.slice(i, i + RELEVANCE_BATCH_SIZE));

  await mapWithConcurrency(batches, BATCH_CONCURRENCY, async (batch) => {
    const { system, prompt } = buildRelevancePrompt({ topic: opts.topic, items: batch });
    try {
      const result = await call({
        agent: "relevance",
        model: "fast",
        system,
        prompt,
        schema: RelevanceOutputSchema,
        maxTokens: 2_000,
        onUsage: opts.onUsage,
      });
      const ids = new Set(batch.map((b) => b.id));
      for (const s of result.scores) if (ids.has(s.id)) scores.set(s.id, s.relevance);
    } catch (err) {
      // One failed batch shouldn't sink research: its items fall back to the default below.
      const message = err instanceof Error ? err.message : String(err);
      failedBatches.push(message);
      console.warn(`[relevance] a batch of ${batch.length} failed: ${message}`);
    }
  });

  const missing = opts.items.filter((i) => !scores.has(i.id));
  if (missing.length) {
    console.warn(`[relevance] no score for ${missing.length} source(s); using ${DEFAULT_RELEVANCE}: ${missing.map((m) => m.id).join(", ")}`);
    for (const m of missing) scores.set(m.id, DEFAULT_RELEVANCE);
  }
  return { scores, failedBatches };
}
