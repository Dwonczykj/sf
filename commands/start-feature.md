---
description: "Run a whole feature idea→open PR through the full left-shifted, gated pipeline."
---
Invoke the `start-feature` skill for this request: $ARGUMENTS. It owns the full factory pipeline (frame → scope + lock the requirements contract → split → plan-review with 3 models → build + test agents in worktrees → gate pre-PR with 3 models → open PR → CI/bot loop → final report) and the `.scratch/<slug>/progress.md` state. Follow it end to end, honouring every human gate. To resume a run later, use `sf:continue`; to enter at one phase, use `sf:plan` / `sf:build` / `sf:review` / `sf:ci-green`.
