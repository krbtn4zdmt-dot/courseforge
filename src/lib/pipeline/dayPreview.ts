import "server-only";

import { DISCLAIMERS } from "@/lib/disclaimers";

import { cardSeconds, isCardLesson, readingWords, videoPlan } from "./cards";
import type { CourseResult } from "./runCourse";
import type { Card, QuizQuestion } from "./schemas";

// Data for the local day preview (pnpm preview:day, task 1.9): one day of a generated course, shaped for the
// player in scripts/preview/player.html. Times come from the same estimates as the audit (cards.ts).

export interface PreviewCard {
  card: Card;
  /** Estimated seconds (a video counts only when it fits the lesson's video minutes). */
  seconds: number;
}

export interface PreviewLesson {
  title: string;
  kind: "lesson" | "review";
  estMinutes: number;
  objectives: string[];
  cards: PreviewCard[];
  sources: { index: number; title: string; url: string }[];
  /** By video number (videos[0] is video 1); fits is false for a clip longer than the lesson's video minutes. */
  videos: { title: string; url: string; excerpt: string; minutes: number | null; fits: boolean }[];
  quiz: QuizQuestion[];
  /** Claims shipped with the "could not be verified" notice. */
  unverifiedClaims: string[];
}

export interface DayPreview {
  courseTitle: string;
  dayNumber: number;
  days: number;
  theme: string;
  minutesPerDay: number;
  disclaimer: string | null;
  lessons: PreviewLesson[];
  /** Next day's theme, for the summary; null on the last day. */
  nextTheme: string | null;
}

const QUIZ_SECONDS_PER_QUESTION = 30;

export function buildDayPreview(course: CourseResult, dayNumber: number): DayPreview {
  const syllabus = course.syllabus.curriculum.syllabus;
  const day = syllabus.days[dayNumber - 1];
  if (!day) throw new Error(`The course has no day ${dayNumber} (it has ${syllabus.days.length})`);

  const lessons = course.lessons.flatMap((outcome): PreviewLesson[] => {
    if (outcome.status !== "ready") {
      if (outcome.dayNumber === dayNumber) throw new Error(`Day ${dayNumber} "${outcome.title}" failed to generate: ${outcome.error}`);
      return [];
    }
    const lesson = outcome.lesson;
    if (lesson.dayNumber !== dayNumber) return [];
    const { content } = lesson;
    if (!isCardLesson(content)) {
      throw new Error(`Day ${dayNumber} "${lesson.spec.title}" is a prose lesson (made before task 1.9): regenerate the course to preview it`);
    }
    const plan = videoPlan(content.activities, lesson.videos, lesson.slot.mediaMinutes);
    return [
      {
        title: lesson.spec.title,
        kind: lesson.spec.kind,
        estMinutes: lesson.slot.estMinutes,
        objectives: lesson.spec.objectives,
        cards: content.activities.map((card) => {
          const v = plan.get(card.id);
          return { card, seconds: cardSeconds(card, v?.fits ? (v.minutes ?? 0) : 0) };
        }),
        sources: lesson.sources,
        videos: lesson.videos.map((v, i) => {
          const placed = content.activities.find((c) => c.type === "video" && c.video === i + 1);
          const p = placed ? plan.get(placed.id) : undefined;
          return { title: v.title, url: v.url, excerpt: v.excerpt, minutes: p?.minutes ?? null, fits: p?.fits ?? false };
        }),
        quiz: lesson.quiz.questions,
        unverifiedClaims: lesson.factCheck.unverifiedClaims.map((i) => i.claim),
      },
    ];
  });
  if (!lessons.length) throw new Error(`Day ${dayNumber} has no ready lessons`);

  const sensitive = course.syllabus.plan.sensitiveDomain;
  return {
    courseTitle: syllabus.courseTitle,
    dayNumber,
    days: syllabus.days.length,
    theme: day.theme,
    minutesPerDay: course.intake.minutesPerDay,
    disclaimer: sensitive ? DISCLAIMERS[sensitive] : null,
    lessons,
    nextTheme: syllabus.days[dayNumber]?.theme ?? null,
  };
}

/** The whole day's estimated minutes: every card (videos that fit only) plus each lesson's quiz. */
export function previewMinutes(preview: DayPreview): number {
  const seconds = preview.lessons.reduce(
    (n, l) => n + l.cards.reduce((m, c) => m + c.seconds, 0) + l.quiz.length * QUIZ_SECONDS_PER_QUESTION,
    0,
  );
  return Math.round(seconds / 60);
}

/** Reading words across the day, for the preview's header note. */
export function previewReadingWords(preview: DayPreview): number {
  return preview.lessons.reduce((n, l) => n + l.cards.reduce((m, c) => m + readingWords(c.card), 0), 0);
}

/** Embeds the preview data in the player template; `</script` and `<!--` are escaped so the JSON can't end the script. */
export function renderPreviewHtml(template: string, preview: DayPreview): string {
  const marker = "/*__DAY_DATA__*/null";
  if (!template.includes(marker)) throw new Error(`The player template has no ${marker} marker`);
  // JSON allows U+2028/U+2029 inside strings; escape them too so older script parsers don't end the line.
  const json = JSON.stringify(preview)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return template.replace(marker, () => json);
}
