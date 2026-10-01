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
  nextQuestion: string | null,   // null when all fields are filled
  // Phase 1b (tasks 1.7, 1.8, 1.11):
  purpose: string | null,        // "visiting Rome in two weeks", "start a data analyst job Monday"
  deadlineDate: string | null,   // ISO date when the user names one ("midterm next Thursday")
  sourcePreference: "academic_only" | "standard" | "include_creators"   // default "standard"
}
```
Rules:
- Ask at most one question per turn; never re-ask something answered.
- `minutesPerDay` snaps to the nearest of 15 / 30 / 45 / 60 / 90 ("20 minutes" → 15, "an hour" → 60, "2 hours" → 90); default to 30 if the user says "whatever" or similar.
- `days` counts today as day 1. "By Friday" said on a Wednesday is 3 days (Wed, Thu, Fri). If the named day is today ("by Friday" on a Friday), ask. "A week" = 7, "two weeks" = 14, "a month" = 30. Over 60 days: say the limit is 60 and ask whether 60 is fine.
- A named date ("my midterm is next Thursday", "I start Monday") sets both `deadlineDate` and `days`. A purpose is recorded as said; don't ask for one if the user didn't give it.
- When the user has uploaded a document, its requirements come from the Requirements Mapper; ask only for what it couldn't find (usually level and minutes per day).
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
**Input:** lesson spec, its minute split from `timeBudget.ts` (`readingMinutes`, `mediaMinutes`, `practiceMinutes` = activities, practice and quiz), the course syllabus (for context), sources assigned to this lesson (numbered, with their `grounding` passages, at most 4,500 words in total), the lesson's curated videos (numbered, with channel and length), level, topic type
**Output** (task 1.9: an interactive lesson, an ordered list of activity cards):
```ts
type Card = { id: string, part: string, cites: number[] } & (
  | { type: "reading", title: string, pages: string[] }            // 2–3 pages, ≤ 80 words each; inline [n] citations
  | { type: "video", video: number, watchFor: string[] }          // one of the lesson's videos; 2–3 notes
  | { type: "predict", prompt: string, options: string[], answer: number, reveal: string }
  | { type: "decide", scenario: string, options: { text: string, outcome: string, best: boolean }[] }  // exactly one best
  | { type: "match", prompt: string, pairs: { left: string, right: string }[] }                       // 3–6 pairs
  | { type: "order", prompt: string, items: string[], explain: string }                               // items in the right order
  | { type: "mythFact", items: { statement: string, fact: boolean, why: string }[] }                  // at least one myth
  | { type: "spotError", prompt: string, segments: string[], errorIndex: number, correction: string, why: string }
  | { type: "practiceStep", instructions: string, expectedOutcome: string, minutes: number }
  | { type: "explainBack", prompt: string, keyPoints: string[], modelAnswer: string }                 // exactly 3 key points
);
{
  activities: Card[],
  keyTerms: { term: string, definition: string }[]
}
```
Rules:
- **Teach, then use.** A lesson is a few parts. Each part (cards sharing `part`, kept together) is an optional predict card, then a reading card, then any videos, then at least one activity. Review never replaces teaching. This gives an action at least every ~90 seconds of reading (≤ 3 pages of 80 words between actions).
- At least 3 different activity types per lesson; at most one `explainBack`, as the last card. Practice steps only when the lesson includes practice, and then at least one.
- Every card except `video` and `practiceStep` cites at least one source in `cites`; reading pages also cite inline as [n], and every inline number is in the card's `cites`. Answers, outcomes, reveals, "why" fields, corrections and model answers follow the same sourcing rule. Deliberately wrong content (wrong options, myths, the `spotError` mistake) is plausible but clearly wrong by the sources, and the card states the truth.
- Original wording only (no copied sentences; quotes under 15 words, attributed); match reading level to user level; the first part opens with why it matters.
- Length: reading pages together are `readingMinutes` × 150–200 words; the prompt gives the number of reading cards and about how many activity cards fill the activity time (about 55 seconds each, after the quiz and practice steps).
- Each video is placed at most once, and at least one when the lesson has videos. A video longer than the lesson's `mediaMinutes` is shown as "save for later" (decided in code, `videoPlan` in `cards.ts`), so the reading must teach everything.
- Sensitive-domain disclaimer: the first page of the first reading card, word for word, as a blockquote.
- Validated in code (a violation sends the draft back once): the card schemas, page lengths, citation numbers in range, answer indexes, the part structure, video numbers, and practice steps matching the lesson.
- The examiner, the fact-checker, the audit and the course markdown read the cards as one rendered text (`renderCardsText` in `cards.ts`), which marks myths and spot-the-error mistakes as wrong on purpose. Lessons made before task 1.9 (one `contentMd` article) are still read by the evals and the audit.

## 6. Examiner (`examiner.ts`), MODEL_FAST
**Input:** lesson content, objectives
**Output:**
```ts
{ questions: { prompt: string, options: {id: string, text: string}[], correctOptionId: string, explanation: string }[] }
```
Rules: 3–5 questions per lesson, exactly the number given (one per objective, capped at 5; with more objectives, a question may cover two); plausible distractors; no "all of the above"; explanations reference the lesson.

## 7. Fact-Checker (`factChecker.ts`), MODEL_FAST
**Input:** lesson content + the `grounding` passages of the sources it cites, the user's level
**Output** (model):
```ts
{
  findings: {
    claim: string,
    sourceIndex: number | null,   // the [n] of the passage the verdict rests on
    passageSays: string | null,   // a short exact quote from that passage
    verdict: "supported" | "unsupported" | "contradicted" | "outdated",
    suggestion: string
  }[]
}
```
`claim` is copied word for word from the lesson ("..." skips words). The passage comes before the verdict so the verdict is decided after reading it. In code, `supported` findings, findings whose claim isn't in the lesson (ignoring case, spacing, emphasis, markdown escapes, citation markers, headings and table pipes) and findings quoted from a myth or a spot-the-error mistake (wrong on purpose) are dropped, and the rest become `issues: { claim, problem, suggestion }[]`. A `contradicted`/`outdated` verdict whose `passageSays` isn't found in that passage (ignoring case, spacing, emphasis and curly quotes; `...` splits the quote) is downgraded to `unsupported`.
Rules:
- Check only specific factual claims: numbers, dates, names, quotes, cause-and-effect statements, and instructions a learner will follow. Not framing, style, definitions, common knowledge at the user's level, or worked examples the lesson sets up itself.
- Card lessons arrive as rendered text with each card's sources in its heading. Check every card, including answers, reveals, scenario outcomes, "why" lines, corrections and model answers; skip content marked as wrong on purpose (myths, the deliberate mistake, the text of options not marked correct or best) and check the line that gives the truth instead.
- Judge a claim against the passage it cites; the other passages count only when the claim has no citation or its cited passage doesn't cover it. A claim a cited passage supports is `supported` even if another passage, or another part of the same passage, disagrees (sources contain errors).
- `contradicted` / `outdated`: the passage says otherwise or is newer. `unsupported`: a specific claim no passage covers.
- `passed` is computed in code, not by the model: the lesson fails if there is any `contradicted` or `outdated` issue, or more than 2 `unsupported` ones.
- On failure, re-run the Lesson Writer once with the issues attached. If it still fails, mark the lesson `ready` with a visible "some claims could not be verified" notice listing them, and log it. The SPEC's fact-check flag rate is the share of lessons shipped with that notice.

## 8. Coach (V2, `coach.ts`), MODEL_FAST or MODEL_SMART (decide in task 5.3)
Answers the learner's questions during a day using only that course's stored lessons and sources, and knows what they got wrong (from `progress.activity_results`). If the answer isn't supported, it says so and points to what the course does cover. Keeps answers short and often ends with one question that makes the learner think. The Day 2 prototype's "Chronicler" is the reference behaviour. Also grades explain-it-back answers against the lesson's key points (MVP, task 4.3), returning `{ covered: number[], praise: string, next: string, error: string }`.

## 9. Requirements Mapper (Phase 1b, `requirementsMapper.ts`), MODEL_SMART
**Input:** an uploaded class syllabus, job description or study guide (PDF sent as a document; DOCX or pasted text as text), today's date and time zone
**Output:**
```ts
{
  kind: "syllabus" | "job_description" | "study_guide" | "other",
  title: string,
  deadlineDate: string | null,   // the exam, start date or due date the document names
  requirements: { id: string, text: string, weight: "core" | "supporting", dueDate: string | null }[]
}
```
Rules: list what the document says the learner must know or do, in its own order; don't invent requirements; dates resolve against today. The planner must cover every `core` requirement and the curriculum's coverage report maps each one to a day (or says why not, e.g. "needs a lab").

## Contract changes planned in Phase 1b
- **Planner / Curriculum (1.7, 1.8):** take `requirements` or `purpose`; every lesson names the requirement, place or task it serves; output a coverage map.
- **Lesson Writer (1.9):** done; see §5.
- **Examiner (1.10):** also writes the 3-question test-out per lesson and marks which cards each question covers; warm-ups reuse earlier items.
- **Researcher (1.11):** honours `sourcePreference` when collecting and scoring sources.
- **Fact-Checker (1.11):** reports a conflict between cited passages as `disagreement` (shown to the learner as a "Sources disagree" note) instead of failing the lesson. (Checking every card, scenario outcomes included, arrived with 1.9.)
