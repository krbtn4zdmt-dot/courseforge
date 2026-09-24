import { describe, expect, it, vi } from "vitest";

import type { callJson } from "@/lib/llm/client";
import { planCourse, slotBudget } from "@/lib/pipeline/planner";
import { PlannerOutputSchema, type CompletedIntake } from "@/lib/pipeline/schemas";

import { excelPlan } from "../../fixtures/agents/builders";

const intake: CompletedIntake = { topic: "Excel for beginners", days: 7, minutesPerDay: 30, level: "beginner", goal: "practical_skill" };

describe("planCourse", () => {
  it("calls the smart model with the planner prompt and schema", async () => {
    const call = vi.fn(async () => excelPlan) as unknown as typeof callJson;
    const onUsage = vi.fn();
    const plan = await planCourse(intake, { callJson: call, onUsage });

    expect(plan).toBe(excelPlan);
    const opts = vi.mocked(call).mock.calls[0]![0];
    expect(opts).toMatchObject({ agent: "planner", model: "smart", schema: PlannerOutputSchema, onUsage });
    expect(opts.prompt).toContain("Excel for beginners");
    expect(opts.prompt).toContain("13 lesson slots"); // 7 days × 30 min: 2+2+2+2+2+2+1
  });

  it("warns when the plan has far more subtopics than lesson slots", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const big = {
      ...excelPlan,
      subtopics: Array.from({ length: 30 }, (_, i) => ({ name: `S${i}`, importance: 2 as const, prerequisites: [] })),
    };
    await planCourse({ ...intake, days: 1 }, { callJson: (async () => big) as unknown as typeof callJson });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("30 subtopics for 1 lesson slots"));
    warn.mockRestore();
  });

  it("slotBudget has the same lesson counts whatever the topic type", () => {
    expect(slotBudget(intake).map((d) => d.lessons.length)).toEqual([2, 2, 2, 2, 2, 2, 1]);
  });
});
