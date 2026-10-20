#!/usr/bin/env python3
"""Fails when sf ships something its docs don't mention: a command or skill missing from README.md,
an agent missing from README.md, or a room or roomui subcommand missing from docs/build-room.md."""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
read = lambda *p: open(os.path.join(ROOT, *p), encoding="utf-8").read()
readme, rooms = read("README.md"), read("docs", "build-room.md")
missing = []

for f in sorted(os.listdir(os.path.join(ROOT, "commands"))):
    name = f[:-3]
    if f.endswith(".md") and not re.search(rf"`sf:{re.escape(name)}[ `]", readme):
        missing.append(f"README.md: command sf:{name}")
for d in sorted(os.listdir(os.path.join(ROOT, "skills"))):
    if os.path.isdir(os.path.join(ROOT, "skills", d)) and not re.search(rf"\b{re.escape(d)}\b", readme):
        missing.append(f"README.md: skill {d}")
for f in sorted(os.listdir(os.path.join(ROOT, "agents"))):
    if f.endswith(".md") and f[:-3] not in readme:
        missing.append(f"README.md: agent {f[:-3]}")
for sub in sorted(set(re.findall(r'cmd\("([a-z-]+)"', read("scripts", "room")))):
    if f"| `{sub}` |" not in rooms:
        missing.append(f"docs/build-room.md: room {sub}")
roomui_actions = re.search(r"choices=\(([^)]*)\)", read("scripts", "roomui"))
for sub in re.findall(r'"([a-z]+)"', roomui_actions.group(1) if roomui_actions else ""):
    if f"`{sub}`" not in rooms:
        missing.append(f"docs/build-room.md: roomui {sub}")

assert not missing, "update the docs in the same change:\n  " + "\n  ".join(missing)
print("docs ok")
