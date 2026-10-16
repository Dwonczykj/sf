# Fyxer-AI/web-app — supplementary build rules

Conventions that a single-file diff can't reveal, forwarded to every factory
sub-agent. Each rule is **When / Then / Check**. Mirror any change here into the
repo's own `AGENTS.md` / `.claude/skills/backend-standards/SKILL.md`.

### Firestore model change → register it in sync-functions

- **When:** the diff adds or changes a Firestore collection — a new `CollectionName`
  (`platform/firestore/src/enums/CollectionName.ts`), a new `defineCollection` in
  `domains/*/src/collections.ts`, a new/renamed model under `domains/*/schema/src/models/**`,
  or a new repository — i.e. anything that creates a new collection or changes what a
  synced document looks like.
- **Then:** update `services/sync-functions/` so the collection is mirrored to BigQuery.
  A new collection needs its model import and a `handleSyncDocument<Model>({ name,
  collectionName: CollectionName.X, fieldsToExclude })` export in
  `services/sync-functions/src/index.ts` (free-text or secret fields go in
  `fieldsToExclude`); a changed shape must stay consistent with
  `apps/bigquery-mirror/src/sync/handleSyncDocument.ts`. Without this, the collection
  silently never reaches analytics/BigQuery. This is done only on the user's explicit
  confirmation at planning — raise it, don't assume it.
- **Check:** if a `CollectionName` was added/renamed and the user confirmed syncing it,
  grep `services/sync-functions/src/index.ts` for `CollectionName.<KEY>`; absent fails the
  check. `services/sync-functions/src/syncedCollections.test.ts` must still pass.

### `pnpm-workspace.yaml` change → mirror into the four reduced copies

- **When:** the diff edits `pnpm-workspace.yaml`.
- **Then:** mirror every change other than the `packages` list into all four reduced
  copies (`services/functions/pnpm-workspace.{ghost-user-cleanup,ghost-seat-refunds,metering}.yaml`
  and `apps/plain-field-schemas/pnpm-workspace.upsert-tenant-field-schemas.yaml`). `catalog`,
  `overrides`, `packageExtensions`, `patchedDependencies` must match, or those Cloud Run image
  builds fail with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. Mirror `allowBuilds` in full too:
  pnpm installs every importer in the lockfile whatever `packages` says, so with
  `strictDepBuilds` an image fails on any native dependency its copy does not allow.
- **Check:** diff every top-level key except `packages` in the four copies against the
  root file; any drift fails the check.

## Blast risk

High: the security-review globs from `apps/factory/brief.md` (keep the two in step), then collections, migrations, billing and usage attribution, and data deletion.
- HTTP routes and webhooks: `**/triggers/http/**`, `**/wrapEndpoint.ts`, `platform/express/**`, `services/custom-integration-egress/**`, `apps/factory/src/server.ts`, `**/routes/**`, `**/*webhook*`, `**/*signature*`
- Sign-in, OAuth and tokens: `**/*auth*`, `**/*token*`, `**/*githubApp*`, `apps/sso/**`, `domains/sso/**`, `domains/oauth-clients/**`, `domains/connections/src/accessTokens/**`
- Rules: `**/firestore.rules`, `**/storage.rules`
- Secrets and credentials: `**/*secret*`, `**/*credential*`, `services/custom-integration-vault/**`
- Impersonation: `**/*impersonat*`
- Sending email or acting on a user's behalf: `**/*send*`, `domains/transactional-email/**`, `platform/google-workspace/src/clients/**/email/**`, `platform/microsoft-graph/src/clients/outlook/email/**`, `**/tools/definitions/comms/**`, `**/*approv*`, `**/toolActions*`
- Collections: `domains/*/src/collections.ts`, `platform/firestore/src/enums/CollectionName.ts`, `**/repositories/**`
- Migrations: `migrations/**`
- Billing and usage attribution: `domains/subscriptions/**`, `apps/subscriptions/**`, `platform/stripe/**`, `services/functions-stripe-event-handler/**`, `platform/usage/**`, `domains/usage-events/**`, `**/*billing*`
- Data deletion: `**/*delet*`, `**/*purge*`, `apps/identity/src/triggers/auth/handleAuthUserDeleted/**`

Medium:
- Shared packages with callers in other domains: `platform/**`, `library/**`
- Composite indexes: `platform/firestore/firestore.indexes.json`
- Workspace and deploy config: `pnpm-workspace.yaml`, `**/pnpm-workspace.*.yaml`, `firebase.json`, `**/Dockerfile`
