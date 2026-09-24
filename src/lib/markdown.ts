// Small markdown helpers that respect code: fenced blocks (``` or ~~~) and inline `code` spans.

const FENCE = /^\s*(```|~~~)/;

/** Applies `fn` to each line outside fenced code blocks; fenced lines pass through unchanged. */
export function mapLinesOutsideFences(md: string, fn: (line: string) => string): string {
  let inFence: string | null = null;
  return md
    .split("\n")
    .map((line) => {
      const fence = line.match(FENCE)?.[1];
      if (fence && (inFence === null || inFence === fence)) {
        inFence = inFence === null ? fence : null;
        return line;
      }
      return inFence === null ? fn(line) : line;
    })
    .join("\n");
}

/** Removes fenced code blocks and inline code spans, e.g. before scanning prose for citations. */
export function stripCode(md: string): string {
  let inFence: string | null = null;
  return md
    .split("\n")
    .filter((line) => {
      const fence = line.match(FENCE)?.[1];
      if (fence && (inFence === null || inFence === fence)) {
        inFence = inFence === null ? fence : null;
        return false;
      }
      return inFence === null;
    })
    .map((line) => line.replace(/(`+)[\s\S]*?\1/g, ""))
    .join("\n");
}
