---
description: Check the current task against its acceptance criteria and log progress
---
1. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test`. Fix any failures.
2. Go through each acceptance criterion for the current `[~]` task in `docs/BUILD_PLAN.md`. For each, show the evidence (command output, test names, or a description of what you checked). Mark each as ✅ or ❌.
3. Check the content rules and code conventions in `CLAUDE.md` weren't broken (no secrets committed, no LLM calls outside the client wrapper, Zod on all LLM output).
4. If everything passes: mark the task `[x]`, append an entry to `docs/PROGRESS.md`, and suggest a commit message. If anything fails: list what's left and propose fixes, don't mark it done.
