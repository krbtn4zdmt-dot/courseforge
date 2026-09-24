import "server-only";

import { stripCode } from "@/lib/markdown";
import { domainCredibility, CREDIBILITY } from "@/lib/research/scoring";

import { WORDS_PER_READING_MINUTE } from "./prompts/lessonWriter";
import type { CourseResult, GeneratedLesson } from "./runCourse";
import { extractCitationIndexes } from "./schemas";

// Mechanical checks on a generated course, for the Phase 1 quality review (/test-course).
// They measure the CLAUDE.md content rules and SPEC targets; they don't judge accuracy or clarity.

export const MAX_QUOTE_WORDS = 15; // AGENTS.md: quotes under 15 words
export const COPY_RUN_WORDS = 20; // a verbatim run this long outside quotes is treated as copying
const SHINGLE = 8;

export const SPEC_TARGETS = {
  syllabusMs: 20_000,
  flagRate: 0.05, // share of lessons shipped with the unverified-claims notice
  costPer7DayCourseUsd: 0.75,
} as const;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Prose word count, ignoring code, markdown symbols and citation markers. */
export function proseWordCount(md: string): number {
  return stripCode(md)
    .replace(/\[\d+(?:\s*,\s*\d+)*\]/g, "")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Quoted passages ("…" or “…”) longer than the limit. */
export function longQuotes(md: string, maxWords = MAX_QUOTE_WORDS): string[] {
  const quotes = [...stripCode(md).matchAll(/"([^"\n]+)"|“([^”\n]+)”/g)].map((m) => (m[1] ?? m[2])!.trim());
  return quotes.filter((q) => q.split(/\s+/).length > maxWords);
}

/**
 * Longest run of consecutive words (outside quotes and code) that also appears verbatim in `source`.
 * Measured with 8-word shingles, so runs under 8 words count as 0.
 */
export function longestCopiedRun(lessonMd: string, source: string): { words: number; text: string } {
  const prose = words(stripCode(lessonMd).replace(/"[^"\n]*"|“[^”\n]*”/g, " "));
  const src = words(source);
  if (prose.length < SHINGLE || src.length < SHINGLE) return { words: 0, text: "" };
  const sourceShingles = new Set<string>();
  for (let i = 0; i + SHINGLE <= src.length; i++) sourceShingles.add(src.slice(i, i + SHINGLE).join(" "));

  let best = { start: 0, shingles: 0 };
  let run = { start: 0, shingles: 0 };
  for (let i = 0; i + SHINGLE <= prose.length; i++) {
    if (sourceShingles.has(prose.slice(i, i + SHINGLE).join(" "))) {
      run = run.shingles ? { ...run, shingles: run.shingles + 1 } : { start: i, shingles: 1 };
      if (run.shingles > best.shingles) best = run;
    } else {
      run = { start: 0, shingles: 0 };
    }
  }
  if (!best.shingles) return { words: 0, text: "" };
  const length = best.shingles + SHINGLE - 1;
  return { words: length, text: prose.slice(best.start, best.start + length).join(" ") };
}

/** "## Heading" sections (other than the recap and the opener) with no [n] citation. */
export function uncitedSections(md: string): string[] {
  const sections = stripCode(md).split(/^## /m).slice(1);
  return sections
    .map((section) => ({ heading: section.split("\n")[0]!.trim(), body: section }))
    .filter(({ heading }) => !/^(recap|why this matters)/i.test(heading))
    .filter(({ body }) => extractCitationIndexes(body).length === 0)
    .map(({ heading }) => heading);
}

export interface LessonAudit {
  day: number;
  position: number;
  title: string;
  kind: "lesson" | "review";
  words: number;
  wordRange: [number, number];
  lengthStatus: "short" | "ok" | "long";
  uncitedSections: string[];
  longQuotes: string[];
  copiedRun: { words: number; text: string; sourceIndex: number } | null;
  lowCredibilitySources: string[];
  videos: number;
  unverifiedClaims: number;
  rewritten: boolean;
}

export function auditLesson(lesson: GeneratedLesson, groundingByUrl: ReadonlyMap<string, string>): LessonAudit {
  const md = lesson.content.contentMd;
  const count = proseWordCount(md);
  const range: [number, number] = [
    lesson.slot.readingMinutes * WORDS_PER_READING_MINUTE.min,
    lesson.slot.readingMinutes * WORDS_PER_READING_MINUTE.max,
  ];
  // Allow 15% either side before calling a lesson short or long.
  const lengthStatus = count < range[0] * 0.85 ? "short" : count > range[1] * 1.15 ? "long" : "ok";

  let copiedRun: LessonAudit["copiedRun"] = null;
  for (const source of lesson.sources) {
    const grounding = groundingByUrl.get(source.url);
    if (!grounding) continue;
    const run = longestCopiedRun(md, grounding);
    if (run.words >= COPY_RUN_WORDS && run.words > (copiedRun?.words ?? 0)) copiedRun = { ...run, sourceIndex: source.index };
  }

  return {
    day: lesson.dayNumber,
    position: lesson.position,
    title: lesson.spec.title,
    kind: lesson.spec.kind,
    words: count,
    wordRange: range,
    lengthStatus,
    uncitedSections: uncitedSections(md),
    longQuotes: longQuotes(md),
    copiedRun,
    lowCredibilitySources: lesson.sources.filter((s) => domainCredibility(s.url) === CREDIBILITY.low).map((s) => s.url),
    videos: lesson.videos.length,
    unverifiedClaims: lesson.factCheck.unverifiedClaims.length,
    rewritten: lesson.factCheck.rewritten,
  };
}

export interface CourseAudit {
  lessons: LessonAudit[];
  pacing: { day: number; minutes: number; target: number }[];
  quizAnswerSpread: Record<string, number>;
  duplicateOptions: string[];
  disclaimerNeeded: boolean;
  /** Each problem is one line for the report; empty means no mechanical problems found. */
  problems: string[];
  targets: {
    syllabusSeconds: number;
    syllabusOk: boolean;
    flagRate: number | null;
    flagRateOk: boolean | null;
    /** Cost scaled to a 7-day course of the same minutes per day, for comparison with SPEC. */
    costPer7DaysUsd: number;
    costOk: boolean;
  };
}

export function auditCourse(course: CourseResult): CourseAudit {
  const groundingByUrl = new Map<string, string>();
  for (const { sources } of course.deepResearch.output) {
    for (const s of sources) if (s.grounding) groundingByUrl.set(s.url, s.grounding);
  }
  const ready = course.lessons.flatMap((o) => (o.status === "ready" ? [o.lesson] : []));
  const lessons = ready.map((l) => auditLesson(l, groundingByUrl));

  const syllabus = course.syllabus.curriculum.syllabus;
  const pacing = syllabus.days.map((d) => ({
    day: d.dayNumber,
    minutes: d.lessons.reduce((n, l) => n + l.estMinutes, 0),
    target: course.intake.minutesPerDay,
  }));

  const quizAnswerSpread: Record<string, number> = {};
  const duplicateOptions: string[] = [];
  for (const l of ready) {
    for (const q of l.quiz.questions) {
      quizAnswerSpread[q.correctOptionId] = (quizAnswerSpread[q.correctOptionId] ?? 0) + 1;
      const texts = q.options.map((o) => o.text.trim().toLowerCase());
      if (new Set(texts).size !== texts.length) duplicateOptions.push(`${l.spec.title}: "${q.prompt}"`);
    }
  }

  const problems: string[] = [];
  const where = (a: LessonAudit) => `Day ${a.day} "${a.title}"`;
  for (const p of pacing) if (p.minutes !== p.target) problems.push(`Day ${p.day} totals ${p.minutes} min (target ${p.target})`);
  for (const o of course.lessons) if (o.status === "failed") problems.push(`Day ${o.dayNumber} "${o.title}" failed to generate: ${o.error}`);
  for (const a of lessons) {
    if (a.copiedRun) problems.push(`${where(a)} repeats ${a.copiedRun.words} words verbatim from source [${a.copiedRun.sourceIndex}]: "${a.copiedRun.text.slice(0, 120)}…"`);
    for (const q of a.longQuotes) problems.push(`${where(a)} quotes ${q.split(/\s+/).length} words (limit ${MAX_QUOTE_WORDS}): "${q.slice(0, 80)}…"`);
    for (const s of a.uncitedSections) problems.push(`${where(a)} section "${s}" has no citation`);
    if (a.lengthStatus !== "ok") problems.push(`${where(a)} is ${a.lengthStatus}: ${a.words} words (target ${a.wordRange[0]}–${a.wordRange[1]})`);
    for (const url of a.lowCredibilitySources) problems.push(`${where(a)} cites a low-credibility source: ${url}`);
  }
  for (const d of duplicateOptions) problems.push(`Duplicate quiz options in ${d}`);
  const answers = Object.values(quizAnswerSpread);
  const totalAnswers = answers.reduce((n, c) => n + c, 0);
  if (totalAnswers >= 8 && Math.max(...answers) / totalAnswers > 0.5) {
    problems.push(`Quiz answers are lopsided: ${JSON.stringify(quizAnswerSpread)}`);
  }

  const { stats } = course;
  const flagRate = stats.lessons.factCheckPassRate === null ? null : 1 - stats.lessons.factCheckPassRate;
  const costPer7DaysUsd = (stats.llm.costUsd / course.intake.days) * 7;
  const targets = {
    syllabusSeconds: course.syllabus.timings.totalMs / 1000,
    syllabusOk: course.syllabus.timings.totalMs < SPEC_TARGETS.syllabusMs,
    flagRate,
    flagRateOk: flagRate === null ? null : flagRate < SPEC_TARGETS.flagRate,
    costPer7DaysUsd,
    costOk: costPer7DaysUsd < SPEC_TARGETS.costPer7DayCourseUsd,
  };

  return {
    lessons,
    pacing,
    quizAnswerSpread,
    duplicateOptions,
    disclaimerNeeded: course.syllabus.plan.sensitiveDomain !== null,
    problems,
    targets,
  };
}
