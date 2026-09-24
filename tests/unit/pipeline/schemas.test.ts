import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  CurriculumOutputSchema,
  ExaminerOutputSchema,
  extractCitationIndexes,
  FactCheckOutputSchema,
  IntakeResultSchema,
  LessonWriterOutputSchema,
  PlannerOutputSchema,
  ResearcherOutputSchema,
} from "@/lib/pipeline/schemas";

import { invalidCases, validOutputs, type AgentName } from "../../fixtures/agents";

const schemas: Record<AgentName, z.ZodType> = {
  intake: IntakeResultSchema,
  planner: PlannerOutputSchema,
  curriculum: CurriculumOutputSchema,
  lessonWriter: LessonWriterOutputSchema,
  examiner: ExaminerOutputSchema,
  factChecker: FactCheckOutputSchema,
};
const agents = Object.keys(schemas) as AgentName[];

describe.each(agents)("%s schema", (agent) => {
  it("accepts the valid fixture", () => {
    const result = schemas[agent].safeParse(validOutputs[agent]);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it.each(invalidCases[agent])("rejects: $name", ({ mutate, path }) => {
    const output = structuredClone(validOutputs[agent]);
    mutate(output);
    const result = schemas[agent].safeParse(output);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path.join("."))).toContain(path);
  });

  it("converts to a structured-outputs JSON schema", () => {
    const { schema } = zodOutputFormat(schemas[agent]);
    expect(schema).toMatchObject({ type: "object", additionalProperties: false });
  });
});

describe("other schemas", () => {
  it("intake accepts a refusal and an in-progress conversation", () => {
    expect(
      IntakeResultSchema.safeParse({
        ...validOutputs.intake,
        isAllowed: false,
        refusalMessage: "I can't build a course on that, but I could teach lock mechanics as a hobby.",
      }).success,
    ).toBe(true);
    expect(
      IntakeResultSchema.safeParse({
        topic: "Excel",
        days: null,
        minutesPerDay: null,
        level: null,
        goal: null,
        isAllowed: true,
        refusalMessage: null,
        nextQuestion: "How many days do you have?",
      }).success,
    ).toBe(true);
  });

  it("fact-check accepts an empty issue list", () => {
    expect(FactCheckOutputSchema.safeParse({ issues: [] }).success).toBe(true);
  });

  it("researcher output validates sources and allows null grounding", () => {
    const source = {
      url: "https://en.wikipedia.org/wiki/Alexander_the_Great",
      title: "Alexander the Great",
      type: "wiki",
      score: 0.9,
      excerpt: "King of Macedon from 336 to 323 BCE.",
      grounding: null,
    };
    expect(ResearcherOutputSchema.safeParse([{ subtopic: "Early life", sources: [source] }]).success).toBe(true);
    expect(
      ResearcherOutputSchema.safeParse([{ subtopic: "Early life", sources: [{ ...source, score: 1.5 }] }]).success,
    ).toBe(false);
    expect(
      ResearcherOutputSchema.safeParse([{ subtopic: "Early life", sources: [{ ...source, url: "not a url" }] }])
        .success,
    ).toBe(false);
  });
});

describe("extractCitationIndexes", () => {
  it("finds single, grouped and repeated citations, sorted and unique", () => {
    expect(extractCitationIndexes("A [2]. B [1, 3]. C [2][4].")).toEqual([1, 2, 3, 4]);
  });

  it("ignores markdown links and non-numeric brackets", () => {
    expect(extractCitationIndexes("See [1](https://example.com) and [note] and [a1].")).toEqual([]);
  });

  it("ignores bracketed numbers inside code", () => {
    expect(extractCitationIndexes("Use `arr[0]` here [1].\n\n```python\nx = m[2, 3]\n```\nDone [2].")).toEqual([1, 2]);
  });

  it("returns an empty list when nothing is cited", () => {
    expect(extractCitationIndexes("No citations here.")).toEqual([]);
  });
});
