// Builders for mocked pipeline runs.
import type { CurriculumOutput, PlannerOutput } from "@/lib/pipeline/schemas";
import type { DayBudget } from "@/lib/pipeline/timeBudget";

import planner from "./planner.valid.json";

export const excelPlan = planner as PlannerOutput;

/** A syllabus that fits `budget` exactly, cycling through the plan's subtopics. */
export function syllabusFor(budget: DayBudget[], plan: PlannerOutput = excelPlan): CurriculumOutput {
  let n = 0;
  return {
    courseTitle: "Excel Essentials",
    courseSummary: "A hands-on introduction to Excel. You'll enter data, write formulas and build charts.",
    days: budget.map((day) => ({
      dayNumber: day.dayNumber,
      theme: `Day ${day.dayNumber} theme`,
      lessons: [
        ...day.lessons.map((slot) => {
          const subtopic = plan.subtopics[n++ % plan.subtopics.length]!.name;
          return {
            kind: "lesson" as const,
            title: `Lesson: ${subtopic}`,
            objectives: ["Explain the idea", "Apply it to a small table"],
            estMinutes: slot.estMinutes,
            subtopics: [subtopic],
            includesPractice: true,
          };
        }),
        ...(day.reviewMinutes > 0
          ? [
              {
                kind: "review" as const,
                title: `Review of days 1–${day.dayNumber - 1}`,
                objectives: ["Recall earlier material", "Apply it again"],
                estMinutes: day.reviewMinutes,
                subtopics: [plan.subtopics[0]!.name],
                includesPractice: false,
              },
            ]
          : []),
      ],
    })),
  };
}
