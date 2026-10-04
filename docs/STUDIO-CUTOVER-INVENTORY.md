# ORDAX Studio cutover inventory

Status: pre-cutover inventory. This document classifies the current implementation; it does **not** move or duplicate source.

Historical/incubation source reviewed at:

`washingtonmsdj/mcp-blender@7d2b6769b9afecb0b63535ab15161b81cb8907fe`

Canonical target boundary: `docs/STUDIO-BOUNDARY.md`.

## Classification rule

Every current path belongs to exactly one destination class:

- **APP** — portable ORDAX Studio product/UI logic, candidate for future `apps/studio/` cutover;
- **HOST** — foreign-OS Runtime/device host implementation, not part of the OrdaX OS app package;
- **INFRA** — remote/control-plane/service infrastructure;
- **CONNECTOR** — provider-facing integration package such as ChatGPT;
- **ADAPTER** — Blender/Unity/tool capability adapter behind generic runtime contracts;
- **DEV** — local development/diagnostic tooling only.

No path is copied merely because it currently lives under `ordax_studio/`.

## Current Studio package

| Current path | Class | Cutover treatment |
| --- | --- | --- |
| `ordax_studio/assets/` | APP | migrate UI assets after package boundary is proven |
| `ordax_studio/studio.html` | APP candidate | reconcile with current product surface; only one UI source may survive cutover |
| `ordax_studio/studio_product.html` | APP candidate | reconcile with `studio.html`; duplicate product surfaces are not allowed long-term |
| `ordax_studio/product_web_desktop.py` | APP/HOST boundary | split portable presentation/API model from Windows/local server hosting |
| `ordax_studio/web_desktop.py` | APP/HOST boundary | remove direct `ActionRegistry`, `AgentConfig` and local policy imports; consume `ordax.studio-runtime/1` instead |
| `ordax_studio/workbench_bridge.py` | HOST adapter | replace direct local method bridge with environment adapter implementing public Studio runtime ports |
| `ordax_studio/desktop.py` | HOST | native/Windows process and desktop hosting does not belong in OrdaX OS app source |
| `ordax_studio/instance_lock.py` | HOST | process-instance ownership is host/platform responsibility |
| `ordax_studio/device_identity.py` | HOST/platform adapter | pairing/device identity authority remains outside Studio app |
| `ordax_studio/product_auth.py` | HOST/INFRA adapter | direct Control Plane authentication must be replaced by a public host/platform port |
| `ordax_studio/mcp_server.py` | DEV/CONNECTOR boundary | local MCP server is not Studio core; provider/public MCP belongs at connector/control-plane boundary |
| `ordax_studio/blender_connection.py` | ADAPTER | Blender remains a capability adapter, not Studio product core |
| `ordax_studio/preview.py` | APP/HOST boundary | keep portable preview UX; move process/server ownership behind a host port |
| `ordax_studio/project_maintenance.py` | APP candidate | retain only product policy/UX that can operate through public project ports |
| `ordax_studio/cli.py` | DEV/HOST | classify commands individually; do not ship development/bootstrap commands in the OrdaX OS app by default |
| `ordax_studio/__init__.py` | transitional | recreated only if required by the final package/runtime technology |

## Runtime and device execution

The following areas are **not** candidates for `apps/studio/` source:

- `ordax_dev_agent/` — typed local action runtime and current Windows/host implementations;
- `ordax_device_agent/` — resident device runtime compatibility/entrypoints;
- Windows computer control, filesystem, process, input, screenshot and application-launch implementations;
- device credentials, pairing recovery, watchdog/supervisor and host process lifecycle;
- local grant/policy enforcement;
- action execution lock/arbitration.

These responsibilities may later move out of the historical `mcp-blender` repository into a dedicated ORDAX Runtime repository/component, but they must not be absorbed by `ordax-apps` merely to eliminate the old repository name.

## Remote infrastructure

`control-plane/` and Cloudflare deployment/runtime code are **INFRA**.

The Control Plane owns remote protocol/OAuth/grant resolution/queueing/audit responsibilities appropriate to that service. It is not application source and must not be copied into `apps/studio`.

The current repository already identifies the remote MCP service as **ORDAX Control Plane**, which is the correct provider-neutral service identity.

## Provider connectors

`plugins/ordax-chatgpt/` is **CONNECTOR**.

Its user-facing name may be `ORDAX for ChatGPT`, but the connector does not own ORDAX Studio or ORDAX Runtime. Future Grok/other provider integrations follow the same pattern and must use the same canonical capability semantics.

Connector packages must remain independently versioned and must not fork local action implementations.

## Tool adapters

Blender, Unity and future specialized tools are **ADAPTERS**.

They may expose capability-specific UI inside Studio, but their execution belongs behind generic runtime/action contracts. A specialized adapter must not create a second Device Agent, second authorization path or separate provider-specific backend.

## Public contracts required before APP cutover

Portable Studio code must stop importing private Runtime/Control Plane implementations directly.

Required public families include:

- `ordax.app-activation/1`;
- `ordax.component-manifest/1`;
- `ordax.component-runtime/1`;
- `ordax.file-space/11`;
- `ordax.project-catalog/1`;
- `ordax.device-agent-capabilities/1`;
- `ordax.device-agent-capability-reader/1`;
- `ordax.device-action-request/1`;
- `ordax.device-action-receipt/1`;
- `ordax.studio-runtime/1`;
- `ordax.intelligence/1`;
- `ordax.memory/1`;
- `ordax.localization/1`;
- `ordax.surface-render-lifecycle/4`.

The platform PR that publishes the narrowed Studio-facing device/runtime contracts must merge before `ordax-apps` updates its SDK pin. The app must never pin to an unmerged branch or unverified `latest` bundle.

## Source-of-truth cutover sequence

1. publish and merge the required public App SDK contracts;
2. update `ordax-apps/platform-sdk.lock.json` to an exact platform commit + verified bundle digest;
3. build a Studio conformance fixture against those public ports without copying the product source;
4. refactor the current authoritative Studio implementation so portable code depends only on those ports;
5. prove equivalent OrdaX OS and Windows host adapters against the same conformance tests;
6. define deterministic `apps/studio/app.json`, package inputs, localization and app-owned state;
7. prove install -> verify -> stage -> health -> promote -> rollback;
8. prove offline launch/reinstall and uninstall with user-data preservation;
9. freeze the migration boundary;
10. move only the **APP** paths in one controlled source-of-truth cutover;
11. update platform catalog/package references;
12. delete the former APP source from the historical repository in the same migration cycle;
13. prove no residual launch path can start the removed Studio copy;
14. only then decide whether the remaining Runtime/Infra/Adapter repository should be renamed/split and archive `mcp-blender` once it owns nothing canonical.

## Stop conditions

Do not cut over Studio source if any of these are true:

- portable Studio still imports `ordax_dev_agent`, `ordax_device_agent` or `CloudflareControlPlane` directly;
- the App SDK pin references an unmerged branch or mutable latest version;
- the Studio package contains raw Device Agent `execute()`;
- OrdaX OS and Windows use different action semantics;
- provider-specific code selects a different local implementation;
- install/rollback/offline/uninstall lifecycle is not proven;
- old and new Studio copies can both launch.

This inventory intentionally favors a slower single-source cutover over a temporary duplicated product tree.
