import "server-only";

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
  if (!result.passed) {
    console.warn(`[lesson] "${spec.title}" failed fact-check (${result.issues.length} issues); rewriting once`);
    content = await writeLesson({ ...writerInput, factCheckIssues: result.issues }, deps);
    result = await check(content);
    attempts = 2;
    if (!result.passed) {
      console.warn(
        `[lesson] "${spec.title}" still fails fact-check after rewrite; shipping with an unverified-claims notice:\n` +
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
      rewritten: attempts === 2,
      unverifiedClaims: result.passed ? [] : result.issues,
    },
  };
}
