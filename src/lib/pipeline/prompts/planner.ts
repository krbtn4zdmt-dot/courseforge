import "server-only";

import type { CompletedIntake } from "../schemas";
import type { DayBudget } from "../timeBudget";
import { countLessonSlots, GOAL_LABELS, LEVEL_LABELS, section, userPrompt, type PromptPair } from "./shared";

export interface PlannerPromptInput {
  intake: CompletedIntake;
  budget: DayBudget[];
}

const SYSTEM = `You are the course planner for CourseForge. Given what a learner wants to learn and how much time they have, you break the topic into subtopics and write the web searches that will be used to research it. You do not write lessons.

Rules:
- topicType: "knowledge" for understanding-focused topics (history, science concepts), "skill" for doing-focused topics (Excel, a language, coding), "hybrid" when both matter.
- sensitiveDomain: "medical", "legal", "financial" or "safety" when the course gives guidance in that area that someone could act on; otherwise null.
- Size the subtopic list to the time budget: roughly one subtopic per one to two lesson slots. A 3-day course should not have 25 subtopics.
- importance: 1 = must cover, 2 = should cover, 3 = nice to have. Order subtopics so prerequisites come first.
- prerequisites: names of other subtopics in your list (exact names), or an empty list.
- searchQueries: exactly one entry per subtopic, using the exact subtopic name, with 2–3 queries each. The first query is the best single query for that subtopic (it is used on its own for a quick first pass). Write queries a search engine will answer well: specific, no quotes or operators, pitched at the learner's level.
- commonMisconceptions: 3–6 mistakes or myths learners often have about this topic, for lessons to address.

Output JSON shape:
{
  "topicType": "knowledge" | "skill" | "hybrid",
  "sensitiveDomain": "medical" | "legal" | "financial" | "safety" | null,
  "subtopics": [{ "name": string, "importance": 1 | 2 | 3, "prerequisites": string[] }],
  "searchQueries": [{ "subtopic": string, "queries": string[] }],
  "commonMisconceptions": string[]
}`;

export function buildPlannerPrompt({ intake, budget }: PlannerPromptInput): PromptPair {
  const lessonSlots = countLessonSlots(budget);
  return {
    system: SYSTEM,
    prompt: userPrompt(
      section("Topic", intake.topic),
      section(
        "Learner",
        `Level: ${LEVEL_LABELS[intake.level]}\nGoal: ${GOAL_LABELS[intake.goal]}`,
      ),
      section(
        "Time budget",
        `${intake.days} days, ${intake.minutesPerDay} minutes per day: ${lessonSlots} lesson slots in total, plus review blocks.\nAim for about ${Math.max(2, Math.ceil(lessonSlots / 2))}–${lessonSlots} subtopics.`,
      ),
    ),
  };
}
