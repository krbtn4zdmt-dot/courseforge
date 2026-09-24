import { describe, expect, it } from "vitest";

import {
  buildTimeBudget,
  reviewMinutesFor,
  splitEvenly,
  splitLesson,
  type DayBudget,
  type TopicType,
} from "@/lib/pipeline/timeBudget";

const lessonMinutes = (day: DayBudget) => day.lessons.map((l) => l.estMinutes);
const dayTotal = (day: DayBudget) =>
  day.reviewMinutes + day.lessons.reduce((sum, l) => sum + l.estMinutes, 0);

describe("worked examples (5-day course, docs/ARCHITECTURE.md)", () => {
  it.each([
    { m: 15, early: [15], mid: [13], midReview: 2, final: [10], finalReview: 5 },
    { m: 30, early: [15, 15], mid: [14, 13], midReview: 3, final: [21], finalReview: 9 },
    { m: 90, early: [23, 23, 22, 22], mid: [21, 20, 20, 20], midReview: 9, final: [21, 21, 21], finalReview: 27 },
  ])("$m min/day", ({ m, early, mid, midReview, final, finalReview }) => {
    const budget = buildTimeBudget({ days: 5, minutesPerDay: m, topicType: "knowledge" });

    expect(budget.map((d) => d.dayNumber)).toEqual([1, 2, 3, 4, 5]);
    for (const day of budget.slice(0, 2)) {
      expect(lessonMinutes(day)).toEqual(early);
      expect(day.reviewMinutes).toBe(0);
    }
    for (const day of budget.slice(2, 4)) {
      expect(lessonMinutes(day)).toEqual(mid);
      expect(day.reviewMinutes).toBe(midReview);
    }
    expect(lessonMinutes(budget[4]!)).toEqual(final);
    expect(budget[4]!.reviewMinutes).toBe(finalReview);
  });
});

describe("course lengths", () => {
  it("1-day course follows the final-day rule", () => {
    const [day, ...rest] = buildTimeBudget({ days: 1, minutesPerDay: 30, topicType: "knowledge" });
    expect(rest).toHaveLength(0);
    expect(day!.reviewMinutes).toBe(9);
    expect(lessonMinutes(day!)).toEqual([21]);
  });

  it("2-day course: no review on day 1, final review on day 2", () => {
    const budget = buildTimeBudget({ days: 2, minutesPerDay: 60, topicType: "knowledge" });
    expect(budget[0]!.reviewMinutes).toBe(0);
    expect(lessonMinutes(budget[0]!)).toEqual([20, 20, 20]);
    expect(budget[1]!.reviewMinutes).toBe(18);
    expect(lessonMinutes(budget[1]!)).toEqual([21, 21]);
  });

  it("7-day course: review from day 3, 30% review on day 7", () => {
    const budget = buildTimeBudget({ days: 7, minutesPerDay: 45, topicType: "skill" });
    expect(budget.map((d) => d.reviewMinutes)).toEqual([0, 0, 5, 5, 5, 5, 14]);
    expect(lessonMinutes(budget[0]!)).toEqual([23, 22]);
    expect(lessonMinutes(budget[2]!)).toEqual([20, 20]);
    expect(lessonMinutes(budget[6]!)).toEqual([16, 15]);
  });

  it("30-day course: days 3–29 identical, day 30 is the final day", () => {
    const budget = buildTimeBudget({ days: 30, minutesPerDay: 60, topicType: "hybrid" });
    expect(budget).toHaveLength(30);
    const middle = budget.slice(2, 29);
    for (const day of middle) {
      expect(day.reviewMinutes).toBe(6);
      expect(day.lessons).toEqual(middle[0]!.lessons);
    }
    expect(lessonMinutes(middle[0]!)).toEqual([18, 18, 18]);
    expect(budget[29]!.reviewMinutes).toBe(18);
  });

  it("60-day course is allowed", () => {
    expect(buildTimeBudget({ days: 60, minutesPerDay: 15, topicType: "knowledge" })).toHaveLength(60);
  });
});

describe("lesson split by topic type", () => {
  it("knowledge: 55% reading, 20% media, 25% practice + quiz", () => {
    expect(splitLesson(20, "knowledge")).toEqual({
      estMinutes: 20,
      readingMinutes: 11,
      mediaMinutes: 4,
      practiceMinutes: 5,
    });
  });

  it("skill: 45% reading, 15% media, 40% practice + quiz", () => {
    expect(splitLesson(20, "skill")).toEqual({
      estMinutes: 20,
      readingMinutes: 9,
      mediaMinutes: 3,
      practiceMinutes: 8,
    });
  });

  it("skill vs knowledge on the same lesson length differ only in the split", () => {
    const knowledge = buildTimeBudget({ days: 3, minutesPerDay: 30, topicType: "knowledge" });
    const skill = buildTimeBudget({ days: 3, minutesPerDay: 30, topicType: "skill" });
    expect(skill.map(lessonMinutes)).toEqual(knowledge.map(lessonMinutes));
    expect(skill[0]!.lessons[0]!.practiceMinutes).toBeGreaterThan(knowledge[0]!.lessons[0]!.practiceMinutes);
    expect(skill[0]!.lessons[0]!.readingMinutes).toBeLessThan(knowledge[0]!.lessons[0]!.readingMinutes);
  });

  it("hybrid uses the knowledge split", () => {
    for (let est = 10; est <= 25; est++) {
      expect(splitLesson(est, "hybrid")).toEqual(splitLesson(est, "knowledge"));
    }
  });

  it("gives the rounding difference to reading", () => {
    // 15 min knowledge: media 3, practice round(3.75) = 4, reading takes the rest (8, not round(8.25))
    expect(splitLesson(15, "knowledge")).toEqual({
      estMinutes: 15,
      readingMinutes: 8,
      mediaMinutes: 3,
      practiceMinutes: 4,
    });
    // 10 min knowledge: practice round(2.5) = 3 (half-up), reading 5
    expect(splitLesson(10, "knowledge").readingMinutes).toBe(5);
  });
});

describe("helpers", () => {
  it("splitEvenly gives leftovers to the earliest parts", () => {
    expect(splitEvenly(90, 4)).toEqual([23, 23, 22, 22]);
    expect(splitEvenly(81, 4)).toEqual([21, 20, 20, 20]);
    expect(splitEvenly(30, 2)).toEqual([15, 15]);
    expect(splitEvenly(13, 1)).toEqual([13]);
  });

  it("reviewMinutesFor: none on days 1–2, round(10%) from day 3, ceil(30%) on the final day", () => {
    expect(reviewMinutesFor(1, 5, 45)).toBe(0);
    expect(reviewMinutesFor(2, 5, 45)).toBe(0);
    expect(reviewMinutesFor(3, 5, 45)).toBe(5); // 4.5 rounds half-up
    expect(reviewMinutesFor(3, 5, 44)).toBe(4);
    expect(reviewMinutesFor(5, 5, 45)).toBe(14); // ceil(13.5)
    expect(reviewMinutesFor(1, 1, 45)).toBe(14);
    expect(reviewMinutesFor(2, 2, 20)).toBe(6); // ceil of an exact 6 stays 6
  });
});

describe("invariant sweep", () => {
  const dayCounts = [1, 2, 3, 5, 7, 30, 60];
  const topicTypes: TopicType[] = ["knowledge", "skill", "hybrid"];

  it("every minutesPerDay 15–90: each day sums exactly and every lesson is 10–25 min", () => {
    let checkedDays = 0;
    for (let minutesPerDay = 15; minutesPerDay <= 90; minutesPerDay++) {
      for (const days of dayCounts) {
        for (const topicType of topicTypes) {
          const budget = buildTimeBudget({ days, minutesPerDay, topicType });
          expect(budget).toHaveLength(days);
          for (const day of budget) {
            checkedDays++;
            expect(dayTotal(day)).toBe(minutesPerDay);
            expect(day.lessons.length).toBeGreaterThanOrEqual(1);
            expect(day.lessons.length).toBeLessThanOrEqual(4);
            const minutes = lessonMinutes(day);
            expect([...minutes].sort((a, b) => b - a)).toEqual(minutes);
            for (const lesson of day.lessons) {
              expect(lesson.estMinutes).toBeGreaterThanOrEqual(10);
              expect(lesson.estMinutes).toBeLessThanOrEqual(25);
              expect(lesson.readingMinutes + lesson.mediaMinutes + lesson.practiceMinutes).toBe(
                lesson.estMinutes,
              );
              expect(Math.min(lesson.readingMinutes, lesson.mediaMinutes, lesson.practiceMinutes)).toBeGreaterThan(0);
            }
          }
        }
      }
    }
    expect(checkedDays).toBe(76 * 108 * 3);
  });
});

describe("input validation", () => {
  it.each([
    { days: 0, minutesPerDay: 30 },
    { days: 61, minutesPerDay: 30 },
    { days: 2.5, minutesPerDay: 30 },
    { days: 3, minutesPerDay: 14 },
    { days: 3, minutesPerDay: 91 },
    { days: 3, minutesPerDay: 30.5 },
    { days: Number.NaN, minutesPerDay: 30 },
  ])("rejects days=$days minutesPerDay=$minutesPerDay", ({ days, minutesPerDay }) => {
    expect(() => buildTimeBudget({ days, minutesPerDay, topicType: "knowledge" })).toThrow(RangeError);
  });

  it("rejects an unknown topic type", () => {
    expect(() =>
      buildTimeBudget({ days: 3, minutesPerDay: 30, topicType: "trivia" as TopicType }),
    ).toThrow(RangeError);
  });
});
