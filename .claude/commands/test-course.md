---
description: Generate a test course and review its quality
---
Run the course pipeline for: $ARGUMENTS
(If no arguments, use "The French Revolution" --days 3 --minutes 30 --level beginner.)

Then run `pnpm audit:course out/<slug>.json` for the mechanical checks (pacing, lesson length, uncited sections, long quotes, verbatim copying from sources, low-credibility sources, quiz answer balance, SPEC targets) and include its problems in your report.

Then review the output as a demanding teacher would and report:
- **Pacing:** do daily lesson minutes match the budget? Is the scope right for the timeframe?
- **Accuracy:** any claims that look wrong or unsupported? Do citations point to relevant sources?
- **Clarity:** is the writing right for the level? Anything confusing?
- **Quizzes:** do questions test the objectives? Any ambiguous answers?
- **Sources:** credible? Any low-quality domains that slipped through?
- **Cost & time:** totals for the run.

End with the top 3 prompt or pipeline changes that would most improve quality. Don't make the changes until I approve.
