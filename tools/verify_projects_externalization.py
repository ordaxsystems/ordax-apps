#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "migrations" / "projects.externalization.json"
TARGET = ROOT / "apps" / "projects"


def fail(message: str) -> None:
    raise SystemExit(f"PROJECTS_EXTERNALIZATION=FAIL\n{message}")


def main() -> None:
    plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))

    if plan.get("$schema") != "ordax.app-externalization-plan/1":
        fail("unexpected plan schema")
    if plan.get("app_id") != "projects":
        fail("wrong app id")
    if plan.get("authority") != "none":
        fail("externalization metadata must not carry authority")
    if plan.get("source_repository_current") != "washingtonmsdj/prototipo-ordax-os":
        fail("Projects source must remain in the platform before Gate A")
    if plan.get("source_path_current") != "system/apps/projects":
        fail("Projects source path drifted")
    if plan.get("target_repository") != "washingtonmsdj/ordax-apps":
        fail("Projects target repository drifted")
    if plan.get("target_path") != "apps/projects":
        fail("Projects target path drifted")
    if plan.get("source_of_truth_state") != "platform-until-cutover":
        fail("Projects must have exactly one source of truth before cutover")
    if plan.get("source_cutover_allowed") is not False:
        fail("Projects source cutover must remain blocked before platform absence proof")
    if plan.get("distribution_activation_allowed") is not False:
        fail("Projects distribution must remain blocked before source cutover")
    if TARGET.exists():
        fail("apps/projects must not exist before remove-first Gate A; dual source is forbidden")

    sdk = plan.get("target_sdk") or {}
    if sdk.get("minimum_bundle_version") != "1.9.0":
        fail("Projects must target App SDK 1.9.0")
    if sdk.get("state") != "pending-platform-merge":
        fail("Projects SDK state must remain pending until platform PR #1168 merges")
    if sdk.get("platform_pr") != 1168:
        fail("Projects SDK prerequisite PR drifted")
    head = sdk.get("platform_pr_head")
    if head != "c35f22ccab4f47da4211547a7e7a929f4ff254e8":
        fail("Projects SDK prerequisite must pin the reviewed read-only PR head")

    contracts = set(plan.get("platform_contracts_required") or [])
    required = {
        "ordax.app-activation/1",
        "ordax.component-manifest/1",
        "ordax.component-runtime/1",
        "ordax.device-agent-capabilities/1",
        "ordax.device-agent-capability-reader/1",
        "ordax.localization/2",
        "prototype-ordax.localization-pack/1",
        "ordax.project-catalog/1",
        "ordax.project-cloud-links-reader/1",
        "ordax.surface-render-lifecycle/5",
    }
    if contracts != required:
        fail("Projects public contract set drifted")

    private = (plan.get("private_dependencies") or {}).get("device_agent_private_import") or {}
    if private.get("former_dependency") != "system/contracts/device-agent.mjs":
        fail("Projects private Device Agent dependency is not tracked")
    if "ordax.device-agent-capability-reader/1" not in private.get("replacement", ""):
        fail("Projects Device Agent replacement must use the public read-only port")
    if private.get("state") != "pending-platform-pr-1168":
        fail("Projects private dependency state drifted")

    cloud_boundary = (plan.get("private_dependencies") or {}).get("project_cloud_links_mutation_boundary") or {}
    if cloud_boundary.get("former_dependency") != "ordax.project-cloud-links/1 mutable port":
        fail("Projects mutable cloud-links dependency is not tracked")
    if cloud_boundary.get("replacement") != "ordax.project-cloud-links-reader/1":
        fail("Projects must consume the read-only cloud-links reader")
    if cloud_boundary.get("state") != "pending-platform-pr-1168":
        fail("Projects cloud-links reader gate drifted")
    if set(cloud_boundary.get("forbidden_methods") or []) != {"link", "unlink", "destroy"}:
        fail("Projects cloud-links reader must forbid link/unlink/destroy")

    state = plan.get("state") or {}
    if state.get("app_owned_durable_state") is not False:
        fail("Projects must not invent app-owned durable project state")
    if state.get("project_catalog_owner") != "platform":
        fail("project catalog ownership must remain platform")
    if state.get("project_cloud_links_owner") != "platform":
        fail("project cloud-link ownership must remain platform")
    if state.get("mutation_authority") != "none":
        fail("Projects must not gain mutation authority")

    delivery = plan.get("delivery") or {}
    if delivery != {
        "delivery_class": "on-demand",
        "discovery": "store-only",
        "store_is_install_authority": False,
        "install_owner": "platform-component-lifecycle",
        "auto_install": False,
    }:
        fail("Projects delivery model drifted")

    snapshot = plan.get("source_snapshot") or {}
    if snapshot.get("state") != "pending-platform-sdk-1.9-merge":
        fail("Projects source snapshot must remain pending before SDK merge")
    if snapshot.get("commit") is not None or snapshot.get("inventory_file") is not None:
        fail("Projects source snapshot must not be fabricated before platform SDK merge")

    print("PROJECTS_EXTERNALIZATION=PASS")
    print("SOURCE=PLATFORM")
    print("TARGET=ORDAX_APPS")
    print("SDK_TARGET=1.9.0")
    print("SDK_GATE=PENDING_PLATFORM_PR_1168")
    print("DUAL_SOURCE_ALLOWED=NO")
    print("DISTRIBUTION_ACTIVATION=BLOCKED")


if __name__ == "__main__":
    main()
