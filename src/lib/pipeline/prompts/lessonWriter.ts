import "server-only";

import { DISCLAIMERS } from "@/lib/disclaimers";

import { MAX_WORDS_PER_PAGE, type CurriculumOutput, type FactCheckIssue, type Level, type SensitiveDomain, type SyllabusItem } from "../schemas";
import type { LessonSlot, TopicType } from "../timeBudget";
import { questionCount } from "./examiner";
import { bullets, LEVEL_LABELS, section, userPrompt, type PromptPair } from "./shared";

export interface LessonSource {
  title: string;
  url: string;
  grounding: string;
  /** True when only a short excerpt is available (no full passages). */
  excerptOnly?: boolean;
}

export interface LessonVideo {
  title: string;
  /** "Channel · 11 min" */
  excerpt: string;
}

export interface LessonWriterPromptInput {
  lesson: SyllabusItem;
  dayNumber: number;
  slot: LessonSlot;
  syllabus: CurriculumOutput;
  /** Numbered in order: sources[0] is [1]. */
  sources: LessonSource[];
  /** The lesson's curated videos, numbered in order: videos[0] is video 1. */
  videos: LessonVideo[];
  level: Level;
  topicType: TopicType;
  sensitiveDomain: SensitiveDomain | null;
  /** Set on a rewrite after a failed fact-check. */
  factCheckIssues?: FactCheckIssue[];
}

export const WORDS_PER_READING_MINUTE = { min: 150, max: 200 } as const;
/** Rough time per activity card, for telling the writer how many to write. */
export const SECONDS_PER_ACTIVITY = 55;
const QUIZ_SECONDS_PER_QUESTION = 30;

const SYSTEM = `You are the lesson writer for CourseForge. You write one interactive lesson, grounded in the numbered sources you are given: an ordered list of activity cards that teaches first and then puts the learner to work.

How a lesson is built:
- The lesson is a few parts. Each part teaches one idea and then uses it: an optional predict card (a guess before the teaching), a reading card, an optional video card, then 1–3 activity cards. Every card in a part has the same "part" title; keep a part's cards together, in that order.
- Reading cards teach: explain, give a concrete example, connect to what came before. Review never replaces teaching.
- Activity cards are predict, decide, match, order, mythFact, spotError, practiceStep and explainBack. Use at least 3 different types in the lesson, and pick the one that fits the idea: decide for judgement calls, order for sequences and procedures, match for terms and categories, spotError for common mistakes, mythFact for misconceptions, predict for surprising results.
- The first part opens with why this matters to the learner. At most one explainBack card, as the lesson's last card.
- Stay within the reading word range in the input (all reading pages together) and write about the number of activity cards it gives. The end-of-lesson quiz is written separately: don't write one.

Card types. Every card has "id" ("c1", "c2", ...), "type", "part" and "cites" (the source numbers the card relies on), plus:
- reading: "title"; "pages": 2–3 pages of at most ${MAX_WORDS_PER_PAGE} words each, in markdown (short paragraphs, a list or a small table when it helps; no headings).
- video: "video" (the number of one of the lesson's videos); "watchFor": 2–3 short things to notice, taken from what this lesson teaches. Place each video at most once, after the reading of the part it fits, and use at least one when videos are listed.
- predict: "prompt"; "options" (2–4); "answer" (0-based index of the right option); "reveal" (one or two sentences on why).
- decide: "scenario" (a short, realistic situation); "options" (2–4, each { "text", "outcome", "best" }, exactly one best). Each outcome says what would happen and why.
- match: "prompt"; "pairs" (3–6, each { "left", "right" }).
- order: "prompt"; "items" (3–6, in the correct order); "explain".
- mythFact: "items" (2–4, each { "statement", "fact", "why" }), with at least one myth; "why" gives the truth.
- spotError: "prompt"; "segments" (3–5 short sentences or steps; exactly one contains a realistic mistake); "errorIndex" (0-based); "correction"; "why".
- practiceStep: "instructions"; "expectedOutcome"; "minutes". Only when the input says practice is included, and then at least one.
- explainBack: "prompt" (explain an idea in 2–3 sentences, as if to a friend); "keyPoints" (exactly 3); "modelAnswer".

Rules:
- Original wording only. Never copy sentences from the sources. Quotes must be under 15 words and attributed to their author or source.
- Every card except video and practiceStep cites at least one source in "cites", using only the source numbers given. In reading pages, also cite inline as [n] after the facts each one supports; every inline number must be in the card's "cites". Answers, outcomes, reveals, "why" fields, corrections and model answers follow the same sourcing rule as the pages. Don't state facts the sources don't support, except common knowledge at the learner's level.
- Deliberately wrong content (wrong options, myths, the spotError mistake) is plausible but clearly wrong by the sources, and the card states the truth.
- Match the reading level to the learner's level.
- For a review item, revisit the listed subtopics from earlier days with short recap readings and more activities; the final day's review is the course review.
- keyTerms: 3–8 terms the lesson introduces or relies on, each with a one-sentence definition in your own words.
- If a disclaimer is given in the input, the first page of the first reading card is that disclaimer, word for word, as a blockquote, and nothing else.
- If fact-check issues are given, fix every one wherever it appears (pages, options, outcomes, answers): correct or remove contradicted and outdated claims, and either support unsupported claims with a source or remove them.

Output JSON shape:
{
  "activities": [{ "id": string, "type": string, "part": string, "cites": number[], ...the fields for its type }],
  "keyTerms": [{ "term": string, "definition": string }]
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

/** Practice-step minutes when the lesson includes practice: about a third of the activity time, at least 2. */
export function practiceStepMinutes(slot: LessonSlot): number {
  return Math.max(2, Math.floor(slot.practiceMinutes / 3));
}

/** About how many activity cards fill the activity time once the quiz (and any practice step) is taken out. */
export function activityCardTarget(slot: LessonSlot, objectiveCount: number, includesPractice: boolean): number {
  const seconds =
    slot.practiceMinutes * 60 -
    questionCount(objectiveCount) * QUIZ_SECONDS_PER_QUESTION -
    (includesPractice ? practiceStepMinutes(slot) * 60 : 0);
  return Math.max(2, Math.round(seconds / SECONDS_PER_ACTIVITY));
}

function timePlan({ lesson, slot }: LessonWriterPromptInput): string {
  const minWords = slot.readingMinutes * WORDS_PER_READING_MINUTE.min;
  const maxWords = slot.readingMinutes * WORDS_PER_READING_MINUTE.max;
  const readingCards = Math.max(1, Math.round((minWords + maxWords) / 2 / 200));
  return [
    `Total: ${slot.estMinutes} min (reading ${slot.readingMinutes}, videos ${slot.mediaMinutes}, activities, practice and quiz ${slot.practiceMinutes}).`,
    `Reading: ${minWords}–${maxWords} words across all reading pages, about ${readingCards} reading card${readingCards === 1 ? "" : "s"} (so about ${readingCards} part${readingCards === 1 ? "" : "s"}).`,
    `Activities: about ${activityCardTarget(slot, lesson.objectives.length, lesson.includesPractice)} activity cards, not counting practice steps.`,
    `Practice included: ${lesson.includesPractice ? `yes, practiceStep cards totalling about ${practiceStepMinutes(slot)} minutes` : "no (no practiceStep cards)"}.`,
  ].join("\n");
}

export function buildLessonWriterPrompt(input: LessonWriterPromptInput): PromptPair {
  const { lesson, slot } = input;

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
    section("Time", timePlan(input)),
    section(
      "Videos",
      input.videos.length
        ? input.videos.map((v, i) => `${i + 1}. ${v.title} (${v.excerpt})`).join("\n") +
            `\nVideo budget: ${slot.mediaMinutes} min. A longer video is offered as "save for later", so place it anyway, but teach everything in the reading too.`
        : null,
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
