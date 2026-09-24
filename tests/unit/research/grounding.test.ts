import { describe, expect, it } from "vitest";

import { makeExcerpt, termsFrom, trimGrounding } from "@/lib/research/grounding";

const para = (topic: string, n = 40) => `${topic} ${"filler word ".repeat(n / 2)}`.trim();

describe("termsFrom", () => {
  it("lowercases, drops stopwords and short words, dedupes", () => {
    expect(termsFrom("Early life of Alexander", "Alexander the Great childhood")).toEqual(["early", "life", "alexander", "great", "childhood"]);
  });
});

describe("trimGrounding", () => {
  it("keeps the most relevant paragraphs, in original order, within the word limit", () => {
    const raw = [
      para("Cookie banner and site navigation"),
      para("Alexander was born in Pella"),
      para("Unrelated sports news"),
      para("Alexander was tutored by Aristotle at Mieza, Alexander loved Homer"),
    ].join("\n\n");
    const out = trimGrounding(raw, ["alexander", "aristotle", "pella"], 90);
    const paragraphs = out.split("\n\n");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toMatch(/^Alexander was born in Pella/);
    expect(paragraphs[1]).toMatch(/^Alexander was tutored by Aristotle/);
  });

  it("truncates the last kept paragraph to fit exactly", () => {
    const raw = [para("Alexander one", 100), para("Alexander two", 100)].join("\n\n");
    const out = trimGrounding(raw, ["alexander"], 150);
    expect(out.split(/\s+/).length).toBe(150);
  });

  it("falls back to the opening words when nothing matches", () => {
    const raw = [para("First paragraph here"), para("Second paragraph here")].join("\n\n");
    const out = trimGrounding(raw, ["zebra"], 10);
    expect(out).toBe("First paragraph here filler word filler word filler word filler");
  });

  it("drops fragments shorter than 5 words and handles text with no paragraphs", () => {
    expect(trimGrounding("Menu\n\nHome\n\nAlexander of Macedon conquered Persia quickly.", ["alexander"])).toBe(
      "Alexander of Macedon conquered Persia quickly.",
    );
    expect(trimGrounding("Short text", ["x"], 5)).toBe("Short text");
  });

  it("defaults to 1,500 words", () => {
    const raw = Array.from({ length: 10 }, () => para("Alexander", 400)).join("\n\n");
    expect(trimGrounding(raw, ["alexander"]).split(/\s+/).length).toBe(1500);
  });
});

describe("makeExcerpt", () => {
  it("keeps up to two sentences within the limit", () => {
    expect(makeExcerpt("One sentence here. Two here! Three is dropped.")).toBe("One sentence here. Two here!");
    expect(makeExcerpt("One sentence here. Two here!", 20)).toBe("One sentence here.");
  });

  it("truncates a long first sentence with an ellipsis and collapses whitespace", () => {
    expect(makeExcerpt("a  very\nlong sentence without an end", 12)).toBe("a very long…");
  });
});
