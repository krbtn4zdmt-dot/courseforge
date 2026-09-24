import "server-only";

import { designCurriculum, type CurriculumResult } from "./curriculum";
import { planCourse, type AgentDeps } from "./planner";
import { research, type ResearchDeps, type ResearchStats } from "./researcher";
import type { CompletedIntake, PlannerOutput, ResearcherOutput } from "./schemas";
import { buildTimeBudget, type DayBudget } from "./timeBudget";

// Orchestrates the pipeline (used by the CLI and, from Phase 3, by jobs).
// Task 1.4: the syllabus half. Task 1.6 adds lesson generation and file output.

export const SYLLABUS_TARGET_MS = 20_000;

export interface SyllabusTimings {
  plannerMs: number;
  lightResearchMs: number;
  curriculumMs: number;
  totalMs: number;
}

export interface SyllabusResult {
  plan: PlannerOutput;
  budget: DayBudget[];
  research: ResearcherOutput;
  researchStats: ResearchStats;
  curriculum: CurriculumResult;
  timings: SyllabusTimings;
}

export interface SyllabusDeps extends AgentDeps {
  research?: ResearchDeps;
  clock?: () => number;
}

/** Planner → light research → curriculum, timing each step. */
export async function generateSyllabus(intake: CompletedIntake, deps: SyllabusDeps = {}): Promise<SyllabusResult> {
  const clock = deps.clock ?? Date.now;
  const agentDeps: AgentDeps = { callJson: deps.callJson, onUsage: deps.onUsage };
  const t0 = clock();

  const plan = await planCourse(intake, agentDeps);
  const t1 = clock();

  const light = await research(
    { topic: intake.topic, plan, mode: "light" },
    { ...deps.research, onUsage: deps.research?.onUsage ?? deps.onUsage },
  );
  const t2 = clock();

  // Slot counts were fixed before planning; the per-lesson split depends on the planner's topicType.
  const budget = buildTimeBudget({ days: intake.days, minutesPerDay: intake.minutesPerDay, topicType: plan.topicType });
  const curriculum = await designCurriculum({ intake, plan, research: light.output, budget }, agentDeps);
  const t3 = clock();

  return {
    plan,
    budget,
    research: light.output,
    researchStats: light.stats,
    curriculum,
    timings: { plannerMs: t1 - t0, lightResearchMs: t2 - t1, curriculumMs: t3 - t2, totalMs: t3 - t0 },
  };
}
