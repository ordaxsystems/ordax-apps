# ORDAX Studio cutover inventory

Status: portable source cut over. `apps/studio` in `ordax-apps` is now the canonical Studio product source. The historical `ordax_studio/` tree is legacy-only and remains tracked until its removal is proven.

Historical/incubation source reviewed at:

`washingtonmsdj/mcp-blender@7d2b6769b9afecb0b63535ab15161b81cb8907fe`

Canonical product source: `washingtonmsdj/ordax-apps/apps/studio` (cut over by `ordax-apps#28`).\n\nCanonical boundary: `docs/STUDIO-BOUNDARY.md`.

## Current platform gate

The public platform contract and external conformance gates are complete for the first Studio extraction stage:

- `prototipo-ordax-os#1030` is merged as `73c86c684abcd38b846e6eed40a5cd75cacf50ae`;
- App SDK bundle `1.3.0` is pinned by exact commit and SHA-256 in this repository; the platform currently publishes 1.6.0, but that newer bundle is not silently adopted by Studio;
- `ordax.studio-runtime/1`, capability discovery, project catalog and device request/receipt envelopes are published with `authority:none`;
- raw `ordax.device-agent/1`, `execute()`, grant validation and Control Plane implementation are deliberately not part of the App SDK;
- `ordax-apps#11` proves the pinned SDK by bundle digest, Git blob identity and provider/host-neutral Studio port semantics without copying platform implementation.

Portable UI/host separation is now enforced in `apps/studio`. The next gates are real Windows/OrdaX OS adapter parity, deterministic package/lifecycle proof, and removal of the historical launchable Studio copy.

## Classification rule

Every current path belongs to exactly one destination class:

- **APP** — portable ORDAX Studio product/UI logic; the canonical implementation now lives in `apps/studio/`;
- **HOST** — foreign-OS Runtime/device host implementation, not part of the OrdaX OS app package;
- **INFRA** — remote/control-plane/service infrastructure;
- **CONNECTOR** — provider-facing integration package such as ChatGPT;
- **ADAPTER** — Blender/Unity/tool capability adapter behind generic runtime contracts;
- **DEV** — local development/diagnostic tooling only.

The table below is retained as historical migration inventory. New Studio product features belong only in `apps/studio/`; legacy paths must not become a second product source.

## Current Studio package

| Current path | Class | Cutover treatment |
| --- | --- | --- |
| `ordax_studio/assets/` | APP | migrate UI assets only after host-specific bridge details are removed from portable code |
| `ordax_studio/assets/studio.js` | APP with current HOST leak | preserve portable product behavior, but move pywebview/WebView2 RPC and readiness lifecycle into a host adapter before cutover |
| `ordax_studio/studio.html` | APP candidate | reconcile with current product surface; only one UI source may survive cutover |
| `ordax_studio/studio_product.html` | APP candidate | reconcile with `studio.html`; duplicate product surfaces are not allowed long-term |
| `ordax_studio/product_web_desktop.py` | APP/HOST boundary | split portable presentation/API model from Windows/local server hosting |
| `ordax_studio/web_desktop.py` | APP/HOST boundary | remove portable dependency on direct `ActionRegistry`, `AgentConfig` and local policy implementations; host composition may retain them behind public ports |
| `ordax_studio/workbench_bridge.py` | HOST adapter | replace direct local method bridge with environment adapter implementing public Studio runtime ports |
| `ordax_studio/desktop.py` | HOST | native/Windows process and desktop hosting does not belong in OrdaX OS app source |
| `ordax_studio/instance_lock.py` | HOST | process-instance ownership is host/platform responsibility |
| `ordax_studio/device_identity.py` | HOST/platform adapter | pairing/device identity authority remains outside Studio app |
| `ordax_studio/product_auth.py` | HOST/INFRA adapter | direct Control Plane authentication remains host/platform integration, not portable app ownership |
| `ordax_studio/mcp_server.py` | DEV/CONNECTOR boundary | local MCP server is not Studio core; provider/public MCP belongs at connector/control-plane boundary |
| `ordax_studio/blender_connection.py` | ADAPTER | Blender remains a capability adapter, not Studio product core |
| `ordax_studio/preview.py` | APP/HOST boundary | keep portable preview UX; move process/server ownership behind a host port |
| `ordax_studio/project_maintenance.py` | APP candidate | retain only product policy/UX that can operate through public project/runtime ports |
| `ordax_studio/cli.py` | DEV/HOST | classify commands individually; do not ship development/bootstrap commands in the OrdaX OS app by default |
| `ordax_studio/__init__.py` | transitional | recreated only if required by the final package/runtime technology |

### Host bridge rule

Portable UI code must call one Studio host abstraction. It must not test for or invoke `window.pywebview`, `window.chrome.webview`, Windows process APIs, `ActionRegistry` or Control Plane clients directly.

The Windows host adapter may translate that abstraction to pywebview/WebView2 and ORDAX Runtime. The OrdaX OS composition may translate the same abstraction to platform-owned public ports. Both adapters must pass the same conformance fixture and expose the same action semantics.

## Runtime and device execution

The following areas are **not** candidates for `apps/studio/` source:

- `ordax_dev_agent/` — typed local action runtime and current Windows/host implementations;
- `ordax_device_agent/` — resident device runtime compatibility/entrypoints;
- Windows computer control, filesystem, process, input, screenshot and application-launch implementations;
- device credentials, pairing recovery, watchdog/supervisor and host process lifecycle;
- local grant/policy enforcement;
- action execution lock/arbitration.

These responsibilities may later move out of the historical `mcp-blender` repository into a dedicated ORDAX Runtime repository/component, but they must not be absorbed by `ordax-apps` merely to eliminate the old repository name.

Computer Control policy (`allowed_roots`, full-filesystem opt-in, allowed applications and equivalent local policy) is host/Settings authority. Pairing/device identity and grants are also host/platform authorities. Studio may present status/navigation but must not become their owner.

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

## Public contracts now pinned

The exact App SDK `1.3.0` pin used by this repository publishes the Studio-facing contract set currently accepted by its conformance gates:

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

The platform App SDK 1.6.0 now publishes `ordax.app-data/1` and the Native binding foundation exists, but this repository remains pinned to 1.3.0 for Studio until compatibility is deliberately proven. Studio must not create a private storage endpoint or misuse global Memory as an internal UI database to bypass that gate.

## Source-of-truth cutover sequence

1. **DONE** — publish and merge the required first-stage public App SDK contracts;
2. **DONE** — pin App SDK `1.3.0` to exact platform commit + verified bundle digest;
3. **DONE** — build and CI-prove a Studio conformance fixture against the pinned public ports without copying product source;
4. **DONE for canonical portable source** — `apps/studio` depends on one injected host abstraction and its boundary test rejects pywebview/WebView2/private Runtime imports;
5. **DONE for canonical portable source** — new product work is owned by `apps/studio`; host/runtime authority remains outside the app;
6. prove equivalent OrdaX OS and Windows host adapters against the same conformance tests;
7. **PARTIAL** — `apps/studio/app.json` and portable source exist; deterministic package inputs, localization packaging and app-owned durable state still require completion;
8. prove install -> verify -> stage -> health -> promote -> rollback;
9. prove offline launch/reinstall and uninstall with user-data preservation;
10. freeze the migration boundary;
11. **DONE** — portable **APP** source is canonical in `apps/studio` after `ordax-apps#28`; the historical copy is frozen for new product work and pending removal;
12. update platform catalog/package references;
13. delete the former APP source from the historical repository in the same migration cycle;
14. prove no residual launch path can start the removed Studio copy;
15. only then decide whether the remaining Runtime/Infra/Adapter repository should be renamed/split and archive `mcp-blender` once it owns nothing canonical.

## Stop conditions

Do not enable Studio **distribution cutover** while any of these are true:

- portable Studio still imports `ordax_dev_agent`, `ordax_device_agent` or `CloudflareControlPlane` directly;
- portable UI still contains pywebview/WebView2-specific transport or startup lifecycle code;
- the App SDK pin references an unmerged branch or mutable latest version;
- the Studio package contains raw Device Agent `execute()`;
- OrdaX OS and Windows use different action semantics;
- provider-specific code selects a different local implementation;
- private app state bypasses the canonical App Data boundary;
- install/rollback/offline/uninstall lifecycle is not proven;
- old and new Studio copies can both launch.

`ordax-apps/apps/studio` is the sole canonical portable product source. The historical copy is migration residue only and must be removed once the remaining Runtime/Infra ownership split and residual launch-path proofs are complete.
