import type { CourseRequest } from "../schemas";
import type { DayBudget } from "../timeBudget";
import {
  countLessonSlots,
  formatSlots,
  GOAL_LABELS,
  joinSections,
  LEVEL_LABELS,
  section,
  systemPrompt,
  type PromptPair,
} from "./shared";

export type PlannerPromptInput = {
  request: CourseRequest;
  timeBudget: readonly DayBudget[];
};

const ROLE =
  "You are the course planner for CourseForge. Given what a learner wants to learn and how much time they have, break the topic into subtopics, decide what kind of topic it is, and write the web searches that will find good sources.";

const RULES = [
  'topicType: "knowledge" (understanding facts and ideas, e.g. history), "skill" (doing something, e.g. Excel), or "hybrid" (both).',
  'sensitiveDomain: "medical", "legal", "financial" or "safety" when the course gives guidance in that area that someone could act on; otherwise null.',
  "Size the subtopic list to the time budget: roughly half as many subtopics as lesson slots, up to one per slot. A 3-day course should not have 25 subtopics.",
  "importance: 1 = must cover, 2 = should cover, 3 = nice to have. Put the must-cover subtopics first.",
  "prerequisites: names of other subtopics in this list that should be learned first. Use the exact names; never list a subtopic as its own prerequisite.",
  "searchQueries: exactly one entry per subtopic, using the subtopic's exact name, with 2–3 web search queries. The first query is the best single query for that subtopic; it is the only one used for the quick syllabus research.",
  "Write queries a researcher would type into a search engine: specific, with key names and terms, no quotation marks or search operators.",
  "commonMisconceptions: 2–5 things learners often get wrong about this topic, as short statements.",
  "Fit the plan to the learner's level and goal.",
];

const OUTPUT_SHAPE = `{
  "topicType": "knowledge" | "skill" | "hybrid",
  "sensitiveDomain": "medical" | "legal" | "financial" | "safety" | null,
  "subtopics": { "name": string, "importance": 1 | 2 | 3, "prerequisites": string[] }[],
  "searchQueries": { "subtopic": string, "queries": string[] }[],   // 2–3 queries each; the first is the best
  "commonMisconceptions": string[]
}`;

export const PLANNER_SYSTEM = systemPrompt(ROLE, RULES, OUTPUT_SHAPE);

export function plannerPrompt({ request, timeBudget }: PlannerPromptInput): PromptPair {
  const slots = countLessonSlots(timeBudget);
  return {
    system: PLANNER_SYSTEM,
    prompt: joinSections(
      section("Topic", request.topic),
      section("Learner", `Level: ${LEVEL_LABELS[request.level]}\nGoal: ${GOAL_LABELS[request.goal]}`),
      section(
        "Time budget",
        `${request.days} day(s), ${request.minutesPerDay} minutes per day, ${slots} lesson slot(s) in total.\n${formatSlots(timeBudget)}`,
      ),
    ),
  };
}
