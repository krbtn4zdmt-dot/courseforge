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
