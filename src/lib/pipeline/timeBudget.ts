import "server-only";

// Time-budget engine: decides how many minutes each day gets and how they're split.
// Rules and worked examples: docs/ARCHITECTURE.md, "Time-budget engine".
// Integer arithmetic throughout (e.g. m * 3 / 10, not m * 0.3) so float error can't shift a ceil or round.

export type TopicType = "knowledge" | "skill" | "hybrid";

export interface TimeBudgetInput {
  days: number;
  minutesPerDay: number;
  topicType: TopicType;
}

export interface LessonSlot {
  estMinutes: number;
  readingMinutes: number;
  mediaMinutes: number;
  practiceMinutes: number;
}

export interface DayBudget {
  dayNumber: number;
  reviewMinutes: number;
  lessons: LessonSlot[];
}

export const MIN_DAYS = 1;
export const MAX_DAYS = 60;
export const MIN_MINUTES_PER_DAY = 15;
export const MAX_MINUTES_PER_DAY = 90;
export const MIN_LESSON_MINUTES = 10;
export const MAX_LESSON_MINUTES = 25;
export const MAX_LESSONS_PER_DAY = 4;

// Percentages of a lesson's estMinutes. Reading takes whatever rounding leaves.
const SPLIT_PERCENT: Record<TopicType, { media: number; practice: number }> = {
  knowledge: { media: 20, practice: 25 },
  hybrid: { media: 20, practice: 25 },
  skill: { media: 15, practice: 40 },
};

/** Days 1–2: none. Day 3+: round(10%). Final day (including a 1-day course): ceil(30%). */
export function reviewMinutesFor(dayNumber: number, days: number, minutesPerDay: number): number {
  if (dayNumber === days) return Math.ceil((minutesPerDay * 3) / 10);
  if (dayNumber <= 2) return 0;
  return Math.round(minutesPerDay / 10);
}

/** Splits total into `parts` whole numbers as evenly as possible, earliest parts get the leftovers. */
export function splitEvenly(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const leftover = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < leftover ? 1 : 0));
}

export function splitLesson(estMinutes: number, topicType: TopicType): LessonSlot {
  const pct = SPLIT_PERCENT[topicType];
  const mediaMinutes = Math.round((estMinutes * pct.media) / 100);
  const practiceMinutes = Math.round((estMinutes * pct.practice) / 100);
  return {
    estMinutes,
    readingMinutes: estMinutes - mediaMinutes - practiceMinutes,
    mediaMinutes,
    practiceMinutes,
  };
}

function lessonCount(teachingMinutes: number): number {
  return Math.min(Math.max(Math.ceil(teachingMinutes / MAX_LESSON_MINUTES), 1), MAX_LESSONS_PER_DAY);
}

function validateInput({ days, minutesPerDay, topicType }: TimeBudgetInput): void {
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    throw new RangeError(`days must be an integer from ${MIN_DAYS} to ${MAX_DAYS}, got ${days}`);
  }
  if (
    !Number.isInteger(minutesPerDay) ||
    minutesPerDay < MIN_MINUTES_PER_DAY ||
    minutesPerDay > MAX_MINUTES_PER_DAY
  ) {
    throw new RangeError(
      `minutesPerDay must be an integer from ${MIN_MINUTES_PER_DAY} to ${MAX_MINUTES_PER_DAY}, got ${minutesPerDay}`,
    );
  }
  if (!Object.hasOwn(SPLIT_PERCENT, topicType)) {
    throw new RangeError(`unknown topicType "${topicType}"`);
  }
}

function assertDayInvariants(day: DayBudget, minutesPerDay: number): void {
  const total = day.reviewMinutes + day.lessons.reduce((sum, l) => sum + l.estMinutes, 0);
  if (total !== minutesPerDay) {
    throw new Error(`time budget: day ${day.dayNumber} sums to ${total}, expected ${minutesPerDay}`);
  }
  for (const lesson of day.lessons) {
    if (lesson.estMinutes < MIN_LESSON_MINUTES || lesson.estMinutes > MAX_LESSON_MINUTES) {
      throw new Error(
        `time budget: day ${day.dayNumber} has a ${lesson.estMinutes}-min lesson (allowed ${MIN_LESSON_MINUTES}–${MAX_LESSON_MINUTES})`,
      );
    }
  }
}

export function buildTimeBudget(input: TimeBudgetInput): DayBudget[] {
  validateInput(input);
  const { days, minutesPerDay, topicType } = input;

  return Array.from({ length: days }, (_, i) => {
    const dayNumber = i + 1;
    const reviewMinutes = reviewMinutesFor(dayNumber, days, minutesPerDay);
    const teachingMinutes = minutesPerDay - reviewMinutes;
    const lessons = splitEvenly(teachingMinutes, lessonCount(teachingMinutes)).map((est) =>
      splitLesson(est, topicType),
    );
    const day = { dayNumber, reviewMinutes, lessons };
    assertDayInvariants(day, minutesPerDay);
    return day;
  });
}
