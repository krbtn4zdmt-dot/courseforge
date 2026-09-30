import type { Level } from "../schemas";
import { joinSections, LEVEL_LABELS, section, systemPrompt, type PromptPair } from "./shared";

export type FactCheckSourceInput = {
  /** The citation number used in the lesson, e.g. 2 for [2]. */
  index: number;
  title: string;
  grounding: string;
};

export type FactCheckerPromptInput = {
  contentMd: string;
  sources: readonly FactCheckSourceInput[];
  level: Level;
};

const ROLE =
  "You are the fact-checker for CourseForge. Compare a lesson against the source passages it cites and report specific factual claims that the sources don't back up.";

const RULES = [
  "Only check specific factual claims: numbers, dates, names, quotes, cause-and-effect statements, and instructions a learner will follow.",
  "Do not flag framing, style, definitions, opinions, or common knowledge for a learner at the given level.",
  '"contradicted": a source says otherwise. "outdated": a source has newer information. "unsupported": a specific claim that none of the passages cover.',
  "claim: quote or closely paraphrase the claim from the lesson. suggestion: how to fix it, based on the sources.",
  "Return an empty issues list when everything checks out. Don't invent problems.",
];

const OUTPUT_SHAPE = `{
  "issues": {
    "claim": string,
    "problem": "unsupported" | "contradicted" | "outdated",
    "suggestion": string
  }[]
}`;

export const FACT_CHECKER_SYSTEM = systemPrompt(ROLE, RULES, OUTPUT_SHAPE);

export function factCheckerPrompt(input: FactCheckerPromptInput): PromptPair {
  const sources = input.sources.length
    ? input.sources.map((s) => `[${s.index}] ${s.title}\n${s.grounding.trim()}`).join("\n\n")
    : "(no sources cited)";
  return {
    system: FACT_CHECKER_SYSTEM,
    prompt: joinSections(
      section("Learner level", LEVEL_LABELS[input.level]),
      section("Source passages", sources),
      section("Lesson", input.contentMd),
    ),
  };
}
