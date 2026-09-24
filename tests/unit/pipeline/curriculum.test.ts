import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { callJson } from "@/lib/llm/client";
import {
  allProblems,
  checkAgainstBudget,
  CurriculumBudgetError,
  designCurriculum,
  slotsFor,
  snapToSlots,
  sourceSummariesFrom,
} from "@/lib/pipeline/curriculum";
import { CurriculumOutputSchema, type CompletedIntake, type CurriculumOutput, type ResearcherOutput } from "@/lib/pipeline/schemas";
import { buildTimeBudget } from "@/lib/pipeline/timeBudget";

import { excelPlan, syllabusFor } from "../../fixtures/agents/builders";

const intake: CompletedIntake = { topic: "Excel for beginners", days: 7, minutesPerDay: 30, level: "beginner", goal: "practical_skill" };
const budget = buildTimeBudget({ days: 7, minutesPerDay: 30, topicType: "skill" });
const names = excelPlan.subtopics.map((s) => s.name);
const good = () => syllabusFor(budget);
const research: ResearcherOutput = [
  {
    subtopic: names[0]!,
    sources: [
      { url: "https://support.microsoft.com/a", title: "Excel basics", type: "docs", score: 0.9, excerpt: "Workbooks and sheets.", grounding: null },
      { url: "https://www.youtube.com/watch?v=1", title: "Video", type: "video", score: 0.9, excerpt: "Chan · 8 min", grounding: null },
    ],
  },
];

/** Changes one item's minutes. */
function withMinutes(s: CurriculumOutput, day: number, item: number, minutes: number): CurriculumOutput {
  const copy = structuredClone(s);
  copy.days[day - 1]!.lessons[item]!.estMinutes = minutes;
  return copy;
}

describe("checkAgainstBudget", () => {
  it("passes a syllabus that follows the slots", () => {
    expect(CurriculumOutputSchema.safeParse(good()).success).toBe(true);
    expect(allProblems(checkAgainstBudget(good(), budget, 30, names))).toEqual([]);
  });

  it("flags minutes that differ from the slot, even within ±10%", () => {
    const check = checkAgainstBudget(withMinutes(good(), 1, 0, 16), budget, 30, names);
    expect(check.minutes).toEqual(['Day 1 item 1 ("Lesson: Workbook basics and navigation") is 16 min; its slot is 15 min.']);
    expect(check.structure).toEqual([]);
  });

  it("flags a day total outside ±10%", () => {
    const check = checkAgainstBudget(withMinutes(good(), 2, 0, 25), budget, 30, names);
    expect(check.minutes).toContain("Day 2 totals 40 min; it must be within 10% of 30.");
  });

  it("flags a wrong day count, item count or kind order as structural", () => {
    const short = { ...good(), days: good().days.slice(0, 6) };
    expect(checkAgainstBudget(short, budget, 30, names).structure).toEqual(["The course has 6 days; it must have exactly 7."]);

    const extra = structuredClone(good());
    extra.days[0]!.lessons.push({ ...extra.days[0]!.lessons[0]! });
    expect(checkAgainstBudget(extra, budget, 30, names).structure).toEqual([
      "Day 1 has items [lesson, lesson, lesson]; its slots are [lesson, lesson].",
    ]);

    const noReview = structuredClone(good());
    noReview.days[2]!.lessons[2]!.kind = "lesson";
    expect(checkAgainstBudget(noReview, budget, 30, names).structure[0]).toMatch(/Day 3 has items \[lesson, lesson, lesson\]; its slots are \[lesson, lesson, review\]/);
  });

  it("flags unknown subtopic names", () => {
    const s = structuredClone(good());
    s.days[0]!.lessons[0]!.subtopics = ["Macros"];
    expect(checkAgainstBudget(s, budget, 30, names).subtopics).toEqual(['Day 1 "Lesson: Workbook basics and navigation" lists unknown subtopic "Macros".']);
  });
});

describe("snapToSlots", () => {
  it("replaces every estMinutes with its slot value and leaves content alone", () => {
    const off = withMinutes(withMinutes(good(), 1, 0, 20), 7, 1, 3);
    const snapped = snapToSlots(off, budget);
    expect(snapped).toEqual(good());
    expect(allProblems(checkAgainstBudget(snapped, budget, 30, names))).toEqual([]);
  });

  it("slotsFor lists lessons then the review", () => {
    expect(slotsFor(budget[6]!)).toEqual([
      { kind: "lesson", minutes: 21 },
      { kind: "review", minutes: 9 },
    ]);
  });
});

describe("sourceSummariesFrom", () => {
  it("uses non-video sources' titles and excerpts", () => {
    expect(sourceSummariesFrom(research)).toEqual([{ subtopic: names[0], sources: [{ title: "Excel basics", excerpt: "Workbooks and sheets." }] }]);
  });
});

describe("designCurriculum", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  const run = (...responses: CurriculumOutput[]) => {
    const call = vi.fn(async () => responses.shift()!) as unknown as typeof callJson;
    return { call, result: designCurriculum({ intake, plan: excelPlan, research, budget }, { callJson: call }) };
  };

  it("returns a fitting syllabus from one call", async () => {
    const { call, result } = run(good());
    expect(await result).toEqual({ syllabus: good(), retried: false, snapped: false, remainingProblems: [] });
    const opts = vi.mocked(call).mock.calls[0]![0];
    expect(opts).toMatchObject({ agent: "curriculum", model: "smart", schema: CurriculumOutputSchema });
    expect(opts.prompt).toContain("Day 7: lesson 21 min, review 9 min (total 30)");
    expect(opts.prompt).toContain("Excel basics: Workbooks and sheets.");
  });

  it("retries once with the problems and previous syllabus when it doesn't fit", async () => {
    const bad = withMinutes(good(), 1, 0, 25);
    const { call, result } = run(bad, good());
    expect(await result).toMatchObject({ syllabus: good(), retried: true, snapped: false, remainingProblems: [] });
    const retryPrompt = vi.mocked(call).mock.calls[1]![0].prompt;
    expect(retryPrompt).toContain("## Problems to fix");
    expect(retryPrompt).toContain("is 25 min; its slot is 15 min");
    expect(retryPrompt).toContain("## Your previous syllabus");
  });

  it("snaps minutes to the slots when the retry still doesn't fit", async () => {
    const bad = withMinutes(good(), 1, 0, 25);
    const { result } = run(bad, withMinutes(good(), 3, 1, 10));
    const out = await result;
    expect(out).toMatchObject({ retried: true, snapped: true });
    expect(out.syllabus).toEqual(good());
    expect(out.remainingProblems[0]).toMatch(/Day 3 item 2 .* is 10 min; its slot is 13 min/);
  });

  it("throws when the structure is still wrong after the retry", async () => {
    const short = { ...good(), days: good().days.slice(0, 5) };
    const { result } = run(short, short);
    await expect(result).rejects.toBeInstanceOf(CurriculumBudgetError);
  });

  it("keeps unknown subtopics after the retry with a warning, without snapping", async () => {
    const s = structuredClone(good());
    s.days[0]!.lessons[0]!.subtopics = ["Macros"];
    const { result } = run(s, s);
    const out = await result;
    expect(out).toMatchObject({ retried: true, snapped: false });
    expect(out.remainingProblems).toHaveLength(1);
  });
});

describe("curriculumMaxTokens", () => {
  it("scales with syllabus size between 16k and 64k", async () => {
    const { curriculumMaxTokens } = await import("@/lib/pipeline/curriculum");
    expect(curriculumMaxTokens(buildTimeBudget({ days: 7, minutesPerDay: 30, topicType: "skill" }))).toBe(16_000);
    // 60 × 90 min: days 1–2 have 4 items, days 3–59 have 4 lessons + review, day 60 has 3 + review = 297 items
    expect(curriculumMaxTokens(buildTimeBudget({ days: 60, minutesPerDay: 90, topicType: "skill" }))).toBe(63_400);
    // 30 × 60 min: 3 + 3, then 27 days × 4, then 3 = 117 items
    expect(curriculumMaxTokens(buildTimeBudget({ days: 30, minutesPerDay: 60, topicType: "skill" }))).toBe(27_400);
  });
});
