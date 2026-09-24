import "server-only";

import type { CompletedIntake, CurriculumOutput, PlannerOutput } from "../schemas";
import type { DayBudget } from "../timeBudget";
import { formatBudgetSlots, GOAL_LABELS, json, LEVEL_LABELS, section, userPrompt, type PromptPair } from "./shared";

export interface SourceSummary {
  subtopic: string;
  sources: { title: string; excerpt: string }[];
}

export interface CurriculumPromptInput {
  intake: CompletedIntake;
  plan: PlannerOutput;
  sourceSummaries: SourceSummary[];
  budget: DayBudget[];
  /** Set when the learner asks for changes to an existing syllabus. */
  edit?: { previous: CurriculumOutput; feedback: string };
  /** Set on the retry after a syllabus failed the time-budget check. */
  fix?: { previous: CurriculumOutput; problems: string[] };
}

const SYSTEM = `You are the curriculum designer for CourseForge. You turn a course plan into a day-by-day syllabus that fits the learner's time budget exactly. You write titles and objectives, not lesson content.

Rules:
- Follow the time budget's slots exactly: each day has the same number of items, in the same order and of the same kind, as its slots, with lessons before the review item. Set each item's estMinutes to its slot's minutes.
- kind "lesson" teaches new material. kind "review" is spaced recall of earlier days' material; the final day's review item is the course review plus the final quiz.
- Order respects prerequisites. Cover every importance-1 subtopic; include importance 2 and 3 subtopics as time allows.
- Each item has 2–4 objectives, each starting with a verb ("Explain…", "Build…", "Compare…"), specific enough to write quiz questions from.
- subtopics: the exact planner subtopic names the item covers (review items list the subtopics they revisit).
- includesPractice: true when the item includes a hands-on task (always true for skill topics' lessons; usually false for pure knowledge lessons).
- Pitch titles and objectives at the learner's level and goal. Use the source summaries to see what material is available.
- theme: a short phrase for what the day is about.
- courseSummary: 2–3 sentences.
- If an edit request is given, apply the learner's feedback to the previous syllabus and change as little else as possible, still following the slots.

Output JSON shape:
{
  "courseTitle": string,
  "courseSummary": string,
  "days": [{
    "dayNumber": number,
    "theme": string,
    "lessons": [{
      "kind": "lesson" | "review",
      "title": string,
      "objectives": string[],
      "estMinutes": number,
      "subtopics": string[],
      "includesPractice": boolean
    }]
  }]
}`;

function formatSources(summaries: SourceSummary[]): string {
  return summaries
    .map(
      (s) =>
        `${s.subtopic}:\n${s.sources.length ? s.sources.map((src) => `  - ${src.title}: ${src.excerpt}`).join("\n") : "  (no sources found)"}`,
    )
    .join("\n");
}

export function buildCurriculumPrompt(input: CurriculumPromptInput): PromptPair {
  const { intake, plan, budget, edit } = input;
  const sections = [
    section("Topic", `${intake.topic} (${plan.topicType})`),
    section(
      "Learner",
      `Level: ${LEVEL_LABELS[intake.level]}\nGoal: ${GOAL_LABELS[intake.goal]}\nTime: ${intake.days} days, ${intake.minutesPerDay} minutes per day`,
    ),
    section("Time budget slots (follow exactly)", formatBudgetSlots(budget)),
    section(
      "Planner subtopics",
      plan.subtopics
        .map(
          (s) =>
            `- ${s.name} (importance ${s.importance}${s.prerequisites.length ? `; after: ${s.prerequisites.join(", ")}` : ""})`,
        )
        .join("\n"),
    ),
    section("Common misconceptions to address", plan.commonMisconceptions.map((m) => `- ${m}`).join("\n")),
    section("Source summaries", formatSources(input.sourceSummaries)),
  ];
  if (edit) {
    sections.push(
      section("Previous syllabus", json(edit.previous)),
      section("Learner's requested changes", edit.feedback),
    );
  }
  if (input.fix) {
    sections.push(
      section("Your previous syllabus", json(input.fix.previous)),
      section(
        "Problems to fix (keep the content, correct these against the time budget slots)",
        input.fix.problems.map((p) => `- ${p}`).join("\n"),
      ),
    );
  }
  return { system: SYSTEM, prompt: userPrompt(...sections) };
}
