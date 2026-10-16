#!/usr/bin/env python3
"""Check `room log` validation and id sequencing. Run: python3 scripts/room_test.py"""
import json
import os
import subprocess
import sys
import tempfile

ROOM = os.path.join(os.path.dirname(os.path.abspath(__file__)), "room")


def run(d, *args):
    return subprocess.run([sys.executable, ROOM, "log", "--dir", d, *args], capture_output=True, text=True)


with tempfile.TemporaryDirectory() as d:
    ok = run(d, "--ticket", "slice2", "--role", "build", "--type", "state", "--sha", "07ce8a1", "--note", "LOCAL tests green")
    assert ok.returncode == 0, ok.stderr
    ok = run(d, "--ticket", "slice2", "--role", "build", "--type", "question", "--note", "Q: retry on 429?")
    assert ok.returncode == 0, ok.stderr

    bad = [
        ("--ticket", "slice 2", "--role", "build", "--type", "note", "--note", "x"),
        ("--ticket", "slice2", "--role", "build", "--type", "gossip", "--note", "x"),
        ("--ticket", "slice2", "--role", "build", "--type", "note", "--sha", "XYZ", "--note", "x"),
        ("--ticket", "slice2", "--role", "build", "--type", "note", "--note", "two\nlines"),
        ("--ticket", "slice2", "--role", "build", "--type", "note", "--note", "x" * 501),
        ("--ticket", "slice2", "--role", "build", "--type", "note", "--note", "  "),
        ("--ticket", "slice2", "--role", "build", "--type", "state", "--note", "PROBABLY done"),
        ("--ticket", "slice2", "--role", "build", "--type", "state", "--note", "built it"),
    ]
    for args in bad:
        r = run(d, *args)
        assert r.returncode != 0, f"accepted {args}"
    assert run(os.path.join(d, "missing"), "--ticket", "s", "--role", "b", "--type", "note", "--note", "x").returncode != 0

    lines = [json.loads(l) for l in open(os.path.join(d, "events.jsonl"))]
    assert [e["id"] for e in lines] == [1, 2], lines
    assert lines[0]["sha"] == "07ce8a1" and lines[1]["sha"] is None
    assert set(lines[0]) == {"ts", "id", "ticket", "role", "type", "sha", "note"}

print("room_test: ok")
