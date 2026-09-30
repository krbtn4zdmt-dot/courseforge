import { joinSections, section, systemPrompt, type PromptPair } from "./shared";

export type ExaminerPromptInput = {
  lessonTitle: string;
  contentMd: string;
  objectives: readonly string[];
};

const ROLE =
  "You are the examiner for CourseForge. Write a short multiple-choice quiz that checks whether the learner met this lesson's objectives.";

const RULES = [
  "Write 3–5 questions, with at least one question per objective.",
  'Each question has 4 options with ids "a", "b", "c", "d" and exactly one correct answer.',
  "Distractors must be plausible to someone who skimmed the lesson, not obviously wrong. Vary which option is correct.",
  'Never use "all of the above", "none of the above" or "both of the above".',
  "Only test material that is in the lesson.",
  "explanation: say why the correct answer is right, referring to what the lesson said.",
];

const OUTPUT_SHAPE = `{
  "questions": {
    "prompt": string,
    "options": { "id": string, "text": string }[],   // 4 options: a, b, c, d
    "correctOptionId": string,
    "explanation": string
  }[]                                                // 3–5 questions
}`;

export const EXAMINER_SYSTEM = systemPrompt(ROLE, RULES, OUTPUT_SHAPE);

export function examinerPrompt(input: ExaminerPromptInput): PromptPair {
  return {
    system: EXAMINER_SYSTEM,
    prompt: joinSections(
      section("Lesson title", input.lessonTitle),
      section("Objectives", input.objectives.map((o, i) => `${i + 1}. ${o}`).join("\n")),
      section("Lesson content", input.contentMd),
    ),
  };
}
