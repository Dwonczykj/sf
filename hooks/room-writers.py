#!/usr/bin/env python3
"""PreToolUse hook: one writer per build-room file.

A room dir is a dir holding events.jsonl. In one:
- ledger.md and tickets.json: only a session marked `sf-orchestrator: ` (a reply that starts with it).
- events.jsonl and signoffs.jsonl: nobody edits them; `room log` and `room signoff` append.
- prs.json: nobody edits it; `room prs` (open to every session) writes it from GitHub.
- requirements.md, once Joey has signed off the requirements gate: only while a `--change requirements.md`
  sign-off is newer than SF_SIGNOFF_EDIT_MINUTES (default 60). In a topic room the same holds for each
  feature's features/<slug>/requirements.md (signed for that feature) and each light build's light/<ticket>.md
  (signed for that ticket), with `--change <that path>`. Same for openspec/changes/<name>/** once
  the spec gate is signed, with `--change openspec/changes/<name>`, looked up in ~/FyxerGh/build-room/<name>/
  and in `.scratch/<name>/` of every worktree of the file's repo.
- `room signoff`, `room render`, `room adopt` and `room refresh` run from Bash: orchestrator only. Only a
  command that runs the CLI counts (`room ...`, `<path>/room ...`, `python3 <path>/room ...`), never text that names it in a quote,
  a commit message or a heredoc. `bash -c '...'` and `eval` hide an invocation from it.
  `room log` and `room join` (a session Joey started by hand adding itself) are open to every session.

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
CONTRACT = re.compile(r"^(.*)/(?:features/([\w.-]+)/requirements\.md|light/([\w.-]+)\.md)$")
BUILD_ROOM = os.path.expanduser("~/FyxerGh/build-room")
# A heredoc body, kept only for the rest of its opening line (where a redirect may sit).
HEREDOC = re.compile(r"<<-?[ \t]*(['\"]?)(\w+)\1([^\n]*)\n.*?(?<=\n)[ \t]*\2[ \t]*(?=\n|$)", re.S)
OPERATORS = ";&|()"


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


def runs_room(command, subcommands=("signoff", "render", "adopt", "refresh")):
    """True if a simple command in `command` runs the room CLI with one of `subcommands`."""
    lex = shlex.shlex(HEREDOC.sub(r"\3", command).replace("\n", ";"), posix=True, punctuation_chars=OPERATORS)
    lex.whitespace_split = True
    try:
        tokens = list(lex)
    except ValueError:  # unbalanced quotes: fall back to the text, which errs towards denying
        return bool(re.search(rf"\broom\s+({'|'.join(subcommands)})\b", command))
    argv = []
    for tok in tokens + [";"]:
        if not set(tok) <= set(OPERATORS):
            argv.append(tok)
            continue
        while argv and re.match(r"^\w+=", argv[0]):
            argv.pop(0)
        if argv and os.path.basename(argv[0]).startswith("python"):
            argv = [x for x in argv[1:] if not x.startswith("-")]
        if len(argv) > 1 and os.path.basename(argv[0]) == "room" and argv[1] in subcommands:
            return True
        argv = []
    return False


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
    if room and name == "prs.json":
        return "prs.json is written by `room prs` alone, from GitHub; run that instead of editing it."
    if room and name in ("ledger.md", "tickets.json") and not orchestrator(transcript):
        return f"only the sf:orchestrate session writes {name}. Log what you need with `room log`."
    if name == "requirements.md" and os.path.isfile(os.path.join(d, "signoffs.jsonl")):
        # the root contract: a room with no features, whose sign-offs name none
        lines = [s for s in signoffs(os.path.join(d, "signoffs.jsonl")) if not s.get("feature")]
        return locked(lines, "requirements", "requirements.md")
    m = CONTRACT.match(path)
    if m and os.path.isfile(os.path.join(m[1], "signoffs.jsonl")):
        # features/<slug>/requirements.md, signed for that feature; light/<ticket>.md, signed for that ticket
        rel = os.path.relpath(path, m[1])
        ours = (lambda s: s.get("feature") == m[2] and s.get("ticket") == "all") if m[2] else (
            lambda s: s.get("ticket") == m[3])
        lines = [s for s in signoffs(os.path.join(m[1], "signoffs.jsonl")) if s.get("change") == rel or ours(s)]
        return locked(lines, "requirements", rel)
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
        if runs_room(command) and not orchestrator(transcript):
            reasons.append("only the sf:orchestrate session runs `room signoff`, `room render`, `room adopt` and "
                           "`room refresh`.")
    reason = next((r for r in reasons if r), None)
    if reason:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                                 "permissionDecisionReason": f"sf build room: {reason}"}}))


if __name__ == "__main__":
    main()
