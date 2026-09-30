// Phase 1 CLI. TODO(task 1.6): run the pipeline via runCourse and write out/<slug>.json and .md.
import { parseGenCourseArgs, USAGE } from "./genCourseArgs";

const result = parseGenCourseArgs(process.argv.slice(2));

if (!result.ok) {
  console.error(`Error: ${result.error}\n${USAGE}`);
  process.exit(1);
}

console.log("gen:course is a stub until task 1.6. Parsed arguments:");
console.log(JSON.stringify(result.args, null, 2));
