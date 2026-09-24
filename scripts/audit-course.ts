// Mechanical quality audit of generated courses: pnpm audit:course out/<slug>.json [more.json ...]
// Checks pacing, length, citations per section, quote length, verbatim copying, source credibility,
// quiz answer balance and the SPEC targets. Accuracy and clarity still need a human (or /test-course).
import { readFile } from "node:fs/promises";

import { formatCostUsd } from "@/lib/llm/cost";
import { auditCourse, SPEC_TARGETS } from "@/lib/pipeline/courseAudit";
import { formatPercent } from "@/lib/pipeline/courseOutput";
import type { CourseResult } from "@/lib/pipeline/runCourse";

const mark = (ok: boolean | null) => (ok === null ? "–" : ok ? "✓" : "✗");

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error("Usage: pnpm audit:course out/<slug>.json [more.json ...]");

  for (const file of files) {
    const course = JSON.parse(await readFile(file, "utf8")) as CourseResult;
    const audit = auditCourse(course);
    const t = audit.targets;
    const title = course.syllabus.curriculum.syllabus.courseTitle;
    console.log(`\n━━ ${title} (${file}) ━━`);
    console.log(`${course.intake.days} days × ${course.intake.minutesPerDay} min · ${audit.lessons.length} lessons audited`);
    console.log(`SPEC targets`);
    console.log(`  ${mark(t.syllabusOk)} syllabus in ${t.syllabusSeconds.toFixed(1)}s (target < ${SPEC_TARGETS.syllabusMs / 1000}s)`);
    console.log(`  ${mark(t.flagRateOk)} flag rate ${formatPercent(t.flagRate)} (target < ${formatPercent(SPEC_TARGETS.flagRate)})`);
    console.log(`  ${mark(t.costOk)} ${formatCostUsd(t.costPer7DaysUsd)} per 7 days at this pace (target < ${formatCostUsd(SPEC_TARGETS.costPer7DayCourseUsd)})`);
    const lengths = audit.lessons.map((l) => l.words);
    if (lengths.length) {
      console.log(`Lessons: ${Math.min(...lengths)}–${Math.max(...lengths)} words; videos per lesson ${audit.lessons.map((l) => l.videos).join(",")}`);
    }
    console.log(`Quiz answers: ${JSON.stringify(audit.quizAnswerSpread)}${audit.disclaimerNeeded ? " · sensitive topic: disclaimer shown" : ""}`);
    if (audit.problems.length) {
      console.log(`Problems (${audit.problems.length})`);
      for (const p of audit.problems) console.log(`  - ${p}`);
    } else {
      console.log("No mechanical problems found.");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
