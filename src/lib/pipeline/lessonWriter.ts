import "server-only";

import { callJson, type Effort, type ModelTier } from "@/lib/llm/client";

import type { AgentDeps } from "./planner";
import { buildLessonWriterPrompt, type LessonWriterPromptInput } from "./prompts/lessonWriter";
import { extractCitationIndexes, LessonWriterOutputSchema, type LessonWriterOutput } from "./schemas";

/** The output schema plus the rules that depend on this lesson's inputs, so a violation gets the client's retry. */
export function lessonOutputSchemaFor(sourceCount: number, includesPractice: boolean, videoCount: number) {
  return LessonWriterOutputSchema.superRefine((v, ctx) => {
    const cited = v.activities.flatMap((c) => [...c.cites, ...(c.type === "reading" ? c.pages.flatMap(extractCitationIndexes) : [])]);
    const outOfRange = [...new Set(cited)].filter((n) => n > sourceCount).sort((a, b) => a - b);
    if (outOfRange.length) {
      ctx.addIssue({
        code: "custom",
        path: ["activities"],
        message: `cites source(s) ${outOfRange.join(", ")} but only [1]–[${sourceCount}] exist`,
      });
    }
    const placed = v.activities.flatMap((c) => (c.type === "video" ? [c.video] : []));
    const unknown = placed.filter((n) => n > videoCount);
    if (unknown.length) {
      ctx.addIssue({ code: "custom", path: ["activities"], message: `video ${unknown.join(", ")} doesn't exist (${videoCount} videos)` });
    }
    if (new Set(placed).size !== placed.length) {
      ctx.addIssue({ code: "custom", path: ["activities"], message: "place each video at most once" });
    }
    if (videoCount > 0 && !placed.length) {
      ctx.addIssue({ code: "custom", path: ["activities"], message: `place at least one of the ${videoCount} videos` });
    }
    const practice = v.activities.some((c) => c.type === "practiceStep");
    if (includesPractice && !practice) {
      ctx.addIssue({ code: "custom", path: ["activities"], message: "add a practiceStep card: this lesson includes practice" });
    }
    if (!includesPractice && practice) {
      ctx.addIssue({ code: "custom", path: ["activities"], message: "remove the practiceStep cards: this lesson has no practice" });
    }
  });
}

/** Which model drafts a lesson and which rewrites one after a failed fact-check. */
export interface WriterSettings {
  draftTier: ModelTier;
  rewriteTier: ModelTier;
  /** Omitted: the model's default. */
  effort?: Effort;
}

export const DEFAULT_WRITER: WriterSettings = { draftTier: "smart", rewriteTier: "smart" };

export async function writeLesson(
  input: LessonWriterPromptInput,
  deps: AgentDeps = {},
  options: { tier?: ModelTier; effort?: Effort } = {},
): Promise<LessonWriterOutput> {
  if (!input.sources.length) throw new Error(`[lessonWriter] no sources for "${input.lesson.title}"`);
  const { system, prompt } = buildLessonWriterPrompt(input);
  return (deps.callJson ?? callJson)({
    agent: "lessonWriter",
    model: options.tier ?? "smart",
    ...(options.effort && { effort: options.effort }),
    system,
    prompt,
    schema: lessonOutputSchemaFor(input.sources.length, input.lesson.includesPractice, input.videos.length),
    onUsage: deps.onUsage,
  });
}
