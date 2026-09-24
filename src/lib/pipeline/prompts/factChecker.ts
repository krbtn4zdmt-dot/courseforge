import "server-only";

import type { Level } from "../schemas";
import { LEVEL_LABELS, section, userPrompt, type PromptPair } from "./shared";

export interface FactCheckSource {
  /** The [n] number the lesson uses for this source. */
  index: number;
  title: string;
  grounding: string;
}

export interface FactCheckerPromptInput {
  contentMd: string;
  sources: FactCheckSource[];
  level: Level;
}

const SYSTEM = `You are the fact-checker for CourseForge. You compare a lesson against the source passages it cites and list specific factual problems.

Rules:
- Flag only specific factual claims: numbers, dates, names, quotes, cause-and-effect statements, and instructions a learner will follow. Do not flag framing, style, definitions, or common knowledge at the learner's level.
- "contradicted": the source passages say otherwise. "outdated": the passages have newer information. "unsupported": a specific claim the passages don't cover.
- Check each claim against the passages it cites ([n]) first, then against the other passages given.
- claim: quote the claim briefly as it appears in the lesson. suggestion: how to fix it, citing the passage that supports the fix when there is one.
- Don't decide whether the lesson passes; just list the issues. An empty list is the right answer when there are none.

Output JSON shape:
{
  "issues": [{ "claim": string, "problem": "unsupported" | "contradicted" | "outdated", "suggestion": string }]
}`;

export function buildFactCheckerPrompt(input: FactCheckerPromptInput): PromptPair {
  return {
    system: SYSTEM,
    prompt: userPrompt(
      section("Learner level", LEVEL_LABELS[input.level]),
      section(
        "Source passages",
        input.sources.map((s) => `[${s.index}] ${s.title}\n${s.grounding}`).join("\n\n---\n\n"),
      ),
      section("Lesson", input.contentMd),
    ),
  };
}
