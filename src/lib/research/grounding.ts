import "server-only";

// Trims a source's raw content to the passages relevant to a subtopic (ARCHITECTURE.md: max ~1,500 words).
// Grounding goes to the Lesson Writer and Fact-Checker only; it is never displayed.

export const MAX_GROUNDING_WORDS = 1_500;

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "for", "on", "how", "what", "is", "with", "by",
  "as", "at", "from", "his", "her", "its", "their", "was", "were", "are", "be", "this", "that",
]);

export function termsFrom(...texts: string[]): string[] {
  const words = texts.join(" ").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((w) => w.length > 2 && !STOPWORDS.has(w)))];
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function firstWords(text: string, n: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, n).join(" ");
}

// One level of nested brackets in link text (e.g. "[[1]](#cite)") and of parentheses in the destination
// (e.g. "wiki/Macedonia_(ancient_kingdom)"); never across a line break.
const MD_IMAGE = /!\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)/g;
const MD_LINK = /\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\]\((?:[^()\n]|\([^()\n]*\))*\)/g;
const AUTOLINK = /<https?:\/\/[^>\s]*>/g;
/** Link text that is page furniture, not prose: footnote markers, "edit", "^". */
const FURNITURE_LINK_TEXT = /^\s*(?:\[?\s*(?:\d+|[a-z]|note \d+|citation needed|edit)\s*\]?|\^)?\s*$/i;

const TABLE_SEPARATOR_CELLS = /\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+/g;
const EMPTY_TABLE_CELLS = /\|(?:[ \t]*\|)+/g;

/**
 * Replaces markdown links with their text and drops images, autolinks, footnote/edit links,
 * table separator rows and empty table cells (cell text is kept).
 * Tavily's raw content is markdown: in Wikipedia pages about half the characters are link URLs
 * and titles, which cost tokens and carry nothing the Lesson Writer can use.
 */
export function stripMarkdownNoise(text: string): string {
  return text
    .replace(MD_IMAGE, "")
    .replace(MD_LINK, (_, linkText: string) => (FURNITURE_LINK_TEXT.test(linkText) ? "" : linkText))
    .replace(AUTOLINK, "")
    .replace(/\[\s*\]/g, "")
    .replace(TABLE_SEPARATOR_CELLS, "|")
    .replace(EMPTY_TABLE_CELLS, "|")
    .replace(/[ \t]+([,.;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

/**
 * Strips markdown noise, then keeps the paragraphs that mention the most terms, in original order, up to maxWords.
 * Falls back to the opening maxWords when no paragraph mentions any term.
 */
export function trimGrounding(markdown: string, terms: string[], maxWords = MAX_GROUNDING_WORDS): string {
  const raw = stripMarkdownNoise(markdown);
  const paragraphs = raw
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => wordCount(p) >= 5);
  if (!paragraphs.length) return firstWords(raw, maxWords);

  const lowerTerms = terms.map((t) => t.toLowerCase());
  const scored = paragraphs.map((text, index) => {
    const lower = text.toLowerCase();
    return { index, text, words: wordCount(text), hits: lowerTerms.filter((t) => lower.includes(t)).length };
  });
  if (scored.every((p) => p.hits === 0)) return firstWords(paragraphs.join("\n\n"), maxWords);

  const chosen: typeof scored = [];
  let total = 0;
  for (const p of [...scored].filter((p) => p.hits > 0).sort((a, b) => b.hits - a.hits || a.index - b.index)) {
    if (total >= maxWords) break;
    const text = total + p.words > maxWords ? firstWords(p.text, maxWords - total) : p.text;
    chosen.push({ ...p, text });
    total += wordCount(text);
  }
  return chosen
    .sort((a, b) => a.index - b.index)
    .map((p) => p.text)
    .join("\n\n");
}

/** First 1–2 sentences, at most maxChars: the displayable excerpt. */
export function makeExcerpt(text: string, maxChars = 300): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [clean];
  let excerpt = sentences[0]!.trim();
  if (sentences[1] && excerpt.length + sentences[1].length <= maxChars) excerpt += ` ${sentences[1].trim()}`;
  return excerpt.length > maxChars ? `${excerpt.slice(0, maxChars - 1).trimEnd()}…` : excerpt;
}
