#!/usr/bin/env python3
"""Resolve the review panel's seats from ~/.claude/sf-tools.json, checking each vendor now.

  seats.py [--root R] [--tools F] [--models F] [--reviewGemini M] [--reviewCursor M]
                                                -> {"seats": [...], "singleVendor": bool}
  seats.py probe <codex|cursor|gemini|claude>   -> {"tool", "ok", "reason", "fix"}

Each seat: {"seat", "vendor", "model", "command", "fallback"}. "command" reads the prompt on
stdin and has a {cwd} placeholder; it is null for a Claude seat, which the caller runs as a
sub-agent on "model". "fallback" is null, or why the chosen vendor could not take the seat.
"""
import json
import os
import shutil
import subprocess
import sys

HOME = os.path.expanduser("~/.claude")
PREFERENCE = ["codex", "gemini", "cursor", "claude"]  # first three available fill the panel
CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"]
DEFAULT_MODELS = {"reviewGemini": "gemini-3.8-flash-high", "reviewCursor": "gpt-5.3-codex-high"}
FIX = {
    "codex": "npm install -g @openai/codex, then codex login",
    "cursor": "curl https://cursor.com/install -fsS | bash, then agent login",
    "gemini": "install Antigravity (agy) and sign in once with agy, or install the Cursor CLI, which also runs Gemini",
    "claude": "",
}


def run(cmd):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        return p.returncode, (p.stdout + p.stderr)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, str(e)


def probe(tool, which=shutil.which, run=run):
    def res(ok, reason=""):
        return {"tool": tool, "ok": ok, "reason": reason, "fix": "" if ok else FIX[tool]}

    if tool == "claude":
        return res(True)
    if tool == "codex":
        if not which("codex"):
            return res(False, "codex not on PATH")
        rc, _ = run(["codex", "login", "status"])
        return res(rc == 0, "" if rc == 0 else "codex logged out (codex login status failed)")
    if tool == "cursor":
        if not which("agent"):
            return res(False, "Cursor CLI (agent) not on PATH")
        rc, out = run(["agent", "status"])
        ok = rc == 0 and "not logged in" not in out.lower()
        return res(ok, "" if ok else "Cursor CLI logged out (agent status)")
    if tool == "gemini":
        # Gemini runs through the Cursor CLI when it is up, else agy. agy has no status
        # command, so a logged-out agy only shows when the seat runs.
        if probe("cursor", which, run)["ok"] or which("agy"):
            return res(True)
        return res(False, "neither the Cursor CLI nor agy is available")
    raise SystemExit(f"unknown tool {tool!r}; one of {PREFERENCE}")


def read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def resolve(tools, models, root, probe=probe, which=shutil.which):
    # No sf-tools.json yet means today's panel: try every vendor, fall back where one is down.
    chosen = tools.get("reviewers", PREFERENCE) or ["claude"]
    models = {**DEFAULT_MODELS, **(models or {})}
    # "Other" reviewers from setup ({"name", "command"}, prompt on stdin) sit before Claude Code.
    others = tools.get("otherReviewers", [])
    order = [v for v in PREFERENCE[:-1] if v in chosen] + others + (["claude"] if "claude" in chosen else [])
    picks = []
    for v in order[:3]:
        if isinstance(v, dict):
            up = which(v["command"].split()[0])
            picks.append((v, None if up else f"{v['name']}: {v['command'].split()[0]} not on PATH"))
        else:
            p = probe(v)
            picks.append((v, None if p["ok"] else p["reason"]))
    while len(picks) < 3:
        picks.append(("claude", None))

    cursor_up = "cursor" in chosen and probe("cursor")["ok"]
    used = set()
    seats = []
    for i, (vendor, fallback) in enumerate(picks, 1):
        seat = {"seat": i, "vendor": vendor, "model": None, "command": None, "fallback": fallback}
        if isinstance(vendor, dict) and not fallback:
            seat.update(vendor=vendor["name"], command=f"cd {{cwd}} && {vendor['command']}")
        elif fallback or vendor == "claude":
            seat["vendor"] = "claude"
            seat["model"] = next(m for m in CLAUDE_MODELS if m not in used)
            used.add(seat["model"])
        elif vendor == "codex":
            seat["command"] = f"node {root}/skills/codex-agent/scripts/run-agent.mjs --sandbox read-only --cwd {{cwd}} --timeout 900"
        elif vendor == "cursor" or (vendor == "gemini" and (cursor_up or not which("agy"))):
            seat["model"] = models["reviewCursor" if vendor == "cursor" else "reviewGemini"]
            seat["command"] = f"node {root}/skills/cursor-agent/scripts/run-agent.mjs --model {seat['model']} --cwd {{cwd}} --timeout 900"
        else:  # gemini on agy, its own default model (agy's slugs differ from Cursor's)
            seat["command"] = 'cd {cwd} && agy --add-dir {cwd} --print "$(cat)" --print-timeout 900s'
        seats.append(seat)
    return {"seats": seats, "singleVendor": all(s["vendor"] == "claude" for s in seats)}


def main(argv):
    if argv[:1] == ["probe"]:
        print(json.dumps(probe(argv[1])))
        return
    opts = dict(zip(argv[::2], argv[1::2]))
    root = opts.get("--root", os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))
    tools = read_json(opts.get("--tools", f"{HOME}/sf-tools.json"), {})
    models = read_json(opts.get("--models", f"{HOME}/sf-models.json"), {})
    models.update({k[2:]: v for k, v in opts.items() if k in ("--reviewGemini", "--reviewCursor")})
    print(json.dumps(resolve(tools, models, root), indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])
