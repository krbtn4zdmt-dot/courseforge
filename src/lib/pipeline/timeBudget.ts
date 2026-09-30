// Time-budget engine (pure function). Implements "Time-budget engine" in docs/ARCHITECTURE.md:
// decides how many minutes each day gets and how they're split. The Curriculum Designer
// fills in the content for each slot.
//
// All math is integer arithmetic so rounding never depends on floating-point error
// (e.g. 30 * 0.3 is not exactly 9).

export type TopicType = "knowledge" | "skill" | "hybrid";

export type TimeBudgetInput = {
  days: number;
  minutesPerDay: number;
  topicType: TopicType;
};

export type LessonBudget = {
  /** The whole lesson: reading, media, practice and quiz. */
  estMinutes: number;
  readingMinutes: number;
  mediaMinutes: number;
  practiceMinutes: number;
};

export type DayBudget = {
  dayNumber: number;
  /** The review item (kind "review"); 0 means the day has no review item. */
  reviewMinutes: number;
  lessons: LessonBudget[];
};

export const MIN_DAYS = 1;
export const MAX_DAYS = 60;
export const MIN_MINUTES_PER_DAY = 15;
export const MAX_MINUTES_PER_DAY = 90;
export const MIN_LESSON_MINUTES = 10;
export const MAX_LESSON_MINUTES = 25;
export const MAX_LESSONS_PER_DAY = 4;

/** Percent of a lesson for media and practice + quiz; reading gets the rest. */
export const LESSON_SPLIT: Record<TopicType, { mediaPct: number; practicePct: number }> = {
  knowledge: { mediaPct: 20, practicePct: 25 },
  hybrid: { mediaPct: 20, practicePct: 25 },
  skill: { mediaPct: 15, practicePct: 40 },
};

/** round(value × pct / 100), half-up, for non-negative integers. */
function roundPct(value: number, pct: number): number {
  return Math.floor((value * pct * 2 + 100) / 200);
}

/** ceil(value × pct / 100) for non-negative integers. */
function ceilPct(value: number, pct: number): number {
  return Math.ceil((value * pct) / 100);
}

function assertIntInRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a whole number from ${min} to ${max} (got ${value})`);
  }
}

/** Rule 1: days 1–2 none; day 3+ 10% (round); final day 30% (ceil), which replaces the 10%. */
export function reviewMinutesFor(dayNumber: number, days: number, minutesPerDay: number): number {
  if (dayNumber === days) return ceilPct(minutesPerDay, 30);
  if (dayNumber <= 2) return 0;
  return roundPct(minutesPerDay, 10);
}

/** Rule 3: clamp(ceil(teaching / 25), 1, 4) lessons, split evenly, leftovers to the earliest. */
export function splitTeachingMinutes(teachingMinutes: number): number[] {
  const count = Math.min(
    MAX_LESSONS_PER_DAY,
    Math.max(1, Math.ceil(teachingMinutes / MAX_LESSON_MINUTES)),
  );
  const base = Math.floor(teachingMinutes / count);
  const leftover = teachingMinutes - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < leftover ? 1 : 0));
}

/** Rule 4: split a lesson by topic type; reading absorbs the rounding difference. */
export function splitLesson(estMinutes: number, topicType: TopicType): LessonBudget {
  const { mediaPct, practicePct } = LESSON_SPLIT[topicType];
  const mediaMinutes = roundPct(estMinutes, mediaPct);
  const practiceMinutes = roundPct(estMinutes, practicePct);
  return {
    estMinutes,
    readingMinutes: estMinutes - mediaMinutes - practiceMinutes,
    mediaMinutes,
    practiceMinutes,
  };
}

function assertDayInvariants(day: DayBudget, minutesPerDay: number): void {
  const lessonTotal = day.lessons.reduce((sum, l) => sum + l.estMinutes, 0);
  if (lessonTotal + day.reviewMinutes !== minutesPerDay) {
    throw new Error(`timeBudget: day ${day.dayNumber} sums to ${lessonTotal + day.reviewMinutes}, not ${minutesPerDay}`);
  }
  for (const l of day.lessons) {
    if (l.estMinutes < MIN_LESSON_MINUTES || l.estMinutes > MAX_LESSON_MINUTES) {
      throw new Error(`timeBudget: day ${day.dayNumber} has a ${l.estMinutes}-minute lesson`);
    }
    if (l.readingMinutes + l.mediaMinutes + l.practiceMinutes !== l.estMinutes || l.readingMinutes < 0) {
      throw new Error(`timeBudget: day ${day.dayNumber} lesson parts don't sum to ${l.estMinutes}`);
    }
  }
}

export function computeTimeBudget({ days, minutesPerDay, topicType }: TimeBudgetInput): DayBudget[] {
  assertIntInRange("days", days, MIN_DAYS, MAX_DAYS);
  assertIntInRange("minutesPerDay", minutesPerDay, MIN_MINUTES_PER_DAY, MAX_MINUTES_PER_DAY);
  if (!(topicType in LESSON_SPLIT)) throw new RangeError(`Unknown topicType: ${String(topicType)}`);

  return Array.from({ length: days }, (_, i) => {
    const dayNumber = i + 1;
    const reviewMinutes = reviewMinutesFor(dayNumber, days, minutesPerDay);
    const lessons = splitTeachingMinutes(minutesPerDay - reviewMinutes).map((est) =>
      splitLesson(est, topicType),
    );
    const day = { dayNumber, reviewMinutes, lessons };
    assertDayInvariants(day, minutesPerDay);
    return day;
  });
}
