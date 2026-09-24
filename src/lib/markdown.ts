// Small markdown helpers that respect code: fenced blocks (``` or ~~~) and inline `code` spans.
// Fences follow CommonMark: a closing fence uses the same character, is at least as long as the
// opening one, and has no info string, so a longer fence can contain shorter ones.

const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})/;

interface Fence {
  char: string;
  length: number;
}

/** Splits lines into (line, inCode) pairs; fence lines themselves count as code. */
function classifyLines(md: string): { line: string; code: boolean }[] {
  let open: Fence | null = null;
  return md.split("\n").map((line) => {
    if (open) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)?.[1];
      if (close && close[0] === open.char && close.length >= open.length) open = null;
      return { line, code: true };
    }
    const fence = line.match(OPEN_FENCE)?.[1];
    if (fence) {
      open = { char: fence[0]!, length: fence.length };
      return { line, code: true };
    }
    return { line, code: false };
  });
}

/** Applies `fn` to each line outside fenced code blocks; fenced lines pass through unchanged. */
export function mapLinesOutsideFences(md: string, fn: (line: string) => string): string {
  return classifyLines(md)
    .map(({ line, code }) => (code ? line : fn(line)))
    .join("\n");
}

/** Removes fenced code blocks and inline code spans, e.g. before scanning prose for citations. */
export function stripCode(md: string): string {
  return classifyLines(md)
    .filter(({ code }) => !code)
    .map(({ line }) => line.replace(/(`+)[\s\S]*?\1/g, ""))
    .join("\n");
}
