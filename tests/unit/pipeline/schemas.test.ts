import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  CourseRequestSchema,
  CurriculumOutputSchema,
  ExaminerOutputSchema,
  extractCitationIndexes,
  FactCheckOutputSchema,
  IntakeResultSchema,
  LessonContentSchema,
  PlannerOutputSchema,
  ResearchResultSchema,
  SourceSchema,
} from "@/lib/pipeline/schemas";

import curriculum from "../../fixtures/agents/curriculum.valid.json";
import examiner from "../../fixtures/agents/examiner.valid.json";
import factChecker from "../../fixtures/agents/factChecker.valid.json";
import { INVALID } from "../../fixtures/agents/invalid";
import intake from "../../fixtures/agents/intake.valid.json";
import lessonWriter from "../../fixtures/agents/lessonWriter.valid.json";
import planner from "../../fixtures/agents/planner.valid.json";

const AGENTS: Record<string, { schema: z.ZodType; valid: unknown }> = {
  intake: { schema: IntakeResultSchema, valid: intake },
  planner: { schema: PlannerOutputSchema, valid: planner },
  curriculum: { schema: CurriculumOutputSchema, valid: curriculum },
  lessonWriter: { schema: LessonContentSchema, valid: lessonWriter },
  examiner: { schema: ExaminerOutputSchema, valid: examiner },
  factChecker: { schema: FactCheckOutputSchema, valid: factChecker },
};

describe.each(Object.entries(AGENTS))("%s schema", (agent, { schema, valid }) => {
  it("accepts the valid fixture", () => {
    const result = schema.safeParse(valid);
    expect(result.error ? z.prettifyError(result.error) : null).toBeNull();
  });

  it.each(INVALID[agent]!.map((c) => [c.name, c]))("rejects: %s", (_name, invalidCase) => {
    const result = schema.safeParse(invalidCase.output);
    expect(result.success).toBe(false);
    expect(z.prettifyError(result.error!)).toContain(invalidCase.error);
  });

  it("converts to a structured-output JSON schema for callJson", () => {
    const format = zodOutputFormat(schema);
    expect(format.type).toBe("json_schema");
    expect(format.schema).toMatchObject({ type: "object", additionalProperties: false });
  });
});

describe("IntakeResultSchema: allowed states", () => {
  it("accepts a partial intake with a next question", () => {
    const partial = { ...intake, days: null, minutesPerDay: null, nextQuestion: "How many days do you have?" };
    expect(IntakeResultSchema.safeParse(partial).success).toBe(true);
  });

  it("accepts a refusal with no next question", () => {
    const refused = {
      ...intake,
      topic: "Making explosives",
      days: null,
      isAllowed: false,
      refusalMessage: "I can't help build a course on that.",
    };
    expect(IntakeResultSchema.safeParse(refused).success).toBe(true);
  });

  it("accepts every snapped minutes value", () => {
    for (const minutesPerDay of [15, 30, 45, 60, 90]) {
      expect(IntakeResultSchema.safeParse({ ...intake, minutesPerDay }).success).toBe(true);
    }
  });
});

describe("LessonContentSchema", () => {
  it("accepts a lesson with no citations when none are listed", () => {
    const uncited = { ...lessonWriter, contentMd: "## Recap\n- One\n- Two\n- Three", citedSourceIndexes: [] };
    expect(LessonContentSchema.safeParse(uncited).success).toBe(true);
  });
});

describe("extractCitationIndexes", () => {
  it.each([
    ["single citations", "A [1]. B [3].", [1, 3]],
    ["grouped citations", "A [2, 1]. B [1,4].", [1, 2, 4]],
    ["duplicates", "[2] and again [2]", [2]],
    ["markdown link text", "See [1](https://example.com) and [2].", [2]],
    ["footnotes and words", "[^1] [a] [1a] [ 3 ]", []],
    ["none", "No citations here.", []],
  ])("%s", (_name, markdown, expected) => {
    expect(extractCitationIndexes(markdown)).toEqual(expected);
  });
});

describe("SourceSchema / ResearchResultSchema", () => {
  const source = {
    url: "https://en.wikipedia.org/wiki/Battle_of_Gaugamela",
    title: "Battle of Gaugamela",
    type: "wiki",
    score: 0.82,
    excerpt: "The decisive battle between Alexander and Darius III.",
    grounding: null,
  };

  it("accepts a light-mode source (no grounding) and a research result", () => {
    expect(SourceSchema.safeParse(source).success).toBe(true);
    expect(ResearchResultSchema.safeParse([{ subtopic: "Issus", sources: [source] }]).success).toBe(true);
  });

  it.each([
    ["non-http url", { ...source, url: "ftp://example.com/file" }],
    ["not a url", { ...source, url: "gaugamela" }],
    ["unknown type", { ...source, type: "podcast" }],
    ["score above 1", { ...source, score: 1.2 }],
  ])("rejects %s", (_name, bad) => {
    expect(SourceSchema.safeParse(bad).success).toBe(false);
  });
});

describe("CourseRequestSchema", () => {
  it("accepts any whole minutesPerDay from 15 to 90 (the CLI isn't snapped)", () => {
    const request = { topic: "Excel", days: 7, minutesPerDay: 20, level: "beginner", goal: "practical_skill" };
    expect(CourseRequestSchema.safeParse(request).success).toBe(true);
    expect(CourseRequestSchema.safeParse({ ...request, minutesPerDay: 10 }).success).toBe(false);
  });
});
