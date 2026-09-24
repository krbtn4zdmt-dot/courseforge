// Live checks for tasks 1.3–1.6: pnpm check:live [--from <step>] [--only <step>] [--skip-preflight]
// Preflight (env vars set, API hosts reachable), then each check in order; stops at the first failure.
// Output of every step is saved to out/live-checks/<timestamp>/<n>-<name>.log.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const REQUIRED_ENV = ["ANTHROPIC_API_KEY", "TAVILY_API_KEY", "YOUTUBE_API_KEY", "MODEL_SMART", "MODEL_FAST"];
const HOSTS = ["https://api.anthropic.com", "https://api.tavily.com", "https://www.googleapis.com", "https://en.wikipedia.org"];

interface Step {
  name: string;
  task: string;
  args: string[];
}

const STEPS: Step[] = [
  { name: "research-smoke", task: "1.3", args: ["research:smoke", "Alexander the Great"] },
  {
    name: "excel-syllabus",
    task: "1.4",
    args: ["gen:syllabus", "Excel for beginners", "--days", "7", "--minutes", "30", "--level", "beginner", "--goal", "practical_skill", "--out", "out/excel-syllabus.json"],
  },
  { name: "excel-day1-lesson1", task: "1.5", args: ["gen:lesson", "--from", "out/excel-syllabus.json", "--day", "1", "--lesson", "1"] },
  { name: "course-alexander", task: "1.6", args: ["gen:course", "Alexander the Great", "--days", "3", "--minutes", "30", "--level", "beginner"] },
  {
    name: "course-excel",
    task: "1.6",
    args: ["gen:course", "Excel for beginners", "--days", "7", "--minutes", "30", "--level", "beginner", "--goal", "practical_skill"],
  },
  { name: "course-black-holes", task: "1.6", args: ["gen:course", "How black holes work", "--days", "2", "--minutes", "30", "--level", "beginner"] },
  {
    name: "audit-courses",
    task: "1.6",
    args: ["audit:course", "out/alexander-the-great.json", "out/excel-for-beginners.json", "out/how-black-holes-work.json"],
  },
];

const { values } = parseArgs({
  options: { from: { type: "string", default: "1" }, only: { type: "string" }, "skip-preflight": { type: "boolean", default: false } },
});

async function preflight(): Promise<string[]> {
  const problems = REQUIRED_ENV.filter((v) => !process.env[v]).map((v) => `${v} is not set`);
  await Promise.all(
    HOSTS.map(async (host) => {
      try {
        // Any response from the real host means reachable; an egress proxy's denial carries x-deny-reason.
        const res = await fetch(host, { method: "HEAD", signal: AbortSignal.timeout(8_000) });
        const denied = res.headers.get("x-deny-reason");
        if (denied) problems.push(`${new URL(host).host} is blocked by the network policy (${denied})`);
      } catch (err) {
        problems.push(`${new URL(host).host} is unreachable (${err instanceof Error ? (err.cause as Error)?.message ?? err.message : String(err)})`);
      }
    }),
  );
  return problems;
}

function run(step: Step, logFile: string): Promise<number> {
  return new Promise((resolve) => {
    const log = createWriteStream(logFile);
    log.write(`$ pnpm ${step.args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}\n\n`);
    const child = spawn("pnpm", ["-s", ...step.args], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk: Buffer) => {
        process.stdout.write(chunk);
        log.write(chunk);
      });
    }
    child.on("close", (code) => log.end(() => resolve(code ?? 1)));
  });
}

async function main() {
  const problems = values["skip-preflight"] ? [] : await preflight();
  if (problems.length) {
    console.error(`Preflight failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    console.error("Set the variables in .env.local (or the cloud environment settings) and allow the hosts, then rerun.");
    process.exit(1);
  }
  console.log("Preflight OK: env vars set, API hosts reachable.\n");

  const dir = path.join("out", "live-checks", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(dir, { recursive: true });
  const from = Number(values.from);
  const only = values.only ? Number(values.only) : undefined;
  const results: { step: Step; n: number; code: number; seconds: number }[] = [];

  for (const [i, step] of STEPS.entries()) {
    const n = i + 1;
    if (only ? n !== only : n < from) continue;
    console.log(`\n━━ ${n}/${STEPS.length} [task ${step.task}] ${step.name} ━━`);
    const started = Date.now();
    const code = await run(step, path.join(dir, `${n}-${step.name}.log`));
    results.push({ step, n, code, seconds: (Date.now() - started) / 1000 });
    if (code !== 0) break;
  }

  console.log(`\n━━ Summary (logs in ${dir}) ━━`);
  for (const r of results) console.log(`  ${r.code === 0 ? "✓" : "✗"} ${r.n}. [${r.step.task}] ${r.step.name} (${r.seconds.toFixed(1)}s)`);
  const failed = results.find((r) => r.code !== 0);
  if (failed) {
    console.log(`\nStopped at step ${failed.n}. Fix it, then resume with: pnpm check:live --from ${failed.n}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
