---
name: review-seat
description: Run one seat, or the whole three-seat panel, of sf's cross-vendor code review. The only place in sf that knows the review vendors (Claude Code, Codex CLI, Cursor CLI, Gemini through Cursor or Antigravity). Reads ~/.claude/sf-tools.json, checks each chosen vendor at run time, and falls back to a Claude sub-agent on a different Claude model when one is missing or logged out, saying so in the verdict. Called by pre-pr-gate, solve-in-worktrees, fix-pr and the build-verify workflow; not user-invoked directly.
---

# review-seat

Callers name the job ("run this pass on the panel", "re-check on the lead seat") and never a vendor. This skill decides who sits in each seat.

## 1. Resolve the seats, once per review round

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/review-seat/scripts/seats.py
```

Add `--reviewGemini <slug>` or `--reviewCursor <slug>` for a per-run model on those seats. It prints `{"seats": [...], "singleVendor": bool}`. Each seat has `seat` (1 to 3), `vendor` (`codex`, `gemini`, `cursor`, `claude`), `model`, `command` and `fallback`.

How the panel fills: the chosen reviewers (`reviewers` in `sf-tools.json`, written by `/sf:install`; no file means all four) take the seats in the order Codex, Gemini, Cursor, Claude Code, three at most. A chosen vendor that is missing or logged out right now keeps its seat but runs as a Claude sub-agent, with `fallback` saying why. Seats left empty are Claude too. Claude seats each get a different model, in the order `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-fable-5-1`, so even an all-Claude panel gives three opinions. Gemini runs through the Cursor CLI when Cursor is chosen and logged in, else through `agy`. The Gemini and Cursor seats' models come from `reviewGemini` (default `gemini-3.8-flash-high`) and `reviewCursor` (default `gpt-5.3-codex-high`) in `~/.claude/sf-models.json`; both bill Cursor, so they default cheap.

Seat 1 is the **lead seat**. Callers that need one reviewer (re-check rounds, `pre-pr-gate` Pass D and its validation calls) use it.

## 2. Run a seat

End every review prompt with this fence, whichever seat runs it (only Codex is sandboxed):

> Review only. Do not edit, create or delete any file; do not run build, test, typecheck or lint commands or execute code to test a hypothesis; if a shell command is rejected, don't retry it, note that and carry on with what's visible. Output findings and a verdict line.

- **A seat with a `command`:** replace `{cwd}` with the worktree path and pipe the prompt on stdin through a quoted heredoc, so nothing in it is interpolated:

  ```bash
  <command> <<'EOF'
  <review prompt>
  EOF
  ```

  A caller that asks for high effort on Codex (Pass D) appends `--effort high` to a `codex` seat's command; the other seats take no effort flag.
- **A Claude seat (`command` is null):** spawn a fresh `general-purpose` sub-agent with the `Agent` tool on the seat's `model` (the tool's short names: `opus`, `sonnet`, `fable`), the prompt verbatim, and its working directory set to the worktree. It shares no context with the caller, which is what keeps it independent.

Run the seats of one pass in parallel. None of them resumes a thread, so each round re-runs each seat fresh.

## 3. When a vendor fails mid-run

The check in step 1 can pass and the call still fail. If the command exits with "command not found", an auth or login error, or empty output, run that seat again as a Claude sub-agent on the first model in the list that no other seat of this pass is using, and record the reason as its `fallback`. Any other error (a timeout, a vendor crash) is a failed seat, not a fallback: report it, and the caller treats it as the conservative verdict.

## 4. Label every verdict

Prefix each seat's result with `seat <n> (<vendor> <model>)`. A seat that fell back starts its verdict with `seat <n> fell back to <model>: <reason>`. When `singleVendor` is true, or every seat fell back, the caller's report says so in one line: `panel: single-vendor (Claude only), seats on <models>`. That is a weaker gate than a cross-vendor one, and the reader should know.

## Adding a vendor

One adapter: a `probe` branch, a `FIX` line and a command in `scripts/seats.py`, its place in `PREFERENCE`, and one option in `/sf:install`'s reviewer question. `python3 scripts/seats_test.py` checks the resolver.
