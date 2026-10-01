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
    .replace(/\\(?=[^\s\w])/g, "") // markdown escapes: "5+2\*3" reads as "5+2*3"
    .replace(/[*_`]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** The quote's parts (split at ellipses), normalized and trimmed of surrounding quotes and punctuation. */
function quoteParts(quote: string): string[] {
  return quote
    .split(/\.\.\.|…/)
    .map((p) => normalizeForQuote(p).replace(/^[\s"'.,;:]+|[\s"'.,;:]+$/g, ""))
    .filter(Boolean);
}

/**
 * True when every part of the quote (split at ellipses) appears in the named passage, or in any passage
 * when the index is missing or unknown. Case, whitespace, markdown escapes and emphasis, and curly quotes are ignored.
 */
export function quoteFoundInPassages(quote: string, sourceIndex: number | null, sources: readonly FactCheckSource[]): boolean {
  const parts = quoteParts(quote);
  if (!parts.length) return false;
  const named = sources.find((s) => s.index === sourceIndex);
  const passages = (named ? [named] : sources).map((s) => normalizeForQuote(s.grounding));
  return passages.some((p) => parts.every((part) => p.includes(part)));
}

/**
 * True when the claim is quoted from the lesson: every part appears in it, ignoring what quoteFoundInPassages
 * ignores plus citation markers, headings, blockquote marks and table pipes.
 */
export function claimFoundInLesson(claim: string, contentMd: string): boolean {
  const strip = (text: string) => text.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, " ").replace(/[|#>]/g, " ");
  const parts = quoteParts(strip(claim));
  const lesson = normalizeForQuote(strip(contentMd));
  return parts.length > 0 && parts.every((part) => lesson.includes(part));
}

/** Lines of a rendered card lesson that are wrong on purpose: myths and spot-the-error mistakes (cards.ts). */
const DELIBERATE_ERROR_LINE = /^- (?:Myth \(false on purpose\)|Deliberate mistake): .*$/gm;

/** True when the claim is quoted from a myth or a spot-the-error mistake, which the lesson states is wrong. */
export function claimIsDeliberateError(claim: string, lessonText: string): boolean {
  const parts = quoteParts(claim.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, " "));
  if (!parts.length) return false;
  return [...lessonText.matchAll(DELIBERATE_ERROR_LINE)].some((m) => {
    const line = normalizeForQuote(m[0]);
    return parts.every((part) => line.includes(part));
  });
}

/**
 * Findings to issues. Dropped: "supported" findings, findings whose claim isn't in the lesson (the model
 * sometimes lists a passage's own sentence), and claims taken from a myth or a deliberate mistake. A contradicted or outdated verdict whose quote isn't in the
 * passages is downgraded to unsupported (a contradiction needs evidence the lesson can be fixed against).
 */
export function issuesFromFindings(
  findings: readonly FactCheckFinding[],
  sources: readonly FactCheckSource[],
  contentMd: string,
): FactCheckIssue[] {
  return findings.flatMap((f): FactCheckIssue[] => {
    if (f.verdict === "supported" || !claimFoundInLesson(f.claim, contentMd) || claimIsDeliberateError(f.claim, contentMd)) return [];
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
  const issues = issuesFromFindings(findings, input.sources, input.contentMd);
  return { issues, passed: factCheckPassed(issues) };
}
