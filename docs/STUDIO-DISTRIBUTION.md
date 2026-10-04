# ORDAX Studio distribution

`ORDAX Studio` has one portable application source and two official release targets.

## OrdaX OS

- distributed as a first-party OrdaX app component;
- consumes OrdaX OS platform ports;
- does not bundle a duplicate `ORDAX Runtime`;
- lifecycle is owned by the OrdaX component/package system.

## Windows

- distributed separately as a standalone desktop product;
- canonical launcher: `ORDAX Studio.exe`;
- canonical installer family: `ORDAX-Studio-Setup-<version>-x64.exe`;
- ships the provider-neutral `ORDAX Runtime` needed to implement the same public capability boundary on Windows;
- does not require OrdaX OS.

## Single-source rule

After the controlled source cutover, both targets consume `apps/studio/`. Target-specific source is limited to host adapters, packaging and lifecycle integration. A Windows-only or OrdaX-OS-only fork of Studio product logic is not an allowed architecture.

## Version provenance

Studio has one canonical application version for both targets.

Before cutover, the historical Windows implementation still reads the transitional version from `washingtonmsdj/mcp-blender:pyproject.toml#project.version`. This is migration state only; it is not a second permanent version authority.

After cutover, `apps/studio/app.json#version` is the single application version source. OrdaX OS package metadata and the Windows installer must consume that value. A target may append build/provenance metadata where the packaging format supports it, but it must not carry a separate Studio feature/version line.

A release must prove adapter, typed-action and canonical-version parity before promotion. The machine-readable authority for this policy is `migrations/studio.distribution.json`; CI enforces it with `tools/verify_studio_distribution.py`.
