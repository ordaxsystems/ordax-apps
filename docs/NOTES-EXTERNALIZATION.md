# Notes externalization plan

Notes is the first extraction pilot from `prototipo-ordax-os` into `ordax-apps`.

The source MUST NOT be copied here while the platform copy is still authoritative. For this pre-launch/no-data migration, the selected strategy is **remove-platform-first**: first remove the implementation from the platform and prove OrdaX works without Notes; then copy the last canonical source into `ordax-apps`. A temporary absence of Notes is preferable to two authoritative copies.

## Platform contracts that must be public App SDK inputs

Current Notes code consumes platform capabilities/contracts that remain owned by OrdaX:

- `ordax.component-manifest/1` — component identity/version/lifecycle metadata;
- `ordax.component-runtime/1` — runtime mount/destroy boundary;
- `ordax.surface-render-lifecycle/4` — render/localization lifecycle supplied by Surface;
- `ordax.intelligence/1` — local/cloud-neutral Intelligence port;
- `ordax.file-space/11` — user file-space capability port;
- `ordax.app-data/1` — device-local private durable state for an independently delivered app;
- app activation contract — navigation/activation request boundary;
- localization contracts — component-scoped locale/fallback behavior.

An external app must consume these through a versioned SDK/runtime host boundary, never by importing files from `system/contracts` in another repository checkout.

The current repository-wide SDK pin remains 1.3.0. The platform bundle inspected at commit `4229f9e381203a09036bff7955bd87ea971cf231` publishes App SDK 1.6.0 including `ordax.app-data/1`. Notes therefore targets **App SDK 1.6.0 or newer compatible contract-major coverage** before source cutover; the global pin must not be bumped blindly because Studio and other consumers have their own conformance gates.

## Notes-owned contracts/code

These belong to the Notes product and should move with Notes at source-of-truth cutover:

- Notes document/store schema and validation;
- Notes file-importer schema and behavior;
- Notes domain runtime;
- Notes UI/editor/list/reference/image code;
- Notes CSS/assets;
- Notes localization messages;
- Notes app tests that do not require platform integration.

The current core paths `system/contracts/notes-store.mjs` and `system/contracts/notes-file-importer.mjs` therefore need an ownership migration strategy; they should not become generic OrdaX platform contracts merely because they currently live under `system/contracts`.

## Intelligence dependency — resolved

The former private dependency on:

`system/services/intelligence/client-actions.mjs`

is no longer present in the current platform source. Notes now owns `system/apps/notes/platform/intelligence-summary.mjs`, which validates and consumes the injected public `ordax.intelligence/1` port.

Do not reconstruct the private helper import during extraction. The migration plan records this dependency as resolved evidence rather than an open blocker.

## Durable storage blocker

The current Notes component runtime still receives a host factory named `createStore` and creates the Notes runtime from that store. This is still platform-composition coupling and is not the final external-app storage boundary.

The target is:

```text
Notes package
   ↓
injected ordax.app-data/1 port
   ↓
platform-owned App Data owner
```

The Notes-owned schema/validation remains with the product. The platform owns isolation, verified app identity, durability and lifecycle of the private App Data partition.

Source cutover remains blocked until the Notes runtime is adapted to the public App Data port and the platform can operate with Notes absent. Package/lifecycle proof no longer blocks the source move in this pre-launch mode; it is performed **after** the single-source move, from `ordax-apps`. This is a **clean pre-launch cutover**: there are no production users or production Notes data to migrate, so a legacy seed bridge is not a requirement. The old payload may be discarded at cutover instead of being carried forward as compatibility debt.

This does **not** weaken the permanent lifecycle rule: once real user data exists, uninstalling the app must remain separate from deleting its App Data.

## Delivery and Store model

Notes is an **on-demand, store-only** first-party app.

The target flow is:

```text
Store UI
   ↓ request only
platform app lifecycle owner
   ↓
catalog → artifact identity → trust/provenance → compatibility
   ↓
stage → health/probation → promote → installed inventory/receipt
   ↓
Notes launchable
```

The Store is structural UI and does not own install authority, signing keys, package verification, permissions or rollback. Before the Store UI/service exists, the official signed Stable release channel may deliver a completed first-party app through the same platform-owned trust/lifecycle boundary. On-demand apps are never silently auto-installed.

Because this project is still pre-launch with no production Notes data, the first externalized Notes install is treated as a clean install. We do not keep a legacy storage bridge solely for nonexistent users.

## Remaining source couplings

The platform catalog still references repo-local Notes implementation metadata through:

- `system/apps/catalog.mjs` → `system/apps/notes/app.mjs`;
- `system/apps/component-catalog.mjs` → `system/apps/notes/component.mjs`.

These must become package/inventory metadata lookups at cutover. They are source-location couplings, not reasons to expose platform internals to the app.

## Tests that must change at cutover

Platform tests currently inspect repo-local paths such as `system/apps/notes/*`. These must split into:

1. app/package tests owned by `ordax-apps`;
2. platform conformance/integration tests that consume a built Notes artifact/package by identity and version.

Browser/Surface integration must not require Notes source to be inside the platform repository.

## Cutover gate

### Gate A — remove from platform

Before copying Notes into `ordax-apps`:

- [ ] required platform contracts are published in a pinned App SDK bundle accepted by Notes;
- [ ] `ordax.app-data/1` is the runtime storage boundary instead of `createStore`;
- [x] pre-launch cutover explicitly requires no legacy data seed;
- [x] Notes Intelligence uses app-owned code over the injected public Intelligence port;
- [ ] Notes-owned contracts have an explicit migration destination;
- [ ] product/catalog metadata no longer imports repo-local Notes implementation;
- [ ] platform works, boots and reports Notes as absent/uninstalled;
- [ ] old platform app implementation and residual launch paths are removed.

### Gate B — establish canonical external source

After Gate A, copy the last canonical Notes source into `apps/notes` and mark `ordax-apps` as the only source of truth.

### Gate C — package and delivery

Then prove from the external source:

- [ ] deterministic Notes package builds entirely in `ordax-apps`;
- [ ] platform verifies package identity/provenance/compatibility without source checkout;
- [ ] install/stage/health/promote/rollback proof exists;
- [ ] offline reinstall works from a verified local artifact;
- [ ] uninstall keeps App Data separate from payload deletion;
- [ ] signed catalog/Store projection exposes Notes only when the artifact is genuinely available.

Long-lived dual source is forbidden. Temporary absence is explicitly allowed for this pre-launch migration.
## CI preflight

`tools/verify_notes_externalization.py` enforces the current Gate A state. While the platform remains the declared source, it fails if `apps/notes` appears here. After platform removal is proven, the migration metadata must advance before `apps/notes` is introduced; the verifier then protects the new single-source state.
