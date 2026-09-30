import { describe, expect, it } from "vitest";

import {
  computeTimeBudget,
  splitLesson,
  type DayBudget,
  type TopicType,
} from "@/lib/pipeline/timeBudget";

const TOPIC_TYPES: TopicType[] = ["knowledge", "skill", "hybrid"];

/** Compact view of a day: lesson minutes and review minutes. */
function shape(day: DayBudget) {
  return { lessons: day.lessons.map((l) => l.estMinutes), review: day.reviewMinutes };
}

describe("computeTimeBudget: worked examples (ARCHITECTURE.md, 5-day course)", () => {
  it.each([
    [
      15,
      [
        { lessons: [15], review: 0 },
        { lessons: [15], review: 0 },
        { lessons: [13], review: 2 },
        { lessons: [13], review: 2 },
        { lessons: [10], review: 5 },
      ],
    ],
    [
      30,
      [
        { lessons: [15, 15], review: 0 },
        { lessons: [15, 15], review: 0 },
        { lessons: [14, 13], review: 3 },
        { lessons: [14, 13], review: 3 },
        { lessons: [21], review: 9 },
      ],
    ],
    [
      90,
      [
        { lessons: [23, 23, 22, 22], review: 0 },
        { lessons: [23, 23, 22, 22], review: 0 },
        { lessons: [21, 20, 20, 20], review: 9 },
        { lessons: [21, 20, 20, 20], review: 9 },
        { lessons: [21, 21, 21], review: 27 },
      ],
    ],
  ])("%i min/day", (minutesPerDay, expected) => {
    const budget = computeTimeBudget({ days: 5, minutesPerDay, topicType: "knowledge" });
    expect(budget.map(shape)).toEqual(expected);
    expect(budget.map((d) => d.dayNumber)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("computeTimeBudget: course lengths", () => {
  it("1-day course follows the final-day rule", () => {
    expect(computeTimeBudget({ days: 1, minutesPerDay: 30, topicType: "knowledge" }).map(shape)).toEqual([
      { lessons: [21], review: 9 },
    ]);
    expect(computeTimeBudget({ days: 1, minutesPerDay: 15, topicType: "skill" }).map(shape)).toEqual([
      { lessons: [10], review: 5 },
    ]);
  });

  it("2-day course: day 1 has no review, day 2 gets the final review", () => {
    expect(computeTimeBudget({ days: 2, minutesPerDay: 60, topicType: "knowledge" }).map(shape)).toEqual([
      { lessons: [20, 20, 20], review: 0 },
      { lessons: [21, 21], review: 18 },
    ]);
  });

  it("7-day course: no review on days 1–2, 10% on days 3–6, 30% on day 7", () => {
    const budget = computeTimeBudget({ days: 7, minutesPerDay: 30, topicType: "knowledge" });
    expect(budget).toHaveLength(7);
    expect(budget.map((d) => d.reviewMinutes)).toEqual([0, 0, 3, 3, 3, 3, 9]);
  });

  it("30-day course: middle days are identical and only the last day differs", () => {
    const budget = computeTimeBudget({ days: 30, minutesPerDay: 45, topicType: "hybrid" });
    expect(budget).toHaveLength(30);
    const middle = budget.slice(2, 29).map(shape);
    expect(new Set(middle.map((d) => JSON.stringify(d))).size).toBe(1);
    // 45 × 10% = 4.5 rounds half-up to 5; teaching 40 → 2 lessons of 20.
    expect(middle[0]).toEqual({ lessons: [20, 20], review: 5 });
    // ceil(45 × 30%) = ceil(13.5) = 14; teaching 31 → 2 lessons 16, 15.
    expect(shape(budget[29]!)).toEqual({ lessons: [16, 15], review: 14 });
  });

  it("60-day course is supported", () => {
    expect(computeTimeBudget({ days: 60, minutesPerDay: 90, topicType: "skill" })).toHaveLength(60);
  });
});

describe("computeTimeBudget: review rounding", () => {
  it.each([
    // minutesPerDay, day-3 review (round 10%), final review (ceil 30%)
    [15, 2, 5], // 1.5 → 2, 4.5 → 5
    [25, 3, 8], // 2.5 → 3, 7.5 → 8
    [30, 3, 9], // exact values: 3 and 9 (no float drift to 10)
    [44, 4, 14], // 4.4 → 4, 13.2 → 14
    [60, 6, 18],
    [90, 9, 27],
  ])("%i min/day → review %i, final %i", (minutesPerDay, dayThree, final) => {
    const budget = computeTimeBudget({ days: 4, minutesPerDay, topicType: "knowledge" });
    expect(budget[2]?.reviewMinutes).toBe(dayThree);
    expect(budget[3]?.reviewMinutes).toBe(final);
  });
});

describe("splitLesson: topic types", () => {
  it("knowledge: 55/20/25", () => {
    expect(splitLesson(20, "knowledge")).toEqual({
      estMinutes: 20,
      readingMinutes: 11,
      mediaMinutes: 4,
      practiceMinutes: 5,
    });
  });

  it("skill: 45/15/40, more practice than knowledge for the same minutes", () => {
    const skill = splitLesson(20, "skill");
    expect(skill).toEqual({ estMinutes: 20, readingMinutes: 9, mediaMinutes: 3, practiceMinutes: 8 });
    expect(skill.practiceMinutes).toBeGreaterThan(splitLesson(20, "knowledge").practiceMinutes);
  });

  it("hybrid matches knowledge", () => {
    for (let est = 10; est <= 25; est++) {
      expect(splitLesson(est, "hybrid")).toEqual(splitLesson(est, "knowledge"));
    }
  });

  it("reading absorbs the rounding difference", () => {
    // 13 × 20% = 2.6 → 3, 13 × 25% = 3.25 → 3, reading = 13 − 3 − 3 = 7 (55% would be 7.15)
    expect(splitLesson(13, "knowledge")).toEqual({
      estMinutes: 13,
      readingMinutes: 7,
      mediaMinutes: 3,
      practiceMinutes: 3,
    });
    // 10 × 15% = 1.5 → 2 (half-up), 10 × 40% = 4, reading = 4
    expect(splitLesson(10, "skill")).toEqual({
      estMinutes: 10,
      readingMinutes: 4,
      mediaMinutes: 2,
      practiceMinutes: 4,
    });
  });
});

describe("computeTimeBudget: input validation", () => {
  it.each([
    [{ days: 0, minutesPerDay: 30 }, /days/],
    [{ days: 61, minutesPerDay: 30 }, /days/],
    [{ days: 2.5, minutesPerDay: 30 }, /days/],
    [{ days: 3, minutesPerDay: 14 }, /minutesPerDay/],
    [{ days: 3, minutesPerDay: 91 }, /minutesPerDay/],
    [{ days: 3, minutesPerDay: Number.NaN }, /minutesPerDay/],
  ])("rejects %j", (input, message) => {
    expect(() => computeTimeBudget({ ...input, topicType: "knowledge" })).toThrow(RangeError);
    expect(() => computeTimeBudget({ ...input, topicType: "knowledge" })).toThrow(message);
  });

  it("rejects an unknown topic type", () => {
    expect(() =>
      computeTimeBudget({ days: 3, minutesPerDay: 30, topicType: "trivia" as TopicType }),
    ).toThrow(RangeError);
  });
});

describe("computeTimeBudget: sweep", () => {
  it("every minutesPerDay 15–90 × every course length 1–60 × every topic type holds the invariants", () => {
    let daysChecked = 0;
    for (let minutesPerDay = 15; minutesPerDay <= 90; minutesPerDay++) {
      for (let days = 1; days <= 60; days++) {
        for (const topicType of TOPIC_TYPES) {
          const budget = computeTimeBudget({ days, minutesPerDay, topicType });
          expect(budget).toHaveLength(days);
          for (const day of budget) {
            const total = day.lessons.reduce((sum, l) => sum + l.estMinutes, 0) + day.reviewMinutes;
            if (total !== minutesPerDay) {
              throw new Error(`${minutesPerDay} min × ${days} days, day ${day.dayNumber}: sums to ${total}`);
            }
            if (day.lessons.length < 1 || day.lessons.length > 4) {
              throw new Error(`${minutesPerDay} min, day ${day.dayNumber}: ${day.lessons.length} lessons`);
            }
            for (const l of day.lessons) {
              if (l.estMinutes < 10 || l.estMinutes > 25) {
                throw new Error(`${minutesPerDay} min, day ${day.dayNumber}: ${l.estMinutes}-min lesson`);
              }
              if (l.readingMinutes + l.mediaMinutes + l.practiceMinutes !== l.estMinutes) {
                throw new Error(`${minutesPerDay} min, day ${day.dayNumber}: parts don't sum`);
              }
            }
            daysChecked++;
          }
        }
      }
    }
    // 76 values × (1 + 2 + … + 60) days × 3 topic types
    expect(daysChecked).toBe(76 * 1830 * 3);
  });
});
