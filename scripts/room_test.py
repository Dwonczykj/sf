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

with tempfile.TemporaryDirectory() as d:
    # join: a session Joey started by hand adds itself. One event, role joined; tickets.json is never written.
    sid = "local_0a1b2c3d-0a1b-0a1b-0a1b-0a1b2c3d4e5f"
    tickets_path = os.path.join(d, "tickets.json")
    with open(tickets_path, "w") as f:
        json.dump({"slug": "demo", "tickets": [{"id": "s1", "title": "one", "state": "BUILDING", "session": "demo-s1"}]}, f)
    before = open(tickets_path).read()

    def join(*args):
        return run(d, *args, cmd="join")

    def events():
        return [json.loads(l) for l in open(os.path.join(d, "events.jsonl"))] if os.path.exists(os.path.join(d, "events.jsonl")) else []

    r = join("--ticket", "s1", "--name", "my-session", "--session-id", sid)
    assert r.returncode == 0, r.stderr
    e = events()[-1]
    assert (e["type"], e["role"], e["ticket"], e["name"], e["sessionId"]) == ("join", "joined", "s1", "my-session", sid), e
    r = join("--ticket", "new:Fix the retry", "--name", "cli-session")
    assert r.returncode == 0, r.stderr
    e = events()[-1]
    assert e["ticket"] == "all" and e["newTitle"] == "Fix the retry" and "sessionId" not in e, e
    assert join("--ticket", "watching", "--name", "looker", "--session-id", sid).returncode == 0
    assert events()[-1]["ticket"] == "all" and "newTitle" not in events()[-1]
    n = len(events())
    for args in (("--ticket", "s1", "--name", "x", "--session-id", "local_nothex"),
                 ("--ticket", "s1", "--name", "x", "--session-id", "0a1b2c3d-0a1b-0a1b-0a1b-0a1b2c3d4e5f"),
                 ("--ticket", "s9", "--name", "x"),
                 ("--ticket", "new:", "--name", "x"),
                 ("--ticket", "new:   ", "--name", "x"),
                 ("--ticket", "new:two\nlines", "--name", "x"),
                 ("--ticket", "watching", "--name", "bad name")):
        assert join(*args).returncode != 0, f"accepted {args}"
    assert run(os.path.join(d, "missing"), "--ticket", "watching", "--name", "x", cmd="join").returncode != 0
    assert len(events()) == n and open(tickets_path).read() == before
    # `log` cannot forge a join, and join needs no tickets.json for new: or watching.
    assert run(d, "--ticket", "s1", "--role", "joined", "--type", "join", "--note", "x").returncode != 0
    with tempfile.TemporaryDirectory() as bare:
        assert run(bare, "--ticket", "watching", "--name", "x", cmd="join").returncode == 0
        assert run(bare, "--ticket", "s1", "--name", "x", cmd="join").returncode != 0
    # hook: any session may run `room join`, like `room log`; signoff and render stay orchestrator-only.
    worker = os.path.join(d, "worker.jsonl")
    open(worker, "w").write('{"message":{"content":[{"type":"text","text":"hand-started session"}]}}\n')
    assert not hook("Bash", {"command": f"python3 {d}/room join --dir {d} --ticket watching --name x"}, worker)
    assert not hook("Bash", {"command": f"cd {d} && ./room join --dir . --ticket s1 --name x"}, worker)
    assert hook("Bash", {"command": f"python3 {d}/room render --dir {d}"}, worker)
    assert hook("Edit", {"file_path": tickets_path}, worker)

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

with tempfile.TemporaryDirectory() as d:
    # FACTORY: a slice build-route sent to the cloud factory. It carries its Linear id and PR url, and goes
    # MERGED without a complexity sign-off, since the factory merges it; a local ticket still needs one.
    ok = run(d, "--ticket", "s1", "--role", "factory", "--type", "state", "--note", "FACTORY PRE-1 labelled")
    assert ok.returncode == 0, ok.stderr
    tickets = {"slug": "demo", "tickets": [
        {"id": "s1", "title": "slice 1", "state": "FACTORY", "linear": "PRE-1", "pr": 15001,
         "prUrl": "https://github.com/o/r/pull/15001"},
        {"id": "s2", "title": "slice 2", "state": "NOT STARTED", "after": ["s1"]},
    ]}
    with open(os.path.join(d, "tickets.json"), "w") as f:
        json.dump(tickets, f)
    assert run(d, cmd="render").returncode == 0
    assert "#15001  slice 1" in open(os.path.join(d, "progress.md")).read()
    assert "FACTORY PRE-1" in open(os.path.join(d, "progress.md")).read()
    tickets["tickets"][0]["state"] = "MERGED"
    with open(os.path.join(d, "tickets.json"), "w") as f:
        json.dump(tickets, f)
    assert run(d, cmd="render").returncode == 0
    tickets["tickets"][0].pop("linear")
    with open(os.path.join(d, "tickets.json"), "w") as f:
        json.dump(tickets, f)
    assert run(d, cmd="render").returncode == 1

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


def put_tickets(d, doc):
    with open(os.path.join(d, "tickets.json"), "w") as f:
        json.dump(doc, f)


def evs(d):
    return [json.loads(l) for l in open(os.path.join(d, "events.jsonl"))]


with tempfile.TemporaryDirectory() as root:
    # new: a topic room with no contract, this session as orchestrator, and Joey's Linear answer.
    d = os.path.join(root, "topic-a")
    sid = "local_0a1b2c3d-0a1b-0a1b-0a1b-0a1b2c3d4e5f"
    r = run(d, "--name", "topic-a-orch", "--session-id", sid, "--linear", "mirror", "--team", "ENG", cmd="new")
    assert r.returncode == 0, r.stderr
    doc = json.load(open(os.path.join(d, "tickets.json")))
    assert doc["topic"] is True and doc["orchestrator"] == "topic-a-orch" and doc["orchestratorSessionId"] == sid
    assert doc["linear"] == {"mirror": True, "team": "ENG", "project": None, "milestones": {}, "updates": {}}
    assert doc["tickets"] == [] and doc["adopted"] == {}
    assert all(os.path.isdir(os.path.join(d, x)) for x in ("tasks", "features", "light"))
    assert os.path.isfile(os.path.join(d, "room")) and "mirrored to Linear" in evs(d)[0]["note"]
    board = open(os.path.join(d, "progress.md")).read()
    assert "Linear: mirrored to a project not made yet in ENG" in board, board
    assert run(d, "--name", "x", "--linear", "no", cmd="new").returncode != 0  # already a room
    for args in (["--name", "x", "--linear", "mirror"], ["--name", "x", "--linear", "no", "--team", "ENG"],
                 ["--name", "bad name", "--linear", "no"], ["--name", "x", "--linear", "maybe"]):
        assert run(os.path.join(root, "topic-b"), *args, cmd="new").returncode != 0, args
    assert run(os.path.join(root, "bad topic"), "--name", "x", "--linear", "no", cmd="new").returncode != 0
    r = run(os.path.join(root, "topic-c"), "--name", "x", "--linear", "no-connector", cmd="new")
    assert r.returncode == 0 and "not mirrored (no Linear connector)" in r.stdout + open(
        os.path.join(root, "topic-c", "progress.md")).read(), r.stdout

    # tasks start without sign-offs and print their skill, code rights, tier and findings path.
    tickets = {**doc, "tickets": [
        {"id": "x1", "title": "what reads the inbox", "kind": "explore", "state": "NOT STARTED"},
        {"id": "p1", "title": "try the parser", "kind": "prototype", "state": "NOT STARTED"},
        {"id": "g1", "title": "inbox card", "kind": "design", "state": "DONE", "feature": "search"},
        {"id": "b1", "title": "read path", "kind": "slice", "state": "NOT STARTED", "feature": "search", "design": "g1"},
        {"id": "b2", "title": "no feature", "kind": "slice", "state": "NOT STARTED"},
        {"id": "l1", "title": "copy fix", "kind": "light", "state": "NOT STARTED"},
    ]}
    put_tickets(d, tickets)
    out = json.loads(run(d, "x1", cmd="start").stdout)
    assert (out["kind"], out["skill"], out["code"], out["tier"]) == (
        "explore", "none, reads code and docs", "read-only", "claude-sonnet-5-5 high"), out
    assert out["findings"] == os.path.join(d, "tasks", "x1.md") and out["useWorktree"] is False
    assert json.loads(run(d, "p1", cmd="start").stdout)["useWorktree"] is True

    # a task is DONE only with tasks/<id>.md under 40 lines and a note pointing to it.
    done = ("--ticket", "x1", "--role", "task", "--type", "state", "--note", "DONE three readers found")
    assert "tasks/x1.md" in run(d, *done).stderr
    write(os.path.join(d, "tasks", "x1.md"), "line\n" * 40)
    assert "40 lines" in run(d, *done).stderr
    write(os.path.join(d, "tasks", "x1.md"), "line\n" * 39)
    assert "note pointing" in run(d, *done).stderr
    assert run(d, "--ticket", "x1", "--role", "task", "--type", "note", "--note", "findings tasks/x1.md").returncode == 0
    assert run(d, *done).returncode == 0
    assert run(d, "--ticket", "b1", "--role", "build", "--type", "state", "--note", "DONE").returncode == 0  # not a task

    # features: a build in a topic room names one, and only its own feature's sign-offs start it.
    assert "no feature" in run(d, "b2", cmd="start").stderr
    for gate in ("requirements", "split"):
        assert run(d, "--ticket", "all", "--gate", gate, "--answer", "ok", "--quote", "yes", cmd="signoff").returncode == 0
        assert run(d, "--ticket", "all", "--feature", "other", "--gate", gate, "--answer", "ok", "--quote", "yes",
                   cmd="signoff").returncode == 0
    r = run(d, "b1", cmd="start")
    assert r.returncode == 1 and "for feature search" in r.stderr and "requirements, split" in r.stderr, r.stderr
    for gate in ("requirements", "split"):
        r = run(d, "--ticket", "all", "--feature", "search", "--gate", gate, "--answer", "ok", "--quote", "signed",
                cmd="signoff")
        assert r.returncode == 0 and json.loads(r.stdout)["feature"] == "search", r.stdout
    out = json.loads(run(d, "b1", cmd="start").stdout)
    assert out["contract"] == os.path.join(d, "features", "search") and out["design"] == os.path.join(d, "tasks", "g1")
    assert out["useWorktree"] is True and "skill" not in out
    assert run(d, "--ticket", "b1", "--feature", "search", "--gate", "split", "--answer", "a", "--quote", "b",
               cmd="signoff").returncode != 0  # --feature only with --ticket all
    # every line names its feature: taken from the ticket, or given for `all`
    assert run(d, "--ticket", "b1", "--role", "build", "--type", "note", "--note", "x").returncode == 0
    assert evs(d)[-1]["feature"] == "search"
    assert run(d, "--ticket", "all", "--feature", "search", "--role", "orchestrator", "--type", "note", "--note", "y").returncode == 0
    assert evs(d)[-1]["feature"] == "search"
    assert run(d, "--ticket", "x1", "--role", "task", "--type", "note", "--note", "z").returncode == 0
    assert "feature" not in evs(d)[-1]
    assert run(d, "--ticket", "all", "--feature", "bad name", "--role", "o", "--type", "note", "--note", "z").returncode != 0
    answer = [e for e in evs(d) if e["type"] == "answer"][-1]
    assert answer["feature"] == "search", answer

    # light builds: signed on their own ticket only, on 1 to 5 numbered requirements in light/<id>.md
    assert "requirements" in run(d, "l1", cmd="start").stderr  # the "all" lines above don't sign it
    assert run(d, "--ticket", "l1", "--gate", "requirements", "--answer", "Sign", "--quote", "sign it",
               cmd="signoff").returncode == 0
    assert "light/l1.md is missing" in run(d, "l1", cmd="start").stderr
    write(os.path.join(d, "light", "l1.md"), "".join(f"{n}. requirement {n}\n" for n in range(1, 7)))
    assert "6 numbered requirements" in run(d, "l1", cmd="start").stderr
    write(os.path.join(d, "light", "l1.md"), "# l1: copy fix\n\n1. Say X.\n2) Say Y.\n3. Test it.\n")
    out = json.loads(run(d, "l1", cmd="start").stdout)
    assert out["contract"] == os.path.join(d, "light", "l1.md") and out["kind"] == "light"

    # ask: a card with a body and a link to the session behind it, from the orchestrator or a task session
    write(os.path.join(d, "light", "card.md"), "1. Say X.\n2. Say Y.\n")
    opts = ["--option", "Sign", "Sign the light contract", "--option", "Change it", "Say what to change"]
    r = run(d, "--ticket", "l1", "--header", "Light", "--question", "Sign l1's light contract?", *opts,
            "--body", os.path.join(d, "light", "card.md"), "--from-name", "copy-chat", "--from-session", sid, cmd="ask")
    assert r.returncode == 0, r.stderr
    q = json.loads(r.stdout)
    assert q["ask"]["body"] == ["1. Say X.", "2. Say Y."] and q["from"] == {"name": "copy-chat", "sessionId": sid}
    assert q["role"] == "orchestrator"
    r = run(d, "--ticket", "g1", "--header", "Design", "--question", "Which version?", *opts, "--role", "task", cmd="ask")
    assert r.returncode == 0 and json.loads(r.stdout)["role"] == "task" and "from" not in json.loads(r.stdout)
    write(os.path.join(d, "big.md"), "x\n" * 21)
    for bad in (["--role", "joey"], ["--body", os.path.join(d, "big.md")], ["--body", os.path.join(d, "nope.md")],
                ["--from-session", sid], ["--from-name", "n", "--from-session", "local_x"]):
        assert run(d, "--ticket", "l1", "--header", "H", "--question", "Q?", *opts, *bad, cmd="ask").returncode != 0, bad

    # kinds and design links are checked
    for t in ({"id": "k", "title": "t", "state": "NOT STARTED", "kind": "gossip"},
              {"id": "k", "title": "t", "state": "NOT STARTED", "design": "x1"},
              {"id": "k", "title": "t", "state": "NOT STARTED", "feature": "bad name"}):
        put_tickets(d, {**tickets, "tickets": tickets["tickets"] + [t]})
        assert run(d, "x1", cmd="start").returncode != 0, t
    put_tickets(d, tickets)

    # render: one tree per feature, tasks and light builds without one last; a DONE task needs no complexity line
    assert run(d, cmd="render").returncode == 0, run(d, cmd="render").stderr
    board = open(os.path.join(d, "progress.md")).read()
    tree = board.split("```")[1]
    assert tree.index("feature search") < tree.index("no feature (tasks and light builds)"), tree
    assert "[design] inbox card" in tree and "[explore] what reads the inbox" in tree and "[light] copy fix" in tree
    assert tree.count("staging") == 2

    # signoff --change takes each signed file's path
    for ok in ("requirements.md", "features/search/requirements.md", "light/l1.md", "openspec/changes/x"):
        assert run(d, "--ticket", "all", "--change", ok, "--answer", "a", "--quote", "b", cmd="signoff").returncode == 0, ok
    for bad in ("features/../requirements.md", "light/l1.txt", "split.md"):
        assert run(d, "--ticket", "all", "--change", bad, "--answer", "a", "--quote", "b", cmd="signoff").returncode != 0, bad

    # hook: a feature's requirements lock on its own sign-off, a light contract on its ticket's
    orch, worker = os.path.join(root, "orch.jsonl"), os.path.join(root, "worker.jsonl")
    open(orch, "w").write('{"message":{"content":[{"type":"text","text":"sf-orchestrator: topic-a"}]}}\n')
    open(worker, "w").write('{"message":{"content":[{"type":"text","text":"a task"}]}}\n')
    e = os.path.join(root, "e")
    assert run(e, "--name", "e-orch", "--linear", "no", cmd="new").returncode == 0
    freq, oreq, light = (os.path.join(e, "features", "f1", "requirements.md"),
                         os.path.join(e, "features", "f2", "requirements.md"), os.path.join(e, "light", "l1.md"))
    assert not hook("Edit", {"file_path": freq}, orch) and not hook("Edit", {"file_path": light}, orch)
    assert run(e, "--ticket", "all", "--feature", "f1", "--gate", "requirements", "--answer", "a", "--quote", "b",
               cmd="signoff").returncode == 0
    assert hook("Edit", {"file_path": freq}, orch) and not hook("Edit", {"file_path": oreq}, orch)
    assert not hook("Edit", {"file_path": os.path.join(e, "requirements.md")}, orch)  # the root has no sign-off
    assert run(e, "--ticket", "all", "--change", "features/f1/requirements.md", "--answer", "a", "--quote", "b",
               cmd="signoff").returncode == 0
    assert not hook("Edit", {"file_path": freq}, orch)
    assert run(e, "--ticket", "l1", "--gate", "requirements", "--answer", "a", "--quote", "b", cmd="signoff").returncode == 0
    assert hook("Write", {"file_path": light}, orch) and not hook("Write", {"file_path": os.path.join(e, "light", "l2.md")}, orch)
    for sub in ("refresh", "adopt"):
        assert hook("Bash", {"command": f"python3 {e}/room {sub} --dir {e}"}, worker), sub
    assert not hook("Bash", {"command": f"python3 {e}/room refresh --dir {e}"}, orch)


def tree_hash(path):
    out = []
    for base, _, files in sorted(os.walk(path)):
        for name in sorted(files):
            p = os.path.join(base, name)
            out.append((p, open(p, "rb").read(), os.stat(p).st_mtime_ns))
    return out


with tempfile.TemporaryDirectory() as root:
    # adopt by reference: the other run's tickets show on this board, read-only, and that run is never written.
    d, src = os.path.join(root, "topic"), os.path.join(root, "older-run")
    assert run(d, "--name", "orch", "--linear", "no", cmd="new").returncode == 0
    os.makedirs(src)
    theirs = {"slug": "older-run", "orchestrator": "older-orch", "orchestratorSessionId": "local_0a1b2c3d-0a1b-0a1b-0a1b-0a1b2c3d4e5f",
              "tickets": [{"id": "s1", "title": "schema", "state": "MERGED", "pr": 101, "branch": "j/s1"},
                          {"id": "s2", "title": "write path", "state": "PR", "stacksOn": "s1", "pr": 102,
                           "prUrl": "https://github.com/o/r/pull/102", "session": "older-s2"}]}
    put_tickets(src, theirs)
    write(os.path.join(src, "events.jsonl"), "")
    before = tree_hash(src)
    r = run(d, "--feature", "export", "--source", src, cmd="adopt")
    assert r.returncode == 0 and "2 tickets" in r.stdout and "no summary.md yet" in r.stdout, r.stdout + r.stderr
    doc = json.load(open(os.path.join(d, "tickets.json")))
    assert doc["adopted"] == {"export": src}
    copies = {t["id"]: t for t in doc["tickets"]}
    assert set(copies) == {"export.s1", "export.s2"} and copies["export.s2"]["stacksOn"] == "export.s1"
    assert copies["export.s2"]["feature"] == "export" and copies["export.s2"]["source"] == src
    source = open(os.path.join(d, "features", "export", "source.md")).read()
    assert src in source and "older-orch (local_0a1b2c3d" in source and "https://github.com/o/r/pull/102" in source
    assert "| s1 | MERGED | - | - | #101 |" in source
    assert "adopted by reference" in run(d, "export.s2", cmd="start").stderr
    assert run(d, cmd="render").returncode == 0  # a MERGED copy needs no complexity line here
    assert "read-only, from older-run" in open(os.path.join(d, "progress.md")).read()
    for args in (["--feature", "export", "--source", src], ["--feature", "x", "--source", d],
                 ["--feature", "x", "--source", os.path.join(root, "missing")], ["--feature", "bad name", "--source", src]):
        assert run(d, *args, cmd="adopt").returncode != 0, args

    # refresh follows the other run, keeps this room's own Linear link, and says when it has finished
    doc["tickets"][1]["linearIssue"] = "ENG-9"
    put_tickets(d, doc)
    theirs["tickets"][1].update(state="MERGED", ci="green")
    put_tickets(src, theirs)
    before = tree_hash(src)
    write(os.path.join(d, "features", "export", "summary.md"), "x\n" * 80)
    r = run(d, cmd="refresh")
    assert r.returncode == 0 and "cut it under 80" in r.stdout and "rewrite summary.md once more" in r.stdout, r.stdout
    copies = {t["id"]: t for t in json.load(open(os.path.join(d, "tickets.json")))["tickets"]}
    assert copies["export.s2"]["state"] == "MERGED" and copies["export.s2"]["linearIssue"] == "ENG-9"
    write(os.path.join(d, "features", "export", "summary.md"), "x\n" * 79)
    assert "summary.md ok" in run(d, cmd="refresh").stdout
    # a broken source keeps the last copy
    write(os.path.join(src, "tickets.json"), "{ half")
    before = tree_hash(src)
    assert "kept the last copy" in run(d, cmd="refresh").stdout
    assert len(json.load(open(os.path.join(d, "tickets.json")))["tickets"]) == 2
    assert tree_hash(src) == before, "refresh wrote to the adopted run"


# orchestrate.md's task table and the CLI's TASKS name the same kinds and start tiers.
import importlib.machinery
import importlib.util
loader = importlib.machinery.SourceFileLoader("room_cli", ROOM)
room_cli = importlib.util.module_from_spec(importlib.util.spec_from_loader("room_cli", loader))
loader.exec_module(room_cli)
doc_rows = {}
for line in open(os.path.join(HERE, "..", "commands", "orchestrate.md")):
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    if len(cells) == 4 and cells[0] in room_cli.TASKS:
        doc_rows[cells[0]] = cells[3]
assert set(doc_rows) == set(room_cli.TASKS), doc_rows
for kind, tier_text in doc_rows.items():
    model, effort = room_cli.TASKS[kind][2].split()
    want = {"claude-sonnet-5-5": "Sonnet 5.5", "claude-opus-5-5": "Opus 5.5"}[model]
    assert tier_text == f"{want} {effort}", (kind, tier_text)

print("room_test: ok")
