import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { callJson } from "@/lib/llm/client";
import type { LlmCallLog } from "@/lib/llm/cost";
import { formatPercent, renderCourseMarkdown, slugify } from "@/lib/pipeline/courseOutput";
import { runCourse, summarizeLessons, summarizeUsage, type CourseResult, type LessonOutcome } from "@/lib/pipeline/runCourse";
import type { CompletedIntake, ExaminerOutput, LessonWriterOutput, PlannerOutput } from "@/lib/pipeline/schemas";
import { buildTimeBudget } from "@/lib/pipeline/timeBudget";
import type { rateRelevance } from "@/lib/research/relevance";
import type { searchTavily } from "@/lib/research/tavily";
import type { YouTubeSearchResult } from "@/lib/research/youtube";

import { validOutputs } from "../../fixtures/agents";
import { excelPlan, syllabusFor } from "../../fixtures/agents/builders";
import failingCheck from "../../fixtures/agents/factChecker.failing.json";

const intake: CompletedIntake = { topic: "Excel for beginners", days: 2, minutesPerDay: 30, level: "beginner", goal: "practical_skill" };
const budget = buildTimeBudget({ days: 2, minutesPerDay: 30, topicType: "skill" });
const syllabus = syllabusFor(budget); // day 1: 2 lessons; day 2 (final): 1 lesson + review
const draft = validOutputs.lessonWriter as LessonWriterOutput;
const quiz = validOutputs.examiner as ExaminerOutput;
const practice = { instructions: "Try it.", expectedOutcome: "It works." };

const titleOf = (prompt: string) => prompt.match(/^Day \d+: (.+) \((lesson|review)\)$/m)?.[1];

/** A fully mocked course run. `failTitle` makes that lesson's writer throw; `flagTitle` fails its fact-check twice. */
function mockRun(opts: { failTitle?: string; flagTitle?: string; plan?: PlannerOutput } = {}) {
  let inFlight = 0;
  let peak = 0;
  const call = vi.fn(async (o: Parameters<typeof callJson>[0]) => {
    const log: LlmCallLog = { agent: o.agent, model: o.model === "smart" ? "claude-sonnet-5" : "claude-haiku-4-5", inputTokens: 1000, outputTokens: 100, costUsd: o.model === "smart" ? 0.003 : 0.0015, attempts: 1, durationMs: 1, ok: true };
    o.onUsage?.(log);
    switch (o.agent) {
      case "planner":
        return opts.plan ?? excelPlan;
      case "curriculum":
        return syllabus;
      case "lessonWriter": {
        const title = titleOf(o.prompt);
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        if (title === opts.failTitle) throw new Error("writer exploded");
        const noPractice = o.prompt.includes("practiceTask must be null");
        return { ...draft, contentMd: `${draft.contentMd}\n\n(${title})`, practiceTask: noPractice ? null : practice };
      }
      case "factChecker":
        return opts.flagTitle && o.prompt.includes(`(${opts.flagTitle})`) ? failingCheck : { issues: [] };
      case "examiner":
        return quiz;
      default:
        throw new Error(`unexpected agent ${o.agent}`);
    }
  }) as unknown as typeof callJson;

  const tavily = vi.fn(async ({ query, includeRawContent }: Parameters<typeof searchTavily>[0]) =>
    [0, 1].map((i) => ({
      url: `https://site${i}.example.com/${encodeURIComponent(query)}`,
      title: `${query} ${i}`,
      content: `About ${query}.`,
      rawContent: includeRawContent ? `Detailed passage ${i} about ${query} and nothing else ${"filler ".repeat(i * 20)}.` : null,
      score: 0.9,
      publishedDate: null,
    })),
  ) as unknown as typeof searchTavily;
  const relevance = vi.fn(async ({ items, onUsage }: Parameters<typeof rateRelevance>[0]) => {
    onUsage?.({ agent: "relevance", model: "claude-haiku-4-5", inputTokens: 500, outputTokens: 50, costUsd: 0.001, attempts: 1, durationMs: 1, ok: true });
    return new Map(items.map((i) => [i.id, 0.8]));
  }) as unknown as typeof rateRelevance;
  const youtube = {
    searchVideos: vi.fn(async (queries: string[]): Promise<YouTubeSearchResult> => ({
      videosByQuery: Object.fromEntries(queries.map((q) => [q, []])),
      unitsUsed: queries.length * 100 + 2,
      liveSearches: queries.length,
      cachedSearches: 0,
      quotaExhausted: false,
      skippedQueries: [],
    })),
  };

  const userLogs: LlmCallLog[] = [];
  const run = runCourse(intake, {
    callJson: call,
    onUsage: (l) => userLogs.push(l),
    research: { searchTavily: tavily, rateRelevance: relevance, youtube },
    lessonConcurrency: 2,
  });
  return { run, call, userLogs, peak: () => peak };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("runCourse", () => {
  it("generates every syllabus item, lessons and reviews, with concurrency capped", async () => {
    const { run, peak } = mockRun();
    const course = await run;

    expect(course.lessons.map((o) => o.status)).toEqual(["ready", "ready", "ready", "ready"]);
    const kinds = course.lessons.map((o) => (o.status === "ready" ? `${o.lesson.dayNumber}.${o.lesson.position + 1} ${o.lesson.spec.kind}` : ""));
    expect(kinds).toEqual(["1.1 lesson", "1.2 lesson", "2.1 lesson", "2.2 review"]);
    expect(peak()).toBe(2);
    expect(course.deepResearch.stats.mode).toBe("deep");
    expect(course.stats.lessons).toEqual({ total: 4, ready: 4, failed: 0, rewritten: 0, shippedWithNotice: 0, factCheckPassRate: 1 });
    expect(course.stats.youtubeUnits).toBeGreaterThan(0);
  });

  it("records a failed lesson and keeps going", async () => {
    const failTitle = syllabus.days[0]!.lessons[1]!.title;
    const { run } = mockRun({ failTitle });
    const course = await run;

    expect(course.lessons[1]).toEqual({ status: "failed", dayNumber: 1, position: 1, title: failTitle, error: "writer exploded" });
    expect(course.lessons.filter((o) => o.status === "ready")).toHaveLength(3);
    expect(course.stats.lessons).toMatchObject({ total: 4, ready: 3, failed: 1 });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("writer exploded"));
  });

  it("counts lessons shipped with a notice in the pass rate", async () => {
    const { run } = mockRun({ flagTitle: syllabus.days[0]!.lessons[0]!.title });
    const course = await run;
    expect(course.stats.lessons).toMatchObject({ ready: 4, rewritten: 1, shippedWithNotice: 1, factCheckPassRate: 0.75 });
  });

  it("totals LLM cost by agent and still forwards every call to the caller's onUsage", async () => {
    const { run, userLogs } = mockRun();
    const { stats } = await run;
    // planner 1, relevance 2 (light + deep), curriculum 1, then per item: writer, fact-check, examiner
    expect(stats.llm.byAgent).toMatchObject({
      planner: { calls: 1 },
      curriculum: { calls: 1 },
      relevance: { calls: 2 },
      lessonWriter: { calls: 4 },
      factChecker: { calls: 4 },
      examiner: { calls: 4 },
    });
    expect(stats.llm.calls).toBe(16);
    expect(stats.llm.costUsd).toBeCloseTo(6 * 0.003 + 8 * 0.0015 + 2 * 0.001);
    expect(userLogs).toHaveLength(16);
  });
});

describe("summaries", () => {
  it("summarizeUsage counts unpriced calls", () => {
    const log = (agent: string, costUsd: number | null): LlmCallLog => ({ agent, model: "m", inputTokens: 1, outputTokens: 1, costUsd, attempts: 1, durationMs: 1, ok: true });
    expect(summarizeUsage([log("a", 0.5), log("a", null), log("b", 0.25)])).toEqual({
      calls: 3,
      costUsd: 0.75,
      unpricedCalls: 1,
      byAgent: { a: { calls: 2, costUsd: 0.5 }, b: { calls: 1, costUsd: 0.25 } },
    });
  });

  it("summarizeLessons pass rate is null when nothing is ready", () => {
    const failed: LessonOutcome = { status: "failed", dayNumber: 1, position: 0, title: "x", error: "e" };
    expect(summarizeLessons([failed]).factCheckPassRate).toBeNull();
    expect(formatPercent(null)).toBe("n/a");
    expect(formatPercent(0.756)).toBe("76%");
  });
});

describe("slugify", () => {
  it.each([
    ["Alexander the Great", "alexander-the-great"],
    ["How black holes work?", "how-black-holes-work"],
    ["Excel  for beginners (2026)", "excel-for-beginners-2026"],
    ["Café résumé", "cafe-resume"],
    ["日本語", "course"],
    ["---", "course"],
  ])("%s -> %s", (topic, slug) => {
    expect(slugify(topic)).toBe(slug);
  });

  it("truncates without a trailing dash", () => {
    expect(slugify("a very long topic name that keeps going", 12)).toBe("a-very-long");
  });
});

describe("renderCourseMarkdown", () => {
  let course: CourseResult;
  beforeEach(async () => {
    course = await mockRun({ flagTitle: syllabus.days[0]!.lessons[0]!.title, failTitle: syllabus.days[1]!.lessons[0]!.title }).run;
  });

  it("renders days in order with lessons, quizzes and linked sources", () => {
    const md = renderCourseMarkdown(course);
    expect(md.startsWith("# Excel Essentials\n")).toBe(true);
    expect(md).toContain("*2 days × 30 min · level: beginner · goal: practical skill · skill*");
    expect(md.indexOf("## Day 1:")).toBeLessThan(md.indexOf("## Day 2:"));
    expect(md).toContain(`### Lesson 1: ${syllabus.days[0]!.lessons[0]!.title}`);
    expect(md).toContain("### Review: ");
    expect(md).toContain("*15 min: reading 7, videos 2, practice and quiz 6*");
    expect(md).toMatch(/#### Sources\n1\. \[.+\]\(https:\/\/.+\)\n2\. \[/);
    expect(md).toContain("<details><summary>Answers</summary>");
    expect(md).toContain("#### Practice\nTry it.");
  });

  it("nests lesson headings under the lesson and shows notices and failures", () => {
    const md = renderCourseMarkdown(course);
    expect(md).toContain("#### Why this matters");
    expect(md).not.toMatch(/^## Why this matters/m);
    expect(md).toContain("> ⚠️ **Some claims could not be verified.**");
    expect(md).toContain("> - Alexander was born in Athens");
    expect(md).toContain("> ❌ This lesson failed to generate: writer exploded");
    expect(md).toMatch(/3\/4 lessons ready, fact-check pass rate 67%/);
  });

  it("adds the disclaimer for sensitive domains", async () => {
    const sensitive = await mockRun({ plan: { ...excelPlan, sensitiveDomain: "financial" } }).run;
    expect(renderCourseMarkdown(sensitive)).toContain("> **Disclaimer:** This lesson is for general education only and is not financial advice.");
  });
});
