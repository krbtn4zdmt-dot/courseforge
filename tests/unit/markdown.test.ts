import { describe, expect, it } from "vitest";

import { mapLinesOutsideFences, stripCode } from "@/lib/markdown";

describe("stripCode", () => {
  it("removes fenced blocks (``` and ~~~) and inline code, keeping prose", () => {
    const md = ["Prose [1].", "```python", "x = arr[0]", "```", "More `m[2, 3]` prose [2].", "~~~", "y[5]", "~~~", "End."].join("\n");
    expect(stripCode(md)).toBe(["Prose [1].", "More  prose [2].", "End."].join("\n"));
  });

  it("doesn't close a ``` fence with ~~~", () => {
    expect(stripCode(["```", "a[1]", "~~~", "b[2]", "```", "c [3]"].join("\n"))).toBe("c [3]");
  });


  it("lets a longer fence contain a shorter one, and ignores fences with an info string as closers", () => {
    const md = ["Intro [1].", "````markdown", "```js", "x[2]", "```", "# not a heading", "````", "After [3]."].join("\n");
    expect(stripCode(md)).toBe(["Intro [1].", "After [3]."].join("\n"));
    const md2 = ["```", "a[1]", "```python", "b[2]", "```", "c [3]"].join("\n");
    expect(stripCode(md2)).toBe("c [3]");
  });
});

describe("mapLinesOutsideFences", () => {
  it("skips lines inside fences", () => {
    const md = ["# Title", "```bash", "# a comment", "```", "## Sub"].join("\n");
    expect(mapLinesOutsideFences(md, (l) => l.toUpperCase())).toBe(["# TITLE", "```bash", "# a comment", "```", "## SUB"].join("\n"));
  });
});
