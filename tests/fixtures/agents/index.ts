// Valid agent outputs (the *.valid.json files) and invalid variants of them.
// Each invalid case breaks exactly one rule and names the path Zod should report.

import curriculum from "./curriculum.valid.json";
import examiner from "./examiner.valid.json";
import factChecker from "./factChecker.valid.json";
import intake from "./intake.valid.json";
import lessonWriter from "./lessonWriter.valid.json";
import planner from "./planner.valid.json";

export const validOutputs = { intake, planner, curriculum, lessonWriter, examiner, factChecker };
export type AgentName = keyof typeof validOutputs;

// Fixtures are plain JSON, so mutations work on a loosely typed clone.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export interface InvalidCase {
  name: string;
  mutate: (output: Json) => void;
  /** Zod issue path, joined with "." */
  path: string;
}

export const invalidCases: Record<AgentName, InvalidCase[]> = {
  intake: [
    { name: "minutesPerDay not snapped", mutate: (o) => (o.minutesPerDay = 20), path: "minutesPerDay" },
    { name: "days over 60", mutate: (o) => (o.days = 90), path: "days" },
    { name: "unknown level", mutate: (o) => (o.level = "expert"), path: "level" },
    { name: "refused without a message", mutate: (o) => (o.isAllowed = false), path: "refusalMessage" },
    { name: "allowed with a refusal message", mutate: (o) => (o.refusalMessage = "Sorry"), path: "refusalMessage" },
    { name: "missing isAllowed", mutate: (o) => delete o.isAllowed, path: "isAllowed" },
  ],
  planner: [
    { name: "unknown topicType", mutate: (o) => (o.topicType = "trivia"), path: "topicType" },
    { name: "importance 4", mutate: (o) => (o.subtopics[0].importance = 4), path: "subtopics.0.importance" },
    { name: "only one query", mutate: (o) => (o.searchQueries[0].queries = ["excel"]), path: "searchQueries.0.queries" },
    {
      name: "four queries",
      mutate: (o) => (o.searchQueries[0].queries = ["a", "b", "c", "d"]),
      path: "searchQueries.0.queries",
    },
    {
      name: "prerequisite that isn't a subtopic",
      mutate: (o) => (o.subtopics[1].prerequisites = ["Macros"]),
      path: "subtopics.1.prerequisites.0",
    },
    {
      name: "queries for an unknown subtopic",
      mutate: (o) => (o.searchQueries[0].subtopic = "Workbook basics"),
      path: "searchQueries.0.subtopic",
    },
    { name: "subtopic without queries", mutate: (o) => o.searchQueries.pop(), path: "searchQueries" },
  ],
  curriculum: [
    { name: "days not numbered from 1", mutate: (o) => (o.days[0].dayNumber = 0), path: "days.0.dayNumber" },
    { name: "review before a lesson", mutate: (o) => o.days[2].lessons.reverse(), path: "days.2.lessons.0.kind" },
    {
      name: "one objective",
      mutate: (o) => (o.days[0].lessons[0].objectives = ["Open Excel"]),
      path: "days.0.lessons.0.objectives",
    },
    {
      name: "five objectives",
      mutate: (o) => (o.days[0].lessons[0].objectives = ["a", "b", "c", "d", "e"]),
      path: "days.0.lessons.0.objectives",
    },
    { name: "unknown kind", mutate: (o) => (o.days[0].lessons[0].kind = "quiz"), path: "days.0.lessons.0.kind" },
    { name: "fractional minutes", mutate: (o) => (o.days[0].lessons[0].estMinutes = 14.5), path: "days.0.lessons.0.estMinutes" },
    { name: "day with no items", mutate: (o) => (o.days[1].lessons = []), path: "days.1.lessons" },
  ],
  lessonWriter: [
    {
      name: "inline citation not listed",
      mutate: (o) => (o.citedSourceIndexes = [1]),
      path: "citedSourceIndexes",
    },
    {
      name: "listed source never cited",
      mutate: (o) => (o.citedSourceIndexes = [1, 2, 3]),
      path: "citedSourceIndexes",
    },
    { name: "no citations", mutate: (o) => (o.citedSourceIndexes = []), path: "citedSourceIndexes" },
    { name: "too few key terms", mutate: (o) => (o.keyTerms = o.keyTerms.slice(0, 2)), path: "keyTerms" },
    { name: "content too short", mutate: (o) => (o.contentMd = "Alexander was a king [1] [2]."), path: "contentMd" },
    {
      name: "practice task missing expectedOutcome",
      mutate: (o) => (o.practiceTask = { instructions: "Draw a map of the empire." }),
      path: "practiceTask.expectedOutcome",
    },
  ],
  examiner: [
    { name: "two questions", mutate: (o) => (o.questions = o.questions.slice(0, 2)), path: "questions" },
    {
      name: "six questions",
      mutate: (o) => (o.questions = [...o.questions, ...o.questions]),
      path: "questions",
    },
    {
      name: "correct option doesn't exist",
      mutate: (o) => (o.questions[0].correctOptionId = "e"),
      path: "questions.0.correctOptionId",
    },
    {
      name: "duplicate option ids",
      mutate: (o) => (o.questions[0].options[1].id = "a"),
      path: "questions.0.options",
    },
    {
      name: "three options",
      mutate: (o) => o.questions[1].options.pop(),
      path: "questions.1.options",
    },
    {
      name: '"all of the above" option',
      mutate: (o) => (o.questions[2].options[3].text = "All of the above"),
      path: "questions.2.options.3.text",
    },
  ],
  factChecker: [
    { name: "unknown problem type", mutate: (o) => (o.issues[0].problem = "wrong"), path: "issues.0.problem" },
    { name: "missing suggestion", mutate: (o) => delete o.issues[0].suggestion, path: "issues.0.suggestion" },
    { name: "issues not an array", mutate: (o) => (o.issues = null), path: "issues" },
  ],
};
