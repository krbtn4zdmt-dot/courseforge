import "server-only";

import { callJson } from "@/lib/llm/client";

import type { AgentDeps } from "./planner";
import { buildFactCheckerPrompt, type FactCheckerPromptInput } from "./prompts/factChecker";
import { FactCheckOutputSchema, type FactCheckIssue } from "./schemas";

export const MAX_UNSUPPORTED_CLAIMS = 2;

/** docs/AGENTS.md §7: fail on any contradicted or outdated claim, or more than 2 unsupported ones. */
export function factCheckPassed(issues: readonly FactCheckIssue[]): boolean {
  if (issues.some((i) => i.problem === "contradicted" || i.problem === "outdated")) return false;
  return issues.filter((i) => i.problem === "unsupported").length <= MAX_UNSUPPORTED_CLAIMS;
}

export interface FactCheckResult {
  issues: FactCheckIssue[];
  passed: boolean;
}

export async function factCheckLesson(input: FactCheckerPromptInput, deps: AgentDeps = {}): Promise<FactCheckResult> {
  const { system, prompt } = buildFactCheckerPrompt(input);
  const { issues } = await (deps.callJson ?? callJson)({
    agent: "factChecker",
    model: "fast",
    system,
    prompt,
    schema: FactCheckOutputSchema,
    onUsage: deps.onUsage,
  });
  return { issues, passed: factCheckPassed(issues) };
}
