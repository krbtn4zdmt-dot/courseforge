// Phase 1 CLI (task 1.6): pnpm gen:course "<topic>" --days 3 --minutes 30 --level beginner [--goal understand] [--out out]
// Runs the whole pipeline and writes out/<slug>.json and out/<slug>.md.
// Needs ANTHROPIC_API_KEY, TAVILY_API_KEY, YOUTUBE_API_KEY, MODEL_SMART, MODEL_FAST (from .env.local).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatCostUsd } from "@/lib/llm/cost";
import { formatPercent, renderCourseMarkdown, slugify } from "@/lib/pipeline/courseOutput";
import { runCourse } from "@/lib/pipeline/runCourse";

import { INTAKE_OPTIONS, intakeFromArgs, parseArgs, seconds } from "./cli";

const USAGE = 'pnpm gen:course "<topic>" --days 3 --minutes 30 --level beginner [--goal understand] [--out out]';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { ...INTAKE_OPTIONS, out: { type: "string", default: "out" } },
});

async function main() {
  const intake = intakeFromArgs(positionals[0], values, USAGE);
  console.log(`Generating "${intake.topic}": ${intake.days} days × ${intake.minutesPerDay} min, ${intake.level}, ${intake.goal}\n`);

  const course = await runCourse(intake);
  const { stats } = course;

  const slug = slugify(intake.topic);
  await mkdir(values.out, { recursive: true });
  const jsonPath = path.join(values.out, `${slug}.json`);
  const mdPath = path.join(values.out, `${slug}.md`);
  await writeFile(jsonPath, JSON.stringify(course, null, 2));
  await writeFile(mdPath, renderCourseMarkdown(course));

  const t = stats.timings;
  const l = stats.lessons;
  console.log(`\n${course.syllabus.curriculum.syllabus.courseTitle}`);
  console.log(`Time:        ${seconds(t.totalMs)} (syllabus ${seconds(t.syllabusMs)}, deep research ${seconds(t.deepResearchMs)}, lessons ${seconds(t.lessonsMs)})`);
  console.log(`Cost:        ${formatCostUsd(stats.llm.costUsd)} over ${stats.llm.calls} LLM calls${stats.llm.unpricedCalls ? ` (${stats.llm.unpricedCalls} unpriced)` : ""}`);
  for (const [agent, a] of Object.entries(stats.llm.byAgent).sort((x, y) => y[1].costUsd - x[1].costUsd)) {
    console.log(`             ${agent.padEnd(13)} ${String(a.calls).padStart(3)} calls  ${formatCostUsd(a.costUsd)}`);
  }
  console.log(
    `Fact-check:  ${formatPercent(l.factCheckPassRate)} pass rate (${l.ready - l.shippedWithNotice}/${l.ready} lessons without a notice; ${l.rewritten} rewritten)`,
  );
  console.log(`Lessons:     ${l.ready}/${l.total} ready${l.failed ? `, ${l.failed} FAILED` : ""}`);
  console.log(`YouTube:     ${stats.youtubeUnits} quota units`);
  console.log(`Wrote        ${jsonPath}\n             ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
