// Prompt templates, one file per agent. Each returns { system, prompt }.
export { curriculumPrompt, CURRICULUM_SYSTEM, type CurriculumPromptInput, type SourceSummary } from "./curriculum";
export { examinerPrompt, EXAMINER_SYSTEM, type ExaminerPromptInput } from "./examiner";
export { factCheckerPrompt, FACT_CHECKER_SYSTEM, type FactCheckerPromptInput } from "./factChecker";
export { dayCountCalendar, intakePrompt, INTAKE_SYSTEM, type IntakeMessage, type IntakePromptInput } from "./intake";
export {
  lessonWriterPrompt,
  LESSON_WRITER_SYSTEM,
  readingWordRange,
  type LessonWriterPromptInput,
} from "./lessonWriter";
export { plannerPrompt, PLANNER_SYSTEM, type PlannerPromptInput } from "./planner";
export { relevancePrompt, RELEVANCE_SYSTEM, type RelevanceItem, type RelevancePromptInput } from "./relevance";
export { JSON_ONLY, type PromptPair } from "./shared";
