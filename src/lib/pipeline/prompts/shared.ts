import "server-only";

export interface PromptPair {
  system: string;
  prompt: string;
}

export const JSON_ONLY = "Respond with JSON only.";

/** A labeled input section. Empty or missing bodies render as "(none)". */
export function section(title: string, body: string | null | undefined): string {
  const text = body?.trim();
  return `## ${title}\n${text ? text : "(none)"}`;
}

/** Joins input sections and ends with the JSON-only instruction. */
export function userPrompt(...sections: string[]): string {
  return [...sections, JSON_ONLY].join("\n\n");
}

export function bullets(items: readonly string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export const LEVEL_LABELS = {
  beginner: "beginner (new to the topic)",
  some_exposure: "some exposure (knows the basics)",
  refresher: "refresher (knew it once, needs a refresh)",
} as const;

export const GOAL_LABELS = {
  understand: "understand the topic",
  pass_test: "pass a test or exam",
  practical_skill: "build a practical skill",
} as const;

interface BudgetDay {
  dayNumber: number;
  reviewMinutes: number;
  lessons: { estMinutes: number }[];
}

/** One line per day with its exact slots, e.g. "Day 3: lesson 14 min, lesson 13 min, review 3 min (total 30)". */
export function formatBudgetSlots(budget: readonly BudgetDay[]): string {
  return budget
    .map((day) => {
      const slots = day.lessons.map((l) => `lesson ${l.estMinutes} min`);
      if (day.reviewMinutes > 0) slots.push(`review ${day.reviewMinutes} min`);
      const total = day.reviewMinutes + day.lessons.reduce((s, l) => s + l.estMinutes, 0);
      return `Day ${day.dayNumber}: ${slots.join(", ")} (total ${total})`;
    })
    .join("\n");
}

export function countLessonSlots(budget: readonly BudgetDay[]): number {
  return budget.reduce((n, day) => n + day.lessons.length, 0);
}
