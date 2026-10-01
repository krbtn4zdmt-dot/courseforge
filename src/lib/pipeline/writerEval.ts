import "server-only";

import { z } from "zod";

import { rebuildLessonSources } from "./factCheckEval";
import type { LessonWriterPromptInput } from "./prompts/lessonWriter";
import type { CourseResult, GeneratedLesson } from "./runCourse";

// Lesson-writer eval (pnpm eval:writer): rewrites shipped lessons whose sources carry a known bad fact
// (a source error or an outdated claim) and checks whether the new draft repeats it.

export const WriterEvalCaseSchema = z.object({
  course: z.string().min(1),
  day: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  /** Case-insensitive regexes for the bad fact; a draft matching any of them repeats it. */
  badFacts: z.array(z.string().min(1)).min(1),
  note: z.string().optional(),
});
export type WriterEvalCase = z.infer<typeof WriterEvalCaseSchema>;

export const WriterEvalFileSchema = z.object({ about: z.string(), cases: z.array(WriterEvalCaseSchema).min(1) });

/** The bad-fact patterns the text matches. */
export function badFactsIn(text: string, patterns: readonly string[]): string[] {
  return patterns.filter((p) => new RegExp(p, "i").test(text));
}

/** The writer input the pipeline would build for this shipped lesson's first draft today. */
export function writerInputFor(course: CourseResult, lesson: GeneratedLesson): LessonWriterPromptInput {
  return {
    lesson: lesson.spec,
    dayNumber: lesson.dayNumber,
    slot: lesson.slot,
    syllabus: course.syllabus.curriculum.syllabus,
    sources: rebuildLessonSources(course, lesson),
    level: course.intake.level,
    topicType: course.syllabus.plan.topicType,
    sensitiveDomain: course.syllabus.plan.sensitiveDomain,
  };
}
