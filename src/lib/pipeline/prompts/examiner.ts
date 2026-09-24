import "server-only";

import { OPTIONS_PER_QUESTION, type Level } from "../schemas";
import { bullets, LEVEL_LABELS, section, userPrompt, type PromptPair } from "./shared";

export interface ExaminerPromptInput {
  contentMd: string;
  objectives: string[];
  level: Level;
}

/** 3–5 questions, and at least one per objective. */
export function questionCount(objectiveCount: number): number {
  return Math.min(Math.max(objectiveCount, 3), 5);
}

const SYSTEM = `You are the examiner for CourseForge. You write a short multiple-choice quiz that checks whether the learner met a lesson's objectives.

Rules:
- Write the number of questions given in the input, with at least one question per objective.
- Each question has exactly ${OPTIONS_PER_QUESTION} options with ids "a", "b", "c", "d", and exactly one correct option.
- Test understanding and application, not trivia or wording tricks. Everything needed to answer must be in the lesson.
- Distractors are plausible: common mistakes or misconceptions, similar length and style to the correct answer.
- Never use "all of the above", "none of the above" or "both of the above".
- Vary which option id is correct.
- explanation: why the correct answer is right (and, where useful, why a tempting distractor is wrong), referring to the lesson.
- Pitch questions at the learner's level.

Output JSON shape:
{
  "questions": [{
    "prompt": string,
    "options": [{ "id": string, "text": string }],
    "correctOptionId": string,
    "explanation": string
  }]
}`;

export function buildExaminerPrompt(input: ExaminerPromptInput): PromptPair {
  return {
    system: SYSTEM,
    prompt: userPrompt(
      section("Objectives", bullets(input.objectives)),
      section("Learner level", LEVEL_LABELS[input.level]),
      section("Number of questions", String(questionCount(input.objectives.length))),
      section("Lesson", input.contentMd),
    ),
  };
}
