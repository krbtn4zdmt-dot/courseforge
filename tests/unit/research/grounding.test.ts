import { describe, expect, it } from "vitest";

import { makeExcerpt, stripMarkdownNoise, termsFrom, trimGrounding } from "@/lib/research/grounding";

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

  it("strips link markup before counting words", () => {
    const raw = `[Alexander](https://en.wikipedia.org/wiki/Alexander_the_Great "Alexander the Great") was born in [Pella](https://en.wikipedia.org/wiki/Pella "Pella") in 356 BC.`;
    expect(trimGrounding(raw, ["alexander"], 7)).toBe("Alexander was born in Pella in 356");
  });
});

describe("stripMarkdownNoise", () => {
  it("keeps link text and drops the destination and title, including parentheses in URLs", () => {
    expect(
      stripMarkdownNoise(
        `carved up [Alexander's empire](https://en.wikipedia.org/wiki/History_of_Macedonia_(ancient_kingdom)#Empire "History of Macedonia (ancient kingdom)") after [his death](/wiki/Death "Death").`,
      ),
    ).toBe("carved up Alexander's empire after his death.");
  });

  it("drops images, including images wrapped in links", () => {
    expect(stripMarkdownNoise("Map ![Diadochi kingdoms](https://x.org/map.png \"Map\") here.")).toBe("Map here.");
    expect(stripMarkdownNoise("[![logo](https://x.org/a.png)](https://x.org) Home")).toBe(" Home");
  });

  it("drops footnote, back-reference and edit links", () => {
    expect(stripMarkdownNoise("won at Gaugamela.[[12]](#cite_note-12) Next")).toBe("won at Gaugamela. Next");
    expect(stripMarkdownNoise("^ [1](#cite_ref-Gabriel_1-0) [2](#cite_ref-Gabriel_1-1) Gabriel, p. 4")).toBe("^ Gabriel, p. 4");
    expect(stripMarkdownNoise("## Tactics[[edit](/w/index.php?title=Phalanx&action=edit&section=4 \"Edit section: Tactics\")]")).toBe(
      "## Tactics",
    );
  });

  it("drops autolinks and leaves plain brackets and parentheses alone", () => {
    expect(stripMarkdownNoise("See <https://example.com/page> for more.")).toBe("See for more.");
    expect(stripMarkdownNoise("He [the king] marched (in 334 BC).")).toBe("He [the king] marched (in 334 BC).");
  });

  it("drops table separator rows and empty cells but keeps cell text", () => {
    expect(stripMarkdownNoise("| Date | | 322–272 BC |\n| --- | :---: |\n| | | |")).toBe("| Date | 322–272 BC |\n|\n|");
  });

  it("does not match across line breaks", () => {
    expect(stripMarkdownNoise("an [unclosed bracket\nand then](later)")).toBe("an [unclosed bracket\nand then](later)");
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
