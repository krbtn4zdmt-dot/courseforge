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

## 2026-09-30: Task 0.1: Scaffold the project
- Changed: Next.js 16.3.8 App Router + TypeScript (strict, plus `noUncheckedIndexedAccess`), Tailwind 4, shadcn/ui (`base-nova`, Button only), ESLint 9, Vitest 5, tsx. Folder structure from ARCHITECTURE.md: `src/lib/**` placeholders with `TODO(task X.Y)`, route-group pages, API routes returning 501, `supabase/migrations`, `tests/fixtures`, `tests/unit`. Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:watch`, `gen:course` (stub that validates args via `scripts/genCourseArgs.ts`). `.gitignore` ignores all `.env*` except `.env.example`. Fixed `MODEL_SMART` to `claude-sonnet-5-5` in `.env.example` and ARCHITECTURE.md.
- Evidence: `pnpm typecheck`, `pnpm lint` pass; `pnpm test` 12/12 pass (arg parser + `@/` alias); `pnpm dev` serves `/`, `/new`, `/courses`, `/courses/[id]`, `/courses/[id]/lessons/[lessonId]` with 200, `POST /api/intake` returns 501; `pnpm gen:course "Alexander the Great" --days 3 --minutes 30 --level beginner` prints parsed args, bad args exit 1 with usage.
- Leftovers: `@anthropic-ai/sdk`, `zod`, `inngest`, Supabase packages not installed yet (added by the tasks that use them). pnpm skipped esbuild's build script; tsx works without it. The landing page uses `next/font/google` (Geist), which fetches fonts at build time.
- Decisions: three entries added to the ARCHITECTURE.md decisions log (agentRules opt-out, typegen before tsc, shadcn base-nova).

## 2026-09-30: Task 0.2: LLM client wrapper
- Changed: `src/lib/llm/client.ts` (`callJson` plus `createLlmClient` for dependency injection, typed errors `LlmConfigError` / `LlmValidationError` / `LlmRefusalError` / `LlmTruncatedError`), `src/lib/llm/cost.ts` (price table, cost estimate, per-call JSON log). Added `@anthropic-ai/sdk` 0.130.0 and `zod` 4.6.5. Tests in `tests/unit/llm/`, fixtures in `tests/fixtures/llm/`.
- Evidence: typecheck and lint pass; 46/46 tests pass (34 new: success, invalid-JSON retry, Zod retry with errors appended, final validation failure, network backoff 1s/2s/4s, giving up after 3 retries, no retry on 400, refusal, truncation, missing env var, fallback iteration pricing, unknown-model cost, cost math).
- Leftovers: no live API call yet (no `ANTHROPIC_API_KEY` in this environment); the first real call in task 1.4 should confirm structured outputs + `fallbacks: "default"` work together. Prices in `cost.ts` carry a TODO to confirm (last checked 2026-09-25). Thinking/effort left at model defaults.
- Decisions: four entries added to the ARCHITECTURE.md decisions log (structured outputs + Zod, client-owned retries, refusal/truncation handling with API fallbacks, `{ data, usage }` return and log shape).

## 2026-09-30: Task 1.1: Time-budget engine
- Changed: `src/lib/pipeline/timeBudget.ts`: `computeTimeBudget({ days, minutesPerDay, topicType })` returns `{ dayNumber, reviewMinutes, lessons: { estMinutes, readingMinutes, mediaMinutes, practiceMinutes }[] }[]`, plus exported helpers (`reviewMinutesFor`, `splitTeachingMinutes`, `splitLesson`) and constants. Integer-only rounding; input validation (`RangeError`); the function asserts its own invariants. Tests in `tests/unit/pipeline/timeBudget.test.ts`.
- Evidence: 26 new tests, 72/72 total pass; typecheck and lint pass. Covers the worked-examples table (15/30/90 min over 5 days), 1-, 2-, 7-, 30- and 60-day courses, review rounding (including 30 min → exactly 9), knowledge/skill/hybrid splits, reading absorbing rounding, input validation, and a sweep of every minutesPerDay 15–90 × every length 1–60 × all topic types (347,760 days): every day sums exactly, every lesson is 10–25 min, every lesson's parts sum to its estMinutes.
- Leftovers: none.
- Decisions: one entry added to the ARCHITECTURE.md decisions log (final-day rule precedence for 2-day courses; integer math).

## 2026-09-30: Task 1.2: Zod schemas + prompt templates
- Changed: `src/lib/pipeline/schemas.ts` (shared enums; `CourseRequest`; schemas for intake, planner, researcher `Source`/`ResearchResult`, curriculum, lesson writer, examiner, fact-checker; `extractCitationIndexes`), `src/lib/pipeline/disclaimers.ts`, `src/lib/pipeline/prompts/` (`shared.ts` + one template per agent: intake, planner, curriculum, lessonWriter, examiner, factChecker; `index.ts` re-exports). `scripts/genCourseArgs.ts` now reuses `LEVELS` from schemas. Fixtures: `tests/fixtures/agents/*.valid.json` (Alexander the Great, 3 days × 30 min) and `invalid.ts` (41 one-change invalid cases). Tests: `schemas.test.ts`, `prompts.test.ts`.
- Evidence: typecheck and lint pass; 173/173 tests pass (101 new). Every valid fixture parses; every invalid case fails with the expected message; every LLM schema converts with `zodOutputFormat`; prompts end with "Respond with JSON only.", are deterministic, and include their inputs; intake calendar checked across month, year and leap-day boundaries.
- Leftovers: prompts are untested against a live model (first real runs in 1.4/1.5). Time-budget slot matching for curriculum, source-existence and fact-check pass/fail checks are for 1.4/1.5. The planner receives a time budget before it has chosen `topicType`; slot counts don't depend on topic type, so any type works there.
- Decisions: three entries added to the ARCHITECTURE.md decisions log (code-added disclaimers, schema vs agent checks, prompt structure); AGENTS.md updated for the disclaimer and examiner option count.
