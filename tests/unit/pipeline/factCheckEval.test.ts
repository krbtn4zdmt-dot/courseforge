import { describe, expect, it } from "vitest";

import { factCheckInputFor, findLesson, labelMatches, scoreFactCheck, type EvalLabel } from "@/lib/pipeline/factCheckEval";
import { citedFactCheckSources } from "@/lib/pipeline/factChecker";
import type { CourseResult, GeneratedLesson } from "@/lib/pipeline/runCourse";
import type { FactCheckIssue } from "@/lib/pipeline/schemas";

const issue = (claim: string, problem: FactCheckIssue["problem"] = "contradicted"): FactCheckIssue => ({ claim, problem, suggestion: "fix it" });
const label = (match: string[], truth: EvalLabel["truth"]): EvalLabel => ({ match, truth });

describe("labelMatches", () => {
  it("matches any of the strings, case-insensitively", () => {
    expect(labelMatches(label(["300 miles", "Thessaly"], "supported"), issue("Alexander reached thessaly in seven days"))).toBe(true);
    expect(labelMatches(label(["Pindar"], "supported"), issue("Thebes was razed"))).toBe(false);
  });
});

describe("scoreFactCheck", () => {
  it("separates false alarms, caught and missed errors, and unlabeled issues; ignores 'either'", () => {
    const labels = [label(["Pindar"], "supported"), label(["526"], "error"), label(["June 13"], "error"), label(["October 31"], "either")];
    const score = scoreFactCheck([issue("the house of Pindar was spared"), issue("Hydaspes in 526 BCE"), issue("October 31 at Gaugamela"), issue("a new claim", "unsupported")], labels);
    expect(score.falseAlarms.map((l) => l.match[0])).toEqual(["Pindar"]);
    expect(score.caught.map((l) => l.match[0])).toEqual(["526"]);
    expect(score.missed.map((l) => l.match[0])).toEqual(["June 13"]);
    expect(score.unlabeled.map((i) => i.claim)).toEqual(["a new claim"]);
  });

  it("scores a clean pass", () => {
    expect(scoreFactCheck([], [label(["Pindar"], "supported")])).toEqual({ falseAlarms: [], caught: [], missed: [], unlabeled: [] });
  });
});

describe("citedFactCheckSources", () => {
  const sources = [
    { title: "A", url: "https://a.org", grounding: "alpha" },
    { title: "B", url: "https://b.org", grounding: "beta" },
  ];

  it("keeps the [n] numbers of the cited sources", () => {
    expect(citedFactCheckSources(sources, [2])).toEqual([{ index: 2, title: "B", grounding: "beta" }]);
  });

  it("throws on a citation with no source", () => {
    expect(() => citedFactCheckSources(sources, [3])).toThrow("cited source [3] doesn't exist");
  });
});

describe("factCheckInputFor", () => {
  const source = (url: string, score: number, grounding: string) => ({ url, title: url, type: "web", score, excerpt: "e", grounding });
  const lesson = {
    dayNumber: 1,
    position: 0,
    spec: { title: "Thebes", subtopics: ["Thebes"] },
    content: { contentMd: "Thebes fell [2].", citedSourceIndexes: [2] },
    sources: [{ index: 2, title: "https://low.org", url: "https://low.org" }],
  } as unknown as GeneratedLesson;
  const course = (lessons: unknown[]) =>
    ({
      intake: { level: "beginner" },
      deepResearch: {
        output: [{ subtopic: "Thebes", sources: [source("https://low.org", 0.5, "[Thebes](https://x.org/T \"T\") fell in 335 BC."), source("https://high.org", 0.9, "High")] }],
      },
      lessons,
    }) as unknown as CourseResult;

  it("rebuilds the cited sources from the stored research, with grounding stripped", () => {
    expect(factCheckInputFor(course([]), lesson)).toEqual({
      contentMd: "Thebes fell [2].",
      sources: [{ index: 2, title: "https://low.org", grounding: "Thebes fell in 335 BC." }],
      level: "beginner",
    });
  });

  it("throws when a cited source no longer matches the research", () => {
    const moved = { ...lesson, sources: [{ index: 2, title: "x", url: "https://other.org" }] } as GeneratedLesson;
    expect(() => factCheckInputFor(course([]), moved)).toThrow("no longer matches");
  });

  it("findLesson returns ready lessons only", () => {
    const c = course([{ status: "failed", dayNumber: 1, position: 1, title: "t", error: "e" }, { status: "ready", lesson }]);
    expect(findLesson(c, 1, 0)).toBe(lesson);
    expect(() => findLesson(c, 1, 1)).toThrow("No ready lesson at day 1, item 2");
  });
});
