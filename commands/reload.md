---
description: "Sync a local-source plugin's cache (default: sf itself) to its latest local version, then tell me to restart to pick it up."
---
Sync the installed plugin cache with its local marketplace source.

1. Target: `$ARGUMENTS` if given (accepts `name` or `name@marketplace`), else default to `sf@sf`.
2. Run `claude plugin update <target>` and show its output verbatim.
3. If it bumped the version, report old → new version in one line. If it says already up to date, say that and stop.
4. Finish with exactly one line telling me to restart Claude Code (close and reopen, or start a fresh `claude`) to pick up the change — don't attempt the restart yourself, this session can't do it.
