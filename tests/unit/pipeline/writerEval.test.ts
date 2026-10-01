import { describe, expect, it } from "vitest";

import type { CourseResult, GeneratedLesson } from "@/lib/pipeline/runCourse";
import { badFactsIn, writerInputFor } from "@/lib/pipeline/writerEval";

describe("badFactsIn", () => {
  it("returns the patterns the text matches, case-insensitively", () => {
    const patterns = ["October\\s+31", "Darius II\\b"];
    expect(badFactsIn("fought on october  31 near Arbela", patterns)).toEqual(["October\\s+31"]);
    expect(badFactsIn("Darius III fled", patterns)).toEqual([]);
  });
});

describe("writerInputFor", () => {
  it("rebuilds the first-draft writer input from the stored course, with today's time split", () => {
    const lesson = {
      dayNumber: 2,
      position: 0,
      slot: { estMinutes: 20, readingMinutes: 11, mediaMinutes: 4, practiceMinutes: 5 }, // the split before task 1.9
      spec: { title: "Thebes", subtopics: ["Thebes"] },
      content: { contentMd: "x", citedSourceIndexes: [1] },
      sources: [{ index: 1, title: "A", url: "https://a.org" }],
      videos: [{ url: "https://www.youtube.com/watch?v=t", title: "Thebes falls", type: "video", score: 1, excerpt: "Chan · 6 min", grounding: null }],
    } as unknown as GeneratedLesson;
    const course = {
      intake: { level: "beginner" },
      syllabus: { plan: { topicType: "knowledge", sensitiveDomain: null }, curriculum: { syllabus: { courseTitle: "C" } } },
      deepResearch: { output: [{ subtopic: "Thebes", sources: [{ url: "https://a.org", title: "A", type: "web", score: 1, excerpt: "e", grounding: "[Thebes](https://x.org) fell." }] }] },
      lessons: [],
    } as unknown as CourseResult;
    expect(writerInputFor(course, lesson)).toEqual({
      lesson: lesson.spec,
      dayNumber: 2,
      slot: { estMinutes: 20, readingMinutes: 7, mediaMinutes: 4, practiceMinutes: 9 },
      syllabus: { courseTitle: "C" },
      sources: [{ title: "A", url: "https://a.org", grounding: "Thebes fell.", excerptOnly: false }],
      videos: [{ title: "Thebes falls", excerpt: "Chan · 6 min" }],
      level: "beginner",
      topicType: "knowledge",
      sensitiveDomain: null,
    });
  });
});
