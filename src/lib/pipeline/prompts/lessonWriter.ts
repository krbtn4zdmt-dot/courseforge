import "server-only";

import { DISCLAIMERS } from "@/lib/disclaimers";

import type { CurriculumOutput, FactCheckIssue, Level, SensitiveDomain, SyllabusItem } from "../schemas";
import type { LessonSlot, TopicType } from "../timeBudget";
import { bullets, LEVEL_LABELS, section, userPrompt, type PromptPair } from "./shared";

export interface LessonSource {
  title: string;
  url: string;
  grounding: string;
  /** True when only a short excerpt is available (no full passages). */
  excerptOnly?: boolean;
}

export interface LessonWriterPromptInput {
  lesson: SyllabusItem;
  dayNumber: number;
  slot: LessonSlot;
  syllabus: CurriculumOutput;
  /** Numbered in order: sources[0] is [1]. */
  sources: LessonSource[];
  level: Level;
  topicType: TopicType;
  sensitiveDomain: SensitiveDomain | null;
  /** Set on a rewrite after a failed fact-check. */
  factCheckIssues?: FactCheckIssue[];
}

export const WORDS_PER_READING_MINUTE = { min: 150, max: 200 } as const;

const SYSTEM = `You are the lesson writer for CourseForge. You write one lesson of a personalized course, grounded in the numbered sources you are given.

Rules:
- Original wording only. Never copy sentences from the sources. Quotes must be under 15 words and attributed to their author or source.
- Every factual section cites at least one source inline as [n], using the source numbers given. Cite only those numbers. Don't state facts the sources don't support, except common knowledge at the learner's level.
- Match the reading level to the learner's level.
- Open with why this matters to the learner. End with a "Recap" heading followed by exactly 3 bullet points.
- Length: stay within the word range given in the input. The rest of the lesson time is for videos, practice and the quiz, so don't pad.
- Use markdown: short sections with ## headings, lists and tables where they help. No top-level # heading (the app shows the title).
- For a review item, write spaced-recall material that revisits the listed subtopics from earlier days rather than teaching new material; the final day's review is the course review.
- keyTerms: 3–8 terms the lesson introduces or relies on, each with a one-sentence definition in your own words.
- practiceTask: when the input says practice is included, a concrete task that fits the practice time, with clear instructions and the expected outcome; otherwise null.
- citedSourceIndexes: every source number you cited inline, and no others.
- If a disclaimer is given in the input, start the lesson with it word for word, as a blockquote.
- If fact-check issues are given, fix every one: correct or remove contradicted and outdated claims, and either support unsupported claims with a source or remove them.

Output JSON shape:
{
  "contentMd": string,
  "keyTerms": [{ "term": string, "definition": string }],
  "practiceTask": { "instructions": string, "expectedOutcome": string } | null,
  "citedSourceIndexes": number[]
}`;

function formatOutline(syllabus: CurriculumOutput): string {
  return syllabus.days
    .map((d) => `Day ${d.dayNumber} (${d.theme}): ${d.lessons.map((l) => l.title).join("; ")}`)
    .join("\n");
}

function formatSources(sources: LessonSource[]): string {
  return sources
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.excerptOnly ? "Excerpt only (cite for what it says, nothing more)" : "Passages"}:\n${s.grounding}`)
    .join("\n\n---\n\n");
}

export function buildLessonWriterPrompt(input: LessonWriterPromptInput): PromptPair {
  const { lesson, slot } = input;
  const minWords = slot.readingMinutes * WORDS_PER_READING_MINUTE.min;
  const maxWords = slot.readingMinutes * WORDS_PER_READING_MINUTE.max;

  const sections = [
    section("Course", `${input.syllabus.courseTitle} (${input.topicType})\n${input.syllabus.courseSummary}`),
    section("Course outline (for context)", formatOutline(input.syllabus)),
    section(
      "This item",
      [
        `Day ${input.dayNumber}: ${lesson.title} (${lesson.kind})`,
        `Objectives:\n${bullets(lesson.objectives)}`,
        `Subtopics: ${lesson.subtopics.join(", ")}`,
        `Learner level: ${LEVEL_LABELS[input.level]}`,
      ].join("\n"),
    ),
    section(
      "Time",
      [
        `Total: ${slot.estMinutes} min (reading ${slot.readingMinutes}, videos ${slot.mediaMinutes}, practice and quiz ${slot.practiceMinutes}).`,
        `Written lesson length: ${minWords}–${maxWords} words.`,
        `Practice included: ${lesson.includesPractice ? `yes, about ${slot.practiceMinutes} minutes including the quiz` : "no (practiceTask must be null)"}.`,
      ].join("\n"),
    ),
    section("Disclaimer", input.sensitiveDomain ? DISCLAIMERS[input.sensitiveDomain] : null),
    section("Sources", formatSources(input.sources)),
  ];
  if (input.factCheckIssues?.length) {
    sections.push(
      section(
        "Fact-check issues to fix in this rewrite",
        input.factCheckIssues
          .map((i) => `- [${i.problem}] "${i.claim}". Suggestion: ${i.suggestion}`)
          .join("\n"),
      ),
    );
  }
  return { system: SYSTEM, prompt: userPrompt(...sections) };
}
