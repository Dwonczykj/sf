---
name: check-ui
description: Open a page of the app a branch changes, look at it, and check it against the repo's design rules, through whichever browser tool this session has (Claude in Chrome, the built-in browser pane, or Playwright MCP, starting from the one chosen at /sf:install). With none, it returns "UI not checked" and the reason for the gate's report. Called by pre-pr-gate on a diff that changes UI; not user-invoked directly.
---

# check-ui

The caller gives the URL of a running copy of the app (a local dev server, or a preview deploy of this branch), the pages or states the diff changes, and where the repo's design rules live (its frontend standards and design-system docs, or what `repo-instructions` holds for it).

## 1. Pick the browser

Try in order, starting with `ui` from `~/.claude/sf-tools.json` and then the rest of this list, and use the first one whose tools load:

1. **Claude in Chrome** (`claude-in-chrome`): load `mcp__claude-in-chrome__list_connected_browsers` with `ToolSearch`; it must list a browser.
2. **Built-in browser pane** (`browser-pane`): the `mcp__Claude_Browser__*` tools are present (the Claude desktop app only).
3. **Playwright MCP** (`playwright`): `ToolSearch` with `+playwright` finds `mcp__playwright__browser_navigate`.

`ui: null` means the user chose None: skip straight to section 3 without trying any. No URL, or none of the three available: section 3 as well.

## 2. Check the page

For each page or state the diff changes:

- Open it, wait for it to settle, and take a screenshot at desktop width and at 375px.
- Read the console for errors raised while it loaded or while you exercised the change.
- Exercise only the change's own flow (open the modal, pick the option) with test data. Sign in only with the repo's own test accounts on a local or preview host, never with anyone's real login, and submit nothing outward-facing.
- Compare what you see with the design rules: components from the design system rather than hand-rolled ones, the loading, empty and error states, spacing and type from the tokens, and text that fits at 375px.

Report findings the gate's way: **P0** the page is broken, blank, throws, or the change isn't visible; **P1** a design-rule breach a reviewer would flag; **P2** a nit. Name the browser used, the URL and the screenshots.

## 3. When it can't run

Return `ui: not checked (<reason>)`, for example "no running app given", "no browser tool in this session", "None chosen in /sf:install". The gate prints that line in its report and carries on. An unchecked UI never blocks the gate, and it never counts as a pass.

## Adding a browser

One entry in section 1's list, plus its option in `/sf:install`'s UI question.
