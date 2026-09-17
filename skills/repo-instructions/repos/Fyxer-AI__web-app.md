# Fyxer-AI/web-app — supplementary build rules

Conventions that a single-file diff can't reveal, forwarded to every factory
sub-agent. Each rule is **When / Then / Check**. Mirror any change here into the
repo's own `AGENTS.md` / `.claude/rules/backend-standards.md`.

### Firestore model change → register it in sync-functions

- **When:** the diff adds or changes a Firestore collection — a new `CollectionName`
  (`shared/src/enums/CollectionName.ts`), a new/renamed model under
  `shared/src/models/**`, or a new repository — i.e. anything that creates a new
  collection or changes what a synced document looks like.
- **Then:** update `sync-functions/` so the collection is mirrored to BigQuery. A new
  collection must be added to the import list and trigger wiring in
  `sync-functions/src/index.ts`; a changed shape must stay consistent with
  `sync-functions/src/triggers/firestore/handleSyncDocument.ts`. Without this, the
  collection silently never reaches analytics/BigQuery. This is done only on the
  user's explicit confirmation at planning — raise it, don't assume it.
- **Check:** if a `CollectionName` was added/renamed, grep `sync-functions/src/index.ts`
  for the new name; a new collection absent from that file fails the check.

### `pnpm-workspace.yaml` change → mirror into the four reduced copies

- **When:** the diff edits `pnpm-workspace.yaml`.
- **Then:** mirror every change other than the `packages` list into all four reduced
  copies (`functions/pnpm-workspace.{migrate-labels,ghost-user-cleanup,ghost-seat-refunds}.yaml`
  and `functions-plain/pnpm-workspace.upsert-tenant-field-schemas.yaml`). `catalog`,
  `overrides`, `packageExtensions`, `patchedDependencies` must match; `onlyBuiltDependencies`
  stays per-image. Otherwise those Cloud Run image builds fail with
  `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- **Check:** diff the four copies' shared keys against the root file; any drift in the
  four recorded keys fails the check.
