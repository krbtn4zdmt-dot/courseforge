import "server-only";

import { mapWithConcurrency } from "@/lib/concurrency";
import type { LlmCallLog } from "@/lib/llm/cost";

import { designCurriculum, type CurriculumResult } from "./curriculum";
import { examineLesson } from "./examiner";
import { factCheckLesson, type FactCheckResult } from "./factChecker";
import { selectLessonSources, selectLessonVideos } from "./lessonSources";
import { writeLesson } from "./lessonWriter";
import { planCourse, type AgentDeps } from "./planner";
import type { LessonWriterPromptInput } from "./prompts/lessonWriter";
import { research, type ResearchDeps, type ResearchStats } from "./researcher";
import type {
  CompletedIntake,
  CurriculumOutput,
  ExaminerOutput,
  FactCheckIssue,
  LessonWriterOutput,
  PlannerOutput,
  ResearcherOutput,
  Source,
  SyllabusItem,
} from "./schemas";
import { buildTimeBudget, splitLesson, type DayBudget, type LessonSlot } from "./timeBudget";

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

// ---------- One lesson: write → fact-check → (rewrite once) → examine ----------

export interface LessonRequest {
  intake: CompletedIntake;
  plan: PlannerOutput;
  syllabus: CurriculumOutput;
  budget: DayBudget[];
  /** Deep research (sources with grounding). */
  research: ResearcherOutput;
  dayNumber: number;
  /** 0-based position of the item within its day. */
  position: number;
}

export interface GeneratedLesson {
  dayNumber: number;
  position: number;
  spec: SyllabusItem;
  slot: LessonSlot;
  content: LessonWriterOutput;
  /** Cited sources only, keeping the numbers used in contentMd. */
  sources: { index: number; title: string; url: string }[];
  videos: Source[];
  quiz: ExaminerOutput;
  factCheck: {
    passed: boolean;
    issues: FactCheckIssue[];
    /** Fact-check runs: 1, or 2 after a rewrite. */
    attempts: number;
    rewritten: boolean;
    /** Set when the rewrite failed (the first draft shipped) or its re-check failed (the rewrite shipped unverified). */
    rewriteError: string | null;
    /** Shown as the "some claims could not be verified" notice when the rewrite still fails. */
    unverifiedClaims: FactCheckIssue[];
  };
}

/** The item's minute split: its lesson slot, or the review block split like a lesson. */
export function slotForItem(budget: readonly DayBudget[], dayNumber: number, position: number, plan: PlannerOutput): LessonSlot {
  const day = budget[dayNumber - 1];
  if (!day) throw new Error(`No day ${dayNumber} in the time budget`);
  const lesson = day.lessons[position];
  if (lesson) return lesson;
  if (position === day.lessons.length && day.reviewMinutes > 0) return splitLesson(day.reviewMinutes, plan.topicType);
  throw new Error(`No item ${position + 1} on day ${dayNumber}`);
}

export async function generateLesson(req: LessonRequest, deps: AgentDeps = {}): Promise<GeneratedLesson> {
  const spec = req.syllabus.days[req.dayNumber - 1]?.lessons[req.position];
  if (!spec) throw new Error(`No item ${req.position + 1} on day ${req.dayNumber} in the syllabus`);
  const slot = slotForItem(req.budget, req.dayNumber, req.position, req.plan);
  // No course-wide fallback: sources about other subtopics can't support this lesson's claims, so an item
  // with no matching research fails (visibly, via writeLesson) rather than cite unrelated material.
  const sources = selectLessonSources(req.research, spec.subtopics);
  const videos = spec.kind === "lesson" ? selectLessonVideos(req.research, spec.subtopics) : [];

  const writerInput: LessonWriterPromptInput = {
    lesson: spec,
    dayNumber: req.dayNumber,
    slot,
    syllabus: req.syllabus,
    sources,
    level: req.intake.level,
    topicType: req.plan.topicType,
    sensitiveDomain: req.plan.sensitiveDomain,
  };
  const check = (content: LessonWriterOutput): Promise<FactCheckResult> =>
    factCheckLesson(
      {
        contentMd: content.contentMd,
        sources: content.citedSourceIndexes.map((index) => ({ index, title: sources[index - 1]!.title, grounding: sources[index - 1]!.grounding })),
        level: req.intake.level,
      },
      deps,
    );

  let content = await writeLesson(writerInput, deps);
  let result = await check(content);
  let attempts = 1;
  let rewritten = false;
  let rewriteError: string | null = null;
  if (!result.passed) {
    console.warn(`[lesson] "${spec.title}" failed fact-check (${result.issues.length} issues); rewriting once`);
    let rewrite: LessonWriterOutput | null = null;
    try {
      rewrite = await writeLesson({ ...writerInput, factCheckIssues: result.issues }, deps);
    } catch (err) {
      // The first draft is usable: ship it with its known issues rather than lose the lesson.
      rewriteError = err instanceof Error ? err.message : String(err);
      console.warn(`[lesson] rewrite of "${spec.title}" failed (${rewriteError}); shipping the first draft with its notice`);
    }
    if (rewrite) {
      [content, rewritten] = [rewrite, true];
      try {
        [result, attempts] = [await check(rewrite), 2];
      } catch (err) {
        // The rewrite targeted known issues, so keep it; it's unverified, so it keeps the first draft's
        // issues as its notice rather than claiming a pass.
        rewriteError = `re-check failed: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`[lesson] re-check of the rewrite of "${spec.title}" failed; shipping the rewrite with the earlier issues as its notice`);
      }
    }
    if (!result.passed) {
      console.warn(
        `[lesson] "${spec.title}" ships with an unverified-claims notice:\n` +
          result.issues.map((i) => `- [${i.problem}] ${i.claim}`).join("\n"),
      );
    }
  }

  const quiz = await examineLesson({ contentMd: content.contentMd, objectives: spec.objectives, level: req.intake.level }, deps);

  return {
    dayNumber: req.dayNumber,
    position: req.position,
    spec,
    slot,
    content,
    sources: content.citedSourceIndexes.map((index) => ({ index, title: sources[index - 1]!.title, url: sources[index - 1]!.url })),
    videos,
    quiz,
    factCheck: {
      passed: result.passed,
      issues: result.issues,
      attempts,
      rewritten,
      rewriteError,
      unverifiedClaims: result.passed ? [] : result.issues,
    },
  };
}

// ---------- Whole course: syllabus → deep research → every item ----------

export const LESSON_CONCURRENCY = 3;

export type LessonOutcome =
  | { status: "ready"; lesson: GeneratedLesson }
  | { status: "failed"; dayNumber: number; position: number; title: string; error: string };

export interface CourseStats {
  timings: { syllabusMs: number; deepResearchMs: number; lessonsMs: number; totalMs: number };
  llm: {
    calls: number;
    costUsd: number;
    /** Calls whose model had no price in the cost table. */
    unpricedCalls: number;
    byAgent: Record<string, { calls: number; costUsd: number }>;
  };
  lessons: {
    total: number;
    ready: number;
    failed: number;
    rewritten: number;
    shippedWithNotice: number;
    /** Share of ready lessons shipped without the unverified-claims notice; null when none are ready. */
    factCheckPassRate: number | null;
  };
  youtubeUnits: number;
}

export interface CourseResult {
  intake: CompletedIntake;
  syllabus: SyllabusResult;
  deepResearch: { output: ResearcherOutput; stats: ResearchStats };
  lessons: LessonOutcome[];
  stats: CourseStats;
}

export interface CourseDeps extends SyllabusDeps {
  lessonConcurrency?: number;
}

export function summarizeUsage(logs: readonly LlmCallLog[]): CourseStats["llm"] {
  const byAgent: CourseStats["llm"]["byAgent"] = {};
  for (const log of logs) {
    const agent = (byAgent[log.agent] ??= { calls: 0, costUsd: 0 });
    agent.calls++;
    agent.costUsd += log.costUsd ?? 0;
  }
  return {
    calls: logs.length,
    costUsd: logs.reduce((n, l) => n + (l.costUsd ?? 0), 0),
    unpricedCalls: logs.filter((l) => l.costUsd === null).length,
    byAgent,
  };
}

export function summarizeLessons(outcomes: readonly LessonOutcome[]): CourseStats["lessons"] {
  const ready = outcomes.flatMap((o) => (o.status === "ready" ? [o.lesson] : []));
  const shippedWithNotice = ready.filter((l) => l.factCheck.unverifiedClaims.length > 0).length;
  return {
    total: outcomes.length,
    ready: ready.length,
    failed: outcomes.length - ready.length,
    rewritten: ready.filter((l) => l.factCheck.rewritten).length,
    shippedWithNotice,
    factCheckPassRate: ready.length ? (ready.length - shippedWithNotice) / ready.length : null,
  };
}

export async function runCourse(intake: CompletedIntake, deps: CourseDeps = {}): Promise<CourseResult> {
  const clock = deps.clock ?? Date.now;
  const logs: LlmCallLog[] = [];
  const onUsage = (log: LlmCallLog) => {
    logs.push(log);
    deps.onUsage?.(log);
  };
  const agentDeps: AgentDeps = { callJson: deps.callJson, onUsage };
  const t0 = clock();

  const syllabus = await generateSyllabus(intake, { ...deps, onUsage, research: { ...deps.research, onUsage } });
  const t1 = clock();

  const deepResearch = await research(
    { topic: intake.topic, plan: syllabus.plan, mode: "deep", previous: syllabus.research },
    { ...deps.research, onUsage },
  );
  const t2 = clock();

  const items = syllabus.curriculum.syllabus.days.flatMap((day) =>
    day.lessons.map((item, position) => ({ dayNumber: day.dayNumber, position, title: item.title })),
  );
  const lessons = await mapWithConcurrency(items, deps.lessonConcurrency ?? LESSON_CONCURRENCY, async (item): Promise<LessonOutcome> => {
    try {
      const lesson = await generateLesson(
        {
          intake,
          plan: syllabus.plan,
          syllabus: syllabus.curriculum.syllabus,
          budget: syllabus.budget,
          research: deepResearch.output,
          dayNumber: item.dayNumber,
          position: item.position,
        },
        agentDeps,
      );
      return { status: "ready", lesson };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[course] day ${item.dayNumber} item ${item.position + 1} "${item.title}" failed: ${error}`);
      return { status: "failed", ...item, error };
    }
  });
  const t3 = clock();

  return {
    intake,
    syllabus,
    deepResearch,
    lessons,
    stats: {
      timings: { syllabusMs: t1 - t0, deepResearchMs: t2 - t1, lessonsMs: t3 - t2, totalMs: t3 - t0 },
      llm: summarizeUsage(logs),
      lessons: summarizeLessons(lessons),
      youtubeUnits: deepResearch.stats.youtubeUnits,
    },
  };
}
