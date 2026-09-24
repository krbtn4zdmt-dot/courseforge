# Product Spec: CourseForge

## One-liner
Tell it what you want to learn and how long you have; it researches the topic and builds you a structured, cited, day-by-day course that fits your schedule.

## Target users
- Students who need to get up to speed on a subject fast (exam prep, new class, project)
- Professionals learning a tool or skill (Excel, SQL, Figma)
- Curious learners exploring knowledge topics (Alexander the Great, black holes)

## Core user flow
1. **Ask:** user types a topic and timeframe in a chat box ("I want to learn Excel in 1 week").
2. **Intake:** the bot asks up to 3 short follow-ups, skipping any already answered:
   - Current level: `beginner | some_exposure | refresher`
   - Minutes per day: 15 / 30 / 45 / 60 / 90 (other answers snap to the nearest)
   - Goal: `understand | pass_test | practical_skill`
3. **Syllabus preview:** shown within ~20 seconds. Day-by-day outline with lesson titles and time estimates. User can edit via chat ("less about battles, more about his legacy") or regenerate.
4. **Confirm:** course is created. Day 1 is generated immediately; later days are generated in the background ahead of time. Day 1 is open straight away; each later day unlocks when the previous day's lessons are all complete.
5. **Learn:** each lesson shows the written lesson (with citations), 0–2 curated videos, key terms, and a short quiz. Skill topics also get a hands-on practice task.
6. **Track:** progress bar, streak, completed lessons, quiz scores. From day 3, each day ends with a short review of earlier days.
7. **Adapt (V2):** quiz results and "too easy / too hard" feedback adjust upcoming days.
8. **Finish:** final quiz and a one-page summary sheet.

## Timeframe parsing
Accept natural phrasing: "in 3 days", "1 week", "two weeks", "by Friday", "a month". Normalize to `days` (integer, 1–60), counting today as day 1, so "by Friday" on a Wednesday is 3 days. If ambiguous, ask. Cap at 60 days in MVP.

## Topic types
The planner classifies each topic, which changes lesson mix:
- **knowledge** (history, science concepts): narrative lessons, timelines, key figures, recall quizzes
- **skill** (Excel, coding, cooking): step-by-step lessons, practice tasks, fewer narrative sections
- **hybrid** (personal finance, photography): both

## Scope

### MVP (Phases 1–4)
- Chat intake with timeframe parsing
- Editable syllabus preview
- Research pipeline (web + YouTube + Wikipedia)
- Text lessons with inline citations
- Curated video embeds
- Multiple-choice quizzes with explanations
- Just-in-time lesson generation (background jobs)
- Auth, saved courses, progress tracking
- Fact-check pass on every lesson

### V2 (Phase 5+)
- Adaptive difficulty from quiz results
- Flashcards with spaced repetition
- "Ask the tutor" chat per lesson, grounded only in that course's sources
- Email/push reminders
- Research cache for popular topics

### Out of scope (for now)
- Native mobile app
- Social features, public course library
- Payments (add in V2 once completion rate is proven)
- Interactive in-browser spreadsheets/coding sandboxes

## Success metrics
- **North star:** course completion rate (target > 40% in beta)
- Time from confirm → Day 1 readable: < 90 seconds
- Syllabus preview: < 20 seconds
- Fact-check flag rate: < 5% of lessons shipped with the "some claims could not be verified" notice
- Cost per 7-day course: track from day one; target < $0.75

## Non-goals and guardrails
- Not a replacement for professional advice: medical, legal, and financial courses show a disclaimer.
- Refuse courses that would teach someone to cause harm (making weapons or drugs, breaking into systems or accounts that aren't yours, self-harm methods, etc.) with a friendly message. Judge by what the course teaches someone to do, not the subject: defensive cybersecurity, military history and pharmacology are fine. Full rules in AGENTS.md (Intake).
