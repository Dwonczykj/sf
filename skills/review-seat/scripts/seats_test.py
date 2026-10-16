#!/usr/bin/env python3
"""python3 seats_test.py -> ok"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seats import probe, resolve  # noqa: E402


def fake_probe(up):
    return lambda v: {"ok": v in up or v == "claude", "reason": f"{v} down"}


def vendors(r):
    return [(s["vendor"], s["model"], bool(s["fallback"])) for s in r["seats"]]


all4 = {"reviewers": ["claude", "codex", "cursor", "gemini"]}

# Joey's machine: today's panel, Claude stays out.
r = resolve(all4, {}, "/R", fake_probe({"codex", "cursor", "gemini"}))
assert vendors(r) == [("codex", None, False), ("gemini", "gemini-3.8-flash-high", False), ("cursor", "gpt-5.3-codex-high", False)]
assert r["seats"][0]["command"].startswith("node /R/skills/codex-agent/") and not r["singleVendor"]

# No sf-tools.json behaves like all four chosen.
assert vendors(resolve({}, {}, "/R", fake_probe({"codex", "cursor", "gemini"}))) == vendors(r)

# Cloud: nothing logged in. Every seat a different Claude model, single-vendor.
r = resolve(all4, {}, "/R", fake_probe(set()))
assert [m for _, m, _ in vendors(r)] == ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"]
assert all(s["command"] is None for s in r["seats"]) and r["singleVendor"]
assert r["seats"][0]["fallback"] == "codex down"

# Claude only: chosen, so no fallback note, still single-vendor.
r = resolve({"reviewers": ["claude"]}, {}, "/R", fake_probe(set()))
assert [f for *_, f in vendors(r)] == [False, False, False] and r["singleVendor"]

# Codex + Claude: codex leads, Claude fills the rest on distinct models.
r = resolve({"reviewers": ["codex", "claude"]}, {}, "/R", fake_probe({"codex"}))
assert vendors(r) == [("codex", None, False), ("claude", "claude-opus-5-5", False), ("claude", "claude-sonnet-5-5", False)]
assert not r["singleVendor"]

# Gemini without Cursor runs on agy; sf-models.json overrides the Cursor seat's model.
r = resolve({"reviewers": ["gemini", "cursor"]}, {"reviewCursor": "claude-sonnet-5-high"}, "/R",
            fake_probe({"gemini"}), which=lambda b: b == "agy")
assert r["seats"][0]["command"].startswith("cd {cwd} && agy ")
assert r["seats"][1]["fallback"] == "cursor down" and r["seats"][1]["vendor"] == "claude"

# An "Other" reviewer from setup sits before Claude Code; a missing one falls back.
aider = {"name": "aider", "command": "aider --stdin"}
r = resolve({"reviewers": ["codex", "claude"], "otherReviewers": [aider]}, {}, "/R", fake_probe({"codex"}), which=lambda b: b == "aider")
assert vendors(r) == [("codex", None, False), ("aider", None, False), ("claude", "claude-opus-5-5", False)]
assert r["seats"][1]["command"] == "cd {cwd} && aider --stdin"
r = resolve({"reviewers": [], "otherReviewers": [aider]}, {}, "/R", fake_probe(set()), which=lambda b: None)
assert r["seats"][0]["fallback"] == "aider: aider not on PATH" and r["singleVendor"]

# probe reads PATH and login status.
assert probe("codex", which=lambda b: None)["reason"] == "codex not on PATH"
assert not probe("codex", which=lambda b: b, run=lambda c: (1, ""))["ok"]
assert not probe("cursor", which=lambda b: b, run=lambda c: (0, "Not logged in"))["ok"]
assert probe("cursor", which=lambda b: b, run=lambda c: (0, "Logged in as x"))["ok"]
assert probe("gemini", which=lambda b: b == "agy", run=lambda c: (1, ""))["ok"]
assert probe("gemini", which=lambda b: None)["fix"]
print("ok")
