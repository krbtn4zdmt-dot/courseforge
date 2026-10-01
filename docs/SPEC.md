# Product Spec: CourseForge

## One-liner
Tell it what you want to learn and how long you have; it researches the topic and builds you a structured, cited, day-by-day course that fits your schedule.

## Why CourseForge wins
The alternatives each miss something: a human tutor is expensive and needs scheduling; ChatGPT-style chat has no plan, no memory of your progress and unchecked facts, and reading answers feels like learning when it often isn't; NotebookLM needs you to bring the sources and gives you no day-by-day path; video courses are fixed-length and passive. CourseForge wins on the combination:
- **Built around a deadline.** "I have 5 days, 30 minutes a day" is a promise, not a pace. Every day is time-boxed, and adaptive catch-up keeps the deadline when you fall behind. Made for exam prep, new jobs and upcoming trips.
- **Built around your goal.** Bring your syllabus, job description or study guide and the course matches it ("learn what's on my midterm next Thursday"), or say what it's for ("I'm visiting Rome in two weeks").
- **Active, not passive.** Every day is a playable session: warm-up recall, test-out to skip what you know, short cards with something to do at least every ~90 seconds, decisions, games, explain-it-back, and a coach that knows your mistakes.
- **Trustworthy.** Every factual claim is cited and fact-checked; you choose how strict the sources are; where sources disagree, the lesson says so instead of picking one.
- **Accountable.** Streaks, daily unlocks, catch-up plans, study groups, a parent or teacher view, and recap texts after the course.
- **Fits a real day.** A 5-minute micro-lesson option and an audio version for the commute.

## Target users
- Students who need to get up to speed on a subject fast (exam prep, new class, project), often with a syllabus or study guide in hand
- Professionals learning a tool or skill (Excel, SQL, Figma), often for a specific new job
- Travelers and the curious learning for a purpose (a trip, a hobby) or exploring knowledge topics (Alexander the Great, black holes)
- Study groups, parents and teachers who want to learn together or keep someone on track

## Core user flow
1. **Ask:** user types a topic and timeframe in a chat box ("I want to learn Excel in 1 week"). They can also:
   - **Bring a syllabus:** upload or paste a class syllabus, job description or study guide (PDF, DOCX, or text). The course is built to cover what it asks for, by its dates ("my midterm is next Thursday").
   - **Learn for a purpose:** say what it's for ("I'm visiting Rome in two weeks", "I start a data analyst job Monday"); lessons are tied to the places you'll see or the tasks the job uses.
2. **Intake:** the bot asks up to 3 short follow-ups, skipping any already answered:
   - Current level: `beginner | some_exposure | refresher`
   - Minutes per day: 15 / 30 / 45 / 60 / 90 (other answers snap to the nearest)
   - Goal: `understand | pass_test | practical_skill`
   Source strictness defaults to "standard" and can be changed on the preview (see Sources and trust).
3. **Syllabus preview:** shown within ~20 seconds. Day-by-day outline with lesson titles and time estimates. For an uploaded syllabus or a stated purpose, a coverage map shows what each day covers ("Midterm topics: 10 of 10 covered"). User can edit via chat ("less about battles, more about his legacy") or regenerate.
4. **Confirm:** course is created, solo or as a group course (invite friends, shared deadline), or assigned by a parent or teacher. Day 1 is generated immediately; later days are generated in the background ahead of time. Day 1 is open straight away; each later day unlocks when the previous day's lessons are all complete.
5. **Learn:** each day is an interactive session that fits its time box:
   - **Warm-up** (from day 2): quick recall of earlier days, with missed items coming back first.
   - **Test-out:** a short check per lesson; get it all right and skip the briefing you already know.
   - **Teach first, then use it.** Each part of a lesson opens with a short passage split into pages of at most about 80 words (2–3 pages per passage, with a page counter so it reads quickly) and, where the course has one, a curated video with a "watch for" note. Activities then put it to work: predict before reading, make a decision in a scenario, match, put in order, myth or fact, spot the error. There's something to do at least every ~90 seconds of reading, and review never replaces teaching. Confidence ratings ("guessing / fairly sure / certain") on recall questions.
   - **Practice** for skill topics (a worked example, then you do the next step), 0–2 curated videos, and key terms.
   - **Explain it back:** a sentence or two in your own words, with AI feedback checked against the course's sources.
   - **Coach** (V2): ask questions any time; answers come only from the course's sources and know what you got wrong.
   - Every card carries its citations; a **micro-lesson** (5 minutes) and an **audio version** (V2) are available for short days and commutes.
6. **Track:** progress bar, streak, daily unlocks, skills map, quiz scores. From day 3, each day ends with a short review of earlier days. If you fall behind, **adaptive catch-up** rebalances the remaining days to still hit your deadline (or offers to move it).
7. **Adapt (V2):** quiz results, confidence and "too easy / too hard" feedback adjust upcoming days.
8. **Finish:** final challenge and a one-page summary sheet. Then, if opted in, one recap question a day by text for two weeks to fight forgetting.

## Timeframe parsing
Accept natural phrasing: "in 3 days", "1 week", "two weeks", "by Friday", "a month". Normalize to `days` (integer, 1–60), counting today as day 1, so "by Friday" on a Wednesday is 3 days. If ambiguous, ask. Cap at 60 days in MVP.

## Topic types
The planner classifies each topic, which changes lesson mix:
- **knowledge** (history, science concepts): narrative lessons, timelines, key figures, recall quizzes
- **skill** (Excel, coding, cooking): step-by-step lessons, practice tasks, fewer narrative sections
- **hybrid** (personal finance, photography): both

## Sources and trust
- Every factual card cites at least one stored source, and every lesson goes through the fact-check pass.
- **Source strictness** per course: `academic_only` (universities, journals, government, encyclopedias, Wikipedia), `standard` (the default: reputable web plus encyclopedias), or `include_creators` (adds YouTube creators and blogs as citable sources where their transcript or text supports the claim).
- **Disagreement flags:** where the course's sources conflict on a fact (a date, a number, a cause), the lesson shows a "Sources disagree" note naming each version and its source ("Britannica's article gives both 1 October and 31 October for Gaugamela"; "Historians disagree on how Alexander died") instead of presenting one version as fact.

## Learning together
- **Group courses:** a study group or class shares one course with a shared deadline, an opt-in leaderboard and group progress. Accountability from friends beats push notifications.
- **Parent or teacher view:** a parent or teacher assigns a course and sees progress, quiz scores and the skills map (the learner sees exactly what is shared). This opens a path to selling to schools later.

## Scope

### MVP (Phases 1–4)
- Chat intake with timeframe parsing, **bring your syllabus** (upload or paste) and **learn for a purpose**
- Editable syllabus preview with a coverage map
- Research pipeline (web + YouTube + Wikipedia) with **source strictness** and **disagreement flags**
- **Interactive day sessions:** short cited cards with an action at least every ~90 seconds, test-out, warm-ups, confidence ratings, explain-it-back with AI feedback, micro-lesson option
- Curated video embeds
- Multiple-choice quizzes with explanations
- Just-in-time lesson generation (background jobs)
- Auth, saved courses, progress tracking, **streaks, daily unlocks and adaptive catch-up**
- Fact-check pass on every lesson

### V2 (Phase 5)
- Adaptive difficulty from quiz results and confidence
- Spaced repetition: missed items and key terms feed each day's warm-up
- Coach chat, grounded only in that course's sources and aware of the learner's mistakes
- Email/push reminders
- **Commute mode:** an audio version of every lesson
- **Daily recap texts:** one question a day by text for two weeks after the course (opt-in)
- Research cache for popular topics
- Payments, once completion rate is proven

### Phase 6: learning together
- Group courses with a shared deadline and opt-in leaderboard
- Parent or teacher view (assign a course, see progress); schools later, after a compliance review

### Out of scope (for now)
- Native mobile app
- Public course library and public social feeds
- Interactive in-browser spreadsheets/coding sandboxes

## Success metrics
- **North star:** course completion rate (target > 40% in beta)
- Time from confirm → Day 1 readable: < 90 seconds
- Syllabus preview: < 20 seconds
- Fact-check flag rate: < 5% of lessons shipped with the "some claims could not be verified" notice
- Cost per 7-day course: track from day one; target < $0.75
- **Retention:** ≥ 70% correct on recap questions 7 days after a lesson (measured from beta; this is the test that interactivity is producing learning, not just activity)
- Day-2 return rate and streak length; time saved by test-out; completion rate of group courses vs solo

## Non-goals and guardrails
- Uploaded documents are private to their owner, used only to build that course, never shown to a group or viewer, and deleted with the course. Lessons stay in original wording; an uploaded study guide is a map of what to cover, not text to copy.
- Engagement features serve learning: no streak-loss guilt messages, leaderboards are opt-in and show first names only, and recap texts are opt-in, at most one a day, outside quiet hours, with STOP to end them.
- Parent or teacher view and group courses: learners must be 13 or older during the beta; schools and under-13 learners need a compliance review (e.g. COPPA, FERPA) first.
- Source strictness never overrides the harmful-content rules.
- Not a replacement for professional advice: medical, legal, and financial courses show a disclaimer.
- Refuse courses that would teach someone to cause harm (making weapons or drugs, breaking into systems or accounts that aren't yours, self-harm methods, etc.) with a friendly message. Judge by what the course teaches someone to do, not the subject: defensive cybersecurity, military history and pharmacology are fine. Full rules in AGENTS.md (Intake).
