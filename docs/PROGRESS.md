# Progress Log

Claude Code: append an entry after completing each task. Newest at the bottom.

Format:
```
## YYYY-MM-DD: Task X.Y: <title>
- Changed: <files / features>
- Evidence: <tests passed, command output summary>
- Leftovers: <anything unfinished or noticed>
- Decisions: <anything also added to ARCHITECTURE.md decisions log>
```

---

## 2026-09-24: Docs revision before task 0.1
- Changed: ARCHITECTURE.md (time-budget rules and worked examples, light/deep research split, YouTube quota plan, day unlocking, schema: `lessons.kind`, `sources.grounding`, no pgvector), AGENTS.md (intake date handling, minute snapping, refusal rules; researcher modes; curriculum slots; fact-check pass rule), SPEC.md, BUILD_PLAN.md acceptance criteria for 1.1, 1.3, 1.4, 3.2, 4.4, 4.5, CLAUDE.md, .env.example.
- Evidence: time-budget rules checked with a script over every minutesPerDay 15–90 and 1–7 day courses: every lesson is 10–25 min and every day sums exactly.
- Leftovers: cost table prices still need confirming (task 0.2).
- Decisions: seven entries added to the ARCHITECTURE.md decisions log.

## 2026-09-24: Task 0.1: Scaffold the project
- Changed: Next.js 16.3.6 (App Router, TS strict + `noUncheckedIndexedAccess`), Tailwind v4, shadcn/ui (`components.json`, `cn()`, theme variables, `Button`), ESLint 9 flat config, Vitest 5 with `@/` alias, `tsx`, `server-only`. Scripts: `dev`, `build`, `start`, `test`, `test:watch`, `typecheck`, `lint`, `gen:course` (stub that parses args). Full folder structure from ARCHITECTURE.md: landing page at `(marketing)/page.tsx`, "Coming soon" pages for `(app)` routes, API routes returning 501, `src/lib/**` placeholders marked `server-only` with the task that fills them, `.gitkeep` in `prompts/`, `supabase/migrations/`, `tests/fixtures/`. Root `AGENTS.md` (Next.js agent rules). `.gitignore` gained `coverage/`, `*.tsbuildinfo`, `next-env.d.ts`, `.vercel`, `.DS_Store`.
- Evidence: `pnpm typecheck` clean; `pnpm lint` clean; `pnpm test` 2/2 passed (`tests/unit/smoke.test.ts`); `pnpm dev` served `/`, `/new`, `/courses`, `/courses/abc`, `/courses/abc/lessons/xyz` with 200 (landing `<title>CourseForge</title>`, Tailwind `.bg-primary` compiled), `/api/intake` and `/api/courses` 501; `pnpm build` succeeded; `pnpm gen:course "Alexander the Great" --days 3 --minutes 30 --level beginner` prints the stub message with parsed args. `.env.example` already lists all variables in CLAUDE.md; `.gitignore` excludes `.env.local`; repo already had commits.
- Leftovers: `ui.shadcn.com` is blocked by this environment's network policy, so `pnpm dlx shadcn add <component>` won't work here until that host is allowed (components can still be added by hand). pnpm skipped build scripts for esbuild/sharp/unrs-resolver (`pnpm approve-builds` if ever needed; nothing currently requires them).
- Decisions: four entries added to the ARCHITECTURE.md decisions log (Next 16 typegen in typecheck, root AGENTS.md, hand-written shadcn files, noUncheckedIndexedAccess).

## 2026-09-24: Task 0.2: LLM client wrapper
- Changed: `src/lib/llm/client.ts`: `callJson<T>({ agent, model: "smart" | "fast", system, prompt, schema, maxTokens?, structuredOutput?, onUsage? })`. It resolves `MODEL_SMART`/`MODEL_FAST` (throws `LlmConfigError` if unset), sends structured outputs by default, retries network errors 3 times with exponential backoff (connection, 408, 429, 5xx/529; honors `retry-after`; SDK retries off), and on invalid JSON, a Zod failure or a `max_tokens` cut-off retries once with the bad reply and the error appended, then throws `LlmValidationError`. A refusal throws `LlmRefusalError` with no retry. Tokens are summed across attempts and logged with cost, success or failure, and passed to `onUsage`. `createLlmClient(deps)` exists for injecting a fake SDK in tests. `src/lib/llm/cost.ts`: price table (Sonnet 5 $2/$10, Haiku 4.5 $1/$5 per MTok, with a TODO to confirm), `estimateCostUsd` (null plus one warning for unknown models), `logUsage`. Added deps `@anthropic-ai/sdk` 0.128.0 and `zod` 4.6.5. Vitest config moved to `vitest.config.mts` with Vite's native tsconfig paths (dropped `vite-tsconfig-paths`) and a `server-only` stub; `gen:course` runs `tsx --conditions=react-server`.
- Evidence: `pnpm test` 23/23 passed (3 files). `client.test.ts` covers success (model, system prompt and schema sent), the fast tier, structured output off with fenced JSON, onUsage tokens and cost, the invalid-JSON retry, the Zod-failure retry (issues in the retry message), the max_tokens retry, the empty-reply retry, final failure (`LlmValidationError` with 2 issues and the failure logged), connection and 529 retries with 1s/2s backoff, the rate-limit retry, giving up after 3 retries (1s/2s/4s), no retry on 400, refusal, and a missing env var. `cost.test.ts` covers the price math, both Haiku IDs and unknown models. Typecheck and lint are clean. Checked that `zodOutputFormat` emits a valid schema for a Zod object with constraints, and that the CLI loads `server-only` code with the react-server condition but fails without it.
- Leftovers: no live API call yet (no `ANTHROPIC_API_KEY` in this environment); the first real call is in task 1.3/1.4. Prices need confirming. Cache-token pricing isn't counted (no caching used yet).
- Decisions: three entries added to the ARCHITECTURE.md decisions log (structured outputs plus Zod, the client owning retries, `server-only` outside Next).

## 2026-09-24: Task 1.1: Time-budget engine
- Changed: `src/lib/pipeline/timeBudget.ts`: `buildTimeBudget({ days, minutesPerDay, topicType })` returns `{ dayNumber, reviewMinutes, lessons: { estMinutes, readingMinutes, mediaMinutes, practiceMinutes }[] }[]` per the ARCHITECTURE.md rules. Exported helpers `reviewMinutesFor`, `splitEvenly`, `splitLesson`, the `TopicType` type and range constants. Inputs are checked: whole numbers only, days 1–60, minutesPerDay 15–90, a known topicType, otherwise a `RangeError`. Every day is checked at runtime (sum equals minutesPerDay, each lesson 10–25 min) and throws if a rule is broken. All math is integer-based (`m * 3 / 10`, `m / 10`, `est * pct / 100`).
- Evidence: `tests/unit/pipeline/timeBudget.test.ts` 24 tests passed (47/47 across the suite): all 3 worked-example rows, 1-, 2-, 7-, 30- and 60-day courses, knowledge, skill and hybrid splits, rounding difference going to reading, helpers, 8 invalid-input cases, and a sweep of every minutesPerDay 15–90 × {1,2,3,5,7,30,60} days × 3 topic types (24,624 days), checking the exact day sum, lessons of 10–25 min, 1–4 lessons a day, non-increasing lesson lengths, parts summing to estMinutes, and every part > 0. Typecheck and lint are clean.
- Leftovers: none. Note: the float risk flagged in planning (`m * 0.3` then ceil) turned out not to occur for any input in range; integer math is kept so it stays correct if the ranges change.
- Decisions: none new.

## 2026-09-24: Task 1.2: Zod schemas and prompt templates
- Changed: `src/lib/pipeline/schemas.ts` has schemas and inferred types for every AGENTS.md output: intake, planner, researcher `Source` and output, curriculum, lesson writer, examiner, fact-checker. It enforces the count rules (2–3 queries, 2–4 objectives, 3–5 questions, 4 options, 3–8 key terms, snapped minutes, days ≤ 60) and output-only consistency rules via `superRefine`, and adds the `extractCitationIndexes` helper. `src/lib/pipeline/prompts/` has `intake`, `planner`, `curriculum`, `lessonWriter`, `examiner` and `factChecker` template functions returning `{ system, prompt }`, plus `shared.ts` (sections, JSON-only line, budget-slot formatting). The curriculum prompt supports edit requests, the lesson writer prompt supports fact-check rewrites and disclaimers, and the intake prompt computes the weekday and a "by <weekday>" table. New `src/lib/disclaimers.ts`. Fixtures are in `tests/fixtures/agents/`: 6 valid outputs plus 35 single-rule invalid variants.
- Evidence: `pnpm test` 130/130 passed. `schemas.test.ts` (54): each valid fixture parses, each invalid variant fails at its expected path, every schema converts via the SDK's `zodOutputFormat` to a closed object schema, plus refusal and in-progress intake, empty fact-check, researcher sources and citation extraction. `prompts.test.ts` (30): every prompt names all output keys, ends with "Respond with JSON only." and has an input-independent system prompt; "by Friday" on a Wednesday gives 3 days; time-zone weekday; slot formatting; edit, rewrite and disclaimer sections appear only when relevant; word range from reading minutes; question count. Typecheck and lint are clean.
- Leftovers: the API hasn't seen these schemas yet; the first live call (task 1.4) confirms structured outputs accept them. Prompt wording is a first draft for the Phase 1 quality review. The relevance-scoring prompt comes with task 1.3. Note for 1.4: the planner decides `topicType`, so compute the budget once for slot counts (they don't depend on topic type) and recompute the per-lesson splits after planning.
- Decisions: five entries added to the ARCHITECTURE.md decisions log (superRefine vs agent-code rules, fixed system prompts, disclaimer text, 4 options / 3–8 key terms, intake date table).

## 2026-09-24: Task 1.3: Research clients (in progress: live smoke run pending)
- Changed: `src/lib/research/`:
  - `http.ts`: `fetchJson` with timeout, `ResearchError` (service, status, body) and Zod-validated responses.
  - `tavily.ts`: `searchTavily`, basic 15s / advanced 30s, optional raw content.
  - `youtube.ts`: `createYouTubeClient`, one per course. `search.list` capped at 8 live searches (cache hits don't count), `videos.list`/`channels.list` batched 50 ids, 3–25 min filter, unit tracking, quota exhausted returns no videos plus a log; `parseIsoDuration`.
  - `wikipedia.ts`: summary (null on 404 or disambiguation) and title search, with a Wikimedia User-Agent from `CONTACT_EMAIL`.
  - `cache.ts`: memory and file caches, 7-day TTL for YouTube.
  - `scoring.ts`: domain credibility, recency, combined score, video score, `canonicalUrl`, 5-word shingles, Jaccard, `dedupeSources` (> 0.8), `rankSources`.
  - `relevance.ts`: batched MODEL_FAST rating, with `prompts/relevance.ts` and `RelevanceOutputSchema`.

  Also `scripts/research-smoke.ts` (`pnpm research:smoke "<topic>"`). `gen:course` and `research:smoke` load `.env.local` via `--env-file-if-exists`. `.env.example` gained `CONTACT_EMAIL`; `.gitignore` gained `.cache/`.
- Evidence: `pnpm test` 195/195 passed; the 65 new tests are in `tests/unit/research/`:
  - youtube 14: request params, duration filter, hidden subscribers, 8-search cap across calls, cache hit not counted, 7-day expiry, 50-id batching and unit math, quota exhausted mid-run and on the first search, bad key throws, missing key.
  - scoring 23.
  - tavily 6, wikipedia 7, http 5, relevance 3, cache 3.

  Typecheck and lint are clean. The smoke script was run offline against a stubbed `fetch` (not committed): it printed the top sources, removed 5 of 9 as URL or text duplicates, filtered the 45-min videos, reported 202 YouTube units, and 0 units with 2 cached searches on a second run.
- Leftovers: **acceptance item not yet met: the live smoke run** (top 5 sources for "Alexander the Great" plus YouTube units). It needs `TAVILY_API_KEY`, `YOUTUBE_API_KEY`, `ANTHROPIC_API_KEY`, `MODEL_FAST` and `CONTACT_EMAIL`, and in the cloud environment, network access to `api.tavily.com` and `*.wikipedia.org` (currently blocked by policy; `www.googleapis.com` and `api.anthropic.com` are reachable). The Tavily and YouTube response shapes are unconfirmed until then. Grounding trimming (~1,500 relevant words per source) is deferred to 1.4 as agreed. The content-farm list and weights need tuning after the quality review.
- Decisions: five entries added to the ARCHITECTURE.md decisions log (scoring weights, file cache, YouTube client rules, relevance fallback, env loading).

## 2026-09-24: Task 1.4: Planner, Researcher, Curriculum Designer (in progress: live runs pending; started with 1.3 still open, at the user's request)
- Changed:
  - `pipeline/planner.ts`: `planCourse`, plus `slotBudget` and a warning when subtopics far outnumber slots.
  - `pipeline/researcher.ts`: `research({ topic, plan, mode, previous })`.
    - light: the first query per subtopic, Tavily basic.
    - deep: the remaining queries (advanced, raw content trimmed to grounding), Wikipedia for importance-1 knowledge/hybrid subtopics, YouTube for importance 1–2.
    - concurrency 5, batched relevance, credibility scoring, dedupe, top 6 text sources and top 3 videos per subtopic, merge with light results, failed queries logged in stats, throws only if all fail.
  - `research/grounding.ts`: `trimGrounding` (relevant paragraphs, ≤ 1,500 words), `makeExcerpt`, `termsFrom`.
  - `pipeline/curriculum.ts`: `designCurriculum` with `checkAgainstBudget` (structure, minutes and subtopic problems), one retry with the problems and previous syllabus, then `snapToSlots` or `CurriculumBudgetError`.
  - `prompts/curriculum.ts` gained a `fix` section.
  - `pipeline/runCourse.ts`: `generateSyllabus` (planner, light research, budget rebuilt with the topic type, curriculum) with per-step timings.
  - `scripts/gen-syllabus.ts` (`pnpm gen:syllabus`) prints the day-by-day syllabus, the retry/snap outcome, the time per step against the 20s target, and the LLM cost; `--out` writes JSON.
- Evidence: `pnpm test` 232/232 passed; the 37 new tests:
  - grounding 8
  - planner 3
  - researcher 12: query selection per mode, light vs deep calls, scores, a partial failure, all failing, grounding trimmed, Wikipedia/YouTube filters, top-3 videos, skill topics skip Wikipedia, deep replaces light for the same URL, the per-subtopic cap, concurrency limit and order
  - curriculum 13: fits, slot mismatch, total outside ±10%, structural problems, unknown subtopics, snapping, first-try pass, fixed on retry, snapped after retry, structure error thrown, unknown subtopics warned
  - runCourse 1: step order and timings

  Typecheck and lint are clean. `pnpm gen:syllabus "Excel for beginners" --days 7 --minutes 30 --level beginner --goal practical_skill` was run offline against a stubbed `fetch` (fake Claude and Tavily, not committed): the first curriculum missed a day-3 slot, the retry fit, all 7 days total 30 min with reviews from day 3 and a 21 + 9 final day, and it printed "planner 0.1s + light research 0.1s + curriculum 0.2s" and "LLM: 4 calls".
- Leftovers: **acceptance items not yet met: "works end to end on a real topic" and the live Excel syllabus output with real timings.** Both need `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `MODEL_SMART` and `MODEL_FAST` in this environment, plus network access to `api.tavily.com`. The first live run will also be the first time the API sees the structured-output schemas. Task 1.3's live smoke run is still pending too.
- Decisions: four entries added to the ARCHITECTURE.md decisions log (slot budget before planning, the three kinds of curriculum problem, researcher merge and caps, failed-query policy).

## 2026-09-24: Task 1.5: Lesson Writer, Examiner, Fact-Checker (in progress: live run pending; started with 1.3 and 1.4 still open, at the user's request)
- Changed:
  - `pipeline/lessonSources.ts`: `selectLessonSources` (grounded first, dedupe, max 6, excerpt-only flagged) and `selectLessonVideos` (0–2).
  - `pipeline/lessonWriter.ts`: `writeLesson` with `lessonOutputSchemaFor` (citation range, practice-task rule).
  - `pipeline/factChecker.ts`: `factCheckLesson` and `factCheckPassed` (any contradicted or outdated claim, or more than 2 unsupported, fails).
  - `pipeline/examiner.ts`: `examineLesson` with `examinerSchemaFor` (at least one question per objective).
  - `runCourse.ts`: `generateLesson` (write → fact-check → rewrite once → fact-check → examine; returns content, cited numbered sources, videos, quiz, and `factCheck { passed, issues, attempts, rewritten, unverifiedClaims }`) and `slotForItem`.
  - `prompts/lessonWriter.ts` labels excerpt-only sources.
  - `scripts/gen-lesson.ts` (`pnpm gen:lesson … --day 1 --lesson 1`, or `--from` a saved syllabus) prints the full lesson, sources, videos, key terms, practice, quiz with answers, the fact-check result, time and cost.
  - `scripts/cli.ts` holds the shared argument parsing; `gen:syllabus --out` now includes the intake.
  - New fixture `tests/fixtures/agents/factChecker.failing.json`.
- Evidence: `pnpm test` 253/253 passed; the 21 new tests:
  - lessonSources 3
  - lesson agents 13: writer prompt numbering, out-of-range citation rejected, practice-task rule, disclaimer, no sources; pass rule for 0/2/3 unsupported and contradicted/outdated; fact-checker model; examiner minimum.
  - generateLesson 5: happy path with cited numbered sources, 3–5 questions and a passed fact-check; the **failing fixture triggers one rewrite with the issues in the prompt and the quiz uses the rewrite**; still failing ships with `unverifiedClaims` and a log; review item; bad positions.

  Typecheck and lint are clean. `pnpm gen:lesson "Excel for beginners" … --day 1 --lesson 1` was run offline against a stubbed `fetch` (fake Claude, Tavily and YouTube, not committed). The first draft's wrong shortcut was flagged as contradicted, rewritten once, and passed; it printed the lesson with [1][2] citations, 2 sources, 2 videos, key terms, a practice task, a 3-question quiz, "Fact-check: passed; rewritten once", and "LLM: 10 calls".
- Leftovers: **acceptance item not yet met: the live Day 1 Lesson 1 for the Excel syllabus** (and citations mapping to real fetched sources). It needs the same keys and network access as 1.3/1.4. Fact-check pass rate and cost per lesson are unmeasured until then.
- Decisions: three entries added to the ARCHITECTURE.md decisions log (examine after fact-check, lesson source selection and numbering, per-call schema refinements).

## 2026-09-24: Task 1.6: Full CLI run (in progress: the 3 live topic runs are pending; started with 1.3–1.5 still open, at the user's request)
- Changed: `runCourse.ts`: `runCourse(intake)` runs the syllabus, deep research merged with the light results, and every syllabus item via `generateLesson`, 3 at a time. Failed lessons are recorded, not dropped. It returns `stats` (time per phase; LLM calls, cost and unpriced calls per agent; lessons ready, failed, rewritten and shipped with a notice; fact-check pass rate; YouTube units), plus `summarizeUsage` and `summarizeLessons`. `pipeline/courseOutput.ts` has `slugify`, `formatPercent` and `renderCourseMarkdown` (days, lessons with nested headings, the notices, videos and sources as links, key terms, practice, quiz with answers in `<details>`, the disclaimer for sensitive domains, a stats footer). `scripts/gen-course.ts` replaces the stub: it writes `out/<slug>.json` and `out/<slug>.md` and prints time, cost per agent, fact-check pass rate, lessons ready/failed and YouTube units.
- Evidence: `pnpm test` 269/269 passed; the 16 new tests in `course.test.ts`: every item generated (lessons and reviews) with concurrency capped, a failed lesson recorded while the rest continue, the pass rate with a notice, cost by agent and forwarding to onUsage, the summaries, 7 slug cases, and markdown structure (order, nesting, notices, failures, answers, sources, disclaimer). Typecheck and lint are clean. `pnpm gen:course "Excel for beginners" --days 7 --minutes 30 --level beginner --goal practical_skill` was run offline against a stubbed `fetch` (not committed): 18/18 lessons ready (13 lessons + 5 reviews), 61 LLM calls, 1 rewrite, a 100% pass rate, and it wrote the `.json` (126 KB) and a 1,134-line `.md`. Cost and time from that run are meaningless (fake token counts, no network).
- Leftovers: **acceptance item not yet met: live runs for "Alexander the Great" (3 days), "Excel for beginners" (7 days) and "How black holes work" (2 days), with their real time, cost and fact-check results.** They need the same keys and network access as 1.3–1.5. **Cost risk:** a rough estimate is that a lesson-writer call with up to 6 grounding passages (~9–12k input tokens) plus ~2k output costs about $0.04–0.05 on Sonnet 5. With fact-checking (~$0.01–0.015 on Haiku) and the quiz, a 7-day 30-min course (18 items plus rewrites) would come to about $1.0–1.3, over SPEC's < $0.75 target. The live runs will show the real figure; the likely levers are fewer or shorter grounding passages per lesson, and prompt caching of the shared syllabus context.
- Decisions: two entries added to the ARCHITECTURE.md decisions log (whole-course CLI run and pass-rate definition, markdown output).
