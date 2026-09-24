import "server-only";

import { callJson } from "@/lib/llm/client";
import { termsFrom } from "@/lib/research/grounding";

import type { AgentDeps } from "./planner";
import { buildCurriculumPrompt, type SourceSummary } from "./prompts/curriculum";
import {
  CurriculumOutputSchema,
  type CompletedIntake,
  type CurriculumOutput,
  type PlannerOutput,
  type ResearcherOutput,
} from "./schemas";
import type { DayBudget } from "./timeBudget";

// Curriculum Designer: docs/AGENTS.md §4. Days must match the time budget's slots; totals within ±10%.
// Checked in code: one retry with the problems listed, then estMinutes snapped to the slots.

export const DAY_TOTAL_TOLERANCE = 0.1;
const TOKENS_PER_SYLLABUS_ITEM = 200;
const MIN_CURRICULUM_TOKENS = 16_000;
const MAX_CURRICULUM_TOKENS = 64_000;

/** Output budget for a syllabus: ~200 tokens per item plus headroom, 16k–64k. A 60-day, 4-lesson course needs ~50k. */
export function curriculumMaxTokens(budget: readonly DayBudget[]): number {
  const items = budget.reduce((n, d) => n + d.lessons.length + (d.reviewMinutes > 0 ? 1 : 0), 0);
  return Math.min(MAX_CURRICULUM_TOKENS, Math.max(MIN_CURRICULUM_TOKENS, items * TOKENS_PER_SYLLABUS_ITEM + 4_000));
}
const SOURCES_PER_SUBTOPIC_IN_PROMPT = 3;

export interface BudgetCheck {
  /** Day/item count, kind or order doesn't match the slots: snapping can't fix these. */
  structure: string[];
  /** estMinutes off its slot, or a day total outside ±10%: fixed by snapping. */
  minutes: string[];
  /** Subtopic names the planner didn't produce. */
  subtopics: string[];
}

interface Slot {
  kind: "lesson" | "review";
  minutes: number;
}

export function slotsFor(day: DayBudget): Slot[] {
  const slots: Slot[] = day.lessons.map((l) => ({ kind: "lesson", minutes: l.estMinutes }));
  if (day.reviewMinutes > 0) slots.push({ kind: "review", minutes: day.reviewMinutes });
  return slots;
}

export function checkAgainstBudget(
  syllabus: CurriculumOutput,
  budget: readonly DayBudget[],
  minutesPerDay: number,
  subtopicNames: readonly string[],
): BudgetCheck {
  const check: BudgetCheck = { structure: [], minutes: [], subtopics: [] };
  if (syllabus.days.length !== budget.length) {
    check.structure.push(`The course has ${syllabus.days.length} days; it must have exactly ${budget.length}.`);
  }
  const known = new Set(subtopicNames);

  syllabus.days.forEach((day, d) => {
    const budgetDay = budget[d];
    if (!budgetDay) return;
    const slots = slotsFor(budgetDay);
    const expected = slots.map((s) => s.kind).join(", ");
    const actual = day.lessons.map((l) => l.kind).join(", ");
    if (expected !== actual) {
      check.structure.push(`Day ${day.dayNumber} has items [${actual}]; its slots are [${expected}].`);
    } else {
      day.lessons.forEach((item, i) => {
        const slot = slots[i]!;
        if (item.estMinutes !== slot.minutes) {
          check.minutes.push(`Day ${day.dayNumber} item ${i + 1} ("${item.title}") is ${item.estMinutes} min; its slot is ${slot.minutes} min.`);
        }
      });
    }
    const total = day.lessons.reduce((n, l) => n + l.estMinutes, 0);
    if (Math.abs(total - minutesPerDay) > minutesPerDay * DAY_TOTAL_TOLERANCE) {
      check.minutes.push(`Day ${day.dayNumber} totals ${total} min; it must be within 10% of ${minutesPerDay}.`);
    }
    for (const item of day.lessons) {
      for (const s of item.subtopics) {
        if (!known.has(s)) check.subtopics.push(`Day ${day.dayNumber} "${item.title}" lists unknown subtopic "${s}".`);
      }
    }
  });
  return check;
}

const nameKey = (name: string) =>
  name.toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Maps subtopic names that differ from the planner's only in case, spacing or punctuation
 * ("workbook basics & navigation") back to the planner's exact name. Lesson sources are looked up by name.
 */
export function normalizeSubtopics(syllabus: CurriculumOutput, subtopicNames: readonly string[]): CurriculumOutput {
  const exact = new Set(subtopicNames);
  // Keys shared by several planner names ("C", "C++" and "C#" all become "c") are ambiguous: never map them.
  const byKey = new Map<string, string | null>();
  for (const name of subtopicNames) {
    const key = nameKey(name);
    byKey.set(key, byKey.has(key) ? null : name);
  }
  const resolve = (s: string) => (exact.has(s) ? s : (byKey.get(nameKey(s)) ?? s));
  return {
    ...syllabus,
    days: syllabus.days.map((day) => ({
      ...day,
      lessons: day.lessons.map((item) => ({ ...item, subtopics: [...new Set(item.subtopics.map(resolve))] })),
    })),
  };
}

/**
 * Maps each unknown subtopic to the planner subtopic sharing the most words with it,
 * when exactly one does ("Pivot tables basics" -> "PivotTables and pivot tables"). Returns the repairs made.
 */
export function repairUnknownSubtopics(
  syllabus: CurriculumOutput,
  subtopicNames: readonly string[],
): { syllabus: CurriculumOutput; repairs: string[] } {
  const known = new Set(subtopicNames);
  const terms = new Map(subtopicNames.map((n) => [n, new Set(termsFrom(n))]));
  const compact = new Map(subtopicNames.map((n) => [n, n.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")]));
  // A word matches a name when it is one of its words or, for 4+ letters, part of a compound ("pivot" in "PivotTables").
  const matches = (term: string, name: string) => terms.get(name)!.has(term) || (term.length >= 4 && compact.get(name)!.includes(term));
  const repairs: string[] = [];
  const bestMatch = (unknown: string): string | undefined => {
    const wanted = termsFrom(unknown);
    const scored = subtopicNames.map((n) => ({ n, shared: wanted.filter((t) => matches(t, n)).length }));
    const top = Math.max(0, ...scored.map((x) => x.shared));
    const winners = scored.filter((x) => x.shared === top);
    return top > 0 && winners.length === 1 ? winners[0]!.n : undefined;
  };
  const out = {
    ...syllabus,
    days: syllabus.days.map((day) => ({
      ...day,
      lessons: day.lessons.map((item) => ({
        ...item,
        subtopics: [
          ...new Set(
            item.subtopics.map((s) => {
              if (known.has(s)) return s;
              const match = bestMatch(s);
              if (match) repairs.push(`"${s}" -> "${match}"`);
              return match ?? s;
            }),
          ),
        ],
      })),
    })),
  };
  return { syllabus: out, repairs };
}

export function allProblems(check: BudgetCheck): string[] {
  return [...check.structure, ...check.minutes, ...check.subtopics];
}

/** Replaces each estMinutes with its slot's value. Only valid when the structure matches. */
export function snapToSlots(syllabus: CurriculumOutput, budget: readonly DayBudget[]): CurriculumOutput {
  return {
    ...syllabus,
    days: syllabus.days.map((day, d) => {
      const slots = slotsFor(budget[d]!);
      return { ...day, lessons: day.lessons.map((item, i) => ({ ...item, estMinutes: slots[i]!.minutes })) };
    }),
  };
}

export function sourceSummariesFrom(research: ResearcherOutput): SourceSummary[] {
  return research.map(({ subtopic, sources }) => ({
    subtopic,
    sources: sources
      .filter((s) => s.type !== "video")
      .slice(0, SOURCES_PER_SUBTOPIC_IN_PROMPT)
      .map((s) => ({ title: s.title, excerpt: s.excerpt })),
  }));
}

export class CurriculumBudgetError extends Error {
  override name = "CurriculumBudgetError";
  constructor(readonly problems: string[]) {
    super(`Syllabus doesn't match the time budget after a retry:\n${problems.join("\n")}`);
  }
}

export interface DesignCurriculumInput {
  intake: CompletedIntake;
  plan: PlannerOutput;
  research: ResearcherOutput;
  /** Built with the planner's topicType. */
  budget: DayBudget[];
  edit?: { previous: CurriculumOutput; feedback: string };
}

export interface CurriculumResult {
  syllabus: CurriculumOutput;
  retried: boolean;
  snapped: boolean;
  /** Problems left after the retry (minutes are snapped; unknown subtopics are only warned about). */
  remainingProblems: string[];
}

export async function designCurriculum(input: DesignCurriculumInput, deps: AgentDeps = {}): Promise<CurriculumResult> {
  const call = deps.callJson ?? callJson;
  const subtopicNames = input.plan.subtopics.map((s) => s.name);
  const promptInput = {
    intake: input.intake,
    plan: input.plan,
    budget: input.budget,
    sourceSummaries: sourceSummariesFrom(input.research),
    edit: input.edit,
  };
  const generate = async (fix?: { previous: CurriculumOutput; problems: string[] }) => {
    const { system, prompt } = buildCurriculumPrompt({ ...promptInput, fix });
    const syllabus = await call({
      agent: "curriculum",
      model: "smart",
      system,
      prompt,
      schema: CurriculumOutputSchema,
      maxTokens: curriculumMaxTokens(input.budget),
      onUsage: deps.onUsage,
    });
    // Name repairs are free, so they happen before the budget check rather than costing a retry.
    const { syllabus: repaired, repairs } = repairUnknownSubtopics(normalizeSubtopics(syllabus, subtopicNames), subtopicNames);
    if (repairs.length) console.warn(`[curriculum] mapped unknown subtopics to the closest planner subtopic: ${repairs.join(", ")}`);
    return repaired;
  };
  const check = (s: CurriculumOutput) => checkAgainstBudget(s, input.budget, input.intake.minutesPerDay, subtopicNames);

  const first = await generate();
  const firstCheck = check(first);
  if (!allProblems(firstCheck).length) return { syllabus: first, retried: false, snapped: false, remainingProblems: [] };

  console.warn(`[curriculum] syllabus doesn't fit the budget, retrying once:\n${allProblems(firstCheck).join("\n")}`);
  const second = await generate({ previous: first, problems: allProblems(firstCheck) });
  const secondCheck = check(second);
  if (secondCheck.structure.length) throw new CurriculumBudgetError(secondCheck.structure);

  const remainingProblems = [...secondCheck.minutes, ...secondCheck.subtopics];
  if (remainingProblems.length) {
    console.warn(`[curriculum] after retry, snapping minutes to slots. Remaining:\n${remainingProblems.join("\n")}`);
  }
  const snapped = secondCheck.minutes.length > 0;
  return { syllabus: snapped ? snapToSlots(second, input.budget) : second, retried: true, snapped, remainingProblems };
}
