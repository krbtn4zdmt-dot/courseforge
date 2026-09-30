import type { CourseRequest, CurriculumOutput, PlannerOutput } from "../schemas";
import type { DayBudget } from "../timeBudget";
import {
  formatSlots,
  GOAL_LABELS,
  joinSections,
  LEVEL_LABELS,
  section,
  systemPrompt,
  type PromptPair,
} from "./shared";

export type SourceSummary = { title: string; excerpt: string };

export type CurriculumPromptInput = {
  request: CourseRequest;
  plan: PlannerOutput;
  sourceSummaries: readonly { subtopic: string; sources: readonly SourceSummary[] }[];
  timeBudget: readonly DayBudget[];
  /** Present when the learner asks for changes to an existing syllabus. */
  edit?: { previousSyllabus: CurriculumOutput; feedback: string };
};

const ROLE =
  "You are the curriculum designer for CourseForge. Turn the course plan into a day-by-day syllabus that fits the learner's time budget exactly.";

const RULES = [
  "The time budget lists the exact slots for each day. Each day must have the same number of items, in the same order and of the same kind (lesson or review), as its slots, with lessons before the review item.",
  "Set each item's estMinutes to its slot's minutes. Each day's total must equal the day's minutes.",
  "Review items are spaced recall of earlier days' material. On the final day, the review item is the course review plus the final quiz.",
  "Order lessons so prerequisites come first. Cover every importance-1 subtopic; include importance-2 and 3 subtopics as time allows.",
  "Each lesson's subtopics must use the planner's exact subtopic names. Review items list the subtopics they revisit.",
  "objectives: 2–4 per item, each starting with a verb (e.g. \"Explain…\", \"Compare…\", \"Build…\"), specific enough to write a quiz question for.",
  "includesPractice: true when the item has a hands-on task or exercise. Skill topics should have practice in most lessons.",
  "Give each day a short theme and each item a clear, specific title.",
  "courseSummary: 2–3 sentences on what the learner will be able to do by the end.",
  "Pitch everything at the learner's level and goal. Use the source summaries to see what the research covers.",
];

const OUTPUT_SHAPE = `{
  "courseTitle": string,
  "courseSummary": string,               // 2–3 sentences
  "days": {
    "dayNumber": number,                 // 1, 2, 3, …
    "theme": string,
    "lessons": {
      "kind": "lesson" | "review",
      "title": string,
      "objectives": string[],            // 2–4, each starts with a verb
      "estMinutes": number,              // the slot's minutes
      "subtopics": string[],             // planner subtopic names
      "includesPractice": boolean
    }[]
  }[]
}`;

export const CURRICULUM_SYSTEM = systemPrompt(ROLE, RULES, OUTPUT_SHAPE);

function formatSubtopics(plan: PlannerOutput): string {
  return plan.subtopics
    .map((s) => {
      const prereqs = s.prerequisites.length ? ` (after: ${s.prerequisites.join(", ")})` : "";
      return `- [importance ${s.importance}] ${s.name}${prereqs}`;
    })
    .join("\n");
}

function formatSources(sourceSummaries: CurriculumPromptInput["sourceSummaries"]): string {
  return sourceSummaries
    .map(({ subtopic, sources }) => {
      const lines = sources.length
        ? sources.map((s) => `  - ${s.title}: ${s.excerpt}`).join("\n")
        : "  - (no sources found)";
      return `${subtopic}\n${lines}`;
    })
    .join("\n");
}

export function curriculumPrompt(input: CurriculumPromptInput): PromptPair {
  const { request, plan, timeBudget, edit } = input;
  const sections = [
    section("Topic", `${request.topic} (${plan.topicType})`),
    section("Learner", `Level: ${LEVEL_LABELS[request.level]}\nGoal: ${GOAL_LABELS[request.goal]}`),
    section("Time budget (exact slots per day)", `${request.minutesPerDay} minutes per day.\n${formatSlots(timeBudget)}`),
    section("Subtopics", formatSubtopics(plan)),
    section("Common misconceptions to address", plan.commonMisconceptions.map((m) => `- ${m}`).join("\n") || "(none)"),
    section("Source summaries", formatSources(input.sourceSummaries) || "(none)"),
  ];
  if (edit) {
    sections.push(
      section("Previous syllabus", JSON.stringify(edit.previousSyllabus, null, 2)),
      section(
        "Learner's requested changes",
        `${edit.feedback}\n\nRevise the previous syllabus to address this feedback while keeping the time-budget slots.`,
      ),
    );
  }
  return { system: CURRICULUM_SYSTEM, prompt: joinSections(...sections) };
}
