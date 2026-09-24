import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { callJson } from "@/lib/llm/client";
import type { ResearchDeps } from "@/lib/pipeline/researcher";
import { generateLesson, generateSyllabus, slotForItem, type LessonRequest } from "@/lib/pipeline/runCourse";
import type { CompletedIntake, ExaminerOutput, FactCheckOutput, LessonWriterOutput, ResearcherOutput } from "@/lib/pipeline/schemas";
import { buildTimeBudget } from "@/lib/pipeline/timeBudget";
import type { rateRelevance } from "@/lib/research/relevance";
import type { searchTavily } from "@/lib/research/tavily";

import { validOutputs } from "../../fixtures/agents";
import { excelPlan, syllabusFor } from "../../fixtures/agents/builders";
import failingCheck from "../../fixtures/agents/factChecker.failing.json";

const intake: CompletedIntake = { topic: "Excel for beginners", days: 7, minutesPerDay: 30, level: "beginner", goal: "practical_skill" };

describe("generateSyllabus", () => {
  it("runs planner → light research → curriculum and times each step", async () => {
    const order: string[] = [];
    const call = vi.fn(async (opts: Parameters<typeof callJson>[0]) => {
      order.push(opts.agent);
      return opts.agent === "planner" ? excelPlan : syllabusFor(buildTimeBudget({ days: 7, minutesPerDay: 30, topicType: "skill" }));
    }) as unknown as typeof callJson;
    const tavily = vi.fn(async ({ query }: Parameters<typeof searchTavily>[0]) => {
      order.push("tavily");
      return [{ url: `https://ex.com/${encodeURIComponent(query)}`, title: query, content: `${query}.`, rawContent: null, score: 1, publishedDate: null }];
    }) as unknown as typeof searchTavily;
    const relevance = vi.fn(async ({ items }: Parameters<typeof rateRelevance>[0]) => {
      order.push("relevance");
      return new Map(items.map((i) => [i.id, 0.8]));
    }) as unknown as typeof rateRelevance;
    const research: ResearchDeps = { searchTavily: tavily, rateRelevance: relevance };

    let t = 0;
    const clock = () => (t += 1000); // each clock() call advances 1s
    const result = await generateSyllabus(intake, { callJson: call, research, clock });

    expect(order).toEqual(["planner", ...Array(7).fill("tavily"), "relevance", "curriculum"]);
    expect(result.budget[0]!.lessons[0]).toEqual({ estMinutes: 15, readingMinutes: 7, mediaMinutes: 2, practiceMinutes: 6 }); // skill split
    expect(result.research).toHaveLength(7);
    expect(result.researchStats).toMatchObject({ mode: "light", webQueries: 7 });
    expect(result.curriculum).toMatchObject({ retried: false, snapped: false });
    expect(result.timings).toEqual({ plannerMs: 1000, lightResearchMs: 1000, curriculumMs: 1000, totalMs: 3000 });
  });
});

// ---------- generateLesson ----------

describe("generateLesson", () => {
  const budget = buildTimeBudget({ days: 7, minutesPerDay: 30, topicType: "skill" });
  const syllabus = syllabusFor(budget);
  const subtopic = syllabus.days[0]!.lessons[0]!.subtopics[0]!;
  const research: ResearcherOutput = [
    {
      subtopic,
      sources: [
        { url: "https://support.microsoft.com/basics", title: "Microsoft: Excel basics", type: "docs", score: 0.9, excerpt: "Basics.", grounding: "A workbook contains worksheets." },
        { url: "https://exceljet.net/basics", title: "Exceljet: navigation", type: "web", score: 0.7, excerpt: "Nav.", grounding: "Use Ctrl+Arrow to jump." },
        { url: "https://blog.example.com/x", title: "Blog", type: "web", score: 0.99, excerpt: "A blog post.", grounding: null },
        { url: "https://www.youtube.com/watch?v=abc", title: "Excel in 10 minutes", type: "video", score: 0.8, excerpt: "Chan · 10 min", grounding: null },
      ],
    },
  ];
  const req: LessonRequest = { intake, plan: excelPlan, syllabus, budget, research, dayNumber: 1, position: 0 };

  const draft = validOutputs.lessonWriter as LessonWriterOutput; // cites [1], [2]
  const withPractice = (content: LessonWriterOutput, tag: string): LessonWriterOutput => ({
    ...content,
    contentMd: `${content.contentMd}\n\n<!-- ${tag} -->`,
    practiceTask: { instructions: "Open a new workbook and add a sheet.", expectedOutcome: "A workbook with two sheets." },
  });
  const quiz = validOutputs.examiner as ExaminerOutput;
  const clean: FactCheckOutput = { issues: [] };

  /** Mock LLM: each agent returns its queued responses in order. */
  function llm(queues: Record<string, unknown[]>) {
    return vi.fn(async (opts: Parameters<typeof callJson>[0]) => {
      const next = queues[opts.agent]?.shift();
      if (next === undefined) throw new Error(`no mock response for ${opts.agent}`);
      return next;
    }) as unknown as typeof callJson;
  }
  const calls = (call: typeof callJson) => vi.mocked(call).mock.calls.map(([o]) => o);

  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("writes, fact-checks and quizzes a lesson with cited, numbered sources", async () => {
    const call = llm({ lessonWriter: [withPractice(draft, "v1")], factChecker: [clean], examiner: [quiz] });
    const lesson = await generateLesson(req, { callJson: call });

    expect(calls(call).map((o) => o.agent)).toEqual(["lessonWriter", "factChecker", "examiner"]);
    expect(lesson.content.contentMd).toMatch(/\[1\]/);
    expect(lesson.sources).toEqual([
      { index: 1, title: "Microsoft: Excel basics", url: "https://support.microsoft.com/basics" },
      { index: 2, title: "Exceljet: navigation", url: "https://exceljet.net/basics" },
    ]);
    expect(lesson.videos.map((v) => v.url)).toEqual(["https://www.youtube.com/watch?v=abc"]);
    expect(lesson.quiz.questions.length).toBeGreaterThanOrEqual(3);
    expect(lesson.quiz.questions.length).toBeLessThanOrEqual(5);
    expect(lesson.factCheck).toEqual({ passed: true, issues: [], attempts: 1, rewritten: false, unverifiedClaims: [] });
    expect(lesson.slot).toEqual({ estMinutes: 15, readingMinutes: 7, mediaMinutes: 2, practiceMinutes: 6 });

    // Grounded sources are numbered first; the fact-checker gets only the cited ones, with their passages
    expect(calls(call)[0]!.prompt).toMatch(/\[1\] Microsoft: Excel basics[\s\S]*\[2\] Exceljet: navigation[\s\S]*\[3\] Blog/);
    expect(calls(call)[1]!.prompt).toContain("[1] Microsoft: Excel basics\nA workbook contains worksheets.");
    expect(calls(call)[1]!.prompt).not.toContain("[3] Blog");
  });

  it("rewrites once with the issues when the fact-check fails, then quizzes the rewrite", async () => {
    const call = llm({
      lessonWriter: [withPractice(draft, "first draft"), withPractice(draft, "rewrite")],
      factChecker: [failingCheck, clean],
      examiner: [quiz],
    });
    const lesson = await generateLesson(req, { callJson: call });

    expect(calls(call).map((o) => o.agent)).toEqual(["lessonWriter", "factChecker", "lessonWriter", "factChecker", "examiner"]);
    const rewritePrompt = calls(call)[2]!.prompt;
    expect(rewritePrompt).toContain("## Fact-check issues to fix in this rewrite");
    expect(rewritePrompt).toContain('[contradicted] "Alexander was born in Athens"');
    expect(calls(call)[4]!.prompt).toContain("<!-- rewrite -->");
    expect(calls(call)[4]!.prompt).not.toContain("<!-- first draft -->");
    expect(lesson.content.contentMd).toContain("<!-- rewrite -->");
    expect(lesson.factCheck).toEqual({ passed: true, issues: [], attempts: 2, rewritten: true, unverifiedClaims: [] });
  });

  it("ships with an unverified-claims notice when the rewrite still fails, and logs it", async () => {
    const call = llm({
      lessonWriter: [withPractice(draft, "v1"), withPractice(draft, "v2")],
      factChecker: [failingCheck, failingCheck],
      examiner: [quiz],
    });
    const lesson = await generateLesson(req, { callJson: call });

    expect(calls(call).filter((o) => o.agent === "lessonWriter")).toHaveLength(2); // only one rewrite
    expect(lesson.factCheck).toMatchObject({ passed: false, attempts: 2, rewritten: true });
    expect(lesson.factCheck.unverifiedClaims.map((i) => i.claim)).toEqual(["Alexander was born in Athens", "he became king at 18"]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("still fails fact-check after rewrite"));
  });

  it("writes review items with the review block's minutes and no videos", async () => {
    const reviewReq = { ...req, dayNumber: 7, position: 1 };
    const call = llm({ lessonWriter: [draft], factChecker: [clean], examiner: [quiz] });
    const reviewResearch: ResearcherOutput = [{ ...research[0]!, subtopic: syllabus.days[6]!.lessons[1]!.subtopics[0]! }];
    const lesson = await generateLesson({ ...reviewReq, research: reviewResearch }, { callJson: call });
    expect(lesson.spec.kind).toBe("review");
    expect(lesson.slot.estMinutes).toBe(9);
    expect(lesson.videos).toEqual([]);
  });

  it("slotForItem rejects positions that don't exist", () => {
    expect(() => slotForItem(budget, 1, 2, excelPlan)).toThrow("No item 3 on day 1");
    expect(() => slotForItem(budget, 8, 0, excelPlan)).toThrow("No day 8");
  });
});
