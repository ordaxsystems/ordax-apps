# Notes externalization plan

Notes is the first extraction pilot from `prototipo-ordax-os` into `ordax-apps`.

The source MUST NOT be copied here until the platform boundary is complete. This document classifies the current dependencies so the cutover is deliberate and results in one source of truth.

## Platform contracts that must be public App SDK inputs

Current Notes code consumes platform capabilities/contracts that remain owned by OrdaX:

- `ordax.component-manifest/1` — component identity/version/lifecycle metadata;
- `ordax.component-runtime/1` — runtime mount/destroy boundary;
- `ordax.surface-render-lifecycle/4` — render/localization lifecycle supplied by Surface;
- `ordax.intelligence/1` — local/cloud-neutral Intelligence port;
- `ordax.file-space/11` — user file-space capability port;
- app activation contract — navigation/activation request boundary;
- localization contracts — component-scoped locale/fallback behavior.

An external app must consume these through a versioned SDK/runtime host boundary, never by importing files from `system/contracts` in another repository checkout.

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

## Private implementation dependency to eliminate

Current Notes UI imports:

`system/services/intelligence/client-actions.mjs`

This is a private implementation helper and MUST NOT be copied into `ordax-apps` or exported as platform service source.

Notes already receives an `intelligence` port at runtime. The target is for app-owned code (using the public SDK validator/client surface) to call the injected `ordax.intelligence/1` capability without knowing the platform service implementation path.

## Tests that must change at cutover

Platform tests currently inspect repo-local paths such as `system/apps/notes/*`. These must split into:

1. app/package tests owned by `ordax-apps`;
2. platform conformance/integration tests that consume a built Notes artifact/package by identity and version.

Browser/Surface integration must not require Notes source to be inside the platform repository.

## Cutover gate

Do not move Notes source until all are true:

- [ ] required platform contracts are published in a pinned App SDK bundle;
- [ ] app runtime can use SDK/runtime-provided ports without core-private imports;
- [ ] Notes-owned contracts have an explicit migration destination;
- [ ] deterministic Notes package builds entirely in `ordax-apps`;
- [ ] platform verifies package identity/provenance/compatibility without source checkout;
- [ ] install/stage/health/promote/rollback proof exists;
- [ ] uninstall preserves user data;
- [ ] platform works with Notes absent;
- [ ] source cutover removes the old core copy in the same migration window.

Long-lived dual source is forbidden.
