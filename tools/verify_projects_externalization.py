#!/usr/bin/env python3
import json
import re
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
    if plan.get("source_repository_current") != "ordaxsystems/ordax-os":
        fail("Projects source must remain in the platform before Gate A")
    if plan.get("source_path_current") != "system/apps/projects":
        fail("Projects source path drifted")
    if plan.get("target_repository") != "ordaxsystems/ordax-apps":
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
    if sdk.get("state") != "merged":
        fail("Projects SDK 1.9 prerequisite must be recorded as merged")
    if sdk.get("platform_merge_commit") != "d2abf5a6012c744ba66568d4ff27661913c81489":
        fail("Projects SDK prerequisite merge commit drifted")
    if sdk.get("platform_pr") != 1168:
        fail("Projects SDK prerequisite PR drifted")
    head = sdk.get("platform_pr_head")
    if head != "86e57b54f9e059c45da80d7579873528ddb45e89":
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
        "ordax.project-cloud-links/1",
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
    if private.get("state") != "resolved-public-sdk-1.9":
        fail("Projects private dependency state drifted")

    cloud_boundary = (plan.get("private_dependencies") or {}).get("project_cloud_links_mutation_boundary") or {}
    if cloud_boundary.get("former_dependency") != "ordax.project-cloud-links/1 mutable port":
        fail("Projects mutable cloud-links dependency is not tracked")
    if cloud_boundary.get("replacement") != "ordax.project-cloud-links-reader/1":
        fail("Projects must consume the read-only cloud-links reader")
    if cloud_boundary.get("state") != "resolved-public-sdk-1.9":
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
    if snapshot.get("state") != "pinned":
        fail("Projects source snapshot must be pinned after SDK merge")
    if snapshot.get("repository") != "ordaxsystems/prototipo-ordax-os":
        fail("Projects pinned historical source snapshot repository drifted")
    if snapshot.get("commit") != sdk["platform_merge_commit"]:
        fail("Projects source snapshot must pin the reviewed SDK merge commit")
    if snapshot.get("inventory_file") != "migrations/projects.source-snapshot.json":
        fail("Projects source inventory location drifted")
    if snapshot.get("file_count") != 9:
        fail("Projects pinned source inventory count drifted")
    inventory_path = ROOT / snapshot["inventory_file"]
    if inventory_path.is_symlink() or not inventory_path.is_file():
        fail("Projects source inventory must be a regular non-symlink file")
    if inventory_path.stat().st_size > 65536:
        fail("Projects source inventory must be bounded")
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    if not isinstance(inventory, dict) or set(inventory) != {
        "$schema", "repository", "commit", "captured_after_public_sdk_boundary",
        "purpose", "file_count", "files", "authority",
    }:
        fail("Projects source inventory fields are not canonical")
    if inventory["$schema"] != "ordax.projects-source-snapshot/1":
        fail("Projects source inventory schema drifted")
    if inventory["repository"] != snapshot["repository"] or inventory["commit"] != snapshot["commit"]:
        fail("Projects source inventory provenance drifted")
    if inventory["authority"] != "none" or inventory["captured_after_public_sdk_boundary"] is not True:
        fail("Projects source inventory cannot grant authority or precede SDK merge")
    if inventory["purpose"] != "reproducible Projects Gate A/B remove-first source transfer":
        fail("Projects source inventory purpose drifted")
    files = inventory.get("files")
    if not isinstance(files, list) or len(files) != snapshot["file_count"] or inventory["file_count"] != len(files):
        fail("Projects source inventory must contain exactly nine blobs")
    paths = []
    for entry in files:
        if not isinstance(entry, dict) or set(entry) != {"path", "blob_sha", "size"}:
            fail("Projects source inventory entry is malformed")
        name, blob_sha, size = entry["path"], entry["blob_sha"], entry["size"]
        if not isinstance(name, str) or not (
            name.startswith("system/apps/projects/") or
            name == "system/services/i18n/catalog/projects.mjs"
        ) or ".." in name.split("/") or "\\" in name:
            fail("Projects source inventory path is outside the app ownership boundary")
        if not isinstance(blob_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", blob_sha):
            fail("Projects source inventory must pin exact lowercase Git blob SHAs")
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
            fail("Projects source inventory size must be a positive integer")
        paths.append(name)
    if paths != sorted(set(paths)) or len(paths) != snapshot["file_count"]:
        fail("Projects source inventory paths must be sorted and unique")


    print("PROJECTS_EXTERNALIZATION=PASS")
    print("SOURCE=PLATFORM")
    print("TARGET=ORDAX_APPS")
    print("SDK_TARGET=1.9.0")
    print("SDK_GATE=MERGED_D2ABF5A")
    print("SOURCE_SNAPSHOT=PINNED")
    print("DUAL_SOURCE_ALLOWED=NO")
    print("DISTRIBUTION_ACTIVATION=BLOCKED")


if __name__ == "__main__":
    main()
