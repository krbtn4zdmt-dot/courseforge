import { describe, expect, it } from "vitest";

import { capLessonGrounding, selectLessonSources, selectLessonVideos } from "@/lib/pipeline/lessonSources";
import type { ResearcherOutput, Source } from "@/lib/pipeline/schemas";

const src = (url: string, score: number, grounding: string | null, type: Source["type"] = "web"): Source => ({
  url,
  title: url.split("/").pop()!,
  type,
  score,
  excerpt: `Excerpt of ${url}.`,
  grounding,
});

const research: ResearcherOutput = [
  {
    subtopic: "Early life",
    sources: [
      src("https://a.com/ungrounded-high", 0.95, null),
      src("https://a.com/grounded-low", 0.5, "Passages A"),
      src("https://a.com/grounded-high", 0.8, "Passages B"),
      src("https://www.youtube.com/watch?v=v1", 0.7, null, "video"),
    ],
  },
  {
    subtopic: "Persia",
    sources: [
      src("https://a.com/grounded-high/", 0.8, "Passages B again"), // same page, other subtopic
      src("https://b.com/persia", 0.6, "Passages C"),
      src("https://www.youtube.com/watch?v=v2", 0.9, null, "video"),
      src("https://www.youtube.com/watch?v=v3", 0.4, null, "video"),
    ],
  },
  { subtopic: "Legacy", sources: [src("https://c.com/legacy", 0.99, "Passages D")] },
];

describe("selectLessonSources", () => {
  it("puts grounded sources first by score, then excerpt-only ones, deduping across subtopics", () => {
    const out = selectLessonSources(research, ["Early life", "Persia"]);
    expect(out.map((s) => s.title)).toEqual(["grounded-high", "persia", "grounded-low", "ungrounded-high"]);
    expect(out[0]).toEqual({ title: "grounded-high", url: "https://a.com/grounded-high", grounding: "Passages B", excerptOnly: false });
    expect(out[3]).toEqual({
      title: "ungrounded-high",
      url: "https://a.com/ungrounded-high",
      grounding: "Excerpt of https://a.com/ungrounded-high.",
      excerptOnly: true,
    });
  });

  it("uses only the lesson's subtopics and respects the cap", () => {
    expect(selectLessonSources(research, ["Legacy"]).map((s) => s.title)).toEqual(["legacy"]);
    expect(selectLessonSources(research, ["Early life", "Persia"], 2)).toHaveLength(2);
    expect(selectLessonSources(research, ["Unknown"])).toEqual([]);
  });
});

describe("capLessonGrounding", () => {
  const para = (topic: string, n: number) => `${topic} ` + Array.from({ length: n - 1 }, (_, i) => `w${i}`).join(" ");
  const source = (title: string, grounding: string) => ({ title, url: `https://x.com/${title}`, grounding, excerptOnly: false });
  const count = (s: { grounding: string }) => s.grounding.split(/\s+/).filter(Boolean).length;

  it("leaves sources alone when they fit", () => {
    const sources = [source("a", para("Gaugamela", 50)), source("b", para("Issus", 40))];
    expect(capLessonGrounding(sources, ["Gaugamela"], 100)).toEqual(sources);
  });

  it("passes a short source's unused share to the longer ones", () => {
    const long = [para("Gaugamela", 60), para("Granicus", 60), para("Gaugamela", 60)].join("\n\n");
    const out = capLessonGrounding([source("short", para("Issus", 20)), source("long", long), source("long2", long)], ["Gaugamela"], 200);
    expect(count(out[0]!)).toBe(20);
    expect(out.map(count).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(200);
    // 90 words each: the on-topic paragraphs come first, the Granicus one is cut.
    expect(count(out[1]!)).toBe(90);
    expect(out[1]!.grounding.startsWith("Gaugamela")).toBe(true);
    expect(out[1]!.grounding).not.toContain("Granicus");
  });
});

describe("selectLessonVideos", () => {
  it("returns the top 2 videos across the lesson's subtopics", () => {
    expect(selectLessonVideos(research, ["Early life", "Persia"]).map((v) => v.url)).toEqual([
      "https://www.youtube.com/watch?v=v2",
      "https://www.youtube.com/watch?v=v1",
    ]);
    expect(selectLessonVideos(research, ["Legacy"])).toEqual([]);
  });
});
