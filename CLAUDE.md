# CourseForge

An app that builds a personalized, time-boxed course on any topic. The user says what they want to learn and how long they have ("Excel in 1 week, 30 min/day"). The app researches the web, then generates a day-by-day course with cited lessons, curated videos, quizzes, and progress tracking.

**Source of truth:** `docs/SPEC.md` (what), `docs/ARCHITECTURE.md` (how), `docs/AGENTS.md` (AI contracts), `docs/BUILD_PLAN.md` (order of work). Read the relevant doc before starting a task. If a request conflicts with the docs, ask before proceeding.

## Workflow rules

- Work on **one task from `docs/BUILD_PLAN.md` at a time**. Don't start the next task unprompted.
- Before coding anything non-trivial, state a short plan (files to create or change, approach) and wait for approval.
- A task is done only when its **acceptance criteria pass** and you've shown the evidence (test output, script output, screenshot description).
- After finishing a task, append an entry to `docs/PROGRESS.md`: date, task ID, what changed, anything left over, decisions made.
- If you make an architectural decision not covered by the docs, add it to the "Decisions log" in `docs/ARCHITECTURE.md`.
- Never commit secrets. Keys live in `.env.local` only; keep `.env.example` updated with variable names.
- Don't install new dependencies without saying why. Prefer the stack below.

## Tech stack

- **Framework:** Next.js (App Router) + TypeScript (strict mode)
- **UI:** Tailwind CSS + shadcn/ui
- **Database/Auth:** Supabase (Postgres + pgvector + Auth)
- **LLM:** Anthropic TypeScript SDK (`@anthropic-ai/sdk`)
- **Research:** Tavily API (web), YouTube Data API v3 (video), Wikipedia REST API (facts)
- **Background jobs:** Inngest
- **Validation:** Zod for every LLM output and API boundary
- **Tests:** Vitest
- **Package manager:** pnpm

## Commands

```bash
pnpm dev                 # run the app locally
pnpm test                # run unit tests
pnpm typecheck           # tsc --noEmit
pnpm lint                # eslint
pnpm gen:course "<topic>" --days 3 --minutes 30 --level beginner   # CLI pipeline test (Phase 1)
npx inngest-cli dev      # local Inngest dev server (Phase 3+)
```

## Code conventions

- All pipeline code lives in `src/lib/pipeline/`. Each agent is one file exporting one async function with typed input and a Zod-validated output.
- LLM prompts live in `src/lib/pipeline/prompts/` as exported template functions, not inline strings.
- Every LLM call goes through `src/lib/llm/client.ts`, which handles model selection, retries (3, exponential backoff), JSON parsing, Zod validation, and token/cost logging.
- Model choices come from env vars (`MODEL_SMART`, `MODEL_FAST`), never hard-coded.
- Server-only code (API keys, pipeline) must never be imported into client components.
- Use named exports. Keep functions small. Handle errors explicitly; no silent catches.
- Write a unit test for every pure function (time-budget math, source scoring, parsers). Mock LLM and search calls in tests using fixtures in `tests/fixtures/`.

## Content rules (non-negotiable)

- Lessons are written in **original wording**. Never copy paragraphs from sources. Quotes must be short and attributed.
- Every factual lesson section cites at least one stored source.
- Videos and articles are **linked or embedded**, never re-hosted.
- Medical, legal, financial, and safety-critical topics get a visible disclaimer. Refuse to generate courses on clearly harmful topics (weapons, self-harm methods, etc.).

## Environment variables

See `.env.example`. Required: `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `YOUTUBE_API_KEY`, `MODEL_SMART`, `MODEL_FAST`. From Phase 2: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. From Phase 3: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`.
