import type {
  CurriculumItem,
  CurriculumOutput,
  FactCheckIssue,
  Level,
  SensitiveDomain,
} from "../schemas";
import type { LessonBudget, TopicType } from "../timeBudget";
import { joinSections, LEVEL_LABELS, section, systemPrompt, type PromptPair } from "./shared";

export type LessonSourceInput = { title: string; url: string; grounding: string };

export type LessonWriterPromptInput = {
  lesson: CurriculumItem;
  dayNumber: number;
  split: LessonBudget;
  syllabus: CurriculumOutput;
  /** Numbered in order: sources[0] is [1]. */
  sources: readonly LessonSourceInput[];
  level: Level;
  topicType: TopicType;
  sensitiveDomain: SensitiveDomain | null;
  /** Present on a rewrite after a failed fact-check. */
  factCheckIssues?: readonly FactCheckIssue[];
};

export const WORDS_PER_READING_MINUTE = { min: 150, max: 200 } as const;

const ROLE =
  "You are the lesson writer for CourseForge. Write one lesson of a personalized course, grounded in the numbered sources you are given.";

const RULES = [
  "Write in your own words. Never copy sentences from the sources. Quotes must be under 15 words and attributed to their source.",
  "Cite sources inline as [1], [2], … using the source numbers given. Every factual paragraph cites at least one source. Only cite numbers that appear in the source list.",
  "citedSourceIndexes lists every source number you cited, and only those.",
  "Match the reading level to the learner's level.",
  "Open with why this matters to the learner. End with a \"Recap\" section of exactly 3 bullets.",
  "Keep the reading length within the word range given in the input.",
  "Use markdown: short sections with ## headings, lists where they help. No top-level # title; the app shows the lesson title.",
  "keyTerms: the 3–6 most important terms from the lesson, each with a one-sentence definition in your own words.",
  "practiceTask: when the lesson includes practice, give concrete instructions the learner can do in the practice time and the outcome they should reach; otherwise null.",
  "For a review item, revisit the earlier material listed in its subtopics with recall prompts and brief summaries rather than new content.",
  "Do not write a disclaimer; the app adds one automatically for sensitive topics.",
];

const OUTPUT_SHAPE = `{
  "contentMd": string,                  // markdown; cite as [1], [2] matching source numbers
  "keyTerms": { "term": string, "definition": string }[],
  "practiceTask": { "instructions": string, "expectedOutcome": string } | null,
  "citedSourceIndexes": number[]
}`;

export const LESSON_WRITER_SYSTEM = systemPrompt(ROLE, RULES, OUTPUT_SHAPE);

export function readingWordRange(readingMinutes: number): { min: number; max: number } {
  return {
    min: readingMinutes * WORDS_PER_READING_MINUTE.min,
    max: readingMinutes * WORDS_PER_READING_MINUTE.max,
  };
}

function formatSyllabus(syllabus: CurriculumOutput): string {
  return syllabus.days
    .map((d) => `Day ${d.dayNumber} (${d.theme}): ${d.lessons.map((l) => l.title).join("; ")}`)
    .join("\n");
}

function formatSources(sources: readonly LessonSourceInput[]): string {
  if (sources.length === 0) return "(no sources: keep claims general and avoid specific facts you can't cite)";
  return sources
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.grounding.trim()}`)
    .join("\n\n");
}

export function lessonWriterPrompt(input: LessonWriterPromptInput): PromptPair {
  const { lesson, split } = input;
  const words = readingWordRange(split.readingMinutes);
  const sections = [
    section("Course", `${input.syllabus.courseTitle} (${input.topicType} topic)\n${formatSyllabus(input.syllabus)}`),
    section(
      "This lesson",
      [
        `Day ${input.dayNumber}, ${lesson.kind}: ${lesson.title}`,
        `Objectives:\n${lesson.objectives.map((o) => `- ${o}`).join("\n")}`,
        `Subtopics: ${lesson.subtopics.join(", ") || "(review of earlier days)"}`,
        `Includes practice: ${lesson.includesPractice ? "yes" : "no"}`,
      ].join("\n"),
    ),
    section(
      "Time split",
      `${split.estMinutes} minutes in total: reading ${split.readingMinutes}, videos ${split.mediaMinutes}, practice and quiz ${split.practiceMinutes}.\nReading length: ${words.min}–${words.max} words.`,
    ),
    section("Learner level", LEVEL_LABELS[input.level]),
    section("Sources", formatSources(input.sources)),
  ];
  if (input.sensitiveDomain) {
    sections.push(
      section(
        "Sensitive domain",
        `This is a ${input.sensitiveDomain} topic. Keep it educational, avoid personalized advice, and don't add your own disclaimer.`,
      ),
    );
  }
  if (input.factCheckIssues?.length) {
    sections.push(
      section(
        "Fix these fact-check issues",
        `A fact-check of your previous draft found these problems. Rewrite the lesson so every claim is supported by the sources, or remove it.\n${input.factCheckIssues
          .map((i) => `- (${i.problem}) ${i.claim} → ${i.suggestion}`)
          .join("\n")}`,
      ),
    );
  }
  return { system: LESSON_WRITER_SYSTEM, prompt: joinSections(...sections) };
}
