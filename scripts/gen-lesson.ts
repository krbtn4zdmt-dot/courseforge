// One-lesson CLI (task 1.5):
//   pnpm gen:lesson "Excel for beginners" --days 7 --minutes 30 --level beginner --goal practical_skill --day 1 --lesson 1
//   pnpm gen:lesson --from out/excel.json --day 1 --lesson 1      (reuse a `gen:syllabus --out` result)
// Runs the syllabus (unless --from), deep research, then one lesson: write → fact-check → rewrite once → quiz.
import { readFile } from "node:fs/promises";

import { formatCostUsd, type LlmCallLog } from "@/lib/llm/cost";
import { research } from "@/lib/pipeline/researcher";
import { generateLesson, generateSyllabus, type SyllabusResult } from "@/lib/pipeline/runCourse";
import type { CompletedIntake } from "@/lib/pipeline/schemas";

import { INTAKE_OPTIONS, intakeFromArgs, parseArgs, seconds } from "./cli";

const USAGE = 'pnpm gen:lesson "<topic>" --days 7 --minutes 30 --level beginner --goal understand --day 1 --lesson 1';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { ...INTAKE_OPTIONS, from: { type: "string" }, day: { type: "string", default: "1" }, lesson: { type: "string", default: "1" } },
});

async function main() {
  const logs: LlmCallLog[] = [];
  const onUsage = (l: LlmCallLog) => logs.push(l);
  const started = Date.now();

  let intake: CompletedIntake;
  let syllabus: SyllabusResult;
  if (values.from) {
    const saved = JSON.parse(await readFile(values.from, "utf8")) as SyllabusResult & { intake: CompletedIntake };
    ({ intake } = saved);
    syllabus = saved;
  } else {
    intake = intakeFromArgs(positionals[0], values, USAGE);
    syllabus = await generateSyllabus(intake, { onUsage });
  }

  const deepStarted = Date.now();
  const deep = await research({ topic: intake.topic, plan: syllabus.plan, mode: "deep", previous: syllabus.research }, { onUsage });
  const lessonStarted = Date.now();
  const dayNumber = Number(values.day);
  const lesson = await generateLesson(
    {
      intake,
      plan: syllabus.plan,
      syllabus: syllabus.curriculum.syllabus,
      budget: syllabus.budget,
      research: deep.output,
      dayNumber,
      position: Number(values.lesson) - 1,
    },
    { onUsage },
  );
  const done = Date.now();

  const { spec, slot, content, factCheck } = lesson;
  const rule = "─".repeat(72);
  console.log(`\n${rule}\nDay ${dayNumber} · ${spec.kind === "review" ? "Review" : `Lesson ${lesson.position + 1}`}: ${spec.title}`);
  console.log(`${slot.estMinutes} min (reading ${slot.readingMinutes}, videos ${slot.mediaMinutes}, practice + quiz ${slot.practiceMinutes})`);
  console.log(`Objectives:\n${spec.objectives.map((o) => `  - ${o}`).join("\n")}\n${rule}\n`);

  if (factCheck.unverifiedClaims.length) {
    console.log(`⚠ Some claims could not be verified:\n${factCheck.unverifiedClaims.map((i) => `  - ${i.claim}`).join("\n")}\n`);
  }
  console.log(content.contentMd);
  console.log(`\nSources`);
  for (const s of lesson.sources) console.log(`  [${s.index}] ${s.title}\n      ${s.url}`);
  if (lesson.videos.length) {
    console.log(`\nVideos`);
    for (const v of lesson.videos) console.log(`  ${v.title} (${v.excerpt})\n      ${v.url}`);
  }
  console.log(`\nKey terms`);
  for (const t of content.keyTerms) console.log(`  ${t.term}: ${t.definition}`);
  if (content.practiceTask) {
    console.log(`\nPractice\n  ${content.practiceTask.instructions}\n  Expected: ${content.practiceTask.expectedOutcome}`);
  }
  console.log(`\nQuiz`);
  lesson.quiz.questions.forEach((q, i) => {
    console.log(`  ${i + 1}. ${q.prompt}`);
    for (const o of q.options) console.log(`     ${o.id === q.correctOptionId ? "✓" : " "} ${o.id}) ${o.text}`);
    console.log(`     ${q.explanation}`);
  });

  console.log(`\n${rule}`);
  console.log(
    `Fact-check: ${factCheck.passed ? "passed" : "FAILED (shipped with notice)"}; ${factCheck.issues.length} issue(s); ` +
      `${factCheck.rewritten ? "rewritten once" : "no rewrite"}`,
  );
  for (const i of factCheck.issues) console.log(`  - [${i.problem}] ${i.claim}`);
  console.log(`Deep research: ${deep.stats.webQueries} queries (${deep.stats.failedQueries.length} failed), ${deep.stats.youtubeUnits} YouTube units`);
  console.log(
    `Time: ${values.from ? "" : `syllabus ${seconds(deepStarted - started)} + `}deep research ${seconds(lessonStarted - deepStarted)} + lesson ${seconds(done - lessonStarted)}`,
  );
  console.log(`LLM: ${logs.length} calls, ${formatCostUsd(logs.reduce((n, l) => n + (l.costUsd ?? 0), 0))}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
