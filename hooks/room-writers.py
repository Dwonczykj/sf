#!/usr/bin/env python3
"""PreToolUse hook: one writer per build-room file.

A room dir is a dir holding events.jsonl. In one:
- ledger.md and tickets.json: only a session marked `sf-orchestrator: ` (a reply that starts with it).
- events.jsonl and signoffs.jsonl: nobody edits them; `room log` and `room signoff` append.
- requirements.md, once Joey has signed off the requirements gate: only while a `--change requirements.md`
  sign-off is newer than SF_SIGNOFF_EDIT_MINUTES (default 60). Same for openspec/changes/<name>/** once
  the spec gate is signed, with `--change openspec/changes/<name>`, looked up in ~/FyxerGh/build-room/<name>/
  and in `.scratch/<name>/` of every worktree of the file's repo.
- `room signoff` and `room render` run from Bash: orchestrator only.

Bash is best effort. It catches redirects, `tee`, `sed -i`, `cp`, `mv`, `ln`, `install`, `truncate` and
`rm` naming one of these files by a literal path. It can't catch a path held in a variable, a script or `python -c` that
writes the file, `cd` into a dir followed by a write it can't resolve, or a hard link. That is why
`room start` reads signoffs.jsonl itself rather than trusting this hook.
"""
import json
import os
import re
import shlex
import subprocess
import sys
from datetime import datetime, timedelta, timezone

MARKER = b'"text":"sf-orchestrator: '
EDIT_MINUTES = int(os.environ.get("SF_SIGNOFF_EDIT_MINUTES", "60"))
REDIRECT = re.compile(r"\d?>>?\|?\s*([^\s;&|<>]+)")
SPEC = re.compile(r"(.*?)/openspec/changes/([\w.-]+)(?:/|$)")
BUILD_ROOM = os.path.expanduser("~/FyxerGh/build-room")


def is_orchestrator(transcript):
    try:
        with open(transcript, "rb") as f:
            return MARKER in f.read()
    except (OSError, TypeError):
        return False


def signoffs(path):
    try:
        with open(path, encoding="utf-8") as f:
            return [json.loads(l) for l in f if l.strip()]
    except (OSError, ValueError):
        return []


def locked(lines, gate, change):
    """None if editing `change` is allowed, else the reason it is not."""
    if not any(s.get("gate") == gate for s in lines):
        return None  # still being drafted, before Joey signed the gate
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=EDIT_MINUTES)
    for s in lines:
        if s.get("change") == change and datetime.strptime(s["ts"], "%Y-%m-%dT%H:%M:%SZ").replace(
                tzinfo=timezone.utc) >= cutoff:
            return None
    return (f"{change} is signed off. Change it only after Joey agrees: ask him, then "
            f"`room signoff --change {change}` with his words; that allows edits for {EDIT_MINUTES} minutes.")


def bash_targets(command):
    """Literal paths a shell command may write or remove."""
    targets = [t.strip("'\"") for t in REDIRECT.findall(command)]
    for segment in re.split(r"[;&|\n]+", command):
        try:
            argv = shlex.split(segment)
        except ValueError:
            continue
        if not argv:
            continue
        cmd, args = os.path.basename(argv[0]), [x for x in argv[1:] if not x.startswith("-")]
        if cmd in ("cp", "install", "ln") and args:
            targets.append(args[-1])
        elif cmd in ("tee", "truncate", "rm", "mv") or (cmd == "sed" and any(x.startswith("-i") for x in argv)):
            targets += args
    return targets


def worktrees(path):
    try:
        out = subprocess.run(["git", "-C", os.path.dirname(path) or ".", "worktree", "list", "--porcelain"],
                             capture_output=True, text=True, timeout=3).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [l[9:] for l in out.splitlines() if l.startswith("worktree ")]


def check(path, orchestrator, transcript):
    path = os.path.abspath(os.path.expanduser(path))
    d, name = os.path.split(path)
    room = os.path.isfile(os.path.join(d, "events.jsonl"))
    if room and name in ("events.jsonl", "signoffs.jsonl"):
        return f"{name} is append-only through the `room` CLI (room log / room signoff); never edit it."
    if room and name in ("ledger.md", "tickets.json") and not orchestrator(transcript):
        return f"only the sf:orchestrate session writes {name}. Log what you need with `room log`."
    if name == "requirements.md" and os.path.isfile(os.path.join(d, "signoffs.jsonl")):
        return locked(signoffs(os.path.join(d, "signoffs.jsonl")), "requirements", "requirements.md")
    m = SPEC.match(path)
    if m:
        dirs = [os.path.join(BUILD_ROOM, m[2])] + [os.path.join(wt, ".scratch", m[2]) for wt in worktrees(path)]
        lines = [s for d in dirs for s in signoffs(os.path.join(d, "signoffs.jsonl"))]
        return locked(lines, "spec", f"openspec/changes/{m[2]}") if lines else None
    return None


def main():
    try:
        e = json.load(sys.stdin)
    except ValueError:
        return
    tool, inp, cwd = e.get("tool_name"), e.get("tool_input") or {}, e.get("cwd") or os.getcwd()
    transcript = e.get("transcript_path")
    cache = {}

    def orchestrator(t):
        if "v" not in cache:
            cache["v"] = is_orchestrator(t)
        return cache["v"]

    reasons = []
    if tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        target = inp.get("file_path") or inp.get("notebook_path")
        reasons.append(target and check(target, orchestrator, transcript))
    elif tool == "Bash":
        command = inp.get("command") or ""
        for target in bash_targets(command):
            reasons.append(check(os.path.join(cwd, os.path.expanduser(target)), orchestrator, transcript))
        if re.search(r"\broom\s+(signoff|render)\b", command) and not orchestrator(transcript):
            reasons.append("only the sf:orchestrate session runs `room signoff` and `room render`.")
    reason = next((r for r in reasons if r), None)
    if reason:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                                 "permissionDecisionReason": f"sf build room: {reason}"}}))


if __name__ == "__main__":
    main()
