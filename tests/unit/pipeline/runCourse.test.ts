import { describe, expect, it, vi } from "vitest";

import type { callJson } from "@/lib/llm/client";
import type { ResearchDeps } from "@/lib/pipeline/researcher";
import { generateSyllabus } from "@/lib/pipeline/runCourse";
import type { CompletedIntake } from "@/lib/pipeline/schemas";
import { buildTimeBudget } from "@/lib/pipeline/timeBudget";
import type { rateRelevance } from "@/lib/research/relevance";
import type { searchTavily } from "@/lib/research/tavily";

import { excelPlan, syllabusFor } from "../../fixtures/agents/builders";

const intake: CompletedIntake = { topic: "Excel for beginners", days: 7, minutesPerDay: 30, level: "beginner", goal: "practical_skill" };

describe("generateSyllabus", () => {
  it("runs planner → light research → curriculum and times each step", async () => {
    const order: string[] = [];
    const call = vi.fn(async (opts: Parameters<typeof callJson>[0]) => {
      order.push(opts.agent);
      return opts.agent === "planner" ? excelPlan : syllabusFor(buildTimeBudget({ days: 7, minutesPerDay: 30, topicType: "skill" }));
    }) as unknown as typeof callJson;
    const tavily = vi.fn(async ({ query }: Parameters<typeof searchTavily>[0]) => {
      order.push("tavily");
      return [{ url: `https://ex.com/${encodeURIComponent(query)}`, title: query, content: `${query}.`, rawContent: null, score: 1, publishedDate: null }];
    }) as unknown as typeof searchTavily;
    const relevance = vi.fn(async ({ items }: Parameters<typeof rateRelevance>[0]) => {
      order.push("relevance");
      return new Map(items.map((i) => [i.id, 0.8]));
    }) as unknown as typeof rateRelevance;
    const research: ResearchDeps = { searchTavily: tavily, rateRelevance: relevance };

    let t = 0;
    const clock = () => (t += 1000); // each clock() call advances 1s
    const result = await generateSyllabus(intake, { callJson: call, research, clock });

    expect(order).toEqual(["planner", ...Array(7).fill("tavily"), "relevance", "curriculum"]);
    expect(result.budget[0]!.lessons[0]).toEqual({ estMinutes: 15, readingMinutes: 7, mediaMinutes: 2, practiceMinutes: 6 }); // skill split
    expect(result.research).toHaveLength(7);
    expect(result.researchStats).toMatchObject({ mode: "light", webQueries: 7 });
    expect(result.curriculum).toMatchObject({ retried: false, snapped: false });
    expect(result.timings).toEqual({ plannerMs: 1000, lightResearchMs: 1000, curriculumMs: 1000, totalMs: 3000 });
  });
});
