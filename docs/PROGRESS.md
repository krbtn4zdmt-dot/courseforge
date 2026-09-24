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
