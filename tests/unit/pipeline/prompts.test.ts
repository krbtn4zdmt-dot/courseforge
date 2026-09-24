import { describe, expect, it } from "vitest";

import { DISCLAIMERS } from "@/lib/disclaimers";
import { buildCurriculumPrompt } from "@/lib/pipeline/prompts/curriculum";
import { buildExaminerPrompt, questionCount } from "@/lib/pipeline/prompts/examiner";
import { buildFactCheckerPrompt } from "@/lib/pipeline/prompts/factChecker";
import { buildIntakePrompt, daysUntilWeekdayTable, localToday } from "@/lib/pipeline/prompts/intake";
import { buildLessonWriterPrompt, type LessonWriterPromptInput } from "@/lib/pipeline/prompts/lessonWriter";
import { buildPlannerPrompt } from "@/lib/pipeline/prompts/planner";
import { formatBudgetSlots, JSON_ONLY, type PromptPair } from "@/lib/pipeline/prompts/shared";
import type {
  CompletedIntake,
  CurriculumOutput,
  FactCheckOutput,
  LessonWriterOutput,
  PlannerOutput,
} from "@/lib/pipeline/schemas";
import { buildTimeBudget, splitLesson } from "@/lib/pipeline/timeBudget";

import { validOutputs } from "../../fixtures/agents";

const intake: CompletedIntake = {
  topic: "Excel",
  days: 3,
  minutesPerDay: 30,
  level: "beginner",
  goal: "practical_skill",
};
const plan = validOutputs.planner as PlannerOutput;
const syllabus = validOutputs.curriculum as CurriculumOutput;
const lesson = validOutputs.lessonWriter as LessonWriterOutput;
const budget = buildTimeBudget({ days: 3, minutesPerDay: 30, topicType: "skill" });
// Wednesday 2026-09-23, 15:00 in New York
const wednesday = new Date("2026-09-23T19:00:00Z");

const lessonInput: LessonWriterPromptInput = {
  lesson: syllabus.days[1]!.lessons[1]!,
  dayNumber: 2,
  slot: splitLesson(15, "skill"),
  syllabus,
  sources: [
    { title: "Microsoft Support: SUM function", url: "https://support.microsoft.com/sum", grounding: "SUM adds values." },
    { title: "IF function", url: "https://support.microsoft.com/if", grounding: "IF returns one value if true." },
  ],
  level: "beginner",
  topicType: "skill",
  sensitiveDomain: null,
};

const prompts: Record<string, { pair: PromptPair; keys: string[] }> = {
  intake: {
    pair: buildIntakePrompt({ history: [{ role: "user", content: "Excel by Friday" }], now: wednesday, timeZone: "America/New_York" }),
    keys: Object.keys(validOutputs.intake),
  },
  planner: { pair: buildPlannerPrompt({ intake, budget }), keys: Object.keys(validOutputs.planner) },
  curriculum: {
    pair: buildCurriculumPrompt({ intake, plan, budget, sourceSummaries: [] }),
    keys: ["courseTitle", "courseSummary", "days", "dayNumber", "theme", "lessons", "kind", "objectives", "estMinutes", "subtopics", "includesPractice"],
  },
  lessonWriter: { pair: buildLessonWriterPrompt(lessonInput), keys: Object.keys(validOutputs.lessonWriter) },
  examiner: {
    pair: buildExaminerPrompt({ contentMd: lesson.contentMd, objectives: ["Explain X", "Apply Y"], level: "beginner" }),
    keys: ["questions", "prompt", "options", "correctOptionId", "explanation"],
  },
  factChecker: {
    pair: buildFactCheckerPrompt({ contentMd: lesson.contentMd, sources: [{ index: 1, title: "Britannica", grounding: "Born 356 BCE." }], level: "beginner" }),
    keys: ["issues", "claim", "problem", "suggestion"],
  },
};

// Same builders, different inputs.
const altIntake: CompletedIntake = { ...intake, topic: "Black holes", days: 2, level: "refresher", goal: "understand" };
const altBudget = buildTimeBudget({ days: 2, minutesPerDay: 60, topicType: "knowledge" });
const altPrompts: Record<string, PromptPair> = {
  intake: buildIntakePrompt({ history: [{ role: "user", content: "Black holes, 2 days" }], now: new Date("2026-01-01T12:00:00Z"), timeZone: "Europe/London" }),
  planner: buildPlannerPrompt({ intake: altIntake, budget: altBudget }),
  curriculum: buildCurriculumPrompt({ intake: altIntake, plan, budget: altBudget, sourceSummaries: [] }),
  lessonWriter: buildLessonWriterPrompt({ ...lessonInput, dayNumber: 3, sensitiveDomain: "safety" }),
  examiner: buildExaminerPrompt({ contentMd: "Different lesson.", objectives: ["Describe Z"], level: "refresher" }),
  factChecker: buildFactCheckerPrompt({ contentMd: "Different lesson.", sources: [], level: "refresher" }),
};

describe.each(Object.entries(prompts))("%s prompt", (agent, { pair, keys }) => {
  it("names every output key in the JSON shape", () => {
    for (const key of keys) expect(pair.system).toContain(`"${key}"`);
  });

  it("ends with the JSON-only instruction", () => {
    expect(pair.prompt.endsWith(JSON_ONLY)).toBe(true);
  });

  it("keeps the system prompt identical across inputs (cacheable)", () => {
    expect(altPrompts[agent]!.system).toBe(pair.system);
    expect(altPrompts[agent]!.prompt).not.toBe(pair.prompt);
  });
});

describe("intake prompt", () => {
  it("resolves today's weekday in the user's time zone", () => {
    expect(localToday(wednesday, "America/New_York")).toEqual({ isoDate: "2026-09-23", weekday: "Wednesday" });
    // Same instant is already Thursday in Tokyo
    expect(localToday(wednesday, "Asia/Tokyo")).toEqual({ isoDate: "2026-09-24", weekday: "Thursday" });
  });

  it('counts "by Friday" on a Wednesday as 3 days and flags today as ambiguous', () => {
    const table = daysUntilWeekdayTable(wednesday, "America/New_York");
    expect(table).toContain("by Friday: 3 days");
    expect(table).toContain("by Tuesday: 7 days");
    expect(table).toContain("Wednesday (today): ambiguous");
  });

  it("renders the transcript and the refusal rules", () => {
    const { system, prompt } = prompts.intake!.pair;
    expect(prompt).toContain("Learner: Excel by Friday");
    expect(prompt).toContain("Wednesday, 2026-09-23");
    expect(system).toContain("988");
  });
});

describe("planner prompt", () => {
  it("sizes subtopics to the lesson slots", () => {
    // 3 days × 30 min: 2 + 2 + 1 lessons
    expect(prompts.planner!.pair.prompt).toContain("5 lesson slots");
  });
});

describe("curriculum prompt", () => {
  it("lists the exact slots per day", () => {
    expect(formatBudgetSlots(budget)).toBe(
      [
        "Day 1: lesson 15 min, lesson 15 min (total 30)",
        "Day 2: lesson 15 min, lesson 15 min (total 30)",
        "Day 3: lesson 21 min, review 9 min (total 30)",
      ].join("\n"),
    );
    expect(prompts.curriculum!.pair.prompt).toContain("Day 3: lesson 21 min, review 9 min (total 30)");
  });

  it("includes the previous syllabus and feedback only for edits", () => {
    expect(prompts.curriculum!.pair.prompt).not.toContain("Learner's requested changes");
    const edited = buildCurriculumPrompt({
      intake,
      plan,
      budget,
      sourceSummaries: [],
      edit: { previous: syllabus, feedback: "More about charts, less about sorting." },
    });
    expect(edited.prompt).toContain("More about charts, less about sorting.");
    expect(edited.prompt).toContain("Excel Essentials in 3 Days");
  });
});

describe("lesson writer prompt", () => {
  it("numbers the sources and sets the word range from reading minutes", () => {
    const { prompt } = prompts.lessonWriter!.pair;
    // 15-min skill lesson: reading 7 min -> 1050–1400 words
    expect(prompt).toContain("1050–1400 words");
    expect(prompt).toContain("[1] Microsoft Support: SUM function");
    expect(prompt).toContain("[2] IF function");
  });

  it("adds the disclaimer only for a sensitive domain", () => {
    expect(prompts.lessonWriter!.pair.prompt).not.toContain(DISCLAIMERS.financial);
    const flagged = buildLessonWriterPrompt({ ...lessonInput, sensitiveDomain: "financial" });
    expect(flagged.prompt).toContain(DISCLAIMERS.financial);
  });

  it("includes fact-check issues only on a rewrite", () => {
    expect(prompts.lessonWriter!.pair.prompt).not.toContain("Fact-check issues");
    const issues = (validOutputs.factChecker as FactCheckOutput).issues;
    const rewrite = buildLessonWriterPrompt({ ...lessonInput, factCheckIssues: issues });
    expect(rewrite.prompt).toContain("Fact-check issues to fix");
    expect(rewrite.prompt).toContain('[unsupported] "before he turned 33"');
  });

  it("tells the writer when there is no practice task", () => {
    const noPractice = buildLessonWriterPrompt({
      ...lessonInput,
      lesson: { ...lessonInput.lesson, includesPractice: false },
    });
    expect(noPractice.prompt).toContain("practiceTask must be null");
  });
});

describe("examiner prompt", () => {
  it("asks for 3–5 questions, at least one per objective", () => {
    expect([1, 2, 3, 4, 5, 6].map(questionCount)).toEqual([3, 3, 3, 4, 5, 5]);
    expect(prompts.examiner!.pair.prompt).toContain("## Number of questions\n3");
  });
});

describe("fact-checker prompt", () => {
  it("renders sources with their lesson citation numbers", () => {
    expect(prompts.factChecker!.pair.prompt).toContain("[1] Britannica\nBorn 356 BCE.");
  });
});
