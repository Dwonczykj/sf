#!/usr/bin/env python3
"""Check the room CLI and the room-writers hook. Run: python3 scripts/room_test.py"""
import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading

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
        {"id": "s2", "title": "slice 2, write path", "state": "NOT STARTED", "stacksOn": "s1", "needs": ["gcloud"],
         "session": "demo-s2", "sessionId": "local_0a1b"},
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
    assert started["override"] is None
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
    assert hook("Bash", {"command": f"cd {d} && FOO=1 ./room render --dir ."}, worker)
    assert hook("Bash", {"command": f"echo hi\npython3 -u {d}/room render --dir {d}"}, worker)
    # Text that only names the subcommands is not an invocation: commit messages, heredocs, quotes.
    commit = (f"git commit -m \"$(cat <<'EOF'\nfeat: room signoff --message\n\nroom render refuses DONE\nEOF\n)\""
              f" && python3 {d}/room log --dir {d} --ticket s1 --role build --type note --note committed")
    assert not hook("Bash", {"command": commit}, worker)
    assert not hook("Bash", {"command": "git commit -m \"docs: room signoff; room render\""}, worker)
    assert not hook("Bash", {"command": "grep -n 'room signoff' commands/orchestrate.md"}, worker)
    assert not hook("Bash", {"command": f"tail -n +3 {d}/events.jsonl > /tmp/x"}, worker)
    assert not hook("Bash", {"command": f"python3 {d}/room tier --dir {d} s1"}, worker)
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

    # signoff --tier: Joey's override wins until he clears it; a ticket's own line beats an older "all" line.
    assert json.loads(run(d, "s1", cmd="tier").stdout) is None
    r = run(d, "--ticket", "s1", "--tier", "claude-opus-5-5 xhigh", "--quote", "put s1 on opus xhigh", cmd="signoff")
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["tier"] == "claude-opus-5-5 xhigh"
    answer = [json.loads(l) for l in open(os.path.join(d, "events.jsonl"))][-1]
    assert answer["role"] == "joey" and answer["note"] == "tier claude-opus-5-5 xhigh: claude-opus-5-5 xhigh", answer
    o = json.loads(run(d, "s1", cmd="tier").stdout)
    assert o["tier"] == "claude-opus-5-5 xhigh" and o["quote"] == "put s1 on opus xhigh", o
    assert json.loads(run(d, "s2", cmd="tier").stdout) is None
    assert run(d, "--ticket", "all", "--tier", "claude-sonnet-5-5 high", "--quote", "all on sonnet", cmd="signoff").returncode == 0
    assert json.loads(run(d, "s2", cmd="tier").stdout)["tier"] == "claude-sonnet-5-5 high"
    assert run(d, "--ticket", "s1", "--tier", "clear", "--quote", "back to the table", cmd="signoff").returncode == 0
    assert json.loads(run(d, "s1", cmd="tier").stdout) is None
    for bad in (["--tier", "opus"], ["--tier", "claude-opus-5-5 turbo"], ["--tier", "claude-opus-5-5 high", "--gate", "split"],
                ["--tier", "claude-opus-5-5 high", "--message"]):
        assert run(d, "--ticket", "s1", *bad, "--quote", "x", cmd="signoff").returncode != 0, bad
    assert run(os.path.join(d, "missing"), "s1", cmd="tier").returncode != 0

class Podium(http.server.BaseHTTPRequestHandler):
    """A stub of Podium's GET /api/fleet/state that wants X-Podium-Token: t0ken."""
    sessions = []

    def do_GET(self):
        ok = self.path == "/api/fleet/state" and self.headers.get("X-Podium-Token") == "t0ken"
        body = json.dumps({"sessions": Podium.sessions} if ok else {"ok": False}).encode()
        self.send_response(200 if ok else 401)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def podium_session(id_, status="running", cwd="~/elsewhere", branch=None, wt=None, **extra):
    return {"id": id_, "status": status, "cwd": cwd, "waitReason": None, "waitNote": None, "secondsSinceSeen": 1,
            "context": {"percent": 20.0}, "agents": [],
            "git": {"branch": branch, "worktreePath": wt}, **extra}


with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as home:
    server = http.server.HTTPServer(("127.0.0.1", 0), Podium)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    def conf(port, token="t0ken"):
        with open(os.path.join(home, "config.env"), "w") as f:
            f.write(f"PODIUMCTL_MODE=standalone\nPODIUMCTL_PORT={port}\nPODIUMCTL_BIND=127.0.0.1\nPODIUM_TOKEN={token}\n")

    def podium():
        r = subprocess.run([sys.executable, ROOM, "podium", "--dir", d], capture_output=True, text=True,
                           env={**os.environ, "PODIUMCTL_HOME": home})
        assert r.returncode == 0, r.stderr
        return r.stdout

    def blockers():
        return [e for e in (json.loads(l) for l in open(os.path.join(d, "events.jsonl"))) if e["role"] == "podium"]

    wts = {t: os.path.join(d, "wt", t) for t in ("s1", "s2", "s3")}
    with open(os.path.join(d, "tickets.json"), "w") as f:
        json.dump({"slug": "demo", "tickets": [
            {"id": "s1", "title": "one", "state": "BUILDING", "worktree": wts["s1"], "branch": "joey/s1", "session": "demo-s1"},
            {"id": "s2", "title": "two", "state": "PUSHED", "branch": "joey/s2"},
            {"id": "s3", "title": "three", "state": "BUILDING", "worktree": wts["s3"], "branch": "joey/s3"},
            {"id": "s4", "title": "four", "state": "BUILDING", "branch": "joey/s4"},
        ]}, f)
    failed = {"id": "a1", "status": "failed", "description": "Run jest", "failure": {"class": "Tool error", "retriedAs": None}}
    retried = {"id": "a2", "status": "failed", "description": "Lint", "failure": {"class": "Tool error", "retriedAs": "a3"}}
    Podium.sessions = [
        podium_session("u-s1", "waiting", cwd=wts["s1"], wt=wts["s1"], waitReason="permission",
                       waitNote="Claude needs your permission to use Bash"),          # waiting, by worktree
        podium_session("u-s2", "stale", branch="joey/s2", secondsSinceSeen=40),       # stale, by branch
        podium_session("u-s3", cwd=os.path.join(wts["s3"], "app"), agents=[failed, retried]),  # failing, by cwd
        podium_session("u-s4", branch="joey/s4", context={"percent": 84.6}),           # context
        podium_session("u-idle", "waiting", branch="joey/s4", waitReason="input"),     # end of turn: not a blocker
        podium_session("u-other", "waiting", cwd="~/other", branch="main", waitReason="permission"),  # unmatched
        podium_session("u-gone", "done", cwd=wts["s1"], wt=wts["s1"], context={"percent": 99.0}),  # ended
    ]
    conf(server.server_port)
    out = podium()
    assert "7 live sessions, 5 matched to tickets, 4 new blockers" in out, out
    got = {e["ticket"]: e["note"] for e in blockers()}
    assert set(got) == {"s1", "s2", "s3", "s4"} and all(e["type"] == "blocker" for e in blockers()), got
    assert got["s1"].startswith("Podium: demo-s1 waits on Joey at a prompt (Claude needs your permission to use Bash)")
    assert got["s1"].endswith(f"http://127.0.0.1:{server.server_port}/#/history?open=u-s1"), got["s1"]
    assert "is stale, no report for 40s" in got["s2"] and "Run jest (Tool error)" in got["s3"] and "Lint" not in got["s3"]
    assert "85% of its context window" in got["s4"]
    assert "t0ken" not in out and "t0ken" not in open(os.path.join(d, "events.jsonl")).read()

    # An unchanged state logs nothing; a new condition on a session logs only that one; one that clears and
    # comes back is logged again.
    assert "0 new blockers" in podium() and len(blockers()) == 4
    Podium.sessions[3]["status"] = "stale"
    Podium.sessions[0].update(status="running", waitReason=None)
    assert "1 new blockers" in podium() and blockers()[-1]["ticket"] == "s4" and "stale" in blockers()[-1]["note"]
    Podium.sessions[0].update(status="waiting", waitReason="permission")
    assert "1 new blockers" in podium() and blockers()[-1]["ticket"] == "s1"

    # A refused token or a server that is down: one line, exit 0, nothing logged.
    conf(server.server_port, token="wrong")
    assert podium().startswith(f"room podium: Podium at http://127.0.0.1:{server.server_port} refused the request (HTTP 401)")
    server.shutdown()
    server.server_close()
    conf(server.server_port)
    assert "Podium is not answering at" in podium()
    assert len(blockers()) == 6

print("room_test: ok")
