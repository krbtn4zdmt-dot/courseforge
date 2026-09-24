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

/**
 * Keeps the paragraphs that mention the most terms, in original order, up to maxWords.
 * Falls back to the opening maxWords when no paragraph mentions any term.
 */
export function trimGrounding(raw: string, terms: string[], maxWords = MAX_GROUNDING_WORDS): string {
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
