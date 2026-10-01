import "server-only";

import { z } from "zod";

import { stripMarkdownNoise } from "@/lib/research/grounding";

import { citedFactCheckSources } from "./factChecker";
import { selectLessonSources } from "./lessonSources";
import type { FactCheckerPromptInput } from "./prompts/factChecker";
import type { LessonSource } from "./prompts/lessonWriter";
import type { CourseResult, GeneratedLesson } from "./runCourse";
import type { FactCheckIssue } from "./schemas";

// Fact-checker eval (pnpm eval:factcheck): re-checks shipped lessons whose claims were labeled by hand,
// and scores false alarms (supported claims flagged) against real problems caught.

export const EvalLabelSchema = z.object({
  /** Matches an issue whose claim contains any of these (case-insensitive). */
  match: z.array(z.string().min(1)).min(1),
  /** supported: a cited passage states it. error: should be flagged. either: not scored. */
  truth: z.enum(["supported", "error", "either"]),
  note: z.string().optional(),
});
export type EvalLabel = z.infer<typeof EvalLabelSchema>;

export const EvalCaseSchema = z.object({
  course: z.string().min(1),
  day: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  labels: z.array(EvalLabelSchema),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalLabelsFileSchema = z.object({ about: z.string(), cases: z.array(EvalCaseSchema).min(1) });

export function labelMatches(label: EvalLabel, issue: FactCheckIssue): boolean {
  const claim = issue.claim.toLowerCase();
  return label.match.some((m) => claim.includes(m.toLowerCase()));
}

export interface CaseScore {
  /** Supported claims that were flagged. */
  falseAlarms: EvalLabel[];
  /** Error claims that were flagged. */
  caught: EvalLabel[];
  /** Error claims that weren't flagged. */
  missed: EvalLabel[];
  /** Issues matching no label: unknown, but on a lesson that passed its original check most are false alarms. */
  unlabeled: FactCheckIssue[];
}

export function scoreFactCheck(issues: readonly FactCheckIssue[], labels: readonly EvalLabel[]): CaseScore {
  const flagged = (label: EvalLabel) => issues.some((i) => labelMatches(label, i));
  return {
    falseAlarms: labels.filter((l) => l.truth === "supported" && flagged(l)),
    caught: labels.filter((l) => l.truth === "error" && flagged(l)),
    missed: labels.filter((l) => l.truth === "error" && !flagged(l)),
    unlabeled: issues.filter((i) => !labels.some((l) => labelMatches(l, i))),
  };
}

export function findLesson(course: CourseResult, day: number, position: number): GeneratedLesson {
  for (const outcome of course.lessons) {
    if (outcome.status === "ready" && outcome.lesson.dayNumber === day && outcome.lesson.position === position) return outcome.lesson;
  }
  throw new Error(`No ready lesson at day ${day}, item ${position + 1}`);
}

/**
 * The sources the pipeline would give this shipped lesson today: the same selection from the stored deep
 * research, with grounding passed through the current markdown stripping. Throws if a cited source moved.
 */
export function rebuildLessonSources(course: CourseResult, lesson: GeneratedLesson): LessonSource[] {
  const sources = selectLessonSources(course.deepResearch.output, lesson.spec.subtopics).map((s) => ({
    ...s,
    grounding: stripMarkdownNoise(s.grounding),
  }));
  for (const cited of lesson.sources) {
    if (sources[cited.index - 1]?.url !== cited.url) {
      throw new Error(`Source [${cited.index}] of "${lesson.spec.title}" no longer matches the stored research`);
    }
  }
  return sources;
}

/** The fact-checker input the pipeline would build for this shipped lesson today. */
export function factCheckInputFor(course: CourseResult, lesson: GeneratedLesson): FactCheckerPromptInput {
  return {
    contentMd: lesson.content.contentMd,
    sources: citedFactCheckSources(rebuildLessonSources(course, lesson), lesson.content.citedSourceIndexes),
    level: course.intake.level,
  };
}
