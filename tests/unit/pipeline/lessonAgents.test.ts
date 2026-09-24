import { describe, expect, it, vi } from "vitest";

import { DISCLAIMERS } from "@/lib/disclaimers";
import type { callJson } from "@/lib/llm/client";
import { examineLesson, examinerSchemaFor } from "@/lib/pipeline/examiner";
import { factCheckLesson, factCheckPassed } from "@/lib/pipeline/factChecker";
import { lessonOutputSchemaFor, writeLesson } from "@/lib/pipeline/lessonWriter";
import type { LessonWriterPromptInput } from "@/lib/pipeline/prompts/lessonWriter";
import type { CurriculumOutput, ExaminerOutput, FactCheckIssue, LessonWriterOutput } from "@/lib/pipeline/schemas";
import { splitLesson } from "@/lib/pipeline/timeBudget";

import { validOutputs } from "../../fixtures/agents";
import failing from "../../fixtures/agents/factChecker.failing.json";

const lesson = validOutputs.lessonWriter as LessonWriterOutput; // cites [1] and [2], no practice task
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
    const result = lessonOutputSchemaFor(1, false).safeParse(lesson);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message)).toContain("cites source(s) 2 but only [1]–[1] exist");
  });

  it("requires a practice task exactly when the lesson includes practice", () => {
    expect(lessonOutputSchemaFor(2, true).safeParse(lesson).error!.issues[0]!.message).toMatch(/required/);
    const withTask = { ...lesson, practiceTask: { instructions: "Do it", expectedOutcome: "Done" } };
    expect(lessonOutputSchemaFor(2, true).safeParse(withTask).success).toBe(true);
    expect(lessonOutputSchemaFor(2, false).safeParse(withTask).error!.issues[0]!.message).toMatch(/must be null/);
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

  it("uses the fast model and computes passed in code", async () => {
    const call = vi.fn(async () => failing) as unknown as typeof callJson;
    const result = await factCheckLesson(
      { contentMd: lesson.contentMd, sources: [{ index: 1, title: "Britannica", grounding: "Born in Pella." }], level: "beginner" },
      { callJson: call },
    );
    expect(result).toEqual({ issues: failing.issues, passed: false });
    expect(vi.mocked(call).mock.calls[0]![0]).toMatchObject({ agent: "factChecker", model: "fast" });
  });
});

describe("examiner", () => {
  const quiz = validOutputs.examiner as ExaminerOutput; // 3 questions

  it("uses the fast model", async () => {
    const call = vi.fn(async () => quiz) as unknown as typeof callJson;
    expect(await examineLesson({ contentMd: lesson.contentMd, objectives: ["A", "B"], level: "beginner" }, { callJson: call })).toBe(quiz);
    expect(vi.mocked(call).mock.calls[0]![0]).toMatchObject({ agent: "examiner", model: "fast" });
  });

  it("needs at least one question per objective", () => {
    expect(examinerSchemaFor(3).safeParse(quiz).success).toBe(true);
    const result = examinerSchemaFor(4).safeParse(quiz);
    expect(result.error!.issues[0]!.message).toBe("3 questions; need at least 4 (one per objective)");
  });
});
