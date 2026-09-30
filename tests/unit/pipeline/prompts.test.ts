import { describe, expect, it } from "vitest";

import {
  curriculumPrompt,
  dayCountCalendar,
  examinerPrompt,
  factCheckerPrompt,
  intakePrompt,
  JSON_ONLY,
  lessonWriterPrompt,
  plannerPrompt,
  readingWordRange,
  type PromptPair,
} from "@/lib/pipeline/prompts";
import type { CourseRequest, CurriculumOutput, PlannerOutput } from "@/lib/pipeline/schemas";
import { computeTimeBudget } from "@/lib/pipeline/timeBudget";

import curriculumFixture from "../../fixtures/agents/curriculum.valid.json";
import lessonFixture from "../../fixtures/agents/lessonWriter.valid.json";
import plannerFixture from "../../fixtures/agents/planner.valid.json";

const request: CourseRequest = {
  topic: "Alexander the Great",
  days: 3,
  minutesPerDay: 30,
  level: "beginner",
  goal: "understand",
};
const plan = plannerFixture as PlannerOutput;
const syllabus = curriculumFixture as CurriculumOutput;
const timeBudget = computeTimeBudget({ days: 3, minutesPerDay: 30, topicType: "knowledge" });
const lesson = syllabus.days[1]!.lessons[0]!;
const split = timeBudget[1]!.lessons[0]!;

const lessonInput = {
  lesson,
  dayNumber: 2,
  split,
  syllabus,
  sources: [
    { title: "Battle of Issus", url: "https://example.com/issus", grounding: "Issus was fought in 333 BC." },
    { title: "Battle of Gaugamela", url: "https://example.com/gaugamela", grounding: "Gaugamela was fought in 331 BC." },
  ],
  level: "beginner" as const,
  topicType: "knowledge" as const,
  sensitiveDomain: null,
};

const ALL: Record<string, () => PromptPair> = {
  intake: () =>
    intakePrompt({ messages: [{ role: "user", content: "Alexander the Great in 3 days" }], today: "2026-09-30", timeZone: "UTC" }),
  planner: () => plannerPrompt({ request, timeBudget }),
  curriculum: () =>
    curriculumPrompt({
      request,
      plan,
      timeBudget,
      sourceSummaries: [{ subtopic: "Macedon and Philip II", sources: [{ title: "Philip II", excerpt: "King of Macedon." }] }],
    }),
  lessonWriter: () => lessonWriterPrompt(lessonInput),
  examiner: () => examinerPrompt({ lessonTitle: lesson.title, contentMd: lessonFixture.contentMd, objectives: lesson.objectives }),
  factChecker: () =>
    factCheckerPrompt({
      contentMd: lessonFixture.contentMd,
      sources: [{ index: 1, title: "Battle of Issus", grounding: "Issus was fought in 333 BC." }],
      level: "beginner",
    }),
};

describe.each(Object.entries(ALL))("%s prompt", (_agent, build) => {
  it("ends the system prompt with the JSON-only instruction and describes the output", () => {
    const { system } = build();
    expect(system.trim().endsWith(JSON_ONLY)).toBe(true);
    expect(system).toContain("## Rules");
    expect(system).toContain("## Output");
  });

  it("puts inputs in labeled sections in the user prompt", () => {
    expect(build().prompt).toMatch(/^## /m);
  });

  it("is deterministic", () => {
    expect(build()).toEqual(build());
  });
});

describe("intake prompt", () => {
  it("includes the conversation, today's date and the time zone", () => {
    const { prompt } = intakePrompt({
      messages: [
        { role: "user", content: "I want to learn Excel" },
        { role: "assistant", content: "How long do you have?" },
        { role: "user", content: "by Friday" },
      ],
      today: "2026-09-30",
      timeZone: "America/New_York",
    });
    expect(prompt).toContain("2026-09-30 (time zone: America/New_York)");
    expect(prompt).toContain("Learner: by Friday");
    expect(prompt).toContain("Assistant: How long do you have?");
  });

  it("gives a day-count calendar so 'by Friday' on a Wednesday is day 3", () => {
    const calendar = dayCountCalendar("2026-09-30");
    expect(calendar.split("\n")).toEqual([
      "Day 1 = Wednesday 2026-09-30 (today)",
      "Day 2 = Thursday 2026-10-01",
      "Day 3 = Friday 2026-10-02",
      "Day 4 = Saturday 2026-10-03",
      "Day 5 = Sunday 2026-10-04",
      "Day 6 = Monday 2026-10-05",
      "Day 7 = Tuesday 2026-10-06",
      "Day 8 = Wednesday 2026-10-07",
    ]);
  });

  it("handles year and leap-day boundaries", () => {
    expect(dayCountCalendar("2027-12-31", 2)).toBe("Day 1 = Friday 2027-12-31 (today)\nDay 2 = Saturday 2028-01-01");
    expect(dayCountCalendar("2028-02-28", 2).split("\n")[1]).toBe("Day 2 = Tuesday 2028-02-29");
  });

  it("rejects an invalid date", () => {
    expect(() => dayCountCalendar("2026-02-30")).toThrow(RangeError);
    expect(() => dayCountCalendar("30/09/2026")).toThrow(RangeError);
  });

  it("states the refusal, crisis line and snapping rules", () => {
    const { system } = intakePrompt({ messages: [], today: "2026-09-30", timeZone: "UTC" });
    expect(system).toContain("988");
    expect(system).toContain("findahelpline.com");
    expect(system).toContain("15, 30, 45, 60, 90");
  });
});

describe("planner prompt", () => {
  it("includes the topic, learner and lesson-slot count", () => {
    const { prompt } = plannerPrompt({ request, timeBudget });
    expect(prompt).toContain("Alexander the Great");
    expect(prompt).toContain("5 lesson slot(s)");
    expect(prompt).toContain("Day 3: lesson 21 min, review 9 min");
  });
});

describe("curriculum prompt", () => {
  it("lists the exact slots and the planner subtopics", () => {
    const { prompt } = curriculumPrompt({ request, plan, timeBudget, sourceSummaries: [] });
    expect(prompt).toContain("Day 1: lesson 15 min, lesson 15 min");
    expect(prompt).toContain("[importance 2] Campaigns in Central Asia and India (after: The conquest of the Persian Empire)");
    expect(prompt).not.toContain("Previous syllabus");
  });

  it("adds the previous syllabus and feedback on edits", () => {
    const { prompt } = curriculumPrompt({
      request,
      plan,
      timeBudget,
      sourceSummaries: [],
      edit: { previousSyllabus: syllabus, feedback: "More on the battles, less on Macedon." },
    });
    expect(prompt).toContain("## Previous syllabus");
    expect(prompt).toContain("Alexander the Great in Three Days");
    expect(prompt).toContain("More on the battles, less on Macedon.");
  });
});

describe("lesson writer prompt", () => {
  it("computes the reading word range from readingMinutes", () => {
    expect(readingWordRange(8)).toEqual({ min: 1_200, max: 1_600 });
    const { prompt } = lessonWriterPrompt(lessonInput);
    const words = readingWordRange(split.readingMinutes);
    expect(prompt).toContain(`Reading length: ${words.min}–${words.max} words.`);
  });

  it("numbers the sources from 1", () => {
    const { prompt } = lessonWriterPrompt(lessonInput);
    expect(prompt).toContain("[1] Battle of Issus");
    expect(prompt).toContain("[2] Battle of Gaugamela");
  });

  it("tells the writer not to add its own disclaimer, and flags sensitive domains", () => {
    expect(lessonWriterPrompt(lessonInput).system).toContain("Do not write a disclaimer");
    expect(lessonWriterPrompt(lessonInput).prompt).not.toContain("Sensitive domain");
    const medical = lessonWriterPrompt({ ...lessonInput, sensitiveDomain: "medical" });
    expect(medical.prompt).toContain("This is a medical topic");
  });

  it("attaches fact-check issues on a rewrite", () => {
    const { prompt } = lessonWriterPrompt({
      ...lessonInput,
      factCheckIssues: [{ claim: "Issus was in 335 BC", problem: "contradicted", suggestion: "Use 333 BC per [1]." }],
    });
    expect(prompt).toContain("Fix these fact-check issues");
    expect(prompt).toContain("(contradicted) Issus was in 335 BC → Use 333 BC per [1].");
  });
});

describe("examiner and fact-checker prompts", () => {
  it("examiner lists the objectives and bans 'of the above' options", () => {
    const { system, prompt } = examinerPrompt({ lessonTitle: "Issus", contentMd: "Lesson", objectives: ["Explain A", "Compare B"] });
    expect(prompt).toContain("1. Explain A\n2. Compare B");
    expect(system).toContain("all of the above");
  });

  it("fact-checker includes each cited source's grounding under its citation number", () => {
    const { prompt } = factCheckerPrompt({
      contentMd: "Claim [3].",
      sources: [{ index: 3, title: "Source three", grounding: "Passage." }],
      level: "refresher",
    });
    expect(prompt).toContain("[3] Source three\nPassage.");
    expect(prompt).toContain("Refresher");
  });
});
