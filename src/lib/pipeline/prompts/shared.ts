// Helpers shared by the prompt templates. Every template returns { system, prompt }:
// `system` is fixed per agent (role, rules, JSON shape) so it can be cached;
// `prompt` holds the inputs in labeled sections.
import type { DayBudget } from "../timeBudget";
import type { Goal, Level } from "../schemas";

export type PromptPair = { system: string; prompt: string };

export const JSON_ONLY = "Respond with JSON only.";

/** A labeled input section. */
export function section(label: string, body: string): string {
  return `## ${label}\n${body.trim()}`;
}

export function joinSections(...sections: string[]): string {
  return sections.join("\n\n");
}

export function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** Builds a system prompt: role, rules, output shape, JSON-only instruction. */
export function systemPrompt(role: string, rules: readonly string[], outputShape: string): string {
  return joinSections(
    role,
    section("Rules", bullets(rules)),
    section("Output", `Return a single JSON object with exactly this shape:\n${outputShape.trim()}`),
    JSON_ONLY,
  );
}

export const LEVEL_LABELS: Record<Level, string> = {
  beginner: "Beginner: new to the topic; define terms and avoid assumed background",
  some_exposure: "Some exposure: knows the basics; move quickly past fundamentals",
  refresher: "Refresher: learned it before; focus on recall, gaps and nuance",
};

export const GOAL_LABELS: Record<Goal, string> = {
  understand: "Understand the topic",
  pass_test: "Pass a test or exam",
  practical_skill: "Build a practical skill",
};

/** One line per day, e.g. "Day 3: lesson 14 min, lesson 13 min, review 3 min". */
export function formatSlots(budget: readonly DayBudget[]): string {
  return budget
    .map((day) => {
      const items = day.lessons.map((l) => `lesson ${l.estMinutes} min`);
      if (day.reviewMinutes > 0) items.push(`review ${day.reviewMinutes} min`);
      return `Day ${day.dayNumber}: ${items.join(", ")}`;
    })
    .join("\n");
}

export function countLessonSlots(budget: readonly DayBudget[]): number {
  return budget.reduce((sum, day) => sum + day.lessons.length, 0);
}
