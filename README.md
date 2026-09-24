# CourseForge: Claude Code Starter Kit

This kit turns the app plan into files Claude Code reads and follows. Drop them into an empty folder, open Claude Code there, and build phase by phase.

## What's inside

| File | Purpose |
|---|---|
| `CLAUDE.md` | Claude Code reads this automatically every session. Project rules, stack, commands, conventions. |
| `docs/SPEC.md` | What the product does, for whom, and what's in or out of scope. |
| `docs/ARCHITECTURE.md` | Pipeline design, data model (SQL), folder structure, job flow. |
| `docs/AGENTS.md` | The AI roles in the pipeline, with input/output contracts. |
| `docs/BUILD_PLAN.md` | Ordered phases and tasks, each with acceptance criteria and a copy-paste prompt. |
| `docs/PROGRESS.md` | A running log Claude Code updates after each task, so new sessions pick up where you left off. |
| `.claude/commands/*.md` | Custom slash commands: `/next-task`, `/verify`, `/test-course`. |

## How to use it

1. **Create accounts and keys** (free tiers are fine to start):
   - Anthropic API key: console.anthropic.com
   - Tavily API key: tavily.com (web research)
   - YouTube Data API v3 key: Google Cloud Console
   - Supabase project: supabase.com (needed from Phase 2)
   - Inngest: inngest.com (needed from Phase 3; runs locally without an account)
2. **Copy this whole folder** into a new, empty project directory.
3. **Open Claude Code** in that directory (`claude` in the terminal, or the Code tab in Claude Desktop).
4. **Start with planning, not code.** Paste:
   > Read CLAUDE.md and everything in docs/. Summarize the plan back to me in 10 bullet points and list any questions or risks before we start. Don't write code yet.
5. **Then build one task at a time** with `/next-task`. After each task, run `/verify`.
6. **Commit after every passing task** (`git commit`), so you can always roll back.

## Tips that make Claude Code far more effective

- **One task per request.** Big "build the whole app" prompts produce messy code. The build plan is already sliced small.
- **Use Plan Mode** (Shift+Tab) for anything touching more than two files. Review the plan before approving.
- **Make it prove things work.** Every task has acceptance criteria; ask Claude to run the tests or script and show output.
- **Clear context between phases** (`/clear`). `CLAUDE.md` and `docs/PROGRESS.md` carry the memory forward.
- **When it goes sideways,** stop it (Esc), say what's wrong, and point it to the relevant doc section. Don't let it pile fixes on a bad foundation; `git reset` is cheap.
- **Update the docs when you change your mind.** If you decide something new, tell Claude to update SPEC.md or ARCHITECTURE.md first, then code.
