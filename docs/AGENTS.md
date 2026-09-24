# AI Agents: Roles and Contracts

Each agent is one function in `src/lib/pipeline/`. Inputs are typed; outputs are Zod-validated JSON. If validation fails, the LLM client retries once with the validation error appended to the prompt, then throws.

All prompts should: state the role, give the inputs as clearly labeled sections, specify the exact JSON shape, and say "Respond with JSON only."

---

## 1. Intake (`intake.ts`), MODEL_FAST
Parses the user's free-text request and decides what to ask next.

**Input:** chat history (array of messages)
**Output:**
```ts
{
  topic: string | null,
  days: number | null,           // normalized from "1 week", "by Friday", etc.
  minutesPerDay: number | null,
  level: "beginner" | "some_exposure" | "refresher" | null,
  goal: "understand" | "pass_test" | "practical_skill" | null,
  isAllowed: boolean,            // false for harmful topics
  nextQuestion: string | null    // null when all fields are filled
}
```
Rules: ask at most one question per turn; never re-ask something answered; default `minutesPerDay` to 30 if the user says "whatever" or similar.

## 2. Planner (`planner.ts`), MODEL_SMART
**Input:** intake result + time budget from `timeBudget.ts`
**Output:**
```ts
{
  topicType: "knowledge" | "skill" | "hybrid",
  sensitiveDomain: "medical" | "legal" | "financial" | "safety" | null,
  subtopics: { name: string, importance: 1|2|3, prerequisites: string[] }[],
  searchQueries: { subtopic: string, queries: string[] }[],  // 3–5 each
  commonMisconceptions: string[]
}
```
Rules: size the subtopic list to the time budget. A 3-day course should not have 25 subtopics. Importance 1 = must-cover.

## 3. Researcher (`researcher.ts`), mostly code, MODEL_FAST for relevance
**Input:** planner output
**Process:** run searches in parallel (limit concurrency to 5), score sources (`research/scoring.ts`), dedupe, store.
**Output:** `{ subtopic: string, sources: Source[] }[]` where `Source = { url, title, type, score, excerpt }`

## 4. Curriculum Designer (`curriculum.ts`), MODEL_SMART
**Input:** planner output, source summaries (titles + short excerpts), time budget, user level/goal
**Output:**
```ts
{
  courseTitle: string,
  courseSummary: string,               // 2–3 sentences
  days: {
    dayNumber: number,
    theme: string,
    lessons: {
      title: string,
      objectives: string[],            // 2–4, each starts with a verb
      estMinutes: number,
      subtopics: string[],             // maps back to planner subtopics
      includesPractice: boolean
    }[]
  }[]
}
```
Rules: total `estMinutes` per day must be within ±10% of the daily budget; order respects prerequisites; the last day includes review + final quiz. Validate the time totals in code after generation, and retry if off.

## 5. Lesson Writer (`lessonWriter.ts`), MODEL_SMART
**Input:** lesson spec, the course syllabus (for context), sources assigned to this lesson (with numbered excerpts), level, topic type
**Output:**
```ts
{
  contentMd: string,       // markdown; cite as [1], [2] matching source numbers
  keyTerms: { term: string, definition: string }[],
  practiceTask: { instructions: string, expectedOutcome: string } | null,
  citedSourceIndexes: number[]
}
```
Rules: original wording only (no copied sentences; quotes under 15 words, attributed); match reading level to user level; open with why it matters; end with a 3-bullet recap; length fits `estMinutes` (roughly 150–200 words per reading minute of lesson share); add the sensitive-domain disclaimer when flagged.

## 6. Examiner (`examiner.ts`), MODEL_FAST
**Input:** lesson content, objectives
**Output:**
```ts
{ questions: { prompt: string, options: {id: string, text: string}[], correctOptionId: string, explanation: string }[] }
```
Rules: 3–5 questions per lesson; one question per objective minimum; plausible distractors; no "all of the above"; explanations reference the lesson.

## 7. Fact-Checker (`factChecker.ts`), MODEL_FAST
**Input:** lesson content + the source excerpts it cites
**Output:**
```ts
{
  passed: boolean,
  issues: { claim: string, problem: "unsupported" | "contradicted" | "outdated", suggestion: string }[]
}
```
Rules: flag only factual claims, not framing or style. If `passed` is false, re-run the Lesson Writer once with the issues attached; if it still fails, mark the lesson `ready` with a visible "some claims could not be verified" notice and log it.

## 8. Tutor (V2, `tutor.ts`), MODEL_SMART
Answers user questions inside a lesson using only that course's stored sources and lessons. If the answer isn't supported, it says so and suggests a search.
