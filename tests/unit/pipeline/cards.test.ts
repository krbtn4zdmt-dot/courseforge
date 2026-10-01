import { describe, expect, it } from "vitest";

import {
  cardCitations,
  cardSeconds,
  citedIndexesOf,
  lessonSeconds,
  lessonTextOf,
  maxReadingBetweenActions,
  pageWordCount,
  partsOf,
  renderCardsText,
  structureProblems,
  videoMinutes,
  videoPlan,
} from "@/lib/pipeline/cards";
import type { Card, LessonWriterOutput } from "@/lib/pipeline/schemas";

import { validOutputs } from "../../fixtures/agents";

const lesson = validOutputs.lessonWriter as LessonWriterOutput;
const cards = lesson.activities;

const reading = (id: string, part: string, words: number): Card => ({
  id,
  type: "reading",
  part,
  cites: [1],
  title: id,
  pages: [Array(Math.ceil(words / 2)).fill("w").join(" "), Array(Math.floor(words / 2)).fill("w").join(" ")],
});
const match = (id: string, part: string): Card => ({
  id,
  type: "match",
  part,
  cites: [1],
  prompt: "Match",
  pairs: [
    { left: "a", right: "1" },
    { left: "b", right: "2" },
    { left: "c", right: "3" },
  ],
});
const video = (id: string, part: string, n = 1): Card => ({ id, type: "video", part, cites: [], video: n, watchFor: ["x", "y"] });

describe("structure", () => {
  it("accepts the fixture: predict, reading, activity / reading, activities", () => {
    expect(partsOf(cards).map((p) => [p.part, p.cards.map((c) => c.type)])).toEqual([
      ["A prince of Macedon", ["predict", "reading", "mythFact"]],
      ["Taking the throne", ["reading", "order", "explainBack"]],
    ]);
    expect(structureProblems(cards)).toEqual([]);
  });

  it("allows videos between the reading and the activities", () => {
    expect(structureProblems([reading("r", "A", 100), video("v", "A"), match("m", "A")])).toEqual([]);
  });

  it("reports parts that don't open with reading, have no activity, read again after activities, or are split", () => {
    expect(structureProblems([match("m", "A"), reading("r", "A", 50)])).toEqual([
      'part "A" must open with a reading card (a predict card may come just before it)',
    ]);
    expect(structureProblems([reading("r", "A", 50), video("v", "A")])).toEqual(['part "A" has no activity after its teaching']);
    expect(structureProblems([reading("r", "A", 50), match("m", "A"), reading("r2", "A", 50), match("m2", "A")])).toEqual([
      'part "A" has a reading card after its activities; start a new part instead',
    ]);
    expect(structureProblems([reading("r", "A", 50), match("m", "A"), reading("r2", "B", 50), match("m2", "B"), reading("r3", "A", 50), match("m3", "A")])).toEqual([
      'part "A" is split: keep a part\'s cards together',
    ]);
  });

  it("measures reading between actions, ignoring citation markers on pages", () => {
    expect(pageWordCount("Born in Pella [1], tutored by Aristotle [1, 2].")).toBe(6);
    expect(maxReadingBetweenActions([reading("r1", "A", 120), video("v", "A"), match("m", "A"), reading("r2", "B", 200), match("m2", "B")])).toBe(200);
    expect(maxReadingBetweenActions([reading("r1", "A", 120), reading("r2", "A", 200), match("m", "A")])).toBe(320);
  });
});

describe("citations and text", () => {
  it("collects the cited sources and renders every card with its answers", () => {
    expect(cardCitations(cards)).toEqual([1, 2]);
    expect(citedIndexesOf(lesson)).toEqual([1, 2]);
    const text = renderCardsText(cards);
    expect(text).toContain("## A prince of Macedon\n\n### Predict (sources [1])");
    expect(text).toContain("B) 20 (correct)");
    expect(text).toContain("### Reading: Early life (sources [1] [2])");
    expect(text).toContain("- Myth (false on purpose): Alexander grew up in Athens.\n  The truth: He was born in Pella");
    expect(text).toContain("1. Alexander is born in Pella\n2. Aristotle tutors Alexander");
    expect(text).toContain("Model answer: As Philip II's son");
  });

  it("renders decide, spot-the-error, video and practice cards", () => {
    const text = renderCardsText(
      [
        reading("r", "A", 20),
        video("v", "A"),
        { id: "d", type: "decide", part: "A", cites: [1], scenario: "Your total is wrong.", options: [{ text: "Retype it", outcome: "It goes stale again.", best: false }, { text: "Use =SUM", outcome: "It updates.", best: true }] },
        { id: "s", type: "spotError", part: "A", cites: [1], prompt: "Find the mistake.", segments: ["Type =", "Use x to multiply", "Press Enter"], errorIndex: 1, correction: "Use *.", why: "Excel multiplies with *." },
        { id: "p", type: "practiceStep", part: "A", cites: [], instructions: "Sum A1:A4.", expectedOutcome: "100", minutes: 3 },
      ],
      [{ title: "Excel basics" }],
    );
    expect(text).toContain("### Video: Excel basics\nWatch for:\n- x\n- y");
    expect(text).toContain("- Use =SUM (best choice)\n  Outcome: It updates.");
    expect(text).toContain("- Deliberate mistake: Use x to multiply");
    expect(text).toContain("### Practice (3 min)\n\nSum A1:A4.\n\nExpected outcome: 100");
  });

  it("reads lessons from before task 1.9 as their markdown", () => {
    const prose = { contentMd: "## Facts\nA fact [3].", keyTerms: [], practiceTask: null, citedSourceIndexes: [3] };
    expect(lessonTextOf(prose)).toBe("## Facts\nA fact [3].");
    expect(citedIndexesOf(prose)).toEqual([3]);
  });
});

describe("time", () => {
  it("reads a video's length from its excerpt", () => {
    expect(videoMinutes({ excerpt: "History Channel · 11 min" })).toBe(11);
    expect(videoMinutes({ excerpt: "No length here" })).toBeNull();
  });

  it("fits videos into the media minutes in order and offers the rest for later", () => {
    const lessonCards = [reading("r", "A", 50), video("v1", "A", 1), video("v2", "A", 2), match("m", "A")];
    const plan = videoPlan(lessonCards, [{ excerpt: "A · 3 min" }, { excerpt: "B · 4 min" }], 5);
    expect(plan.get("v1")).toEqual({ minutes: 3, fits: true });
    expect(plan.get("v2")).toEqual({ minutes: 4, fits: false });
  });

  it("estimates card and lesson time", () => {
    expect(cardSeconds(reading("r", "A", 175))).toBe(60);
    expect(cardSeconds(match("m", "A"))).toBe(46);
    expect(cardSeconds(video("v", "A"), 3)).toBe(180);
    // 175 words (60 s) + a 3-minute video that fits (180 s) + a match (46 s) + 3 quiz questions (90 s)
    expect(lessonSeconds([reading("r", "A", 175), video("v", "A"), match("m", "A")], [{ excerpt: "A · 3 min" }], 3, 3)).toBe(376);
    // The same video over budget counts nothing.
    expect(lessonSeconds([reading("r", "A", 175), video("v", "A"), match("m", "A")], [{ excerpt: "A · 3 min" }], 2, 3)).toBe(196);
  });
});
