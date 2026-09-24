import "server-only";

import { callJson, type CallJsonOptions } from "@/lib/llm/client";

import { buildPlannerPrompt } from "./prompts/planner";
import { PlannerOutputSchema, type CompletedIntake, type PlannerOutput } from "./schemas";
import { buildTimeBudget, type DayBudget } from "./timeBudget";

export interface AgentDeps {
  /** Injected in tests. */
  callJson?: typeof callJson;
  onUsage?: CallJsonOptions<unknown>["onUsage"];
}

/** Lesson slot counts don't depend on topic type, so any type works before the planner has decided. */
export function slotBudget(intake: CompletedIntake): DayBudget[] {
  return buildTimeBudget({ days: intake.days, minutesPerDay: intake.minutesPerDay, topicType: "knowledge" });
}

export async function planCourse(intake: CompletedIntake, deps: AgentDeps = {}): Promise<PlannerOutput> {
  const budget = slotBudget(intake);
  const { system, prompt } = buildPlannerPrompt({ intake, budget });
  const plan = await (deps.callJson ?? callJson)({
    agent: "planner",
    model: "smart",
    system,
    prompt,
    schema: PlannerOutputSchema,
    onUsage: deps.onUsage,
  });

  const slots = budget.reduce((n, d) => n + d.lessons.length, 0);
  if (plan.subtopics.length > slots * 2) {
    console.warn(`[planner] ${plan.subtopics.length} subtopics for ${slots} lesson slots; expected at most ~${slots}`);
  }
  return plan;
}
