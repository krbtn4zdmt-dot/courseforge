# Build Plan

Work top to bottom. One task per Claude Code request. Each task has **acceptance criteria** (what "done" means) and a **prompt** you can paste as-is or run via `/next-task`.

Status key: `[ ]` todo · `[~]` in progress · `[x]` done. Claude Code updates the checkbox when a task passes.

---

## Phase 0: Project setup

### [x] 0.1 Scaffold the project
**Acceptance:** `pnpm dev` serves a page; `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass; `.env.example` lists every variable in CLAUDE.md; `.gitignore` excludes `.env.local`; git repo initialized with first commit.
**Prompt:**
> Do task 0.1 from docs/BUILD_PLAN.md. Scaffold a Next.js App Router + TypeScript (strict) project with pnpm, Tailwind, shadcn/ui, Vitest, and ESLint. Create the folder structure from docs/ARCHITECTURE.md with placeholder index files. Add the scripts listed in CLAUDE.md (gen:course can be a stub for now). Show me the plan first.

### [x] 0.2 LLM client wrapper
**Acceptance:** `src/lib/llm/client.ts` exports `callJson<T>(opts: { agent, model, system, prompt, schema })`; retries on network errors (3x backoff); on Zod failure retries once with the error appended; logs tokens and estimated cost; unit tests cover success, invalid-JSON retry, and final failure (with the SDK mocked).
**Prompt:**
> Do task 0.2. Build the LLM client wrapper as described in CLAUDE.md and the acceptance criteria. Include a small cost table in llm/cost.ts keyed by model env var with a TODO to confirm current prices. Write the tests with a mocked Anthropic SDK.

---

## Phase 1: Pipeline as a CLI (no UI, no database)
Goal: prove the course quality before building any app. Output is a JSON file you can read.

### [x] 1.1 Time-budget engine
**Acceptance:** `timeBudget.ts` implements the rules in ARCHITECTURE.md; ≥ 8 unit tests including 1-day, 7-day, 30-day, skill vs knowledge, final-day review, and the worked-examples table; a test sweeps every `minutesPerDay` from 15 to 90 and asserts every day sums to `minutesPerDay` and every lesson is 10–25 min.
**Prompt:**
> Do task 1.1. Implement the time-budget engine exactly per docs/ARCHITECTURE.md as a pure function with thorough tests.

### [x] 1.2 Zod schemas + prompt templates
**Acceptance:** `schemas.ts` defines every output shape in docs/AGENTS.md; `prompts/` has one template per agent (planner, curriculum, lessonWriter, examiner, factChecker, intake); schemas have unit tests with valid and invalid fixtures.
**Prompt:**
> Do task 1.2. Create Zod schemas for every agent output in docs/AGENTS.md and write the prompt templates, following the rules listed for each agent. Put example valid/invalid outputs in tests/fixtures.

### [x] 1.3 Research clients
**Acceptance:** `tavily.ts`, `youtube.ts`, `wikipedia.ts` each export a typed search function with timeouts and error handling; YouTube stays within 8 searches per course, caches by query, and returns no videos (not an error) when quota runs out; `scoring.ts` implements the scoring and shingle-dedupe rules with unit tests; a smoke script prints top 5 scored sources for "Alexander the Great" and the YouTube quota units it used.
**Prompt:**
> Do task 1.3. Build the three research clients and the source scoring module per docs/ARCHITECTURE.md. Use MODEL_FAST relevance scoring (no embeddings; see the embeddings note). Then run the smoke test and show me the output.

### [x] 1.4 Planner, Researcher, Curriculum Designer
**Acceptance:** each agent function works end to end on a real topic; the researcher supports light and deep modes; curriculum days match the time budget's slots and totals are within ±10% (enforced in code with one retry, then snapped to the slots); light research + planner + curriculum time is printed.
**Prompt:**
> Do task 1.4. Implement planner.ts, researcher.ts, and curriculum.ts per docs/AGENTS.md using the LLM client. Enforce the time-total rule in code. Show me the syllabus output for "Excel for beginners, 7 days, 30 min/day".

### [x] 1.5 Lesson Writer, Examiner, Fact-Checker
**Acceptance:** generating one lesson produces markdown with numbered citations that map to real sources, 3–5 quiz questions, and a fact-check result; the rewrite-on-fail loop works (test with a fixture that fails).
**Prompt:**
> Do task 1.5. Implement lessonWriter.ts, examiner.ts, and factChecker.ts with the rewrite loop from docs/AGENTS.md. Generate Day 1 Lesson 1 for the Excel syllabus and show me the full output.

### [~] 1.6 Full CLI run
**Acceptance:** `pnpm gen:course "Alexander the Great" --days 3 --minutes 30 --level beginner` writes `out/<slug>.json` and `out/<slug>.md` (readable course); prints total time, cost, and fact-check pass rate. Run on 3 very different topics.
**Prompt:**
> Do task 1.6. Wire everything together in runCourse.ts and scripts/gen-course.ts. Run it for "Alexander the Great" (3 days), "Excel for beginners" (7 days), and "How black holes work" (2 days). Report time, cost, and fact-check results for each.

## Phase 1b: What beats the alternatives (pipeline)

These build the differentiators in docs/SPEC.md ("Why CourseForge wins") into the pipeline, so the quality review below judges the real product. Each changes an agent contract in docs/AGENTS.md: update it in the same task.

### [ ] 1.7 Bring your syllabus
**Acceptance:** `pnpm gen:course --from-file <syllabus.pdf|.docx|.txt|.md>` (or pasted text) builds a course from an uploaded class syllabus, job description or study guide. A Requirements Mapper extracts the topics, objectives, weights and dates it asks for. PDFs go to Claude as documents (no PDF-parser dependency); any DOCX library is named and justified first. A date in the document ("midterm next Thursday") sets the course length. The planner and curriculum cover every requirement, and a coverage report maps each one to a day or says why it isn't covered. Run on a real class syllabus, a job description and a study guide; unit tests for the coverage math.
**Prompt:**
> Do task 1.7. Add uploaded-syllabus support per docs/SPEC.md: a Requirements Mapper agent, planner/curriculum changes so the course covers every requirement by its date, and a coverage report. Show me the plan first, including how each file type is read.

### [ ] 1.8 Learn for a purpose
**Acceptance:** intake captures a purpose ("visiting Rome in two weeks", "start a data analyst job Monday") and its date. The planner ties subtopics to it: each lesson names the place, task or situation it serves, and the syllabus is visibly different from the same topic without the purpose. Run Rome-trip and data-analyst-job courses and show both syllabi beside the plain-topic versions.
**Prompt:**
> Do task 1.8. Add purpose-driven courses: intake field, planner and curriculum rules, and the coverage report from 1.7 applied to the purpose. Show me the plan first.

### [~] 1.9 Interactive lesson format
**Acceptance:** each lesson is an ordered list of activity cards instead of one article:
- **Card types:** reading passage (2–3 pages of ≤ 80 words each), video (a curated clip with a "watch for" note), predict-then-reveal, decide (a scenario with outcomes), match, order, myth-or-fact, spot-the-error, practice step, explain-it-back.
- **Teach, then use:** each part of the lesson starts with a reading passage (and a video where the course has one) before its activities; review never replaces teaching. The video's minutes count against the lesson's media minutes, and an over-budget video is offered as "save for later".
- **Pacing:** an action at least every ~90 seconds of reading.
- **Rules unchanged:** citations per card, original wording.
- **Time split:** reading is about 35% of a lesson (30% for skills), videos 20% (15%), and activities, practice and quiz the rest, as in the Day 2 prototypes (decided 2026-10-01, to cut wordiness and cost).

The fact-checker covers every card, including scenario outcomes. `audit:course` checks the reading time between actions and citations per card. `eval:writer` and `eval:factcheck` show no regression. The cost per 7-day course is no higher than the prose format. The Alexander and Excel courses regenerate, and one day of each is playable in a local preview built on the Day 2 prototype.
**Prompt:**
> Do task 1.9. Change the Lesson Writer (and Examiner/Fact-Checker as needed) to produce interactive activity cards per docs/SPEC.md and AGENTS.md. Show me the plan and the card schema first.

### [ ] 1.10 Test-out and warm-ups
**Acceptance:** each lesson gets a 3-question test-out check, and each card that all three answers cover is marked skippable. Each day from day 2 gets a warm-up drawn from earlier days' items and key terms. The time saved by test-out is computed from the time budget. Unit tests cover the skip map and the warm-up selection.
**Prompt:**
> Do task 1.10. Generate test-out checks and daily warm-ups, with the skip map and time accounting in code. Show me the plan first.

### [ ] 1.11 Source strictness and disagreement flags
**Acceptance:** the researcher honours `sourcePreference`:
- `academic_only`: no blogs or creators.
- `standard`: today's behaviour.
- `include_creators`: YouTube creators and blogs are citable only where their transcript or text supports the claim.

When cited passages conflict on a specific fact, the lesson carries a "Sources disagree" note naming each version and its source, and the fact-checker no longer fails the lesson for that conflict. An Alexander run shows the Gaugamela date note, an `academic_only` course cites no blogs, and unit tests cover the source classification and the note format.
**Prompt:**
> Do task 1.11. Add source strictness to research and disagreement detection to the lesson pipeline per docs/SPEC.md ("Sources and trust"). Show me the plan first.

### [ ] 1.12 Micro-lessons
**Acceptance:** every lesson has a 5-minute path (its key cards plus two checks) selected in code from the full lesson, with no extra LLM calls. The time-budget math shows each path fits in 5 minutes. Unit tests.
**Prompt:**
> Do task 1.12. Derive a 5-minute micro-lesson path for every lesson, in code. Show me the plan first.

### 🛑 Checkpoint: quality review (you, not Claude)
Read and play the generated courses yourself, including one built from a real syllabus and one built for a purpose. Are they accurate? Well paced? Fun? Would you finish them? Note problems, then ask Claude Code to tune the prompts. **Don't move to Phase 2 until you'd happily use these courses.** This is the most important step in the whole plan.

---

## Phase 2: Database + auth

### [ ] 2.1 Supabase schema
**Acceptance:** migration in `supabase/migrations/` matches ARCHITECTURE.md (including the Phase 1b columns: purpose, deadline, source preference, requirements and coverage, lesson activities, test-out, micro path, disagreements, streaks, and the `uploads` table); RLS policies on all user tables; applied to the Supabase project; typed DB client generated.
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

### [ ] 2.4 Private uploads
**Acceptance:** uploaded syllabi, job descriptions and study guides go to a private Supabase Storage bucket; only the owner can read them (storage policies); the extracted requirements are stored on the course; deleting a course deletes its uploads (test).
**Prompt:**
> Do task 2.4. Add private upload storage for course documents per docs/ARCHITECTURE.md, with storage policies and cleanup on delete.

---

## Phase 3: Background jobs

### [ ] 3.1 Inngest setup + syllabus job
**Acceptance:** `course/syllabus.requested` event runs planner → research → curriculum as separate steps; course status updates to `syllabus_ready`; failures set `failed` with an error message.
**Prompt:**
> Do task 3.1. Set up Inngest (client, API route, local dev) and build the syllabus generation function with each agent as its own step.

### [ ] 3.2 Just-in-time lesson jobs
**Acceptance:** on confirm, deep research runs as its own step, then Day 1 lessons generate in parallel; completing day N queues day N+2; a scheduled function tops up active courses nightly; each lesson's status moves pending → generating → ready/failed.
**Prompt:**
> Do task 3.2. Implement just-in-time lesson generation per the Generation strategy section of docs/ARCHITECTURE.md.

---

## Phase 4: The app UI (MVP complete)

### [ ] 4.1 Chat intake page
**Acceptance:** `/new` has a chat UI where the intake agent asks follow-ups one at a time and harmful topics get a polite refusal. The user can upload or paste a syllabus, job description or study guide (drag and drop on desktop, file picker on phones), state a purpose and a date, and pick source strictness. When intake is complete, a "Build my syllabus" button fires the syllabus job.
**Prompt:**
> Do task 4.1. Build the /new chat intake page and /api/intake route using the intake agent, with uploads, purpose and source strictness. Keep the UI clean and mobile-friendly with shadcn components. Show me the plan first.

### [ ] 4.2 Syllabus preview + edit
**Acceptance:** loading state while generating (poll or realtime); day-by-day outline with minutes; coverage map for uploaded syllabi and purposes ("Midterm topics: 10 of 10 covered"); source strictness can be changed; user can request edits in plain language (re-runs curriculum with the feedback); "Start course" confirms.
**Prompt:**
> Do task 4.2. Build the syllabus preview page with a generation loading state, coverage map, plain-language edit requests, and a confirm button.

### [ ] 4.3 Interactive day player
**Acceptance:** a day plays as one session, modelled on the Day 2 prototype:
- **Session parts:** warm-up, per-lesson test-out that skips covered cards, every card type from 1.9 with instant feedback, and confidence ratings on recall questions.
- **Explain-it-back:** AI feedback via a server route, falling back to a self-check against key points.
- **Lesson content:** citations on every card, "Sources disagree" notes, the unverified-claims notice when relevant, embedded videos, key terms and the practice task.
- **Engagement layer:** points, combos, a skills map that fills in and a time-box meter.
- **Controls:** a micro-lesson toggle, plus mark complete and too easy / just right / too hard.
- **Quality:** keyboard and screen-reader accessible, and works at phone width.
**Prompt:**
> Do task 4.3. Build the interactive day player per the acceptance criteria, starting from the Day 2 prototype's flow. Show me the plan first.

### [ ] 4.4 Dashboard, streaks + catch-up
**Acceptance:** `/courses` lists courses with progress bars. The course overview shows days and their locked/unlocked state (day N unlocks when day N−1 is complete), the streak and the skills map. When the learner falls behind, adaptive catch-up rebalances the remaining days to still hit the deadline or offers to move it; the rebalancing is a pure function with unit tests. The final day shows the final challenge and the summary sheet.
**Prompt:**
> Do task 4.4. Build the courses dashboard and course overview with streaks, daily unlocks and adaptive catch-up.

### [ ] 4.5 Polish + deploy
**Acceptance:** empty states, error states, loading skeletons everywhere; Lighthouse accessibility ≥ 90; YouTube quota increase requested (or the beta sized to the default quota); deployed to Vercel with env vars set; Inngest connected in production.
**Prompt:**
> Do task 4.5. Do a polish pass (empty/error/loading states, accessibility), help me request a YouTube Data API quota increase, then walk me through deploying to Vercel and connecting Inngest and Supabase in production.

### 🛑 Checkpoint: beta test
Give it to 10–20 people, including a few students with a real syllabus. Track completion rate, day-2 return rate, retention on recap questions after 7 days, time to first lesson, time saved by test-out, and cost per course. Collect feedback before V2.

---

## Phase 5: V2, fit into a real day (pick based on beta feedback)

- [ ] 5.1 Adaptive difficulty: feed quiz scores, confidence and too easy/too hard feedback into generation of upcoming days
- [ ] 5.2 Spaced repetition (SM-2): missed items and key terms feed each day's warm-up across the course
- [ ] 5.3 Coach chat, grounded only in the course's sources and aware of the learner's mistakes, with a per-user daily cost cap
- [ ] 5.4 Reminders by email (Resend), then push, for daily lessons and streaks
- [ ] 5.5 Commute mode: an audio version of every lesson (choose and justify a text-to-speech provider in the task's mini-spec), playable with the screen off
- [ ] 5.6 Daily recap texts: one question a day by SMS for two weeks after the course ends; opt-in, quiet hours, STOP to end; answer by reply or link (choose and justify an SMS provider in the mini-spec)
- [ ] 5.7 Research cache for popular topics
- [ ] 5.8 Stripe subscriptions + free-tier limits

For each, first ask Claude Code to write a mini-spec into docs/SPEC.md and acceptance criteria into this file, then build it.

---

## Phase 6: Learn together

- [ ] 6.1 Sharing model: course members with roles (owner, member, viewer) and RLS rewritten from owner-only to membership-based, with tests that a non-member can read nothing
- [ ] 6.2 Group courses: invite link, one shared course and deadline, opt-in leaderboard (first names only), group progress, friendly nudges
- [ ] 6.3 Parent or teacher view: assign a course by invite, see progress, quiz scores and the skills map; the learner sees what's shared and consents; learners 13+ during the beta
- [ ] 6.4 Schools (later): class rosters and bulk assignment, only after a compliance review (e.g. COPPA, FERPA)

As in Phase 5, write each mini-spec and its acceptance criteria before building.
