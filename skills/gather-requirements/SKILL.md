---
name: gather-requirements
description: Read-only feature requirement-gathering. Trace the codebase to find what already exists and can be reused, surface every scope decision that changes the build, resolve each one with the user, and finish with a numbered list of one-sentence requirements that define the feature and implicitly fix what is out of scope. Use when the user wants to scope a feature, gather requirements, decide what to build before building it, is about to write a spec/PRD and needs requirements pinned first, or says "gather requirements", "scope this feature", "requirement gathering". Makes no code changes.
---

# Gather Requirements

Turn a messy feature idea into a locked set of one-sentence requirements. Investigation and conversation only — this is the stage before any spec, plan, or code.

## Hard rules

- **Read-only.** Never Edit, Write, or create project files, and never run a mutating command. Trace and talk, nothing else. (Writing to a scratchpad for your own notes is fine.)
- **The deliverable is a numbered list of one-sentence requirements.** Each requirement is one sentence stating *what* the feature does and *how* it does it.
- **The list is the scope boundary.** Anything not on it is out of scope by omission — no code beyond the requirements gets built later. You may add one line naming a tempting-but-excluded item, but the default is: not listed means not built.
- **Every scope decision is made now.** Nothing is deferred to implementation time. If a choice would change the diff, it gets resolved here.

## Process

1. **Understand the ask.** Restate the feature in one line and get agreement. If the underlying problem is unclear, run the 5 whys before going further.

2. **Trace the codebase (read-only).** The highest-value question: *what of this already exists, and is it plumbed into anything or dormant?* Then:
   - What can be reused — hook points, helpers, tables, templates, existing flows — versus what must be built new?
   - Where are the natural insertion points?
   Keep a running reuse map (`need → existing thing`). Prefer reuse; a feature that is mostly wiring is a good outcome, name it as such.

3. **Surface the decisions that change the build.** Only the ones a competent engineer could not settle alone: scope edges, data-model choices, voice/UX calls, overwrite and idempotency rules, sync vs async, gating. For each, give **one opinionated recommendation** as the default — not a menu.

4. **Resolve every decision with the user.** Interrogate until each is settled; use AskUserQuestion for genuine forks. Lead with your recommendation. Once a decision is made, it is fixed (disagree and commit).

5. **Emit the requirements.** A numbered list, one sentence each, what + how. Then check completeness out loud: *could someone build exactly this feature — and only this feature — from this list?* If not, a requirement is missing or too vague.

## What a good requirement looks like

- One sentence, what + how, testable, no "and also" (split compound requirements in two).
- Good: "On email-backfill completion the system runs tone synthesis only for fyxer.com or fyxer.ai connections."
- Good: "Synthesis writes into `membership.draftPrompt` only when that field is empty, never overwriting an existing custom tone."
- Bad (vague): "The feature should handle tone nicely."
- Bad (compound): "It synthesizes tone, sends an email, and updates settings."

## Handoff

Requirements feed a spec or PRD — they are not the spec. When the list is locked, stop and offer to hand off (e.g. `design.md`, `/to-prd`, `/product-spec`). Do not design the implementation or write code from here.
