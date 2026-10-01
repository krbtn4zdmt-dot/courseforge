import "server-only";

import type { Card, CardType, LessonContent, LessonWriterOutput, Source } from "./schemas";

// Pure helpers for interactive lessons (task 1.9): structure rules, one plain-text rendering of a lesson's
// cards (for the fact-checker, the examiner, the audit and the markdown file), and time estimates.
// Type-only imports from schemas.ts, which imports this file's structure rules.

/** Cards that ask the learner to do something. Reading and video cards are teaching, not actions. */
export const ACTION_TYPES: readonly CardType[] = ["predict", "decide", "match", "order", "mythFact", "spotError", "practiceStep", "explainBack"];

export const isAction = (card: Card): boolean => ACTION_TYPES.includes(card.type);

const CITATION_MARKER = /\[\d+(?:\s*,\s*\d+)*\](?!\()/g;

/** Words on a reading page, ignoring citation markers and markdown symbols. */
export function pageWordCount(page: string): number {
  return page
    .replace(CITATION_MARKER, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function readingWords(card: Card): number {
  return card.type === "reading" ? card.pages.reduce((n, p) => n + pageWordCount(p), 0) : 0;
}

/** Consecutive runs of cards with the same `part`, in lesson order. */
export function partsOf(cards: readonly Card[]): { part: string; cards: Card[] }[] {
  const parts: { part: string; cards: Card[] }[] = [];
  for (const card of cards) {
    const last = parts.at(-1);
    if (last && last.part === card.part) last.cards.push(card);
    else parts.push({ part: card.part, cards: [card] });
  }
  return parts;
}

/**
 * Teach, then use (SPEC.md): each part is an optional predict card, then a reading card, then any videos,
 * then at least one action, and nothing else. Returns one message per broken rule; empty when the lesson is fine.
 */
export function structureProblems(cards: readonly Card[]): string[] {
  const problems: string[] = [];
  const parts = partsOf(cards);
  const seen = new Set<string>();
  for (const { part, cards: inPart } of parts) {
    if (seen.has(part)) problems.push(`part "${part}" is split: keep a part's cards together`);
    seen.add(part);
    let i = inPart[0]?.type === "predict" && inPart[1]?.type === "reading" ? 1 : 0;
    if (inPart[i]?.type !== "reading") {
      problems.push(`part "${part}" must open with a reading card (a predict card may come just before it)`);
      continue;
    }
    i++;
    while (inPart[i]?.type === "video") i++;
    const rest = inPart.slice(i);
    if (!rest.length) problems.push(`part "${part}" has no activity after its teaching`);
    const misplaced = rest.filter((c) => !isAction(c));
    if (misplaced.length) problems.push(`part "${part}" has ${misplaced.map((c) => `a ${c.type} card`).join(", ")} after its activities; start a new part instead`);
  }
  return problems;
}

/** The most reading words the learner meets between two actions (SPEC: an action at least every ~90 seconds). */
export function maxReadingBetweenActions(cards: readonly Card[]): number {
  let run = 0;
  let max = 0;
  for (const card of cards) {
    if (isAction(card)) run = 0;
    else run += readingWords(card);
    max = Math.max(max, run);
  }
  return max;
}

/** Sorted, unique source numbers the cards cite. */
export function cardCitations(cards: readonly Card[]): number[] {
  return [...new Set(cards.flatMap((c) => c.cites))].sort((a, b) => a - b);
}

// ---------- Old (prose) and new (card) lessons ----------

export function isCardLesson(content: LessonContent): content is LessonWriterOutput {
  return "activities" in content;
}

export function citedIndexesOf(content: LessonContent): number[] {
  return isCardLesson(content) ? cardCitations(content.activities) : content.citedSourceIndexes;
}

/** The text the fact-checker, examiner and audit read: the rendered cards, or a prose lesson's markdown. */
export function lessonTextOf(content: LessonContent, videos: readonly { title: string }[] = []): string {
  return isCardLesson(content) ? renderCardsText(content.activities, videos) : content.contentMd;
}

// ---------- Rendering ----------

const LETTERS = "ABCDEFGH";
const sourcesNote = (cites: readonly number[]) => (cites.length ? ` (sources ${cites.map((n) => `[${n}]`).join(" ")})` : "");

function renderCard(card: Card, videos: readonly { title: string }[]): string {
  const head = (label: string) => `### ${label}${sourcesNote(card.cites)}`;
  switch (card.type) {
    case "reading":
      return [head(`Reading: ${card.title}`), ...card.pages].join("\n\n");
    case "video":
      return `${head(`Video: ${videos[card.video - 1]?.title ?? `video ${card.video}`}`)}\nWatch for:\n${card.watchFor.map((w) => `- ${w}`).join("\n")}`;
    case "predict":
      return [
        head("Predict"),
        card.prompt,
        card.options.map((o, i) => `${LETTERS[i]}) ${o}${i === card.answer ? " (correct)" : ""}`).join("\n"),
        `Reveal: ${card.reveal}`,
      ].join("\n\n");
    case "decide":
      return [
        head("Decide"),
        card.scenario,
        card.options.map((o) => `- ${o.text}${o.best ? " (best choice)" : ""}\n  Outcome: ${o.outcome}`).join("\n"),
      ].join("\n\n");
    case "match":
      return [head("Match"), card.prompt, card.pairs.map((p) => `- ${p.left}: ${p.right}`).join("\n")].join("\n\n");
    case "order":
      return [head("Put in order"), card.prompt, card.items.map((x, i) => `${i + 1}. ${x}`).join("\n"), `Why: ${card.explain}`].join("\n\n");
    case "mythFact":
      return [
        head("Myth or fact"),
        card.items
          .map((x) => (x.fact ? `- Fact: ${x.statement}\n  Why: ${x.why}` : `- Myth (false on purpose): ${x.statement}\n  The truth: ${x.why}`))
          .join("\n"),
      ].join("\n\n");
    case "spotError":
      return [
        head("Spot the error"),
        card.prompt,
        card.segments.map((s, i) => (i === card.errorIndex ? `- Deliberate mistake: ${s}` : `- ${s}`)).join("\n"),
        `Correction: ${card.correction}`,
        `Why: ${card.why}`,
      ].join("\n\n");
    case "practiceStep":
      return [head(`Practice (${card.minutes} min)`), card.instructions, `Expected outcome: ${card.expectedOutcome}`].join("\n\n");
    case "explainBack":
      return [head("Explain it back"), card.prompt, `Key points:\n${card.keyPoints.map((k) => `- ${k}`).join("\n")}`, `Model answer: ${card.modelAnswer}`].join("\n\n");
  }
}

/** Markdown: one "## part" heading per part, one "### card" heading per card, answers shown. */
export function renderCardsText(cards: readonly Card[], videos: readonly { title: string }[] = []): string {
  return partsOf(cards)
    .map(({ part, cards: inPart }) => [`## ${part}`, ...inPart.map((c) => renderCard(c, videos))].join("\n\n"))
    .join("\n\n");
}

// ---------- Time ----------

/** Reading speed for the time estimate: the middle of the writer's 150–200 words-per-minute budget. */
export const READING_WPM = 175;
const QUIZ_SECONDS_PER_QUESTION = 30;

/** A curated video's length, from its stored excerpt ("Channel · 11 min"); null when it isn't there. */
export function videoMinutes(video: Pick<Source, "excerpt">): number | null {
  const m = video.excerpt.match(/·\s*(\d+)\s*min\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Which video cards fit the lesson's media minutes, in lesson order. A video that doesn't fit (or whose
 * length is unknown) is offered as "save for later" and doesn't count toward the lesson's time.
 */
export function videoPlan(cards: readonly Card[], videos: readonly Pick<Source, "excerpt">[], mediaMinutes: number): Map<string, { minutes: number | null; fits: boolean }> {
  const plan = new Map<string, { minutes: number | null; fits: boolean }>();
  let used = 0;
  for (const card of cards) {
    if (card.type !== "video") continue;
    const video = videos[card.video - 1];
    const minutes = video ? videoMinutes(video) : null;
    const fits = minutes !== null && used + minutes <= mediaMinutes;
    if (fits) used += minutes;
    plan.set(card.id, { minutes, fits });
  }
  return plan;
}

/** Estimated seconds for one card; a video card counts its minutes only when it fits the budget (pass them in). */
export function cardSeconds(card: Card, videoMinutesIfFits = 0): number {
  switch (card.type) {
    case "reading":
      return Math.round((readingWords(card) / READING_WPM) * 60);
    case "video":
      return videoMinutesIfFits * 60;
    case "predict":
      return 40;
    case "decide":
      return 60;
    case "match":
      return 10 + 12 * card.pairs.length;
    case "order":
      return 15 + 10 * card.items.length;
    case "mythFact":
      return 20 * card.items.length;
    case "spotError":
      return 45;
    case "practiceStep":
      return card.minutes * 60;
    case "explainBack":
      return 120;
  }
}

/** The lesson's estimated time: its cards (videos that fit only) plus the end-of-lesson quiz. */
export function lessonSeconds(
  cards: readonly Card[],
  videos: readonly Pick<Source, "excerpt">[],
  mediaMinutes: number,
  quizQuestions: number,
): number {
  const plan = videoPlan(cards, videos, mediaMinutes);
  const cardsTotal = cards.reduce((n, c) => {
    const v = plan.get(c.id);
    return n + cardSeconds(c, v?.fits ? (v.minutes ?? 0) : 0);
  }, 0);
  return cardsTotal + quizQuestions * QUIZ_SECONDS_PER_QUESTION;
}
