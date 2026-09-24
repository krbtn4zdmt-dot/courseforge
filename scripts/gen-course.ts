// Phase 1 CLI: pnpm gen:course "<topic>" --days 3 --minutes 30 --level beginner
// Stub until task 1.6 wires it to runCourse (see docs/BUILD_PLAN.md).
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    days: { type: "string", default: "3" },
    minutes: { type: "string", default: "30" },
    level: { type: "string", default: "beginner" },
  },
});

const topic = positionals[0];
if (!topic) {
  console.error('Usage: pnpm gen:course "<topic>" --days 3 --minutes 30 --level beginner');
  process.exit(1);
}

console.log(
  `gen:course is not implemented yet (task 1.6). Parsed: topic="${topic}", days=${values.days}, minutes=${values.minutes}, level=${values.level}`,
);
