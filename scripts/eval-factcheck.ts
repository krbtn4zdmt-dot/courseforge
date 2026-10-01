// Fact-checker eval: pnpm eval:factcheck [--corpus out/eval/factcheck] [--labels evals/factcheck/labels.json]
//   [--model fast|smart] [--reps 1] [--concurrency 4] [--rescore out/eval/factcheck-<time>.json]
// Re-runs only the fact-checker on hand-labeled shipped lessons and reports false alarms (supported claims
// flagged), real problems caught, unlabeled issues, lessons that would be rewritten, and cost.
// --rescore re-scores a saved run against the current labels without calling the API.
// The corpus is course JSON from gen:course runs, named <course>.json; it isn't committed (third-party text).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { callJson, type ModelTier } from "@/lib/llm/client";
import { formatCostUsd, type LlmCallLog } from "@/lib/llm/cost";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  EvalLabelsFileSchema,
  factCheckInputFor,
  findLesson,
  scoreFactCheck,
  type CaseScore,
  type EvalCase,
} from "@/lib/pipeline/factCheckEval";
import { factCheckLesson } from "@/lib/pipeline/factChecker";
import type { CourseResult } from "@/lib/pipeline/runCourse";
import type { FactCheckIssue } from "@/lib/pipeline/schemas";

const { values } = parseArgs({
  options: {
    corpus: { type: "string", default: "out/eval/factcheck" },
    labels: { type: "string", default: "evals/factcheck/labels.json" },
    model: { type: "string" },
    reps: { type: "string", default: "1" },
    concurrency: { type: "string", default: "4" },
    rescore: { type: "string" },
  },
});

interface Run {
  testCase: EvalCase;
  rep: number;
  passed: boolean;
  issues: FactCheckIssue[];
  /** The model's raw findings, including "supported" ones that become no issue. */
  findings: unknown;
  score: CaseScore;
}

function parseModel(value: string | undefined): ModelTier | undefined {
  if (value === undefined || value === "fast" || value === "smart") return value;
  throw new Error(`--model must be fast or smart, not "${value}"`);
}

async function runChecks(cases: readonly EvalCase[], model: ModelTier | undefined, reps: number): Promise<{ runs: Run[]; costUsd: number }> {
  const courses = new Map<string, CourseResult>();
  for (const name of new Set(cases.map((c) => c.course))) {
    courses.set(name, JSON.parse(await readFile(path.join(values.corpus, `${name}.json`), "utf8")) as CourseResult);
  }
  const logs: LlmCallLog[] = [];
  const jobs = cases.flatMap((testCase) => Array.from({ length: reps }, (_, rep) => ({ testCase, rep })));
  const runs = await mapWithConcurrency(jobs, Number(values.concurrency), async ({ testCase, rep }): Promise<Run> => {
    const course = courses.get(testCase.course)!;
    const lesson = findLesson(course, testCase.day, testCase.position);
    let findings: unknown = null;
    const result = await factCheckLesson(factCheckInputFor(course, lesson), {
      callJson: async (opts) => {
        const output = await callJson({ ...opts, model: model ?? opts.model });
        findings = output;
        return output;
      },
      onUsage: (log) => logs.push(log),
    });
    return { testCase, rep, passed: result.passed, issues: result.issues, findings, score: scoreFactCheck(result.issues, testCase.labels) };
  });
  return { runs, costUsd: logs.reduce((n, l) => n + (l.costUsd ?? 0), 0) };
}

/** Saved runs re-scored against the current labels (cases are matched by course, day and position). */
function rescoreRuns(saved: readonly Run[], cases: readonly EvalCase[]): Run[] {
  return saved.map((r) => {
    const testCase = cases.find((c) => c.course === r.testCase.course && c.day === r.testCase.day && c.position === r.testCase.position);
    if (!testCase) throw new Error(`No label case for ${r.testCase.course} day ${r.testCase.day} item ${r.testCase.position + 1}`);
    return { ...r, testCase, score: scoreFactCheck(r.issues, testCase.labels) };
  });
}

async function main() {
  const model = parseModel(values.model);
  const reps = Number(values.reps);
  if (!Number.isInteger(reps) || reps < 1) throw new Error("--reps must be a positive integer");
  const { cases } = EvalLabelsFileSchema.parse(JSON.parse(await readFile(values.labels, "utf8")));

  let runs: Run[];
  let cost: string;
  let modelName: string;
  if (values.rescore) {
    const saved = JSON.parse(await readFile(values.rescore, "utf8")) as { summary: { model: string; cost: string }; runs: Run[] };
    runs = rescoreRuns(saved.runs, cases);
    [cost, modelName] = [saved.summary.cost, saved.summary.model];
  } else {
    const result = await runChecks(cases, model, reps);
    [runs, cost, modelName] = [result.runs, formatCostUsd(result.costUsd), model ?? "default"];
  }

  for (const r of runs) {
    const { course, day, position } = r.testCase;
    const s = r.score;
    console.log(
      `${`${course} d${day}i${position + 1}`.padEnd(18)} ${r.passed ? "pass" : "FAIL"}  ` +
        `false alarms ${s.falseAlarms.length}  caught ${s.caught.length}/${s.caught.length + s.missed.length}  unlabeled ${s.unlabeled.length}`,
    );
    for (const i of r.issues) console.log(`    [${i.problem}] ${i.claim.slice(0, 140)}`);
  }

  const sum = (f: (r: Run) => number) => runs.reduce((n, r) => n + f(r), 0);
  const supported = sum((r) => r.testCase.labels.filter((l) => l.truth === "supported").length);
  const errors = sum((r) => r.testCase.labels.filter((l) => l.truth === "error").length);
  const clean = runs.filter((r) => r.testCase.labels.length === 0);
  const summary = {
    model: modelName,
    runs: runs.length,
    failed: runs.filter((r) => !r.passed).length,
    falseAlarms: `${sum((r) => r.score.falseAlarms.length)}/${supported}`,
    caught: `${sum((r) => r.score.caught.length)}/${errors}`,
    unlabeledIssues: sum((r) => r.score.unlabeled.length),
    cleanLessonsFailed: `${clean.filter((r) => !r.passed).length}/${clean.length}`,
    cost,
  };
  console.log("\nSummary");
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(18)} ${v}`);
  if (values.rescore) return;

  const outDir = path.join("out", "eval");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `factcheck-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(outFile, JSON.stringify({ summary, runs }, null, 2));
  console.log(`  results            ${outFile}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
