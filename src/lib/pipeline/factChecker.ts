import "server-only";

import { callJson } from "@/lib/llm/client";

import type { AgentDeps } from "./planner";
import { buildFactCheckerPrompt, type FactCheckerPromptInput, type FactCheckSource } from "./prompts/factChecker";
import type { LessonSource } from "./prompts/lessonWriter";
import { FactCheckOutputSchema, type FactCheckFinding, type FactCheckIssue } from "./schemas";

export const MAX_UNSUPPORTED_CLAIMS = 2;

/** docs/AGENTS.md §7: fail on any contradicted or outdated claim, or more than 2 unsupported ones. */
export function factCheckPassed(issues: readonly FactCheckIssue[]): boolean {
  if (issues.some((i) => i.problem === "contradicted" || i.problem === "outdated")) return false;
  return issues.filter((i) => i.problem === "unsupported").length <= MAX_UNSUPPORTED_CLAIMS;
}

/** The passages the fact-checker sees: the lesson's cited sources, keeping their [n] numbers. */
export function citedFactCheckSources(sources: readonly LessonSource[], citedIndexes: readonly number[]): FactCheckSource[] {
  return citedIndexes.map((index) => {
    const source = sources[index - 1];
    if (!source) throw new Error(`[factChecker] cited source [${index}] doesn't exist (${sources.length} sources)`);
    return { index, title: source.title, grounding: source.grounding };
  });
}

function normalizeForQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when every part of the quote (split at ellipses) appears in the named passage, or in any passage
 * when the index is missing or unknown. Case, whitespace, markdown emphasis and curly quotes are ignored.
 */
export function quoteFoundInPassages(quote: string, sourceIndex: number | null, sources: readonly FactCheckSource[]): boolean {
  const parts = quote
    .split(/\.\.\.|…/)
    .map((p) => normalizeForQuote(p).replace(/^[\s"'.,;:]+|[\s"'.,;:]+$/g, ""))
    .filter(Boolean);
  if (!parts.length) return false;
  const named = sources.find((s) => s.index === sourceIndex);
  const passages = (named ? [named] : sources).map((s) => normalizeForQuote(s.grounding));
  return passages.some((p) => parts.every((part) => p.includes(part)));
}

/**
 * Findings to issues: "supported" findings are dropped, and a contradicted or outdated verdict whose quote
 * isn't in the passages is downgraded to unsupported (a contradiction needs evidence the lesson can be fixed against).
 */
export function issuesFromFindings(findings: readonly FactCheckFinding[], sources: readonly FactCheckSource[]): FactCheckIssue[] {
  return findings.flatMap((f): FactCheckIssue[] => {
    if (f.verdict === "supported") return [];
    const evidenced = f.passageSays !== null && quoteFoundInPassages(f.passageSays, f.sourceIndex, sources);
    const problem = f.verdict === "unsupported" || evidenced ? f.verdict : "unsupported";
    return [{ claim: f.claim, problem, suggestion: f.suggestion }];
  });
}

export interface FactCheckResult {
  issues: FactCheckIssue[];
  passed: boolean;
}

export async function factCheckLesson(input: FactCheckerPromptInput, deps: AgentDeps = {}): Promise<FactCheckResult> {
  const { system, prompt } = buildFactCheckerPrompt(input);
  const { findings } = await (deps.callJson ?? callJson)({
    agent: "factChecker",
    model: "fast",
    system,
    prompt,
    schema: FactCheckOutputSchema,
    onUsage: deps.onUsage,
  });
  const issues = issuesFromFindings(findings, input.sources);
  return { issues, passed: factCheckPassed(issues) };
}
