import { describe, expect, it, vi } from "vitest";

import { DISCLAIMERS } from "@/lib/disclaimers";
import type { callJson } from "@/lib/llm/client";
import { examineLesson, examinerSchemaFor } from "@/lib/pipeline/examiner";
import { renderCardsText } from "@/lib/pipeline/cards";
import { claimFoundInLesson, claimIsDeliberateError, factCheckLesson, factCheckPassed, issuesFromFindings, quoteFoundInPassages } from "@/lib/pipeline/factChecker";
import { lessonOutputSchemaFor, writeLesson } from "@/lib/pipeline/lessonWriter";
import type { LessonWriterPromptInput } from "@/lib/pipeline/prompts/lessonWriter";
import type { CurriculumOutput, ExaminerOutput, FactCheckIssue, LessonWriterOutput } from "@/lib/pipeline/schemas";
import { splitLesson } from "@/lib/pipeline/timeBudget";

import { validOutputs } from "../../fixtures/agents";
import failing from "../../fixtures/agents/factChecker.failing.json";

const lesson = validOutputs.lessonWriter as LessonWriterOutput; // cites [1] and [2], no practice step, no video
const lessonText = renderCardsText(lesson.activities);
const syllabus = validOutputs.curriculum as CurriculumOutput;
const issue = (problem: FactCheckIssue["problem"]): FactCheckIssue => ({ claim: "c", problem, suggestion: "s" });

const writerInput = (overrides: Partial<LessonWriterPromptInput> = {}): LessonWriterPromptInput => ({
  lesson: { ...syllabus.days[0]!.lessons[0]!, includesPractice: false },
  dayNumber: 1,
  slot: splitLesson(15, "knowledge"),
  syllabus,
  sources: [
    { title: "Britannica", url: "https://britannica.com/a", grounding: "Born in Pella in 356 BCE." },
    { title: "World History", url: "https://worldhistory.org/a", grounding: "Tutored by Aristotle.", excerptOnly: true },
  ],
  videos: [],
  level: "beginner",
  topicType: "knowledge",
  sensitiveDomain: null,
  ...overrides,
});

describe("lesson writer", () => {
  it("calls the smart model with numbered sources and an input-aware schema", async () => {
    const call = vi.fn(async () => lesson) as unknown as typeof callJson;
    expect(await writeLesson(writerInput(), { callJson: call })).toBe(lesson);
    const opts = vi.mocked(call).mock.calls[0]![0];
    expect(opts).toMatchObject({ agent: "lessonWriter", model: "smart" });
    expect(opts.prompt).toContain("[1] Britannica");
    expect(opts.prompt).toContain("[2] World History\nURL: https://worldhistory.org/a\nExcerpt only");
    expect(opts.schema.safeParse(lesson).success).toBe(true);
  });

  it("rejects citations beyond the numbered sources, so the client retries", () => {
    const result = lessonOutputSchemaFor(1, false, 0).safeParse(lesson);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message)).toContain("cites source(s) 2 but only [1]–[1] exist");
  });

  const withCard = (card: object, at = 5): LessonWriterOutput => ({
    ...lesson,
    activities: [...lesson.activities.slice(0, at), card as LessonWriterOutput["activities"][number], ...lesson.activities.slice(at)],
  });
  const practice = { id: "p1", type: "practiceStep", part: "Taking the throne", cites: [], instructions: "Draw a timeline.", expectedOutcome: "Four dated events.", minutes: 3 };
  const video = (n: number, id = "v1") => ({ id, type: "video", part: "Taking the throne", cites: [], video: n, watchFor: ["Pella", "Philip's death"] });

  it("requires a practice step exactly when the lesson includes practice", () => {
    expect(lessonOutputSchemaFor(2, true, 0).safeParse(lesson).error!.issues[0]!.message).toMatch(/add a practiceStep/);
    expect(lessonOutputSchemaFor(2, true, 0).safeParse(withCard(practice)).success).toBe(true);
    expect(lessonOutputSchemaFor(2, false, 0).safeParse(withCard(practice)).error!.issues[0]!.message).toMatch(/remove the practiceStep/);
  });

  it("places existing videos once each, and at least one when there are videos", () => {
    expect(lessonOutputSchemaFor(2, false, 1).safeParse(lesson).error!.issues[0]!.message).toBe("place at least one of the 1 videos");
    expect(lessonOutputSchemaFor(2, false, 1).safeParse(withCard(video(1), 4)).success).toBe(true);
    expect(lessonOutputSchemaFor(2, false, 1).safeParse(withCard(video(2), 4)).error!.issues[0]!.message).toBe("video 2 doesn't exist (1 videos)");
    const twice = { ...withCard(video(1), 4) };
    twice.activities = [...twice.activities.slice(0, 5), video(1, "v2") as LessonWriterOutput["activities"][number], ...twice.activities.slice(5)];
    expect(lessonOutputSchemaFor(2, false, 1).safeParse(twice).error!.issues.map((i) => i.message)).toContain("place each video at most once");
  });

  it("tells the writer the reading words, card counts, videos and practice for the slot", async () => {
    const call = vi.fn(async () => lesson) as unknown as typeof callJson;
    await writeLesson(writerInput({ videos: [{ title: "Alexander in 10 minutes", excerpt: "History Channel · 10 min" }] }), { callJson: call });
    const { prompt } = vi.mocked(call).mock.calls[0]![0];
    // 15-min knowledge slot: reading 5 min (750–1,000 words), videos 3, activities, practice and quiz 7.
    expect(prompt).toContain("Reading: 750–1000 words across all reading pages, about 4 reading cards");
    expect(prompt).toContain("1. Alexander in 10 minutes (History Channel · 10 min)\nVideo budget: 3 min.");
    expect(prompt).toContain("Practice included: no (no practiceStep cards).");
  });

  it("passes the disclaimer for sensitive domains", async () => {
    const call = vi.fn(async () => lesson) as unknown as typeof callJson;
    await writeLesson(writerInput({ sensitiveDomain: "medical" }), { callJson: call });
    expect(vi.mocked(call).mock.calls[0]![0].prompt).toContain(DISCLAIMERS.medical);
  });

  it("refuses to write without sources", async () => {
    await expect(writeLesson(writerInput({ sources: [] }), { callJson: vi.fn() as unknown as typeof callJson })).rejects.toThrow(/no sources/);
  });
});

describe("fact-checker", () => {
  it.each([
    { name: "no issues", issues: [], passed: true },
    { name: "2 unsupported", issues: [issue("unsupported"), issue("unsupported")], passed: true },
    { name: "3 unsupported", issues: [issue("unsupported"), issue("unsupported"), issue("unsupported")], passed: false },
    { name: "1 contradicted", issues: [issue("contradicted")], passed: false },
    { name: "1 outdated", issues: [issue("outdated")], passed: false },
  ])("factCheckPassed: $name -> $passed", ({ issues, passed }) => {
    expect(factCheckPassed(issues)).toBe(passed);
  });

  const passages = [
    { index: 1, title: "Microsoft", grounding: "A **workbook** contains   worksheets. Each sheet has a tab." },
    { index: 2, title: "Exceljet", grounding: "Use Ctrl+Arrow to jump to the edge of the data." },
  ];

  it("uses the fast model, turns findings into issues and computes passed in code", async () => {
    const call = vi.fn(async () => failing) as unknown as typeof callJson;
    const result = await factCheckLesson({ contentMd: lessonText, sources: passages, level: "beginner" }, { callJson: call });
    expect(result.issues.map((i) => [i.problem, i.claim])).toEqual([
      ["contradicted", "Alexander was born in Pella in 356 BCE"],
      ["contradicted", "Alexander, then 20, moved quickly"],
      ["unsupported", "taught by the philosopher Aristotle"],
    ]);
    expect(result.passed).toBe(false);
    expect(vi.mocked(call).mock.calls[0]![0]).toMatchObject({ agent: "factChecker", model: "fast" });
  });

  it("quoteFoundInPassages ignores case, spacing, emphasis and curly quotes, and splits at ellipses", () => {
    expect(quoteFoundInPassages("“a workbook contains worksheets.”", 1, passages)).toBe(true);
    expect(quoteFoundInPassages("A workbook ... each sheet has a tab", 1, passages)).toBe(true);
    expect(quoteFoundInPassages("A workbook contains worksheets", 2, passages)).toBe(false);
    expect(quoteFoundInPassages("Use Ctrl+Arrow to jump", null, passages)).toBe(true);
    expect(quoteFoundInPassages("Use Ctrl+Arrow to jump", 9, passages)).toBe(true);
    expect(quoteFoundInPassages("A workbook has 3 sheets", 1, passages)).toBe(false);
    expect(quoteFoundInPassages(" ... ", 1, passages)).toBe(false);
    expect(quoteFoundInPassages("adds 5 to the result. =5+2*3", null, [{ index: 3, title: "MS", grounding: "adds 5 to the result. **=5+2\\*3**" }])).toBe(true);
  });

  it("claimFoundInLesson matches quoted lesson text across citations, emphasis, tables and ellipses", () => {
    const md = "## Gaugamela\nThe battle was fought on **1 October 331 BCE** [1][2].\n\n| Battle | Year |\n| --- | --- |\n| Issus | 333 BC |";
    expect(claimFoundInLesson("The battle was fought on 1 October 331 BCE", md)).toBe(true);
    expect(claimFoundInLesson("“the battle was fought ... 331 BCE [1]”", md)).toBe(true);
    expect(claimFoundInLesson("Issus 333 BC", md)).toBe(true);
    expect(claimFoundInLesson("The battle was fought on October 31", md)).toBe(false);
    expect(claimFoundInLesson("...", md)).toBe(false);
  });

  it("issuesFromFindings drops supported findings and claims not in the lesson, and downgrades contradictions without a real quote", () => {
    const finding = (verdict: "supported" | "unsupported" | "contradicted" | "outdated", passageSays: string | null, sourceIndex: number | null = 1) => ({
      claim: `${verdict}: ${passageSays}`,
      sourceIndex,
      passageSays,
      verdict,
      suggestion: "s",
    });
    const issues = issuesFromFindings(
      [
        finding("supported", "A workbook contains worksheets."),
        finding("contradicted", "A workbook contains worksheets."),
        finding("outdated", "A workbook holds 3 sheets"),
        finding("contradicted", null, null),
        finding("unsupported", null, null),
        { ...finding("contradicted", "A workbook contains worksheets."), claim: "a sentence the lesson never says" },
      ],
      passages,
      "supported: A workbook contains worksheets. contradicted: A workbook contains worksheets. outdated: A workbook holds 3 sheets contradicted: null unsupported: null",
    );
    expect(issues.map((i) => i.problem)).toEqual(["contradicted", "unsupported", "unsupported", "unsupported"]);
  });
});

describe("fact-checker on cards", () => {
  it("drops findings that quote a myth or a deliberate spot-the-error mistake", () => {
    const text = renderCardsText(lesson.activities);
    expect(text).toContain("- Myth (false on purpose): Alexander grew up in Athens.");
    expect(claimIsDeliberateError("Alexander grew up in Athens", text)).toBe(true);
    expect(claimIsDeliberateError("He was born in Pella, the capital of Macedon", text)).toBe(false);
    const issues = issuesFromFindings(
      [{ claim: "Alexander grew up in Athens.", sourceIndex: null, passageSays: null, verdict: "unsupported", suggestion: "s" }],
      [],
      text,
    );
    expect(issues).toEqual([]);
  });
});

describe("examiner", () => {
  const quiz = validOutputs.examiner as ExaminerOutput; // 3 questions

  it("uses the fast model", async () => {
    const call = vi.fn(async () => quiz) as unknown as typeof callJson;
    expect(await examineLesson({ contentMd: lessonText, objectives: ["A", "B"], level: "beginner" }, { callJson: call })).toBe(quiz);
    expect(vi.mocked(call).mock.calls[0]![0]).toMatchObject({ agent: "examiner", model: "fast" });
  });

  it("needs at least one question per objective", () => {
    expect(examinerSchemaFor(3).safeParse(quiz).success).toBe(true);
    const result = examinerSchemaFor(4).safeParse(quiz);
    expect(result.error!.issues[0]!.message).toBe("3 questions; need at least 4 (one per objective)");
  });
});
