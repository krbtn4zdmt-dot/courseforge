// Invalid agent outputs: each is a valid fixture with one change that breaks one rule.
// `error` is a substring expected in the Zod error for that case.
import curriculum from "./curriculum.valid.json";
import examiner from "./examiner.valid.json";
import factChecker from "./factChecker.valid.json";
import intake from "./intake.valid.json";
import lessonWriter from "./lessonWriter.valid.json";
import planner from "./planner.valid.json";

export type InvalidCase = { name: string; output: unknown; error: string };

type Path = readonly (string | number)[];

/** Deep-copies `base` and sets the value at `path` (or deletes it when value is undefined). */
function withChange(base: unknown, path: Path, value: unknown): unknown {
  const copy = structuredClone(base) as Record<string | number, unknown>;
  let node = copy;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  const last = path[path.length - 1]!;
  if (value === undefined) delete node[last];
  else node[last] = value;
  return copy;
}

export const INVALID: Record<string, InvalidCase[]> = {
  intake: [
    { name: "minutesPerDay not snapped", output: withChange(intake, ["minutesPerDay"], 20), error: "minutesPerDay" },
    { name: "days over 60", output: withChange(intake, ["days"], 90), error: "days" },
    { name: "fractional days", output: withChange(intake, ["days"], 2.5), error: "days" },
    { name: "unknown level", output: withChange(intake, ["level"], "expert"), error: "level" },
    { name: "missing isAllowed", output: withChange(intake, ["isAllowed"], undefined), error: "isAllowed" },
    {
      name: "refused without a message",
      output: { ...intake, isAllowed: false, refusalMessage: null },
      error: "Required when isAllowed is false",
    },
    {
      name: "allowed with a refusal message",
      output: withChange(intake, ["refusalMessage"], "Sorry, no."),
      error: "Must be null when isAllowed is true",
    },
    {
      name: "fields missing but no next question",
      output: withChange(intake, ["goal"], null),
      error: "Required while any of topic",
    },
  ],
  planner: [
    { name: "unknown topic type", output: withChange(planner, ["topicType"], "trivia"), error: "topicType" },
    { name: "importance 4", output: withChange(planner, ["subtopics", 0, "importance"], 4), error: "importance" },
    { name: "no subtopics", output: { ...planner, subtopics: [], searchQueries: [] }, error: "subtopics" },
    {
      name: "only one query",
      output: withChange(planner, ["searchQueries", 0, "queries"], ["Philip II of Macedon"]),
      error: "queries",
    },
    {
      name: "four queries",
      output: withChange(planner, ["searchQueries", 0, "queries"], ["a", "b", "c", "d"]),
      error: "queries",
    },
    {
      name: "prerequisite that isn't a subtopic",
      output: withChange(planner, ["subtopics", 1, "prerequisites"], ["Ancient Egypt"]),
      error: 'Unknown subtopic "Ancient Egypt"',
    },
    {
      name: "self prerequisite",
      output: withChange(planner, ["subtopics", 0, "prerequisites"], ["Macedon and Philip II"]),
      error: "its own prerequisite",
    },
    {
      name: "subtopic without search queries",
      output: { ...planner, searchQueries: planner.searchQueries.slice(1) },
      error: 'No search queries for subtopic "Macedon and Philip II"',
    },
    {
      name: "queries for an unknown subtopic",
      output: withChange(planner, ["searchQueries", 0, "subtopic"], "Philip"),
      error: 'Unknown subtopic "Philip"',
    },
    {
      name: "duplicate subtopic",
      output: withChange(planner, ["subtopics", 1, "name"], "Macedon and Philip II"),
      error: "Duplicate subtopic",
    },
  ],
  curriculum: [
    { name: "one objective", output: withChange(curriculum, ["days", 0, "lessons", 0, "objectives"], ["Describe Macedon"]), error: "objectives" },
    {
      name: "five objectives",
      output: withChange(curriculum, ["days", 0, "lessons", 0, "objectives"], ["A a", "B b", "C c", "D d", "E e"]),
      error: "objectives",
    },
    { name: "zero minutes", output: withChange(curriculum, ["days", 0, "lessons", 0, "estMinutes"], 0), error: "estMinutes" },
    { name: "unknown kind", output: withChange(curriculum, ["days", 0, "lessons", 0, "kind"], "quiz"), error: "kind" },
    { name: "days out of order", output: withChange(curriculum, ["days", 1, "dayNumber"], 3), error: "Expected day 2" },
    {
      name: "review before a lesson",
      output: withChange(curriculum, ["days", 2, "lessons"], [...curriculum.days[2]!.lessons].reverse()),
      error: "review item must come after",
    },
    {
      name: "day with only a review",
      output: withChange(curriculum, ["days", 2, "lessons"], [curriculum.days[2]!.lessons[1]]),
      error: "at least one lesson item",
    },
    {
      name: "lesson with no subtopics",
      output: withChange(curriculum, ["days", 0, "lessons", 0, "subtopics"], []),
      error: "at least one planner subtopic",
    },
    { name: "no days", output: { ...curriculum, days: [] }, error: "days" },
  ],
  lessonWriter: [
    { name: "empty content", output: withChange(lessonWriter, ["contentMd"], "  "), error: "contentMd" },
    {
      name: "cited in text but not listed",
      output: withChange(lessonWriter, ["citedSourceIndexes"], [1]),
      error: "[2] is cited in contentMd but missing here",
    },
    {
      name: "listed but never cited",
      output: withChange(lessonWriter, ["citedSourceIndexes"], [1, 2, 3]),
      error: "3 is listed but never cited",
    },
    { name: "source index 0", output: withChange(lessonWriter, ["citedSourceIndexes"], [0, 1, 2]), error: "citedSourceIndexes" },
    {
      name: "practice task missing expected outcome",
      output: withChange(lessonWriter, ["practiceTask"], { instructions: "Draw the battle lines." }),
      error: "expectedOutcome",
    },
  ],
  examiner: [
    { name: "two questions", output: { questions: examiner.questions.slice(0, 2) }, error: "questions" },
    {
      name: "six questions",
      output: { questions: [...examiner.questions, ...examiner.questions] },
      error: "questions",
    },
    {
      name: "correct answer isn't an option",
      output: withChange(examiner, ["questions", 0, "correctOptionId"], "e"),
      error: '"e" is not an option id',
    },
    {
      name: "duplicate option ids",
      output: withChange(examiner, ["questions", 0, "options", 1, "id"], "a"),
      error: "Option ids must be unique",
    },
    {
      name: "all of the above",
      output: withChange(examiner, ["questions", 0, "options", 3, "text"], "All of the above"),
      error: "of the above",
    },
    {
      name: "two options",
      output: withChange(examiner, ["questions", 0, "options"], examiner.questions[0]!.options.slice(0, 2)),
      error: "options",
    },
  ],
  factChecker: [
    { name: "unknown problem", output: withChange(factChecker, ["issues", 0, "problem"], "wrong"), error: "problem" },
    { name: "empty claim", output: withChange(factChecker, ["issues", 0, "claim"], ""), error: "claim" },
    { name: "missing issues", output: {}, error: "issues" },
  ],
};
