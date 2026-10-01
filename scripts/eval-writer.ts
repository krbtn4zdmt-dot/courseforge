// Lesson-writer eval: pnpm eval:writer [--corpus out/eval/factcheck] [--cases evals/writer/cases.json]
//   [--reps 1] [--concurrency 3] [--draft-model fast|smart] [--writer-effort low|medium|high]
// Drafts each case's lesson again from its stored sources and outline, then reports whether the draft repeats
// the known bad fact, whether it passes the fact-checker (no rewrite), and the cost. Uses the corpus of the
// fact-checker eval (course JSON named <course>.json; not committed).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { mapWithConcurrency } from "@/lib/concurrency";
import { formatCostUsd, type LlmCallLog } from "@/lib/llm/cost";
import { findLesson } from "@/lib/pipeline/factCheckEval";
import { cardCitations, renderCardsText } from "@/lib/pipeline/cards";
import { citedFactCheckSources, factCheckLesson } from "@/lib/pipeline/factChecker";
import { writeLesson } from "@/lib/pipeline/lessonWriter";
import type { CourseResult } from "@/lib/pipeline/runCourse";
import type { FactCheckIssue } from "@/lib/pipeline/schemas";
import { badFactsIn, writerInputFor, WriterEvalFileSchema, type WriterEvalCase } from "@/lib/pipeline/writerEval";

import { WRITER_OPTIONS, writerFromArgs } from "./cli";

const { values } = parseArgs({
  options: {
    corpus: { type: "string", default: "out/eval/factcheck" },
    cases: { type: "string", default: "evals/writer/cases.json" },
    reps: { type: "string", default: "1" },
    concurrency: { type: "string", default: "3" },
    ...WRITER_OPTIONS,
  },
});

interface Run {
  testCase: WriterEvalCase;
  rep: number;
  badFacts: string[];
  passed: boolean;
  issues: FactCheckIssue[];
  contentMd: string;
}

async function main() {
  const writer = writerFromArgs(values);
  const reps = Number(values.reps);
  if (!Number.isInteger(reps) || reps < 1) throw new Error("--reps must be a positive integer");
  const { cases } = WriterEvalFileSchema.parse(JSON.parse(await readFile(values.cases, "utf8")));
  const courses = new Map<string, CourseResult>();
  for (const name of new Set(cases.map((c) => c.course))) {
    courses.set(name, JSON.parse(await readFile(path.join(values.corpus, `${name}.json`), "utf8")) as CourseResult);
  }

  const logs: LlmCallLog[] = [];
  const onUsage = (log: LlmCallLog) => logs.push(log);
  const jobs = cases.flatMap((testCase) => Array.from({ length: reps }, (_, rep) => ({ testCase, rep })));
  const runs = await mapWithConcurrency(jobs, Number(values.concurrency), async ({ testCase, rep }): Promise<Run> => {
    const course = courses.get(testCase.course)!;
    const input = writerInputFor(course, findLesson(course, testCase.day, testCase.position));
    const content = await writeLesson(input, { onUsage }, { tier: writer.draftTier, effort: writer.effort });
    const text = renderCardsText(content.activities, input.videos);
    const check = await factCheckLesson(
      { contentMd: text, sources: citedFactCheckSources(input.sources, cardCitations(content.activities)), level: input.level },
      { onUsage },
    );
    return { testCase, rep, badFacts: badFactsIn(text, testCase.badFacts), passed: check.passed, issues: check.issues, contentMd: text };
  });

  for (const r of runs) {
    const { course, day, position } = r.testCase;
    console.log(
      `${`${course} d${day}i${position + 1}`.padEnd(18)} ${r.badFacts.length ? "REPEATS BAD FACT" : "no bad fact     "}  ` +
        `fact-check ${r.passed ? "pass" : "FAIL"}`,
    );
    for (const i of r.issues) console.log(`    [${i.problem}] ${i.claim.slice(0, 140)}`);
  }
  const cost = (agent: string) => logs.filter((l) => l.agent === agent).reduce((n, l) => n + (l.costUsd ?? 0), 0);
  const summary = {
    writer: `${writer.draftTier}${writer.effort ? ` (${writer.effort})` : ""}`,
    drafts: runs.length,
    repeatBadFact: runs.filter((r) => r.badFacts.length).length,
    factCheckFailed: runs.filter((r) => !r.passed).length,
    writerCost: formatCostUsd(cost("lessonWriter")),
    checkerCost: formatCostUsd(cost("factChecker")),
  };
  console.log("\nSummary");
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(16)} ${v}`);

  const outDir = path.join("out", "eval");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `writer-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(outFile, JSON.stringify({ summary, runs }, null, 2));
  console.log(`  results          ${outFile}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
