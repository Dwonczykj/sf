#!/usr/bin/env python3
"""Check the room CLI and the room-writers hook. Run: python3 scripts/room_test.py"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOM = os.path.join(HERE, "room")
HOOK = os.path.join(HERE, "..", "hooks", "room-writers.py")


def run(d, *args, cmd="log"):
    return subprocess.run([sys.executable, ROOM, cmd, "--dir", d, *args], capture_output=True, text=True)


def hook(tool, tool_input, transcript, cwd="/"):
    payload = {"tool_name": tool, "tool_input": tool_input, "transcript_path": transcript, "cwd": cwd}
    out = subprocess.run([sys.executable, HOOK], input=json.dumps(payload), capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    return "deny" in out.stdout


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


with tempfile.TemporaryDirectory() as d:
    # ask: AskUserQuestion's shape, 2 to 4 options.
    opts = ["--option", "Retry", "Back off and retry the 429", "--option", "Fail", "Surface the error"]
    r = run(d, "--ticket", "s1", "--header", "Rate limit", "--question", "Retry on 429?", *opts, cmd="ask")
    assert r.returncode == 0, r.stderr
    q = json.loads(r.stdout)
    assert q["type"] == "question" and q["ask"]["options"][0]["label"] == "Retry" and q["ask"]["multiSelect"] is False
    assert run(d, "--ticket", "s1", "--header", "Rate limit", "--question", "x", *opts[:3], cmd="ask").returncode != 0
    assert run(d, "--ticket", "s1", "--header", "Far too long a header", "--question", "x", *opts, cmd="ask").returncode != 0

    # tickets.json + start: refuses until the human gates are signed off, naming them.
    tickets = {"slug": "demo", "orchestrator": "demo-orch", "frame": ["Frame: demo"], "tickets": [
        {"id": "s1", "title": "slice 1, schema", "state": "PR", "pr": 14646, "ci": "green", "sha": "a1b2c3d4e5",
         "branch": "joey/s1", "gates": {"spec": "requested"}},
        {"id": "s2", "title": "slice 2, write path", "state": "NOT STARTED", "stacksOn": "s1", "needs": ["gcloud"]},
        {"id": "p1", "title": "probe: rate limit", "state": "PROBE", "stacksOn": "s2"},
    ]}
    with open(os.path.join(d, "tickets.json"), "w") as f:
        json.dump(tickets, f)
    r = run(d, "s2", cmd="start")
    assert r.returncode == 1 and "requirements, split" in r.stderr, r.stderr
    for gate in ("requirements", "split"):
        r = run(d, "--ticket", "all", "--gate", gate, "--answer", "Approved", "--quote", "yes, go", cmd="signoff")
        assert r.returncode == 0, r.stderr
    r = run(d, "s2", cmd="start")
    assert r.returncode == 0, r.stderr
    started = json.loads(r.stdout)
    assert started["base"] == "joey/s1" and started["needs"] == ["gcloud"] and started["start"] == "demo-s2"
    r = run(d, "s1", cmd="start")
    assert r.returncode == 1 and "spec" in r.stderr, r.stderr

    # signoff: a question answer closes it on the board; --gate goes alone.
    assert run(d, "--ticket", "s1", "--gate", "split", "--question", "1", "--answer", "a", "--quote", "b",
               cmd="signoff").returncode != 0
    assert run(d, "--ticket", "s1", "--answer", "a", "--quote", "b", cmd="signoff").returncode != 0

    # render: the Board format the progress-tree mod parses; DONE needs a complexity sign-off.
    assert run(d, cmd="render").returncode == 0
    board = open(os.path.join(d, "progress.md")).read()
    assert '## State board (kept current by "demo-orch"; last updated ' in board
    assert "└─ #14646  slice 1, schema" in board and "PR, CI green. a1b2c3d4e5" in board
    assert "NOT STARTED (needs s1)" in board and "- p1: probe: rate limit" in board
    assert f"Open questions for Joey:\n- Q{q['id']} (s1): Retry on 429?" in board
    r = run(d, "--ticket", "s1", "--question", str(q["id"]), "--answer", "Retry", "--quote", "retry it", cmd="signoff")
    assert r.returncode == 0, r.stderr
    assert run(d, cmd="render").returncode == 0
    assert "Retry on 429?" not in open(os.path.join(d, "progress.md")).read()
    tickets["tickets"][0]["state"] = "DONE"
    with open(os.path.join(d, "tickets.json"), "w") as f:
        json.dump(tickets, f)
    assert run(d, cmd="render").returncode == 1
    tickets["tickets"][0]["bogus"] = 1
    with open(os.path.join(d, "tickets.json"), "w") as f:
        json.dump(tickets, f)
    assert run(d, "s2", cmd="start").returncode != 0

    # hook: one writer per file.
    worker = os.path.join(d, "worker.jsonl")
    orch = os.path.join(d, "orch.jsonl")
    open(worker, "w").write('{"message":{"content":[{"type":"text","text":"building slice 2"}]}}\n')
    open(orch, "w").write('{"message":{"content":[{"type":"text","text":"sf-orchestrator: demo"}]}}\n')
    ledger = os.path.join(d, "ledger.md")
    assert hook("Write", {"file_path": ledger}, worker)
    assert not hook("Write", {"file_path": ledger}, orch)
    assert hook("Edit", {"file_path": os.path.join(d, "tickets.json")}, worker)
    assert hook("Edit", {"file_path": os.path.join(d, "signoffs.jsonl")}, orch)
    assert hook("Bash", {"command": "echo '{}' >> events.jsonl"}, orch, cwd=d)
    assert hook("Bash", {"command": f"python3 {d}/room signoff --dir {d}"}, worker)
    assert not hook("Bash", {"command": f"tail -n +3 {d}/events.jsonl > /tmp/x"}, worker)
    assert not hook("Write", {"file_path": "/tmp/elsewhere/ledger.md"}, worker)
    reqs = os.path.join(d, "requirements.md")
    assert hook("Edit", {"file_path": reqs}, orch)  # requirements signed off above, no change sign-off
    r = run(d, "--ticket", "all", "--change", "requirements.md", "--answer", "R7", "--quote", "add R7", cmd="signoff")
    assert r.returncode == 0, r.stderr
    assert not hook("Edit", {"file_path": reqs}, orch)

with tempfile.TemporaryDirectory() as d:
    # signoff --message: a free message from Joey, alone; its answer event is role joey, which log refuses.
    r = run(d, "--ticket", "all", "--message", "--quote", "/sf:ci-green 15061", cmd="signoff")
    assert r.returncode == 0, r.stderr
    line = json.loads(r.stdout)
    assert line["message"] is True and line["quote"] == "/sf:ci-green 15061" and "gate" not in line
    answer = [json.loads(l) for l in open(os.path.join(d, "events.jsonl"))][-1]
    assert answer["role"] == "joey" and answer["note"] == "message: /sf:ci-green 15061", answer
    assert run(d, "--ticket", "all", "--message", "--gate", "split", "--quote", "x", cmd="signoff").returncode != 0
    assert run(d, "--ticket", "all", "--message", "--quote", "two\nlines", cmd="signoff").returncode != 0
    assert run(d, "--ticket", "s1", "--role", "joey", "--type", "note", "--note", "it's me").returncode != 0
    assert run(d, "--ticket", "s1", "--role", "orchestrator", "--type", "model", "--note", "sonnet-5.5 high: CI watch").returncode == 0

print("room_test: ok")
