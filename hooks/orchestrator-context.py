#!/usr/bin/env python3
"""UserPromptSubmit hook: once an sf:orchestrate session's context passes the fork threshold, say so.

A session counts as an orchestrator when one of its replies starts with "sf-orchestrator: ".
Context size is the last reply's input + cache tokens, read from the session transcript.
"""
import json
import os
import sys

# 500k is half of a 1M-token window. Set SF_ORCHESTRATOR_FORK_TOKENS for a smaller window.
THRESHOLD = int(os.environ.get("SF_ORCHESTRATOR_FORK_TOKENS", "500000"))
MARKER = b'"text":"sf-orchestrator: '


def context_tokens(data):
    for line in reversed(data.splitlines()):
        if b'"usage"' not in line:
            continue
        try:
            usage = json.loads(line)["message"]["usage"]
        except (ValueError, KeyError, TypeError):
            continue
        return sum(usage.get(k) or 0 for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
    return 0


def main():
    try:
        with open(json.load(sys.stdin)["transcript_path"], "rb") as f:
            data = f.read()
    except (OSError, ValueError, KeyError, TypeError):
        return
    if MARKER not in data:
        return
    used = context_tokens(data)
    if used < THRESHOLD:
        return
    note = (
        f"sf orchestrator: context is at {used:,} tokens, past the {THRESHOLD:,} fork threshold. "
        "Fork at the next natural point, per 'Forking yourself' in sf:orchestrate."
    )
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": note}}))


if __name__ == "__main__":
    main()
