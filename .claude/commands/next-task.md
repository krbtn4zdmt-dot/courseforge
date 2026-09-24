---
description: Find and start the next unfinished task from the build plan
---
1. Read `CLAUDE.md`, `docs/BUILD_PLAN.md`, and the last 3 entries in `docs/PROGRESS.md`.
2. Identify the first task marked `[ ]` (or `[~]` if one is in progress). If a 🛑 checkpoint comes before it and hasn't been acknowledged in PROGRESS.md, stop and remind me to do the checkpoint.
3. Read the docs sections that task depends on.
4. Tell me: the task ID and title, its acceptance criteria, your plan (files to create/change, approach), and any questions or risks.
5. Wait for my approval before writing code. After approval, mark the task `[~]`, build it, then run `/verify`.

$ARGUMENTS
