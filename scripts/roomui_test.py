#!/usr/bin/env python3
"""Check roomui's ps parsing, log summary and log cap with fake data. Run: python3 scripts/roomui_test.py"""
import importlib.machinery
import importlib.util
import os
import builtins
import io
import json
import tempfile
import contextlib
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
loader = importlib.machinery.SourceFileLoader("roomui", os.path.join(HERE, "roomui"))
roomui = importlib.util.module_from_spec(importlib.util.spec_from_loader("roomui", loader))
loader.exec_module(roomui)

assert roomui.parse_etime("02:55") == 175
assert roomui.parse_etime("13:41:01") == 49261
assert roomui.parse_etime("41-01:53:07") == 41 * 86400 + 6787
assert roomui.parse_ps("  PID ELAPSED\n42012   02:55  51472   0.3\n") == {"pid": 42012, "up": 175, "rss": 51472 / 1024, "cpu": 0.3}
assert roomui.parse_ps("") is None and roomui.parse_ps("garbage line\n") is None
assert roomui.duration(175) == "2m 55s" and roomui.duration(3725) == "1h 02m" and roomui.duration(90000) == "1d 1h 0m"

now = datetime(2026, 10, 19, 12, 0, 0, tzinfo=timezone.utc)
log = [
    "2026-10-18T11:59:00Z agent-team 1 999.0 0.0",  # older than 24h, ignored
    "2026-10-18T12:01:00Z agent-team 1 40.0 0.0",
    "2026-10-19T11:00:00Z agent-team 1 60.0 1.0",
    "2026-10-19T11:00:00Z podium 2 56.0 0.0",
    "not a sample line",
    "2026-10-19T11:01:00Z podium 2 oops 0.0",
]
s = roomui.summarise(log, now)
assert s == {"agent-team": (2, 60.0, 50.0), "podium": (1, 56.0, 56.0)}, s
assert roomui.summarise([], now) == {}

with tempfile.TemporaryDirectory() as d:
    roomui.STATE, roomui.MAX_SAMPLES = d, 3
    roomui.find = lambda name: ("up", 7 if name == "podium" else 6)
    roomui.stats = lambda pid: {"pid": pid, "up": 1, "rss": 50.0 + pid, "cpu": 0.0}
    for _ in range(3):
        roomui.sample_once()
    lines = roomui.read_samples()
    assert len(lines) == 3 and all(l.split()[1] in ("agent-team", "podium") for l in lines), lines
    assert lines[-1].split()[1:] == ["podium", "7", "57.0", "0.0"], lines

# rooms: listed from tickets.json or events.jsonl, summarised, and closed by archiving
def write_room(state, slug, events=(), tickets=None):
    d = os.path.join(state, slug)
    os.makedirs(d)
    if tickets is not None:
        with open(os.path.join(d, "tickets.json"), "w") as f:
            json.dump({"slug": slug, "orchestrator": "orch", "tickets": tickets}, f)
    with open(os.path.join(d, "events.jsonl"), "w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")


def event(i, minutes_ago, kind, note="n", ask=None):
    ts = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).strftime(roomui.TS)
    return {"ts": ts, "id": i, "type": kind, "note": note, **({"ask": ask} if ask else {})}


with tempfile.TemporaryDirectory() as d:
    roomui.STATE = d
    ask = {"question": "q?", "options": []}
    write_room(d, "old", [event(1, 3000, "question", ask=ask), event(2, 2990, "answer", "re 1: yes")], [{"id": "a"}, {"id": "b"}])
    write_room(d, "waiting", [event(1, 3000, "question", ask=ask)], [{"id": "a"}])
    write_room(d, "live", [event(1, 2, "note")], [{"id": "a"}])
    os.makedirs(os.path.join(d, "not-a-room"))
    os.makedirs(os.path.join(d, ".closed", "x-1"))
    assert roomui.room_names() == ["live", "old", "waiting"], roomui.room_names()
    now = datetime.now(timezone.utc)
    old = roomui.room_summary("old")
    assert (old["tickets"], old["open"], old["orchestrator"]) == (2, 0, "orch"), old
    assert roomui.room_summary("waiting")["open"] == 1
    assert roomui.room_line(old, now).startswith("old  2 tickets · orchestrator orch · 0 open questions · last event 2d 1h")
    # a room with an open question or a recent event is not closed without --force
    for name in ("waiting", "live"):
        ok, msg = roomui.close_room(name)
        assert not ok and "--force" in msg and os.path.isdir(os.path.join(d, name)), msg
    # names that are not rooms are refused, and nothing outside the state dir is reachable
    for bad in ("", ".closed", "../x", "a/b", "missing", "not-a-room"):
        assert not roomui.close_room(bad, force=True)[0], bad
    ok, msg = roomui.close_room("old")
    assert ok and not os.path.exists(os.path.join(d, "old")), msg
    archived = [x for x in os.listdir(os.path.join(d, ".closed")) if x.startswith("old-")]
    assert len(archived) == 1 and os.path.exists(os.path.join(d, ".closed", archived[0], "events.jsonl"))
    assert roomui.close_room("waiting", force=True)[0] and roomui.room_names() == ["live"]

    # the follow-up after stop: default is no, y closes only that room, no tty means no prompt
    write_room(d, "second", [event(1, 3000, "note")], [{"id": "a"}])
    real_input, real_isatty = builtins.input, roomui.sys.stdin.isatty
    try:
        roomui.sys.stdin.isatty = lambda: True
        for answers, left in ((["", ""], ["live", "second"]), (["n", "y"], ["live"]), (["yes", "N"], ["second"])):
            if "second" not in roomui.room_names():
                write_room(d, "second", [event(1, 3000, "note")], [{"id": "a"}])
            if "live" not in roomui.room_names():
                write_room(d, "live", [event(1, 2, "note")], [{"id": "a"}])
            it = iter(answers)
            builtins.input = lambda prompt="": next(it)
            with contextlib.redirect_stdout(io.StringIO()):
                roomui.offer_close(True)
            assert roomui.room_names() == left, (answers, roomui.room_names())
        roomui.sys.stdin.isatty = lambda: False
        builtins.input = lambda prompt="": (_ for _ in ()).throw(AssertionError("must not prompt without a tty"))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            roomui.offer_close(True)
        assert "roomui close <room>" in out.getvalue() and roomui.room_names()
    finally:
        builtins.input, roomui.sys.stdin.isatty = real_input, real_isatty
print("roomui ok")
