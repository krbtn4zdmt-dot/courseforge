import "server-only";

import { callJson } from "@/lib/llm/client";

import type { AgentDeps } from "./planner";
import { buildLessonWriterPrompt, type LessonWriterPromptInput } from "./prompts/lessonWriter";
import { extractCitationIndexes, LessonWriterOutputSchema, type LessonWriterOutput } from "./schemas";

/** The output schema plus the rules that depend on this lesson's inputs, so a violation gets the client's retry. */
export function lessonOutputSchemaFor(sourceCount: number, includesPractice: boolean) {
  return LessonWriterOutputSchema.superRefine((v, ctx) => {
    const outOfRange = [...new Set([...extractCitationIndexes(v.contentMd), ...v.citedSourceIndexes])].filter(
      (n) => n > sourceCount,
    );
    if (outOfRange.length) {
      ctx.addIssue({
        code: "custom",
        path: ["citedSourceIndexes"],
        message: `cites source(s) ${outOfRange.join(", ")} but only [1]–[${sourceCount}] exist`,
      });
    }
    if (includesPractice && !v.practiceTask) {
      ctx.addIssue({ code: "custom", path: ["practiceTask"], message: "required: this lesson includes practice" });
    }
    if (!includesPractice && v.practiceTask) {
      ctx.addIssue({ code: "custom", path: ["practiceTask"], message: "must be null: this lesson has no practice" });
    }
  });
}

export async function writeLesson(input: LessonWriterPromptInput, deps: AgentDeps = {}): Promise<LessonWriterOutput> {
  if (!input.sources.length) throw new Error(`[lessonWriter] no sources for "${input.lesson.title}"`);
  const { system, prompt } = buildLessonWriterPrompt(input);
  return (deps.callJson ?? callJson)({
    agent: "lessonWriter",
    model: "smart",
    system,
    prompt,
    schema: lessonOutputSchemaFor(input.sources.length, input.lesson.includesPractice),
    onUsage: deps.onUsage,
  });
}
