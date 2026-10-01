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

## 2026-09-24: Overnight hardening of Phase 1 (tasks 1.3–1.6 still in progress; live runs still blocked)
- Context: the user asked for live checks and autonomous work overnight. The session still had no API keys and `api.tavily.com` / `*.wikipedia.org` were blocked, so the live checks couldn't run. Work stayed inside the open Phase 1 tasks; Phase 2 was not started (the 🛑 quality checkpoint comes first).
- Changed:
  - **Streaming LLM calls:** `callJson` streams (the SDK refuses non-streaming requests over ~21k max tokens). The curriculum's `max_tokens` scales with syllabus size. Mid-stream overload errors are retried. A reply cut off at `max_tokens` retries with double the budget.
  - **Research robustness:** Tavily and Wikipedia retry once on transient errors; network-policy denials are named as such. YouTube failures are non-fatal. Deep mode falls back to light sources if every deep query fails. Relevance batches run 3 at a time, a failed batch falls back to 0.5, and failures are recorded. YouTube starts after the web search, alongside relevance. Wikipedia uses full-text search anchored on the topic, with a distinct page per subtopic.
  - **Lesson robustness:** a failed rewrite ships the first draft with its notice; a failed re-check ships the rewrite with the earlier issues. Citations, headings and the audit ignore code (CommonMark fences). Subtopic-name matching (exact, then normalized, then closest planner subtopic) runs before the budget check.
  - **Tooling:**
    - `pnpm check:live` preflights env vars and hosts, then runs the 6 live steps plus an audit, logging to `out/live-checks/`, stopping at the first failure and resuming with `--from N`.
    - `pnpm audit:course` runs mechanical checks: copying, long quotes, uncited sections, length, credibility, quiz balance, pacing, SPEC targets.
    - `/test-course` now includes the audit.
    - CLAUDE.md lists the new commands.
  - Also fixed: `gen:syllabus --out` creates its own directory; `mapWithConcurrency` moved to `src/lib/concurrency.ts`.
- Evidence: two code-review passes (the full pipeline, then tonight's changes) found 20 issues; all are fixed with tests. `pnpm test` 312/312 passed (up from 269); typecheck and lint are clean. A full offline dry run, `pnpm check:live --skip-preflight` against stubbed Anthropic (including real SSE streaming), Tavily, YouTube and Wikipedia responses, passed all 7 steps. The preflight correctly reports the missing keys and the two blocked hosts in this environment.
- Leftovers:
  - The live runs still decide tasks 1.3–1.6 (`pnpm check:live` once keys and hosts are available).
  - Cost is likely over the $0.75 per 7-day target (estimated $1.0–1.3).
  - Pending decision: should a lesson the audit finds copying 20+ words from a source be rewritten automatically?
- Decisions: four decisions-log rows updated in place (YouTube, relevance, failed queries, lesson sources) and six added (streaming and max tokens, the rewrite-failure policy, subtopic-name matching, Wikipedia search, code-aware markdown, the audit).

## 2026-09-30: API-key fallback for hosted environments (supports the pending 1.3–1.6 live runs)
- Context: the branch with tasks 0.1–1.6 was fast-forwarded into `claude/charming-heisenberg-iy5l4w`. The cloud environment warns that `ANTHROPIC_API_KEY` is reserved for Claude Code's own auth, and the running session still saw it as unset, so the app now also accepts an app-specific name.
- Changed: `src/lib/llm/apiKey.ts` (`ANTHROPIC_API_KEY_VARS`, `findAnthropicApiKey`). `callJson` passes the resolved key to the SDK and throws `LlmConfigError` naming both variables if neither is set. The `check:live` preflight accepts either name. `.env.example` and CLAUDE.md list the alternative.
- Evidence: `pnpm test` 317/317 passed (5 new in `apiKey.test.ts`: either name, precedence, blank and whitespace values, neither set). Typecheck and lint are clean. `pnpm check:live --only 99` with neither set reports "COURSEFORGE_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY is not set"; with only `COURSEFORGE_ANTHROPIC_API_KEY` set, the preflight passes (all four hosts reachable, no steps run).
- Leftovers: the live runs for 1.3–1.6 still need a session started after the key is saved.
- Decisions: one row added to the ARCHITECTURE.md decisions log (key lookup order).

## 2026-09-30: Workspace header for unscoped API keys (supports the pending 1.3–1.6 live runs)
- Context: `pnpm check:live` passed its preflight but step 2 (`gen:syllabus`) failed. The API returned 400 "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header". Step 1 only "passed" because the failed relevance batch fell back to 0.5.
- Changed: `src/lib/llm/apiKey.ts` adds `ANTHROPIC_WORKSPACE_ID_VARS` and `findAnthropicWorkspaceId`, with the same precedence and blank/trim handling as the key. `callJson` sends the ID as `anthropic-workspace-id` via the SDK's `defaultHeaders` when set, and sends nothing extra otherwise. `.env.example` and CLAUDE.md list the optional variables.
- Evidence: `pnpm test` 321/321 passed (4 new in `apiKey.test.ts`). Typecheck and lint are clean. A real `callJson` sent to a local stub via `ANTHROPIC_BASE_URL` sent no header with the variable unset, and sent `anthropic-workspace-id=wrkspc_test123` with it set.
- Leftovers: the live runs for 1.3–1.6 need a workspace ID set in the environment (or a workspace-scoped key), then `pnpm check:live --from 2`. (The preflight gap noted at the time is fixed in the next entry.)
- Decisions: one row added to the ARCHITECTURE.md decisions log (workspace ID lookup and header).

## 2026-09-30: `check:live` preflight verifies the Anthropic key (supports the pending 1.3–1.6 live runs)
- Context: the preflight only checked that env vars were set and hosts were reachable, so an unscoped key passed it and failed at step 2.
- Changed:
  - New `src/lib/llm/accessCheck.ts`. `checkAnthropicAccess` makes one free authenticated request (list one model) with the same key and headers as `callJson`. `describeAnthropicAccessError` turns failures into preflight problems: an unscoped key names the two workspace variables, a 401 says the key was rejected, and other failures give the API's message, adding "check the workspace ID too" when one is set.
  - `anthropicDefaultHeaders` in `apiKey.ts` is now the one place that builds the workspace header; `callJson` and the preflight both use it.
  - The preflight runs the check when `api.anthropic.com` is reachable.
- Evidence: `pnpm test` 330/330 passed (9 new: 7 in `accessCheck.test.ts`, 2 for `anthropicDefaultHeaders`). Typecheck and lint are clean. Live runs of `pnpm check:live --only 99` exit 1. With the current key it says "the Anthropic API key is not scoped to a workspace: set COURSEFORGE_ANTHROPIC_WORKSPACE_ID or ANTHROPIC_WORKSPACE_ID…". With `ANTHROPIC_WORKSPACE_ID=wrkspc_bogus` it says "(400: anthropic-workspace-id header must be a valid workspace ID.); check the workspace ID too", which proves the header is sent. The `callJson` stub probe still sends the header only when the variable is set.
- Leftovers: the live runs for 1.3–1.6 still need a real workspace ID in the environment.
- Decisions: one row added to the ARCHITECTURE.md decisions log (authenticated preflight request).

## 2026-09-30: `check:live` preflight also verifies `MODEL_SMART` and `MODEL_FAST` (supports the pending 1.3–1.6 live runs)
- Changed: once the key check passes, `checkAnthropicAccess` looks up both configured models (`GET /v1/models/{id}`, free) and now returns a list of problems. An unknown ID is reported as `MODEL_X is "<id>", which isn't a model this key can use`; other failures are prefixed with the variable and model. If the key check fails, only that is reported and no models are looked up. Unset models are left to the env-var check. The decisions-log row for the preflight is updated.
- Evidence: `pnpm test` 334/334 passed (`accessCheck.test.ts` now has 11 tests: both models looked up, key failure short-circuits, unknown model reported, unset model skipped, no key means no request, plus `describeModelError`). Typecheck and lint are clean. `pnpm check:live --only 99` against a local stub of the models API (via `ANTHROPIC_BASE_URL`) reported `MODEL_SMART is "claude-nope-9", which isn't a model this key can use` and exited 1. With two known models it printed "Preflight OK: … Anthropic key and models accepted". Every stub request carried the workspace header. Against the real API with the current env, it still reports only the unscoped key.
- Leftovers: whether `MODEL_SMART=claude-sonnet-5-5` in this environment is valid can't be checked until the key works. (Its missing price is fixed in the next entry.)
- Decisions: the decisions-log row for the preflight now covers the model checks.

## 2026-09-30: Claude Sonnet 5.5 in the price table (supports the pending 1.3–1.6 live runs)
- Context: this environment sets `MODEL_SMART=claude-sonnet-5-5`, which had no price, so every smart-model call logged its cost as unknown ("$?"). That made the per-course cost target unmeasurable.
- Changed: `src/lib/llm/cost.ts` adds `claude-sonnet-5-5` at $2 input / $10 output per million tokens (the same as Sonnet 5; from Anthropic's current model table, cached 2026-09-25). The table's "last checked" date is now 2026-09-30.
- Evidence: `pnpm test` 335/335 passed (1 new in `cost.test.ts`: 1M in + 0.5M out on Sonnet 5.5 = $7). Typecheck and lint are clean.
- Leftovers: the pre-launch TODO to confirm every price against the pricing page still stands.
- Decisions: none.

## 2026-09-30: Live runs for tasks 1.3–1.6 (`pnpm check:live`, all 7 steps passed); 1.3, 1.4, 1.5 done
- Context: the environment now has a working workspace-scoped key, so the pending live runs could finally happen. Run on commit `d1abb5e`; logs were kept in the session's scratchpad (`out/live-checks/2026-09-30T22-12-34-220Z/`), not committed.
- Evidence:
  - 1.3 ✅ `research:smoke "Alexander the Great"` printed "Scored 11 sources; 3 removed as duplicates", the top 5 sources and videos, and "YouTube quota: 202 units (2 live searches, 0 cached)". The 7-day Excel course used 803 units, which is within the 8-search cap (`MAX_SEARCHES_PER_COURSE`). Clients, scoring and dedupe are covered by unit tests.
  - 1.4 ✅ `gen:syllabus "Excel for beginners"` (7 days × 30 min) printed 7 days of 30 min each and "planner 13.9s + light research 7.9s + curriculum 30.9s = 52.7s". The ±10% rule, with one retry and then snapping, is enforced in `curriculum.ts` and covered by unit tests.
  - 1.5 ✅ `gen:lesson` (Excel, Day 1, Lesson 1) produced markdown citing [1]–[5], each mapped to a listed source URL. It has 4 quiz questions and printed "Fact-check: passed; 0 issue(s); no rewrite". The rewrite loop is covered by 4 tests in `runCourse.test.ts`: rewrite on fail, notice when the rewrite still fails, first draft when the rewrite errors, and a kept rewrite when its re-check fails.
  - 1.6 (criteria met, but not marked done): all 3 topics wrote `.json` and `.md` and printed time, cost and pass rate.
    - Alexander (3 days): 313.6s, $1.17, 83% (6/6 lessons ready).
    - Excel (7 days): 403.6s, $1.94, 78% (18/18).
    - Black holes (2 days): 124.1s, $0.61, 100% (4/4).
- Leftovers (why 1.6 stays `[~]`):
  - `audit:course` found 27 `##` sections without a citation, 25 of them in Excel (capstone steps, recaps, "XLSX vs. CSV"). That breaks the CLAUDE.md rule "every factual lesson section cites at least one stored source" for at least some sections.
  - The 1.6 quality-review checkpoint is the user's to do.
- SPEC targets missed:
  - Syllabus time: 24.5–64.0s against < 20s.
  - Flag rate: 17% (Alexander) and 22% (Excel) against < 5%.
  - Cost per 7 days: $1.94–$2.73 against < $0.75. Being worked on next.
  - Correct quiz answers are skewed toward "b" (Excel 50/70).
- Decisions: none.

## 2026-09-30: Cost overrun, first pass (supports 1.6 and the SPEC cost target; measurement incomplete)
- Context: the first live run cost $1.94 for the 7-day Excel course and $2.73 per 7 days at Alexander's pace, against a target of < $0.75. The lesson writer (Sonnet 5.5) was 74% of spend. About half its output was thinking at the default `high` effort, and about half the characters of Tavily's markdown grounding were link URLs and titles. The price table was checked against Anthropic's current model table and is correct.
- Changed (commit `cec1d44`):
  - `trimGrounding` now runs `stripMarkdownNoise` first. It keeps link text and drops URLs and titles, images, autolinks, footnote/back-reference/edit links, table separator rows and empty cells. Offline, on the first run's stored grounding, this removed 43% of characters for Alexander, 37% for black holes and 17% for Excel.
  - `callJson` takes an optional `effort`. It goes in `output_config` next to the format and is skipped for models that reject it (Haiku 4.5, Sonnet 4.5).
  - Call logs now include `think=` (thinking tokens).
  - The lesson writer uses `effort: "medium"`.
- Evidence:
  - `pnpm test` 344/344 passed (6 new `stripMarkdownNoise` tests, 1 for word counting after stripping, 2 client tests for effort and thinking tokens). Typecheck and lint are clean.
  - Live A/B with Excel (7 days) and Alexander (3 days). Both runs stopped early when the Anthropic account ran out of credits: 12–13 of 18 Excel lessons and 3 of 6 Alexander lessons failed with "Your credit balance is too low". Whole-course costs are therefore not comparable. Lesson-writer cost per successful call:
    - Excel: baseline $0.0624. Stripping + Sonnet medium: $0.0404 (−35%; input 11.2k→8.0k, output 4.0k→2.4k). Stripping + Haiku: $0.0138 (−78%).
    - Alexander: baseline $0.1156. Stripping + Sonnet medium: $0.0650 (−44%; input 29.0k→16.1k, output 5.8k→3.3k). Stripping + Haiku: $0.0235 (−80%).
    - Only 5 of 18 Sonnet-medium calls reported any thinking tokens.
  - Projected from the per-call numbers: Excel ≈ $1.35–1.45 (was $1.94); Alexander ≈ $1.9 per 7 days (was $2.73). Still above $0.75.
  - Quality:
    - Sonnet medium: 1 of 8 audited lessons came in under the word range (950 words against 1,200–1,600).
    - Haiku: 7 of 11 lessons came in under range, some at half the target (461 words against 1,050–1,400). Fact-check flags were 0/6 on Excel and 1/3 on Alexander, but the samples are too small to compare.
- Leftovers:
  - Add Anthropic credits, then rerun the full measurement: `pnpm gen:course` for Excel and Alexander, then `pnpm audit:course`.
  - Haiku as lesson writer is not adopted: its lessons are too short. It could be retried with a length-enforcing retry.
  - $0.75 still needs a product decision: a cheaper writer, shorter lessons, or a revised target.
- Decisions: one row added to the ARCHITECTURE.md decisions log.

## 2026-09-30: Cost overrun, full rerun after credits were added (supports 1.6 and the SPEC cost target)
- Evidence: all lessons completed on commit `1336a11`: stripped grounding plus Sonnet 5.5 at `medium` effort.
  - Excel (7 days): 309.8s, $1.67 (was $1.94, −14%). Lesson writer: 25 calls, $1.21 (was 23 calls, $1.43). 7 rewrites (was 5). Flag rate 17% (was 22%). 23 audit problems, including 4 lessons under the word range (was 0).
  - Alexander (3 days): 205.7s, $1.11 (was $1.17, −5%), which is $2.58 per 7 days. Lesson writer: 11 calls, $0.84 (was 7 calls, $0.81). 5 rewrites (was 1). **Flag rate 83% (was 17%).**
  - Per lesson-writer call: Excel −22% ($0.0486 vs $0.0624), Alexander −34% ($0.0767 vs $0.1156). Extra rewrites ate most of the saving.
- Findings:
  - Rewrites, not first drafts, now decide course cost. Each rewrite is a full extra lesson-writer call.
  - Of the 6 flagged Alexander claims:
    - 1 is a real error: Gaugamela "October 31"; Britannica in the grounding says October 1.
    - 2 are stated in stored grounding: Pindar's house spared, and "second and final battle between the two kings". Likely fact-checker false positives, unless those passages weren't in that lesson's sources.
    - The rest aren't clearly supported by the passages.
  - Whether `medium` effort raised the flag rate is not established. It's one run with 6 lessons, and the Excel flag rate went down.
- Leftovers:
  - Isolate the effort change: rerun with stripping at the default effort.
  - Look into fact-checker false positives, which belong to the flag-rate work.
  - $0.75 is still far off and needs a product decision.
- Decisions: none yet; `medium` effort stays pending that isolation run.

## 2026-10-01: Cost overrun, effort isolation test; lesson writer back to default effort (supports 1.6 and the SPEC cost target)
- Evidence: Alexander (3 days) with stripped grounding at the default (`high`) effort: 248.0s, $1.04, 6/6 lessons ready, 9 lesson-writer calls ($0.0854 per call), 3 rewrites, flag rate 50% (3/6). Average writer output was 5,389 tokens, of which 1,647 were thinking. Comparison:
  - Original (unstripped, `high`): $1.17; per call $0.1156; 1 rewrite; 1/6 flagged.
  - Stripped, `high`: $1.04; per call $0.0854 (−26%); 3 rewrites; 3/6 flagged.
  - Stripped, `medium`: $1.11; per call $0.0767 (−34%); 5 rewrites; 5/6 flagged; average thinking 257 tokens.
- Changed: the lesson writer no longer sets `effort`. `medium` cut thinking by about 85%, but the extra rewrites made the course cost more ($1.11 vs $1.04) and flagged more lessons. The `effort` option in `callJson` stays. The decisions-log row is updated.
- Some flags are genuine errors caught by the fact-checker: Hydaspes dated "526 BCE" (it was 326), and Gaugamela dated "October 31" (it was October 1), which appeared in two separate runs. Flag rates swing widely between runs of 6 lessons (17%, 50%, 83%), so whether stripping affects flags isn't established either.
- `pnpm test` 344/344 passed; typecheck and lint are clean. No secrets in the diff, and no LLM calls outside `src/lib/llm/`.
- Leftovers:
  - 1.6 stays `[~]`: sections without citations are still found (17 in the latest Excel run, 1 in Alexander).
  - Rewrites now decide course cost, so the flag-rate work (fact-checker false positives, factual errors in drafts) is the next cost lever.
  - $0.75 is still far off: about $1.6 for Excel and $2.4 per 7 days for Alexander.
- Decisions: the decisions-log row is updated (effort plumbing kept, no agent uses it).
