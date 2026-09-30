// Zod schemas for every agent output in docs/AGENTS.md, plus the shared enums and types.
// Schemas enforce what can be checked from the output alone. Checks that need other
// context (time-budget slots, which sources exist, fact-check pass/fail) live in the agents.
import { z } from "zod";

import type { TopicType } from "./timeBudget";

// ---------------------------------------------------------------------------
// Shared enums

export const LEVELS = ["beginner", "some_exposure", "refresher"] as const;
export type Level = (typeof LEVELS)[number];

export const GOALS = ["understand", "pass_test", "practical_skill"] as const;
export type Goal = (typeof GOALS)[number];

export const MINUTES_PER_DAY_OPTIONS = [15, 30, 45, 60, 90] as const;

export const TOPIC_TYPES = ["knowledge", "skill", "hybrid"] as const satisfies readonly TopicType[];

export const SENSITIVE_DOMAINS = ["medical", "legal", "financial", "safety"] as const;
export type SensitiveDomain = (typeof SENSITIVE_DOMAINS)[number];

export const SOURCE_TYPES = ["web", "video", "wiki", "docs"] as const;

const text = z.string().trim().min(1);

// ---------------------------------------------------------------------------
// Course request: a completed intake, and what the pipeline runs on.

export const CourseRequestSchema = z.object({
  topic: text,
  days: z.number().int().min(1).max(60),
  minutesPerDay: z.number().int().min(15).max(90),
  level: z.enum(LEVELS),
  goal: z.enum(GOALS),
});
export type CourseRequest = z.infer<typeof CourseRequestSchema>;

// ---------------------------------------------------------------------------
// 1. Intake

export const IntakeResultSchema = z
  .object({
    topic: text.nullable(),
    days: z.number().int().min(1).max(60).nullable(),
    minutesPerDay: z.literal(MINUTES_PER_DAY_OPTIONS).nullable(),
    level: z.enum(LEVELS).nullable(),
    goal: z.enum(GOALS).nullable(),
    isAllowed: z.boolean(),
    refusalMessage: text.nullable(),
    nextQuestion: text.nullable(),
  })
  .superRefine((v, ctx) => {
    if (!v.isAllowed && v.refusalMessage === null) {
      ctx.addIssue({ code: "custom", path: ["refusalMessage"], message: "Required when isAllowed is false" });
    }
    if (v.isAllowed && v.refusalMessage !== null) {
      ctx.addIssue({ code: "custom", path: ["refusalMessage"], message: "Must be null when isAllowed is true" });
    }
    const missing = [v.topic, v.days, v.minutesPerDay, v.level, v.goal].some((f) => f === null);
    if (v.isAllowed && missing && v.nextQuestion === null) {
      ctx.addIssue({
        code: "custom",
        path: ["nextQuestion"],
        message: "Required while any of topic, days, minutesPerDay, level, goal is null",
      });
    }
  });
export type IntakeResult = z.infer<typeof IntakeResultSchema>;

// ---------------------------------------------------------------------------
// 2. Planner

export const SubtopicSchema = z.object({
  name: text,
  importance: z.literal([1, 2, 3]),
  prerequisites: z.array(text),
});

export const PlannerOutputSchema = z
  .object({
    topicType: z.enum(TOPIC_TYPES),
    sensitiveDomain: z.enum(SENSITIVE_DOMAINS).nullable(),
    subtopics: z.array(SubtopicSchema).min(1),
    searchQueries: z.array(
      z.object({
        subtopic: text,
        queries: z.array(text).min(2).max(3),
      }),
    ),
    commonMisconceptions: z.array(text),
  })
  .superRefine((v, ctx) => {
    const names = new Set<string>();
    v.subtopics.forEach((s, i) => {
      if (names.has(s.name)) {
        ctx.addIssue({ code: "custom", path: ["subtopics", i, "name"], message: `Duplicate subtopic "${s.name}"` });
      }
      names.add(s.name);
    });
    v.subtopics.forEach((s, i) => {
      s.prerequisites.forEach((p, j) => {
        if (p === s.name) {
          ctx.addIssue({ code: "custom", path: ["subtopics", i, "prerequisites", j], message: "A subtopic can't be its own prerequisite" });
        } else if (!names.has(p)) {
          ctx.addIssue({ code: "custom", path: ["subtopics", i, "prerequisites", j], message: `Unknown subtopic "${p}"` });
        }
      });
    });
    const covered = new Set<string>();
    v.searchQueries.forEach((q, i) => {
      if (!names.has(q.subtopic)) {
        ctx.addIssue({ code: "custom", path: ["searchQueries", i, "subtopic"], message: `Unknown subtopic "${q.subtopic}"` });
      } else if (covered.has(q.subtopic)) {
        ctx.addIssue({ code: "custom", path: ["searchQueries", i, "subtopic"], message: `Duplicate entry for "${q.subtopic}"` });
      }
      covered.add(q.subtopic);
    });
    for (const name of names) {
      if (!covered.has(name)) {
        ctx.addIssue({ code: "custom", path: ["searchQueries"], message: `No search queries for subtopic "${name}"` });
      }
    }
  });
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

// ---------------------------------------------------------------------------
// 3. Researcher (built by code, validated at the boundary)

export const SourceSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  title: text,
  type: z.enum(SOURCE_TYPES),
  score: z.number().min(0).max(1),
  excerpt: z.string(),
  /** Trimmed source passages for the Lesson Writer and Fact-Checker; null in light mode. */
  grounding: z.string().nullable(),
});
export type Source = z.infer<typeof SourceSchema>;

export const ResearchResultSchema = z.array(
  z.object({
    subtopic: text,
    sources: z.array(SourceSchema),
  }),
);
export type ResearchResult = z.infer<typeof ResearchResultSchema>;

// ---------------------------------------------------------------------------
// 4. Curriculum Designer

export const CurriculumItemSchema = z
  .object({
    kind: z.enum(["lesson", "review"]),
    title: text,
    objectives: z.array(text).min(2).max(4),
    estMinutes: z.number().int().positive(),
    subtopics: z.array(text),
    includesPractice: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "lesson" && v.subtopics.length === 0) {
      ctx.addIssue({ code: "custom", path: ["subtopics"], message: "A lesson must map to at least one planner subtopic" });
    }
  });
export type CurriculumItem = z.infer<typeof CurriculumItemSchema>;

export const CurriculumDaySchema = z
  .object({
    dayNumber: z.number().int().min(1),
    theme: text,
    lessons: z.array(CurriculumItemSchema).min(1),
  })
  .superRefine((v, ctx) => {
    const reviews = v.lessons.filter((l) => l.kind === "review").length;
    if (reviews === v.lessons.length) {
      ctx.addIssue({ code: "custom", path: ["lessons"], message: "Each day needs at least one lesson item" });
    }
    if (reviews > 1) {
      ctx.addIssue({ code: "custom", path: ["lessons"], message: "At most one review item per day" });
    }
    const firstReview = v.lessons.findIndex((l) => l.kind === "review");
    if (firstReview !== -1 && firstReview !== v.lessons.length - 1) {
      ctx.addIssue({ code: "custom", path: ["lessons", firstReview], message: "The review item must come after the lessons" });
    }
  });
export type CurriculumDay = z.infer<typeof CurriculumDaySchema>;

export const CurriculumOutputSchema = z
  .object({
    courseTitle: text,
    courseSummary: text,
    days: z.array(CurriculumDaySchema).min(1),
  })
  .superRefine((v, ctx) => {
    v.days.forEach((d, i) => {
      if (d.dayNumber !== i + 1) {
        ctx.addIssue({ code: "custom", path: ["days", i, "dayNumber"], message: `Expected day ${i + 1}, got ${d.dayNumber}` });
      }
    });
  });
export type CurriculumOutput = z.infer<typeof CurriculumOutputSchema>;

// ---------------------------------------------------------------------------
// 5. Lesson Writer

/** Source numbers cited in markdown as [1] or [1, 3]. Ignores link text like [1](url). */
export function extractCitationIndexes(markdown: string): number[] {
  const found = new Set<number>();
  for (const match of markdown.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g)) {
    for (const n of (match[1] ?? "").split(",")) found.add(Number(n.trim()));
  }
  return [...found].sort((a, b) => a - b);
}

export const LessonContentSchema = z
  .object({
    contentMd: text,
    keyTerms: z.array(z.object({ term: text, definition: text })),
    practiceTask: z.object({ instructions: text, expectedOutcome: text }).nullable(),
    citedSourceIndexes: z.array(z.number().int().min(1)),
  })
  .superRefine((v, ctx) => {
    const inText = new Set(extractCitationIndexes(v.contentMd));
    const listed = new Set(v.citedSourceIndexes);
    for (const n of inText) {
      if (!listed.has(n)) {
        ctx.addIssue({ code: "custom", path: ["citedSourceIndexes"], message: `[${n}] is cited in contentMd but missing here` });
      }
    }
    for (const n of listed) {
      if (!inText.has(n)) {
        ctx.addIssue({ code: "custom", path: ["citedSourceIndexes"], message: `${n} is listed but never cited as [${n}] in contentMd` });
      }
    }
  });
export type LessonContent = z.infer<typeof LessonContentSchema>;

// ---------------------------------------------------------------------------
// 6. Examiner

const BANNED_OPTION = /\b(all|none|both) of the above\b/i;

export const QuestionSchema = z
  .object({
    prompt: text,
    options: z.array(z.object({ id: text, text })).min(3).max(5),
    correctOptionId: text,
    explanation: text,
  })
  .superRefine((v, ctx) => {
    const ids = v.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Option ids must be unique" });
    }
    if (!ids.includes(v.correctOptionId)) {
      ctx.addIssue({ code: "custom", path: ["correctOptionId"], message: `"${v.correctOptionId}" is not an option id` });
    }
    v.options.forEach((o, i) => {
      if (BANNED_OPTION.test(o.text)) {
        ctx.addIssue({ code: "custom", path: ["options", i, "text"], message: 'No "all/none/both of the above" options' });
      }
    });
  });
export type Question = z.infer<typeof QuestionSchema>;

export const ExaminerOutputSchema = z.object({
  questions: z.array(QuestionSchema).min(3).max(5),
});
export type ExaminerOutput = z.infer<typeof ExaminerOutputSchema>;

// ---------------------------------------------------------------------------
// 7. Fact-Checker

export const FactCheckIssueSchema = z.object({
  claim: text,
  problem: z.enum(["unsupported", "contradicted", "outdated"]),
  suggestion: text,
});
export type FactCheckIssue = z.infer<typeof FactCheckIssueSchema>;

export const FactCheckOutputSchema = z.object({
  issues: z.array(FactCheckIssueSchema),
});
export type FactCheckOutput = z.infer<typeof FactCheckOutputSchema>;
