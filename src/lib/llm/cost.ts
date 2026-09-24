import "server-only";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCallLog extends TokenUsage {
  agent: string;
  model: string;
  costUsd: number | null;
  attempts: number;
  durationMs: number;
  ok: boolean;
}

interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

// USD per million tokens, keyed by the model ID set in MODEL_SMART / MODEL_FAST.
// TODO: confirm against https://www.anthropic.com/pricing before launch (last checked 2026-09-24).
const PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
};

const warnedModels = new Set<string>();

/** Estimated cost in USD, or null when the model has no entry in the price table. */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const price = PRICES[model];
  if (!price) {
    if (!warnedModels.has(model)) {
      warnedModels.add(model);
      console.warn(`[llm] no price for model "${model}"; cost will be logged as unknown`);
    }
    return null;
  }
  return (
    (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) /
    1_000_000
  );
}

export function formatCostUsd(costUsd: number | null): string {
  return costUsd === null ? "$?" : `$${costUsd.toFixed(5)}`;
}

export function logUsage(log: LlmCallLog): void {
  console.info(
    `[llm] ${log.ok ? "ok" : "failed"} agent=${log.agent} model=${log.model} ` +
      `in=${log.inputTokens} out=${log.outputTokens} cost=${formatCostUsd(log.costUsd)} ` +
      `attempts=${log.attempts} ${log.durationMs}ms`,
  );
}
