import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auditCourse, auditLesson, longestCopiedRun, longQuotes, proseWordCount, uncitedSections } from "@/lib/pipeline/courseAudit";
import type { GeneratedLesson } from "@/lib/pipeline/runCourse";

const source =
  "Alexander the Great was king of the ancient Greek kingdom of Macedon and a member of the Argead dynasty. He succeeded his father Philip II to the throne in 336 BC at the age of 20 and spent most of his ruling years conducting a lengthy military campaign throughout Western Asia and Egypt.";

describe("longestCopiedRun", () => {
  it("finds a long verbatim run from the source", () => {
    const lesson = `## Early life\nIn short, he succeeded his father Philip II to the throne in 336 BC at the age of 20 and spent most of his ruling years at war [1].`;
    const run = longestCopiedRun(lesson, source);
    // "he succeeded … his ruling years" (24 words); "at war" differs from the source
    expect(run.words).toBe(24);
    expect(run.text).toMatch(/^he succeeded his father philip ii/);
  });

  it("ignores original paraphrase, short overlaps and quoted text", () => {
    expect(longestCopiedRun("Philip II's son took the throne at twenty, in 336 BC, and spent years campaigning in Asia [1].", source).words).toBe(0);
    expect(longestCopiedRun(`As one source puts it, "he succeeded his father Philip II to the throne in 336 BC at the age of 20" [1].`, source).words).toBe(0);
  });

  it("ignores case and punctuation differences", () => {
    const lesson = "HE SUCCEEDED his father, Philip II, to the throne in 336 BC: at the age of 20!";
    expect(longestCopiedRun(lesson, source).words).toBe(17);
  });
});

describe("text checks", () => {
  it("proseWordCount ignores code and citation markers", () => {
    expect(proseWordCount("## Title\nOne two three [1, 2].\n```\ncode words here\n```\n- four `x[0]`")).toBe(5);
  });

  it("longQuotes flags quotes over 15 words, straight or curly", () => {
    const md = `He said "short and sweet" and also “${"word ".repeat(16).trim()}” [1].`;
    expect(longQuotes(md)).toEqual(["word ".repeat(16).trim()]);
  });

  it("uncitedSections skips the opener and recap", () => {
    const md = "## Why this matters\nNo cite.\n\n## Facts\nA fact [1].\n\n## More facts\nUncited claim.\n\n## Recap\n- x";
    expect(uncitedSections(md)).toEqual(["More facts"]);
  });
});

function lesson(overrides: { contentMd?: string; readingMinutes?: number; url?: string } = {}): GeneratedLesson {
  const readingMinutes = overrides.readingMinutes ?? 1;
  return {
    dayNumber: 1,
    position: 0,
    spec: { kind: "lesson", title: "Early life", objectives: ["Explain", "Describe"], estMinutes: 10, subtopics: ["Early life"], includesPractice: false },
    slot: { estMinutes: 10, readingMinutes, mediaMinutes: 2, practiceMinutes: 3 },
    content: { contentMd: overrides.contentMd ?? `## Early life\n${"word ".repeat(170)}[1]`, keyTerms: [], practiceTask: null, citedSourceIndexes: [1] },
    sources: [{ index: 1, title: "Src", url: overrides.url ?? "https://www.britannica.com/x" }],
    videos: [],
    quiz: {
      questions: ["a", "b", "c"].map((id) => ({
        prompt: `Q${id}`,
        options: ["a", "b", "c", "d"].map((o) => ({ id: o, text: `opt ${o}` })),
        correctOptionId: id,
        explanation: "e",
      })),
    },
    factCheck: { passed: true, issues: [], attempts: 1, rewritten: false, rewriteError: null, unverifiedClaims: [] },
  };
}

describe("auditLesson", () => {
  it("passes a lesson within its word range with citations", () => {
    const a = auditLesson(lesson(), new Map());
    expect(a).toMatchObject({ words: 172, wordRange: [150, 200], lengthStatus: "ok", uncitedSections: [], copiedRun: null, lowCredibilitySources: [] });
  });

  it("flags short lessons, copying and low-credibility sources", () => {
    const copied = `## Early life\nHe succeeded his father Philip II to the throne in 336 BC at the age of 20 and spent most of his ruling years conducting a lengthy military campaign [1].`;
    const a = auditLesson(lesson({ contentMd: copied, readingMinutes: 3, url: "https://www.quora.com/x" }), new Map([["https://www.quora.com/x", source]]));
    expect(a.lengthStatus).toBe("short");
    expect(a.copiedRun).toMatchObject({ words: 29, sourceIndex: 1 });
    expect(a.lowCredibilitySources).toEqual(["https://www.quora.com/x"]);
  });
});

describe("auditCourse", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("reports pacing, failures, problems and SPEC targets", async () => {
    const good = lesson();
    const bad = lesson({ contentMd: "## Facts\nUncited claim with no source at all." });
    const course = {
      intake: { topic: "t", days: 2, minutesPerDay: 30, level: "beginner", goal: "understand" },
      syllabus: {
        plan: { sensitiveDomain: null },
        timings: { totalMs: 25_000 },
        curriculum: { syllabus: { days: [{ dayNumber: 1, lessons: [{ estMinutes: 15 }, { estMinutes: 15 }] }, { dayNumber: 2, lessons: [{ estMinutes: 20 }] }] } },
      },
      deepResearch: { output: [] },
      lessons: [
        { status: "ready", lesson: good },
        { status: "ready", lesson: { ...bad, factCheck: { ...bad.factCheck, unverifiedClaims: [{ claim: "c", problem: "unsupported", suggestion: "s" }] } } },
        { status: "failed", dayNumber: 2, position: 0, title: "Broken", error: "boom" },
      ],
      stats: { llm: { costUsd: 0.3 }, lessons: { factCheckPassRate: 0.5 } },
    } as unknown as Parameters<typeof auditCourse>[0];

    const audit = auditCourse(course);
    expect(audit.pacing).toEqual([
      { day: 1, minutes: 30, target: 30 },
      { day: 2, minutes: 20, target: 30 },
    ]);
    expect(audit.problems).toEqual(
      expect.arrayContaining([
        "Day 2 totals 20 min (target 30)",
        'Day 2 "Broken" failed to generate: boom',
        'Day 1 "Early life" section "Facts" has no citation',
      ]),
    );
    // $0.30 for 2 days scales to $1.05 per 7 days: over the $0.75 target
    expect(audit.targets).toMatchObject({ syllabusSeconds: 25, syllabusOk: false, flagRate: 0.5, flagRateOk: false, costOk: false });
    expect(audit.targets.costPer7DaysUsd).toBeCloseTo(1.05, 5);
    expect(audit.quizAnswerSpread).toEqual({ a: 2, b: 2, c: 2 });
  });
});
