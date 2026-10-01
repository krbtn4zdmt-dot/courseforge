import { describe, expect, it } from "vitest";

import { structureProblems } from "@/lib/pipeline/cards";
import { buildDayPreview, previewMinutes, previewReadingWords, renderPreviewHtml } from "@/lib/pipeline/dayPreview";
import type { CourseResult, GeneratedLesson } from "@/lib/pipeline/runCourse";
import { LessonWriterOutputSchema } from "@/lib/pipeline/schemas";

import { allCardTypesLesson } from "../../fixtures/cardLesson";

const quiz = {
  questions: ["a", "b", "c"].map((id) => ({ prompt: `Q${id}`, options: ["a", "b", "c", "d"].map((o) => ({ id: o, text: o })), correctOptionId: id, explanation: "e" })),
};

function lesson(dayNumber: number, content: GeneratedLesson["content"], videoExcerpt = "Chan · 3 min"): GeneratedLesson {
  return {
    dayNumber,
    position: 0,
    spec: { kind: "lesson", title: `Day ${dayNumber} lesson`, objectives: ["Write a formula", "Pick a function"], estMinutes: 15, subtopics: ["s"], includesPractice: true },
    slot: { estMinutes: 15, readingMinutes: 5, mediaMinutes: 2, practiceMinutes: 8 },
    content,
    sources: [
      { index: 1, title: "Microsoft Support", url: "https://support.microsoft.com/a" },
      { index: 2, title: "BYU", url: "https://byu.edu/b" },
    ],
    videos: [{ url: "https://www.youtube.com/watch?v=x", title: "Formulas in 3 minutes", type: "video", score: 1, excerpt: videoExcerpt, grounding: null }],
    quiz,
    factCheck: { passed: true, issues: [], firstIssues: [], attempts: 1, rewritten: false, rewriteError: null, unverifiedClaims: [] },
  };
}

function course(lessons: GeneratedLesson[]): CourseResult {
  return {
    intake: { topic: "Excel", days: 2, minutesPerDay: 15, level: "beginner", goal: "practical_skill" },
    syllabus: {
      plan: { sensitiveDomain: "financial" },
      curriculum: { syllabus: { courseTitle: "Excel Essentials", days: [{ dayNumber: 1, theme: "Formulas" }, { dayNumber: 2, theme: "Charts" }] } },
    },
    lessons: lessons.map((l) => ({ status: "ready", lesson: l })),
  } as unknown as CourseResult;
}

describe("the all-card-types fixture", () => {
  it("is a valid lesson", () => {
    expect(LessonWriterOutputSchema.safeParse(allCardTypesLesson).error?.issues ?? []).toEqual([]);
    expect(structureProblems(allCardTypesLesson.activities)).toEqual([]);
  });
});

describe("buildDayPreview", () => {
  it("shapes one day for the player, with card times and the video budget", () => {
    const preview = buildDayPreview(course([lesson(1, allCardTypesLesson), lesson(2, allCardTypesLesson)]), 1);
    expect(preview).toMatchObject({ courseTitle: "Excel Essentials", dayNumber: 1, days: 2, theme: "Formulas", minutesPerDay: 15, nextTheme: "Charts" });
    expect(preview.disclaimer).toMatch(/not financial advice/);
    expect(preview.lessons).toHaveLength(1);
    const [l] = preview.lessons;
    expect(l!.cards).toHaveLength(11);
    // A 3-minute clip doesn't fit 2 media minutes: it counts no time and is offered for later.
    expect(l!.videos).toEqual([{ title: "Formulas in 3 minutes", url: "https://www.youtube.com/watch?v=x", excerpt: "Chan · 3 min", minutes: 3, fits: false }]);
    expect(l!.cards.find((c) => c.card.type === "video")!.seconds).toBe(0);
    expect(l!.cards.find((c) => c.card.type === "practiceStep")!.seconds).toBe(180);
    expect(previewReadingWords(preview)).toBeGreaterThan(40);
    expect(previewMinutes(preview)).toBeGreaterThan(5);
  });

  it("counts a video that fits", () => {
    const preview = buildDayPreview(course([lesson(1, allCardTypesLesson, "Chan · 2 min")]), 1);
    expect(preview.lessons[0]!.videos[0]!.fits).toBe(true);
    expect(preview.lessons[0]!.cards.find((c) => c.card.type === "video")!.seconds).toBe(120);
  });

  it("refuses prose lessons, missing days and days with nothing ready", () => {
    const prose = { contentMd: "## Facts\nA fact [1].", keyTerms: [], practiceTask: null, citedSourceIndexes: [1] };
    expect(() => buildDayPreview(course([lesson(1, prose)]), 1)).toThrow(/prose lesson .* regenerate the course/);
    expect(() => buildDayPreview(course([lesson(1, allCardTypesLesson)]), 3)).toThrow("The course has no day 3 (it has 2)");
    expect(() => buildDayPreview(course([lesson(1, allCardTypesLesson)]), 2)).toThrow("Day 2 has no ready lessons");
  });
});

describe("renderPreviewHtml", () => {
  it("embeds the data so text can't close the script tag", () => {
    const preview = buildDayPreview(course([lesson(1, allCardTypesLesson)]), 1);
    preview.theme = "Tricky </script><script>alert(1)</script>";
    const html = renderPreviewHtml("<script>var DAY = /*__DAY_DATA__*/null;</script>", preview);
    expect(html).not.toContain("</script><script>alert");
    expect(html).toContain("\\u003c/script>");
    expect(JSON.parse(html.slice("<script>var DAY = ".length, -";</script>".length)).theme).toBe(preview.theme);
    expect(() => renderPreviewHtml("<p>no marker</p>", preview)).toThrow(/marker/);
  });
});
