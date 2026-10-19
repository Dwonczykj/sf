#!/usr/bin/env python3
"""Check roomui's ps parsing, log summary and log cap with fake data. Run: python3 scripts/roomui_test.py"""
import importlib.machinery
import importlib.util
import os
import tempfile
from datetime import datetime, timezone

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
print("roomui ok")
