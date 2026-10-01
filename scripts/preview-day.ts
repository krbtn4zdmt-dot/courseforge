// Local day preview (task 1.9): pnpm preview:day out/<slug>.json --day 2 [--out out/preview/<slug>-day2.html]
// Writes one self-contained HTML page that plays a generated day card by card (the player in
// scripts/preview/player.html, built on the Day 2 prototypes). No API calls; open the file in a browser.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { slugify } from "@/lib/pipeline/courseOutput";
import { buildDayPreview, previewMinutes, previewReadingWords, renderPreviewHtml } from "@/lib/pipeline/dayPreview";
import type { CourseResult } from "@/lib/pipeline/runCourse";

import { parseArgs } from "./cli";

const USAGE = "pnpm preview:day out/<slug>.json --day 2 [--out out/preview/<slug>-day2.html]";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { day: { type: "string", default: "1" }, out: { type: "string" } },
});

async function main() {
  const file = positionals[0];
  if (!file) throw new Error(`Usage: ${USAGE}`);
  const day = Number(values.day);
  if (!Number.isInteger(day) || day < 1) throw new Error("--day must be a positive integer");

  const course = JSON.parse(await readFile(file, "utf8")) as CourseResult;
  const preview = buildDayPreview(course, day);
  const template = await readFile(path.join("scripts", "preview", "player.html"), "utf8");
  const out = values.out ?? path.join("out", "preview", `${slugify(course.intake.topic)}-day${day}.html`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, renderPreviewHtml(template, preview));

  const cards = preview.lessons.reduce((n, l) => n + l.cards.length, 0);
  console.log(`${preview.courseTitle}, day ${day}: ${preview.theme}`);
  console.log(`${preview.lessons.length} lessons, ${cards} cards, ${previewReadingWords(preview)} reading words, about ${previewMinutes(preview)} of ${preview.minutesPerDay} min`);
  console.log(`Wrote ${out}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
