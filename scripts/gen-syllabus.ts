// Syllabus CLI (task 1.4): pnpm gen:syllabus "Excel for beginners" --days 7 --minutes 30 --level beginner --goal practical_skill
// Needs ANTHROPIC_API_KEY, TAVILY_API_KEY, MODEL_SMART, MODEL_FAST (from .env.local).
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { formatCostUsd, type LlmCallLog } from "@/lib/llm/cost";
import { generateSyllabus, SYLLABUS_TARGET_MS } from "@/lib/pipeline/runCourse";
import { GOALS, LEVELS, MINUTES_PER_DAY_OPTIONS, type CompletedIntake } from "@/lib/pipeline/schemas";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    days: { type: "string", default: "7" },
    minutes: { type: "string", default: "30" },
    level: { type: "string", default: "beginner" },
    goal: { type: "string", default: "understand" },
    out: { type: "string" },
  },
});

function oneOf<const A extends readonly (string | number)[]>(name: string, value: string | number, allowed: A): A[number] {
  const match = allowed.find((a) => a === value);
  if (match === undefined) throw new Error(`--${name} must be one of ${allowed.join(", ")}; got ${value}`);
  return match;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

async function main() {
  const topic = positionals[0];
  if (!topic) throw new Error('Usage: pnpm gen:syllabus "<topic>" --days 7 --minutes 30 --level beginner --goal understand');
  const intake: CompletedIntake = {
    topic,
    days: Number(values.days),
    minutesPerDay: oneOf("minutes", Number(values.minutes), MINUTES_PER_DAY_OPTIONS),
    level: oneOf("level", values.level!, LEVELS),
    goal: oneOf("goal", values.goal!, GOALS),
  };

  const logs: LlmCallLog[] = [];
  const result = await generateSyllabus(intake, { onUsage: (l) => logs.push(l) });
  const { plan, curriculum, timings, researchStats } = result;
  const s = curriculum.syllabus;

  console.log(`\n${s.courseTitle}`);
  console.log(`${s.courseSummary}\n`);
  console.log(`Topic type: ${plan.topicType}${plan.sensitiveDomain ? ` (sensitive: ${plan.sensitiveDomain})` : ""}; ${plan.subtopics.length} subtopics\n`);
  for (const day of s.days) {
    const total = day.lessons.reduce((n, l) => n + l.estMinutes, 0);
    console.log(`Day ${day.dayNumber}: ${day.theme} (${total} min)`);
    for (const item of day.lessons) {
      console.log(`  ${String(item.estMinutes).padStart(2)} min  ${item.kind === "review" ? "[review] " : ""}${item.title}${item.includesPractice ? "  ✎ practice" : ""}`);
      for (const o of item.objectives) console.log(`           - ${o}`);
    }
  }

  const cost = logs.reduce((n, l) => n + (l.costUsd ?? 0), 0);
  console.log(`\nCurriculum: ${curriculum.retried ? "retried once" : "fit on first try"}${curriculum.snapped ? ", minutes snapped to slots" : ""}`);
  if (curriculum.remainingProblems.length) console.log(`  remaining: ${curriculum.remainingProblems.join("; ")}`);
  console.log(`Light research: ${researchStats.webQueries} queries, ${researchStats.failedQueries.length} failed`);
  console.log(
    `Time: planner ${seconds(timings.plannerMs)} + light research ${seconds(timings.lightResearchMs)} + curriculum ${seconds(timings.curriculumMs)} = ${seconds(timings.totalMs)} ` +
      `(target < ${seconds(SYLLABUS_TARGET_MS)}${timings.totalMs > SYLLABUS_TARGET_MS ? ", MISSED" : ""})`,
  );
  console.log(`LLM: ${logs.length} calls, ${formatCostUsd(cost)}`);

  if (values.out) {
    await mkdir("out", { recursive: true });
    await writeFile(values.out, JSON.stringify(result, null, 2));
    console.log(`Wrote ${values.out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
