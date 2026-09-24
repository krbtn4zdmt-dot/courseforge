import "server-only";

import { z } from "zod";

import type { DisclaimerDomain } from "@/lib/disclaimers";
import { stripCode } from "@/lib/markdown";

import type { TopicType } from "./timeBudget";

// Zod schemas for every agent output in docs/AGENTS.md.
// Rules that only need the output itself live here (via superRefine), so a violation
// triggers the LLM client's retry-once. Rules that need other data (the time budget,
// the number of sources) are checked in the agent code.

export const TOPIC_TYPES = ["knowledge", "skill", "hybrid"] as const satisfies readonly TopicType[];
export const SENSITIVE_DOMAINS = ["medical", "legal", "financial", "safety"] as const satisfies readonly DisclaimerDomain[];
export const LEVELS = ["beginner", "some_exposure", "refresher"] as const;
export const GOALS = ["understand", "pass_test", "practical_skill"] as const;
export const MINUTES_PER_DAY_OPTIONS = [15, 30, 45, 60, 90] as const;
export const OPTIONS_PER_QUESTION = 4;

export type SensitiveDomain = (typeof SENSITIVE_DOMAINS)[number];
export type Level = (typeof LEVELS)[number];
export type Goal = (typeof GOALS)[number];

// ---------- 1. Intake ----------

export const IntakeResultSchema = z
  .object({
    topic: z.string().min(1).nullable(),
    days: z.int().min(1).max(60).nullable(),
    minutesPerDay: z.literal(MINUTES_PER_DAY_OPTIONS).nullable(),
    level: z.enum(LEVELS).nullable(),
    goal: z.enum(GOALS).nullable(),
    isAllowed: z.boolean(),
    refusalMessage: z.string().min(1).nullable(),
    nextQuestion: z.string().min(1).nullable(),
  })
  .superRefine((v, ctx) => {
    if (!v.isAllowed && !v.refusalMessage) {
      ctx.addIssue({ code: "custom", path: ["refusalMessage"], message: "required when isAllowed is false" });
    }
    if (v.isAllowed && v.refusalMessage) {
      ctx.addIssue({ code: "custom", path: ["refusalMessage"], message: "must be null when isAllowed is true" });
    }
  });
export type IntakeResult = z.infer<typeof IntakeResultSchema>;

/** An intake result with every field filled, which is what the planner needs. */
export type CompletedIntake = {
  [K in "topic" | "days" | "minutesPerDay" | "level" | "goal"]: NonNullable<IntakeResult[K]>;
};

// ---------- 2. Planner ----------

export const PlannerOutputSchema = z
  .object({
    topicType: z.enum(TOPIC_TYPES),
    sensitiveDomain: z.enum(SENSITIVE_DOMAINS).nullable(),
    subtopics: z
      .array(
        z.object({
          name: z.string().min(1),
          importance: z.literal([1, 2, 3]),
          prerequisites: z.array(z.string()),
        }),
      )
      .min(1),
    searchQueries: z
      .array(
        z.object({
          subtopic: z.string().min(1),
          queries: z.array(z.string().min(1)).min(2).max(3),
        }),
      )
      .min(1),
    commonMisconceptions: z.array(z.string()),
  })
  .superRefine((v, ctx) => {
    const names = v.subtopics.map((s) => s.name);
    const known = new Set(names);
    if (known.size !== names.length) {
      ctx.addIssue({ code: "custom", path: ["subtopics"], message: "subtopic names must be unique" });
    }
    v.subtopics.forEach((s, i) => {
      s.prerequisites.forEach((p, j) => {
        if (!known.has(p) || p === s.name) {
          ctx.addIssue({
            code: "custom",
            path: ["subtopics", i, "prerequisites", j],
            message: `"${p}" must be the name of another subtopic`,
          });
        }
      });
    });
    const covered = new Set<string>();
    v.searchQueries.forEach((q, i) => {
      if (!known.has(q.subtopic)) {
        ctx.addIssue({
          code: "custom",
          path: ["searchQueries", i, "subtopic"],
          message: `"${q.subtopic}" is not a subtopic name`,
        });
      }
      if (covered.has(q.subtopic)) {
        ctx.addIssue({
          code: "custom",
          path: ["searchQueries", i, "subtopic"],
          message: `duplicate entry for "${q.subtopic}"`,
        });
      }
      covered.add(q.subtopic);
    });
    for (const name of names) {
      if (!covered.has(name)) {
        ctx.addIssue({ code: "custom", path: ["searchQueries"], message: `missing queries for "${name}"` });
      }
    }
  });
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

// ---------- 3. Researcher (code, not an LLM call) ----------

export const SourceSchema = z.object({
  url: z.url(),
  title: z.string(),
  type: z.enum(["web", "video", "wiki", "docs"]),
  score: z.number().min(0).max(1),
  excerpt: z.string(),
  grounding: z.string().nullable(), // null in light mode
});
export type Source = z.infer<typeof SourceSchema>;

export const ResearcherOutputSchema = z.array(
  z.object({ subtopic: z.string().min(1), sources: z.array(SourceSchema) }),
);
export type ResearcherOutput = z.infer<typeof ResearcherOutputSchema>;

// ---------- 4. Curriculum Designer ----------

export const SyllabusItemSchema = z.object({
  kind: z.enum(["lesson", "review"]),
  title: z.string().min(1),
  objectives: z.array(z.string().min(1)).min(2).max(4),
  estMinutes: z.int().positive(),
  subtopics: z.array(z.string().min(1)).min(1),
  includesPractice: z.boolean(),
});
export type SyllabusItem = z.infer<typeof SyllabusItemSchema>;

export const CurriculumOutputSchema = z
  .object({
    courseTitle: z.string().min(1),
    courseSummary: z.string().min(1),
    days: z
      .array(
        z.object({
          dayNumber: z.int().positive(),
          theme: z.string().min(1),
          lessons: z.array(SyllabusItemSchema).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((v, ctx) => {
    v.days.forEach((day, i) => {
      if (day.dayNumber !== i + 1) {
        ctx.addIssue({
          code: "custom",
          path: ["days", i, "dayNumber"],
          message: `expected day ${i + 1}, got ${day.dayNumber}`,
        });
      }
      day.lessons.forEach((item, j) => {
        if (item.kind === "review" && j !== day.lessons.length - 1) {
          ctx.addIssue({
            code: "custom",
            path: ["days", i, "lessons", j, "kind"],
            message: "a review item must be the last item of its day",
          });
        }
      });
    });
  });
export type CurriculumOutput = z.infer<typeof CurriculumOutputSchema>;

// ---------- 5. Lesson Writer ----------

/** Sorted, unique source numbers cited inline as [1], [2] or [1, 3]. Code (`arr[0]`, fenced blocks) is ignored. */
export function extractCitationIndexes(markdown: string): number[] {
  const found = new Set<number>();
  for (const match of stripCode(markdown).matchAll(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g)) {
    for (const n of match[1]!.split(",")) found.add(Number(n.trim()));
  }
  return [...found].sort((a, b) => a - b);
}

export const LessonWriterOutputSchema = z
  .object({
    contentMd: z.string().min(200),
    keyTerms: z
      .array(z.object({ term: z.string().min(1), definition: z.string().min(1) }))
      .min(3)
      .max(8),
    practiceTask: z
      .object({ instructions: z.string().min(1), expectedOutcome: z.string().min(1) })
      .nullable(),
    citedSourceIndexes: z.array(z.int().positive()).min(1),
  })
  .superRefine((v, ctx) => {
    const inline = extractCitationIndexes(v.contentMd);
    const listed = new Set(v.citedSourceIndexes);
    const missing = inline.filter((n) => !listed.has(n));
    const unused = [...listed].filter((n) => !inline.includes(n));
    if (missing.length) {
      ctx.addIssue({
        code: "custom",
        path: ["citedSourceIndexes"],
        message: `cited inline but not listed: ${missing.join(", ")}`,
      });
    }
    if (unused.length) {
      ctx.addIssue({
        code: "custom",
        path: ["citedSourceIndexes"],
        message: `listed but never cited inline: ${unused.join(", ")}`,
      });
    }
  });
export type LessonWriterOutput = z.infer<typeof LessonWriterOutputSchema>;

// ---------- 6. Examiner ----------

const CATCH_ALL_OPTION = /\b(all|none|both) of the above\b/i;

export const QuizQuestionSchema = z
  .object({
    prompt: z.string().min(1),
    options: z
      .array(z.object({ id: z.string().min(1), text: z.string().min(1) }))
      .length(OPTIONS_PER_QUESTION),
    correctOptionId: z.string().min(1),
    explanation: z.string().min(1),
  })
  .superRefine((q, ctx) => {
    const ids = q.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "option ids must be unique" });
    }
    if (!ids.includes(q.correctOptionId)) {
      ctx.addIssue({
        code: "custom",
        path: ["correctOptionId"],
        message: `"${q.correctOptionId}" is not one of the option ids`,
      });
    }
    q.options.forEach((o, i) => {
      if (CATCH_ALL_OPTION.test(o.text)) {
        ctx.addIssue({
          code: "custom",
          path: ["options", i, "text"],
          message: 'no "all/none/both of the above" options',
        });
      }
    });
  });
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const ExaminerOutputSchema = z.object({
  questions: z.array(QuizQuestionSchema).min(3).max(5),
});
export type ExaminerOutput = z.infer<typeof ExaminerOutputSchema>;

// ---------- 7. Fact-Checker ----------

export const FactCheckIssueSchema = z.object({
  claim: z.string().min(1),
  problem: z.enum(["unsupported", "contradicted", "outdated"]),
  suggestion: z.string().min(1),
});
export type FactCheckIssue = z.infer<typeof FactCheckIssueSchema>;

export const FactCheckOutputSchema = z.object({ issues: z.array(FactCheckIssueSchema) });
export type FactCheckOutput = z.infer<typeof FactCheckOutputSchema>;

// ---------- Relevance rating (researcher, MODEL_FAST) ----------

export const RelevanceOutputSchema = z.object({
  scores: z.array(z.object({ id: z.string().min(1), relevance: z.number().min(0).max(1) })),
});
export type RelevanceOutput = z.infer<typeof RelevanceOutputSchema>;
