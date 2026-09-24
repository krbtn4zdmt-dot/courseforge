# AI Agents: Roles and Contracts

Each agent is one function in `src/lib/pipeline/`. Inputs are typed; outputs are Zod-validated JSON. If validation fails, the LLM client retries once with the validation error appended to the prompt, then throws.

All prompts should: state the role, give the inputs as clearly labeled sections, specify the exact JSON shape, and say "Respond with JSON only."

---

## 1. Intake (`intake.ts`), MODEL_FAST
Parses the user's free-text request and decides what to ask next.

**Input:** chat history (array of messages), today's date and the user's time zone (for "by Friday")
**Output:**
```ts
{
  topic: string | null,
  days: number | null,           // normalized from "1 week", "by Friday", etc.
  minutesPerDay: 15 | 30 | 45 | 60 | 90 | null,
  level: "beginner" | "some_exposure" | "refresher" | null,
  goal: "understand" | "pass_test" | "practical_skill" | null,
  isAllowed: boolean,            // false for harmful topics
  refusalMessage: string | null, // friendly explanation when isAllowed is false
  nextQuestion: string | null    // null when all fields are filled
}
```
Rules:
- Ask at most one question per turn; never re-ask something answered.
- `minutesPerDay` snaps to the nearest of 15 / 30 / 45 / 60 / 90 ("20 minutes" → 15, "an hour" → 60, "2 hours" → 90); default to 30 if the user says "whatever" or similar.
- `days` counts today as day 1. "By Friday" said on a Wednesday is 3 days (Wed, Thu, Fri). If the named day is today ("by Friday" on a Friday), ask. "A week" = 7, "two weeks" = 14, "a month" = 30. Over 60 days: say the limit is 60 and ask whether 60 is fine.
- **Allowed vs refused** is about what the course would teach someone to *do*, not the subject area:
  - Allowed: cybersecurity for defending systems or for certifications (e.g. Security+, ethical hacking on your own lab), how attacks work conceptually, history of wars and weapons, pharmacology and drug safety, mental-health topics, lock mechanics as a hobby.
  - Refused: making weapons, explosives or illegal drugs; breaking into systems, accounts or property that aren't yours; stalking or surveilling a person; self-harm methods; evading law enforcement.
  - Borderline: ask one clarifying question about the goal before deciding.
  - Self-harm requests: refuse the course, respond with care, and include a crisis line (e.g. 988 in the US; findahelpline.com elsewhere).

## 2. Planner (`planner.ts`), MODEL_SMART
**Input:** intake result + time budget from `timeBudget.ts`
**Output:**
```ts
{
  topicType: "knowledge" | "skill" | "hybrid",
  sensitiveDomain: "medical" | "legal" | "financial" | "safety" | null,
  subtopics: { name: string, importance: 1|2|3, prerequisites: string[] }[],
  searchQueries: { subtopic: string, queries: string[] }[],  // 2–3 each; the first is the best single query (used for light research)
  commonMisconceptions: string[]
}
```
Rules: size the subtopic list to the time budget. A 3-day course should not have 25 subtopics. Importance 1 = must-cover.

## 3. Researcher (`researcher.ts`), mostly code, MODEL_FAST for relevance
**Input:** planner output, `mode: "light" | "deep"`
**Process:** run searches in parallel (limit concurrency to 5), score sources (`research/scoring.ts`), dedupe, store. `light` runs one Tavily `basic` query per subtopic for the syllabus; `deep` runs everything else (Tavily `advanced` with raw content, YouTube, Wikipedia) after confirm. See Research details in ARCHITECTURE.md.
**Output:** `{ subtopic: string, sources: Source[] }[]` where `Source = { url, title, type, score, excerpt, grounding }` (`grounding` is null in light mode)

## 4. Curriculum Designer (`curriculum.ts`), MODEL_SMART
**Input:** planner output, source summaries (titles + short excerpts), time budget from `timeBudget.ts` (the exact slots per day), user level/goal, and on edits the previous syllabus plus the user's feedback
**Output:**
```ts
{
  courseTitle: string,
  courseSummary: string,               // 2–3 sentences
  days: {
    dayNumber: number,
    theme: string,
    lessons: {
      kind: "lesson" | "review",
      title: string,
      objectives: string[],            // 2–4, each starts with a verb
      estMinutes: number,
      subtopics: string[],             // maps back to planner subtopics
      includesPractice: boolean
    }[]
  }[]
}
```
Rules: each day has the same number of items, in the same order and of the same kind, as the time budget's slots for that day, with lessons before the review item. Each item's `estMinutes` should match its slot; the day total must be within ±10% of `minutesPerDay`. Review items cover earlier days' material (spaced recall); the final day's review item is the course review + final quiz. Order respects prerequisites. Validate in code after generation and retry once with the problems listed; if still off, keep the content and replace each `estMinutes` with its slot's value.

## 5. Lesson Writer (`lessonWriter.ts`), MODEL_SMART
**Input:** lesson spec, its minute split from `timeBudget.ts` (`readingMinutes`, `mediaMinutes`, `practiceMinutes`), the course syllabus (for context), sources assigned to this lesson (numbered, with their `grounding` passages), level, topic type
**Output:**
```ts
{
  contentMd: string,       // markdown; cite as [1], [2] matching source numbers
  keyTerms: { term: string, definition: string }[],
  practiceTask: { instructions: string, expectedOutcome: string } | null,
  citedSourceIndexes: number[]
}
```
Rules: original wording only (no copied sentences; quotes under 15 words, attributed); match reading level to user level; open with why it matters; end with a 3-bullet recap; length is `readingMinutes` × 150–200 words; add the sensitive-domain disclaimer when flagged.

## 6. Examiner (`examiner.ts`), MODEL_FAST
**Input:** lesson content, objectives
**Output:**
```ts
{ questions: { prompt: string, options: {id: string, text: string}[], correctOptionId: string, explanation: string }[] }
```
Rules: 3–5 questions per lesson; one question per objective minimum; plausible distractors; no "all of the above"; explanations reference the lesson.

## 7. Fact-Checker (`factChecker.ts`), MODEL_FAST
**Input:** lesson content + the `grounding` passages of the sources it cites, the user's level
**Output:**
```ts
{
  issues: { claim: string, problem: "unsupported" | "contradicted" | "outdated", suggestion: string }[]
}
```
Rules:
- Flag only specific factual claims: numbers, dates, names, quotes, cause-and-effect statements, and instructions a learner will follow. Not framing, style, definitions, or common knowledge at the user's level.
- `contradicted` / `outdated`: the grounding says otherwise or is newer. `unsupported`: a specific claim the grounding doesn't cover.
- `passed` is computed in code, not by the model: the lesson fails if there is any `contradicted` or `outdated` issue, or more than 2 `unsupported` ones.
- On failure, re-run the Lesson Writer once with the issues attached. If it still fails, mark the lesson `ready` with a visible "some claims could not be verified" notice listing them, and log it. The SPEC's fact-check flag rate is the share of lessons shipped with that notice.

## 8. Tutor (V2, `tutor.ts`), MODEL_SMART
Answers user questions inside a lesson using only that course's stored sources and lessons. If the answer isn't supported, it says so and suggests a search.
