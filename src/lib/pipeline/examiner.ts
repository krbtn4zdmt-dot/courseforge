import "server-only";

import { callJson } from "@/lib/llm/client";

import type { AgentDeps } from "./planner";
import { buildExaminerPrompt, questionCount, type ExaminerPromptInput } from "./prompts/examiner";
import { ExaminerOutputSchema, type ExaminerOutput } from "./schemas";

/** At least one question per objective (3–5 overall). */
export function examinerSchemaFor(objectiveCount: number) {
  const min = questionCount(objectiveCount);
  return ExaminerOutputSchema.superRefine((v, ctx) => {
    if (v.questions.length < min) {
      ctx.addIssue({
        code: "custom",
        path: ["questions"],
        message: `${v.questions.length} questions; need at least ${min} (one per objective)`,
      });
    }
  });
}

export async function examineLesson(input: ExaminerPromptInput, deps: AgentDeps = {}): Promise<ExaminerOutput> {
  const { system, prompt } = buildExaminerPrompt(input);
  return (deps.callJson ?? callJson)({
    agent: "examiner",
    model: "fast",
    system,
    prompt,
    schema: examinerSchemaFor(input.objectives.length),
    onUsage: deps.onUsage,
  });
}
