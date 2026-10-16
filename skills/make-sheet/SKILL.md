---
name: make-sheet
description: Turn rows sf has produced (an eval, a review list, an impact table) into something a person can read and mark up, through the sheet CLI chosen at /sf:install (gws today). Always writes a CSV first; with no sheet tool, or one that is logged out, the CSV plus an artifact table is the result. Called by sf skills that hand rows to a person; not user-invoked directly.
---

# make-sheet

Callers hand over rows, a title and a folder for the CSV (gitignored, for example `.scratch/<slug>/`). They never call `gws` themselves.

## 1. Always write the CSV

Write `<folder>/<title>.csv` with a header row. It is the source of truth for the rows, and the whole result when nothing else works.

## 2. Make the sheet, when the tool is there

Read `sheets` in `~/.claude/sf-tools.json` (no file means `gws`). Check it now: `command -v gws`, and `gws auth status` prints `"has_refresh_token": true`. On a pass, upload and convert:

```bash
gws drive files create --json '{"name":"<title>.csv"}' --upload <abs path to csv> --params '{"supportsAllDrives":true}'
gws drive files copy --params '{"fileId":"<id from the first call>","supportsAllDrives":true}' \
  --json '{"name":"<title>","mimeType":"application/vnd.google-apps.spreadsheet"}'
```

Return `https://docs.google.com/spreadsheets/d/<sheet id>` and the uploaded CSV's link. A 403 on scopes means `gws auth login` again; say so and fall through to section 3.

## 3. Otherwise: an artifact table

`sheets` is `null`, the check failed, or the upload failed: say which, then show the rows as a table. Publish them as a private Artifact (load `artifact-design` first, as the Artifact tool requires); without an Artifact tool, print a markdown table of the first 50 rows and point at the CSV. Rows that hold customer data stay in the CSV only: no artifact, no sheet shared beyond the person who asked.

## Adding a tool

One check and upload in section 2, plus its option in `/sf:install`'s sheet question.
