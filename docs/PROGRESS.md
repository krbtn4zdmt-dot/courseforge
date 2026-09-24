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
