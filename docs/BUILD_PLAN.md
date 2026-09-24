# Build Plan

Work top to bottom. One task per Claude Code request. Each task has **acceptance criteria** (what "done" means) and a **prompt** you can paste as-is or run via `/next-task`.

Status key: `[ ]` todo · `[~]` in progress · `[x]` done. Claude Code updates the checkbox when a task passes.

---

## Phase 0: Project setup

### [ ] 0.1 Scaffold the project
**Acceptance:** `pnpm dev` serves a page; `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass; `.env.example` lists every variable in CLAUDE.md; `.gitignore` excludes `.env.local`; git repo initialized with first commit.
**Prompt:**
> Do task 0.1 from docs/BUILD_PLAN.md. Scaffold a Next.js App Router + TypeScript (strict) project with pnpm, Tailwind, shadcn/ui, Vitest, and ESLint. Create the folder structure from docs/ARCHITECTURE.md with placeholder index files. Add the scripts listed in CLAUDE.md (gen:course can be a stub for now). Show me the plan first.

### [ ] 0.2 LLM client wrapper
**Acceptance:** `src/lib/llm/client.ts` exports `callJson<T>(opts: { agent, model, system, prompt, schema })`; retries on network errors (3x backoff); on Zod failure retries once with the error appended; logs tokens and estimated cost; unit tests cover success, invalid-JSON retry, and final failure (with the SDK mocked).
**Prompt:**
> Do task 0.2. Build the LLM client wrapper as described in CLAUDE.md and the acceptance criteria. Include a small cost table in llm/cost.ts keyed by model env var with a TODO to confirm current prices. Write the tests with a mocked Anthropic SDK.

---

## Phase 1: Pipeline as a CLI (no UI, no database)
Goal: prove the course quality before building any app. Output is a JSON file you can read.

### [ ] 1.1 Time-budget engine
**Acceptance:** `timeBudget.ts` implements the rules in ARCHITECTURE.md; ≥ 8 unit tests including 1-day, 7-day, 30-day, skill vs knowledge, and final-day review.
**Prompt:**
> Do task 1.1. Implement the time-budget engine exactly per docs/ARCHITECTURE.md as a pure function with thorough tests.

### [ ] 1.2 Zod schemas + prompt templates
**Acceptance:** `schemas.ts` defines every output shape in docs/AGENTS.md; `prompts/` has one template per agent (planner, curriculum, lessonWriter, examiner, factChecker, intake); schemas have unit tests with valid and invalid fixtures.
**Prompt:**
> Do task 1.2. Create Zod schemas for every agent output in docs/AGENTS.md and write the prompt templates, following the rules listed for each agent. Put example valid/invalid outputs in tests/fixtures.

### [ ] 1.3 Research clients
**Acceptance:** `tavily.ts`, `youtube.ts`, `wikipedia.ts` each export a typed search function with timeouts and error handling; `scoring.ts` implements the scoring rules with unit tests; a smoke script prints top 5 scored sources for "Alexander the Great".
**Prompt:**
> Do task 1.3. Build the three research clients and the source scoring module per docs/ARCHITECTURE.md. Decide embeddings vs LLM-based relevance scoring (see the embeddings note), explain your recommendation, and log the decision. Then run the smoke test and show me the output.

### [ ] 1.4 Planner, Researcher, Curriculum Designer
**Acceptance:** each agent function works end to end on a real topic; curriculum day totals are within ±10% of budget (enforced in code with one retry).
**Prompt:**
> Do task 1.4. Implement planner.ts, researcher.ts, and curriculum.ts per docs/AGENTS.md using the LLM client. Enforce the time-total rule in code. Show me the syllabus output for "Excel for beginners, 7 days, 30 min/day".

### [ ] 1.5 Lesson Writer, Examiner, Fact-Checker
**Acceptance:** generating one lesson produces markdown with numbered citations that map to real sources, 3–5 quiz questions, and a fact-check result; the rewrite-on-fail loop works (test with a fixture that fails).
**Prompt:**
> Do task 1.5. Implement lessonWriter.ts, examiner.ts, and factChecker.ts with the rewrite loop from docs/AGENTS.md. Generate Day 1 Lesson 1 for the Excel syllabus and show me the full output.

### [ ] 1.6 Full CLI run
**Acceptance:** `pnpm gen:course "Alexander the Great" --days 3 --minutes 30 --level beginner` writes `out/<slug>.json` and `out/<slug>.md` (readable course); prints total time, cost, and fact-check pass rate. Run on 3 very different topics.
**Prompt:**
> Do task 1.6. Wire everything together in runCourse.ts and scripts/gen-course.ts. Run it for "Alexander the Great" (3 days), "Excel for beginners" (7 days), and "How black holes work" (2 days). Report time, cost, and fact-check results for each.

### 🛑 Checkpoint: quality review (you, not Claude)
Read the three generated courses yourself. Are they accurate? Well paced? Would you finish them? Note problems, then ask Claude Code to tune the prompts. **Don't move to Phase 2 until you'd happily use these courses.** This is the most important step in the whole plan.

---

## Phase 2: Database + auth

### [ ] 2.1 Supabase schema
**Acceptance:** migration in `supabase/migrations/` matches ARCHITECTURE.md; RLS policies on all user tables; applied to the Supabase project; typed DB client generated.
**Prompt:**
> Do task 2.1. Create the Supabase migration from docs/ARCHITECTURE.md, including RLS policies so users can only access their own courses and child rows. Generate TypeScript types. Walk me through applying it.

### [ ] 2.2 Auth
**Acceptance:** email magic-link sign in/out works; `(app)` routes redirect to sign-in when logged out; profile row created on first sign-in.
**Prompt:**
> Do task 2.2. Add Supabase Auth with email magic links, protected (app) routes, and automatic profile creation.

### [ ] 2.3 Persist pipeline output
**Acceptance:** `runCourse` can save to the DB instead of files (flag); CLI supports `--save`; data round-trips correctly (test).
**Prompt:**
> Do task 2.3. Add DB persistence to the pipeline via src/lib/db/queries.ts and a --save flag on the CLI. Keep the file output option.

---

## Phase 3: Background jobs

### [ ] 3.1 Inngest setup + syllabus job
**Acceptance:** `course/syllabus.requested` event runs planner → research → curriculum as separate steps; course status updates to `syllabus_ready`; failures set `failed` with an error message.
**Prompt:**
> Do task 3.1. Set up Inngest (client, API route, local dev) and build the syllabus generation function with each agent as its own step.

### [ ] 3.2 Just-in-time lesson jobs
**Acceptance:** on confirm, Day 1 lessons generate in parallel; completing day N queues day N+2; a scheduled function tops up active courses nightly; each lesson's status moves pending → generating → ready/failed.
**Prompt:**
> Do task 3.2. Implement just-in-time lesson generation per the Generation strategy section of docs/ARCHITECTURE.md.

---

## Phase 4: The app UI (MVP complete)

### [ ] 4.1 Chat intake page
**Acceptance:** `/new` has a chat UI; intake agent asks follow-ups one at a time; harmful topics get a polite refusal; when complete, a "Build my syllabus" button fires the syllabus job.
**Prompt:**
> Do task 4.1. Build the /new chat intake page and /api/intake route using the intake agent. Keep the UI clean and mobile-friendly with shadcn components. Show me the plan first.

### [ ] 4.2 Syllabus preview + edit
**Acceptance:** loading state while generating (poll or realtime); day-by-day outline with minutes; user can request edits in plain language (re-runs curriculum with the feedback); "Start course" confirms.
**Prompt:**
> Do task 4.2. Build the syllabus preview page with a generation loading state, plain-language edit requests, and a confirm button.

### [ ] 4.3 Lesson page
**Acceptance:** renders markdown with clickable citations to a sources list; embedded YouTube videos; key terms; practice task; quiz with instant feedback and explanations; "mark complete" + too easy/just right/too hard buttons; unverified-claims notice when relevant.
**Prompt:**
> Do task 4.3. Build the lesson page with all elements in the acceptance criteria.

### [ ] 4.4 Dashboard + progress
**Acceptance:** `/courses` lists courses with progress bars; course overview shows days, locked/unlocked state, streak; final day shows final quiz and summary.
**Prompt:**
> Do task 4.4. Build the courses dashboard and course overview with progress tracking.

### [ ] 4.5 Polish + deploy
**Acceptance:** empty states, error states, loading skeletons everywhere; Lighthouse accessibility ≥ 90; deployed to Vercel with env vars set; Inngest connected in production.
**Prompt:**
> Do task 4.5. Do a polish pass (empty/error/loading states, accessibility), then walk me through deploying to Vercel and connecting Inngest and Supabase in production.

### 🛑 Checkpoint: beta test
Give it to 10–20 people. Track completion rate, time to first lesson, and cost per course. Collect feedback before V2.

---

## Phase 5: V2 (pick based on beta feedback)

- [ ] 5.1 Adaptive difficulty: feed quiz scores + feedback into generation of upcoming days
- [ ] 5.2 Flashcards with spaced repetition (SM-2 algorithm)
- [ ] 5.3 Tutor chat per lesson, grounded in course sources
- [ ] 5.4 Email reminders (Resend) for daily lessons and streaks
- [ ] 5.5 Research cache for popular topics
- [ ] 5.6 Stripe subscriptions + free-tier limits

For each, first ask Claude Code to write a mini-spec into docs/SPEC.md and acceptance criteria into this file, then build it.
