#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "migrations" / "notes.externalization.json"
NOTES_SDK_LOCK_PATH = ROOT / "migrations" / "notes.platform-sdk.lock.json"
TARGET_PATH = ROOT / "apps" / "notes"
SOURCE_INVENTORY_PATH = ROOT / "migrations" / "notes.source-snapshot.json"
TRANSFER_MAP_PATH = ROOT / "migrations" / "notes.gate-b-transfer-map.json"
HOST_BOUNDARY_PATH = ROOT / "migrations" / "notes.host-boundary.json"
DISTRIBUTION_PATH = ROOT / "migrations" / "notes.distribution.json"
COMPATIBILITY_PATH = ROOT / "migrations" / "notes.compatibility.json"

REQUIRED_PROOFS = {
    "sdk-contracts-pinned",
    "no-core-private-imports",
    "external-deterministic-package",
    "platform-package-verification",
    "install-stage-health-promote",
    "rollback-last-known-good",
    "platform-operates-without-app",
    "offline-reinstall-from-local-artifact",
    "uninstall-preserves-user-data",
    "old-platform-source-removed",
}


def fail(message: str) -> None:
    raise SystemExit(f"NOTES_EXTERNALIZATION=FAIL\n{message}")


def version_tuple(value: str) -> tuple[int, int, int]:
    try:
        parts = tuple(int(part) for part in value.split("."))
    except (AttributeError, ValueError):
        fail(f"invalid SDK version: {value!r}")
    if len(parts) != 3:
        fail(f"SDK version must have three numeric parts: {value!r}")
    return parts


def main() -> None:
    plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))

    if plan.get("$schema") != "ordax.app-externalization-plan/1":
        fail("unexpected Notes externalization plan schema")
    if plan.get("app_id") != "notes":
        fail("wrong app id")
    source_cutover_allowed = plan.get("source_cutover_allowed")
    distribution_activation_allowed = plan.get("distribution_activation_allowed")
    if source_cutover_allowed not in (False, True):
        fail("source_cutover_allowed must be boolean")
    if distribution_activation_allowed not in (False, True):
        fail("distribution_activation_allowed must be boolean")

    expected_source_repo = (
        "washingtonmsdj/ordax-apps"
        if source_cutover_allowed
        else "washingtonmsdj/prototipo-ordax-os"
    )
    expected_source_path = "apps/notes" if source_cutover_allowed else "system/apps/notes"
    if plan.get("source_repository_current") != expected_source_repo:
        fail("Notes source repository does not match source cutover state")
    if plan.get("source_path_current") != expected_source_path:
        fail("Notes source path does not match source cutover state")
    if plan.get("target_repository") != "washingtonmsdj/ordax-apps":
        fail("wrong Notes target repository")
    if plan.get("target_path") != "apps/notes":
        fail("wrong Notes target path")
    expected_source_state = (
        "ordax-apps-canonical"
        if source_cutover_allowed
        else "platform-until-cutover"
    )
    if plan.get("source_of_truth_state") != expected_source_state:
        fail("Notes source-of-truth state does not match source cutover state")
    if plan.get("authority") != "none":
        fail("app externalization metadata must not carry authority")

    source_snapshot = plan.get("source_snapshot") or {}
    if source_snapshot.get("repository") != "washingtonmsdj/prototipo-ordax-os":
        fail("Notes source snapshot repository drifted")
    snapshot_commit = source_snapshot.get("commit")
    if not isinstance(snapshot_commit, str) or len(snapshot_commit) != 40 or any(
        char not in "0123456789abcdef" for char in snapshot_commit
    ):
        fail("Notes source snapshot must pin an exact lowercase Git commit")
    if snapshot_commit != "f2d3a0d003b07b1f4b4b5514ba9100cdd73a37f6":
        fail("Notes pre-removal source snapshot drifted")
    if source_snapshot.get("captured_before_gate_a_removal") is not True:
        fail("Notes source snapshot must be explicitly pre-removal")
    if source_snapshot.get("app_source_path") != "system/apps/notes":
        fail("Notes source snapshot app path drifted")
    if source_snapshot.get("inventory_file") != "migrations/notes.source-snapshot.json":
        fail("Notes source snapshot inventory path drifted")
    if source_snapshot.get("file_count") != 19:
        fail("Notes source snapshot file count drifted")

    inventory = json.loads(SOURCE_INVENTORY_PATH.read_text(encoding="utf-8"))
    if inventory.get("$schema") != "ordax.notes-source-snapshot/1":
        fail("unexpected Notes source inventory schema")
    if inventory.get("repository") != source_snapshot.get("repository"):
        fail("Notes source inventory repository drifted")
    if inventory.get("commit") != snapshot_commit:
        fail("Notes source inventory commit drifted")
    if inventory.get("captured_before_gate_a_removal") is not True:
        fail("Notes source inventory must be pre-removal")
    if inventory.get("authority") != "none":
        fail("Notes source inventory must not carry authority")
    files = inventory.get("files")
    if not isinstance(files, list) or len(files) != 19 or inventory.get("file_count") != 19:
        fail("Notes source inventory must contain exactly 19 owned files")
    paths = [item.get("path") for item in files if isinstance(item, dict)]
    if len(paths) != 19 or len(set(paths)) != 19:
        fail("Notes source inventory paths must be unique")
    for item in files:
        if not isinstance(item, dict):
            fail("Notes source inventory entry is invalid")
        blob_sha = item.get("blob_sha")
        size = item.get("size")
        if not isinstance(blob_sha, str) or len(blob_sha) != 40 or any(
            char not in "0123456789abcdef" for char in blob_sha
        ):
            fail("Notes source inventory blob SHA is invalid")
        if not isinstance(size, int) or size < 0:
            fail("Notes source inventory size is invalid")

    transfer = json.loads(TRANSFER_MAP_PATH.read_text(encoding="utf-8"))
    if transfer.get("$schema") != "ordax.notes-gate-b-transfer-map/1":
        fail("unexpected Notes Gate B transfer-map schema")
    if transfer.get("source_snapshot") != "migrations/notes.source-snapshot.json":
        fail("Notes Gate B transfer map must bind the pinned source snapshot")
    if transfer.get("source_commit") != snapshot_commit:
        fail("Notes Gate B transfer map source commit drifted")
    if transfer.get("target_root") != "apps/notes":
        fail("Notes Gate B target root drifted")
    if transfer.get("source_file_count") != 19:
        fail("Notes Gate B transfer map must account for 19 source files")
    if transfer.get("target_manifest") != "apps/notes/app.json":
        fail("Notes Gate B target manifest drifted")
    if transfer.get("authority") != "none":
        fail("Notes Gate B transfer metadata must not carry authority")

    transfer_rules = transfer.get("rules") or {}
    required_true_rules = {
        "app_owned_contracts_move_with_product",
        "localization_moves_with_product",
        "public_platform_contracts_consumed_via_sdk_or_injected_ports",
    }
    required_false_rules = {
        "copy_platform_private_imports",
        "copy_legacy_storage_adapters",
        "copy_legacy_native_endpoint",
        "dual_source_allowed",
    }
    for rule in required_true_rules:
        if transfer_rules.get(rule) is not True:
            fail(f"Notes Gate B rule must remain true: {rule}")
    for rule in required_false_rules:
        if transfer_rules.get(rule) is not False:
            fail(f"Notes Gate B rule must remain false: {rule}")

    mappings = transfer.get("mappings")
    if not isinstance(mappings, list) or len(mappings) != 19:
        fail("Notes Gate B transfer map must contain exactly 19 mappings")
    mapped_sources = [item.get("source") for item in mappings if isinstance(item, dict)]
    if len(mapped_sources) != 19 or set(mapped_sources) != set(paths):
        fail("Notes Gate B transfer map must account for every pinned source path exactly once")
    if len(set(mapped_sources)) != 19:
        fail("Notes Gate B transfer sources must be unique")

    allowed_operations = {
        "replace-by-manifest",
        "fold-version-into-manifest",
        "relocate",
        "relocate-and-rewire-public-contract-imports",
        "relocate-and-rewire-app-contract-imports",
        "relocate-and-rewire-contract-imports",
        "move-app-owned-contract",
        "move-app-owned-localization",
    }
    for item in mappings:
        operation = item.get("operation")
        target = item.get("target")
        if operation not in allowed_operations:
            fail(f"unsupported Notes Gate B transfer operation: {operation!r}")
        if not isinstance(target, str) or not target.startswith("apps/notes/"):
            fail("every Notes Gate B target must stay inside apps/notes")

    manifest_sources = {
        item.get("source")
        for item in mappings
        if item.get("target") == "apps/notes/app.json"
    }
    if manifest_sources != {
        "system/apps/notes/app.mjs",
        "system/apps/notes/component.mjs",
        "system/apps/notes/version.mjs",
    }:
        fail("Notes external manifest must replace exactly app.mjs, component.mjs and version.mjs")

    manifest = transfer.get("manifest_replacement") or {}
    expected_manifest = {
        "schema": "ordax.component-manifest/1",
        "id": "notes",
        "kind": "app",
        "releaseMode": "component-slot",
        "owner": "washingtonmsdj/ordax-apps",
        "version_source": "system/apps/notes/version.mjs@source_snapshot",
        "legacy_platform_metadata_sources": [
            "system/apps/notes/app.mjs",
            "system/apps/notes/component.mjs",
        ],
    }
    if manifest != expected_manifest:
        fail("Notes Gate B manifest replacement contract drifted")

    if plan.get("host_boundary") != "migrations/notes.host-boundary.json":
        fail("Notes migration must bind the canonical host boundary")

    host = json.loads(HOST_BOUNDARY_PATH.read_text(encoding="utf-8"))
    if host.get("$schema") != "ordax.notes-host-boundary/1":
        fail("unexpected Notes host-boundary schema")
    if host.get("app_id") != "notes" or host.get("target_source") != "apps/notes":
        fail("Notes host-boundary identity drifted")
    if host.get("host_object") != "ordaxNotesHost":
        fail("Notes host injection object drifted")
    if host.get("injection_owner") != "ordax-platform-host":
        fail("Notes host injection must remain platform-owned")
    if host.get("portable_app_authority") != "none" or host.get("authority") != "none":
        fail("Notes portable boundary must carry no authority")

    facets = host.get("required_facets") or {}
    expected_facets = {
        "appData": ("ordax.app-data/1", True),
        "appActivation": ("ordax.app-activation/1", True),
        "fileSpace": ("ordax.file-space/11", False),
        "intelligence": ("ordax.intelligence/1", False),
        "localization": ("ordax.localization/2", True),
        "surfaceLifecycle": ("ordax.surface-render-lifecycle/5", True),
    }
    if set(facets) != set(expected_facets):
        fail("Notes host facets drifted")
    for name, (contract, required) in expected_facets.items():
        value = facets.get(name) or {}
        if value.get("contract") != contract:
            fail(f"Notes host facet contract drifted: {name}")
        if value.get("required_for_distribution") is not required:
            fail(f"Notes host facet distribution requirement drifted: {name}")

    component_contracts = host.get("component_contracts") or {}
    if component_contracts != {
        "manifest": "ordax.component-manifest/1",
        "runtime": "ordax.component-runtime/1",
    }:
        fail("Notes component contracts drifted")
    if set(host.get("app_owned_contracts") or []) != {"notes-store", "notes-file-importer"}:
        fail("Notes app-owned contract ownership drifted")

    forbidden = host.get("forbidden") or {}
    for key in {
        "platform_private_imports",
        "system_contract_path_imports",
        "legacy_createStore_injection",
        "legacy_native_notes_endpoint",
        "raw_native_storage_path",
        "install_authority_in_app",
        "store_authority_in_app",
    }:
        if forbidden.get(key) is not True:
            fail(f"Notes forbidden host-boundary rule drifted: {key}")

    data = host.get("data") or {}
    if data.get("durable_owner") != "ordax.app-data/1":
        fail("Notes durable data owner must be App Data")
    if data.get("legacy_seed_required") is not False:
        fail("Notes clean pre-launch host boundary must not require legacy seed")
    if data.get("uninstall_payload_and_user_data_are_separate") is not True:
        fail("Notes uninstall/data separation drifted")

    parity = host.get("host_parity") or {}
    for key in {
        "same_port_semantics_web_native",
        "host_specific_transport_outside_app",
        "app_source_fork_by_host_forbidden",
    }:
        if parity.get(key) is not True:
            fail(f"Notes host parity rule drifted: {key}")

    if plan.get("distribution_contract") != "migrations/notes.distribution.json":
        fail("Notes migration must bind the canonical distribution contract")

    distribution = json.loads(DISTRIBUTION_PATH.read_text(encoding="utf-8"))
    if distribution.get("$schema") != "ordax-apps.notes-distribution/1":
        fail("unexpected Notes distribution schema")
    if distribution.get("authority") != "none":
        fail("Notes distribution metadata must carry no authority")

    product = distribution.get("product") or {}
    if product != {
        "app_id": "notes",
        "name": "Notas",
        "portable_source": "apps/notes",
        "canonical_version_source": "apps/notes/app.json#version",
    }:
        fail("Notes distribution product identity drifted")

    ordax_os = distribution.get("ordax_os") or {}
    expected_os = {
        "supported": True,
        "distribution_kind": "first-party-app-component",
        "release_mode": "component-slot",
        "delivery_class": "on-demand",
        "discovery": "store-only",
        "auto_install": False,
        "bundled_in_base": False,
        "runtime_owner": "ordax-os-platform",
    }
    if ordax_os != expected_os:
        fail("Notes OrdaX OS distribution policy drifted")

    store = distribution.get("store") or {}
    if store != {
        "role": "presentation-and-request",
        "install_authority": False,
        "signing_authority": False,
        "permission_authority": False,
        "rollback_authority": False,
        "requests_platform_lifecycle": True,
    }:
        fail("Notes Store authority boundary drifted")

    lifecycle = distribution.get("lifecycle") or {}
    if lifecycle.get("owner") != "platform-component-lifecycle":
        fail("Notes lifecycle owner drifted")
    if lifecycle.get("flow") != [
        "catalog",
        "artifact-identity",
        "trust-provenance",
        "compatibility",
        "stage",
        "health-probation",
        "promote",
        "installed-inventory-receipt",
    ]:
        fail("Notes canonical install lifecycle drifted")
    for key in {
        "failed_update_retains_last_known_good",
        "uninstall_payload_preserves_app_data",
        "user_data_deletion_requires_separate_action",
        "offline_reinstall_from_verified_local_artifact_required",
    }:
        if lifecycle.get(key) is not True:
            fail(f"Notes lifecycle invariant drifted: {key}")

    pre_store = distribution.get("pre_store") or {}
    if pre_store != {
        "allowed": True,
        "channel": "official-signed-stable-release",
        "must_use_same_platform_lifecycle": True,
        "may_create_parallel_updater": False,
    }:
        fail("Notes pre-Store delivery policy drifted")

    activation = distribution.get("activation") or {}
    if activation.get("source_cutover_required") is not True:
        fail("Notes distribution requires source cutover")
    if activation.get("sdk_minimum_bundle") != "1.6.0":
        fail("Notes distribution minimum SDK drifted")
    if activation.get("app_data_contract") != "ordax.app-data/1":
        fail("Notes distribution App Data contract drifted")
    for key in {
        "deterministic_package_required",
        "platform_verification_required",
        "install_stage_health_promote_proof_required",
        "rollback_proof_required",
        "offline_reinstall_proof_required",
        "uninstall_preserves_data_proof_required",
    }:
        if activation.get(key) is not True:
            fail(f"Notes distribution activation proof drifted: {key}")

    if plan.get("compatibility_descriptor") != "migrations/notes.compatibility.json":
        fail("Notes migration must bind the canonical compatibility descriptor")

    if plan.get("production_trust_lock") != "migrations/notes.platform-trust.lock.json":
        fail("Notes migration must bind the canonical production trust lock")
    compatibility = json.loads(COMPATIBILITY_PATH.read_text(encoding="utf-8"))
    expected_compatibility = {
        "schema": "ordax.component-compatibility/1",
        "componentId": "notes",
        "componentVersion": "0.4.1",
        "provides": [
            {"id": "ordax.component-runtime", "major": 1},
        ],
        "requires": [
            {"id": "ordax.app-activation", "minMajor": 1, "maxMajor": 1, "optional": False},
            {"id": "ordax.app-data", "minMajor": 1, "maxMajor": 1, "optional": False},
            {"id": "ordax.file-space", "minMajor": 11, "maxMajor": 11, "optional": True},
            {"id": "ordax.intelligence", "minMajor": 1, "maxMajor": 1, "optional": True},
            {"id": "ordax.localization", "minMajor": 2, "maxMajor": 2, "optional": False},
            {"id": "ordax.surface-render-lifecycle", "minMajor": 5, "maxMajor": 5, "optional": False},
        ],
        "state": {
            "id": "ordax.notes-store",
            "writeVersion": 2,
            "readableFrom": 1,
            "readableThrough": 2,
        },
        "authority": "none",
    }
    if compatibility != expected_compatibility:
        fail("Notes component compatibility descriptor drifted")

    contracts = plan.get("platform_contracts_required")
    if not isinstance(contracts, list) or "ordax.app-data/1" not in contracts:
        fail("Notes cutover must require ordax.app-data/1")

    target_sdk = plan.get("target_sdk") or {}
    target_version = target_sdk.get("minimum_bundle_version")
    if target_version != "1.6.0":
        fail("Notes distribution must target App SDK 1.6.0 baseline")
    if target_sdk.get("lock_file") != "migrations/notes.platform-sdk.lock.json":
        fail("Notes target SDK must use its own exact lock instead of the Studio/global lock")
    notes_sdk_lock = json.loads(NOTES_SDK_LOCK_PATH.read_text(encoding="utf-8"))
    expected_notes_sdk_lock = {
        "$schema": "ordax.app-sdk-lock/1",
        "repository": "washingtonmsdj/prototipo-ordax-os",
        "commit": "4229f9e381203a09036bff7955bd87ea971cf231",
        "bundle_path": "sdk/app-sdk-v1/bundle.json",
        "bundle_schema": "ordax.app-sdk-bundle/1",
        "bundle_version": "1.6.0",
        "sha256": "89628d27ea33ec0a5085bd5b61acba6028edae1a7ca2df54b86ce4d009817f0c",
        "authority": "none",
    }
    if notes_sdk_lock != expected_notes_sdk_lock:
        fail("Notes App SDK 1.6 exact lock drifted")

    resolved = plan.get("resolved_dependencies")
    if not isinstance(resolved, list):
        fail("resolved dependency evidence is missing")
    intelligence = [
        item for item in resolved
        if isinstance(item, dict)
        and item.get("former_dependency") == "system/services/intelligence/client-actions.mjs"
    ]
    if len(intelligence) != 1:
        fail("former private Intelligence helper must be recorded exactly once as resolved")
    replacement = intelligence[0].get("replacement", "")
    if "ordax.intelligence/1" not in replacement:
        fail("resolved Intelligence dependency must use the public Intelligence port")

    private = plan.get("private_dependencies_to_remove")
    if private != []:
        fail("known private Notes dependencies are resolved; new ones require explicit review")

    couplings = plan.get("source_couplings_to_remove")
    if not isinstance(couplings, list):
        fail("source coupling inventory is missing")
    coupling_dependencies = {
        item.get("dependency") for item in couplings if isinstance(item, dict)
    }
    expected_couplings = {
        "system/apps/notes/app.mjs",
        "system/apps/notes/component.mjs",
    }
    if coupling_dependencies != expected_couplings:
        fail("Notes platform source coupling inventory drifted")

    storage = plan.get("storage_migration") or {}
    if storage.get("current_runtime_injection") != "appData":
        fail("Notes runtime must consume the public App Data port")
    if storage.get("target_contract") != "ordax.app-data/1":
        fail("Notes durable state must target ordax.app-data/1")
    if storage.get("state") != "ready-app-data-runtime":
        fail("Notes App Data runtime state must be ready")
    if storage.get("layout") != "ordax.notes-app-data-layout/1":
        fail("Notes App Data layout contract drifted")
    if storage.get("transition_journal") != "ordax.notes-app-data-transition-journal/1":
        fail("Notes App Data transition journal contract drifted")
    if storage.get("crash_safe_commit") is not True:
        fail("Notes App Data commit must remain crash-safe")
    if storage.get("cutover_mode") != "clean-prelaunch":
        fail("Notes must use the clean pre-launch cutover while no production data exists")
    if storage.get("production_user_data_present") is not False:
        fail("Notes migration plan must explicitly record that no production user data exists")
    if storage.get("legacy_seed_required") is not False:
        fail("legacy Notes seed must not be required for a clean pre-launch cutover")
    if storage.get("legacy_payload_may_be_discarded_at_cutover") is not True:
        fail("legacy Notes payload must be explicitly discardable at pre-launch cutover")
    if storage.get("uninstall_data_separation_required") is not True:
        fail("future uninstall must remain separate from App Data deletion")

    delivery = plan.get("delivery") or {}
    expected_delivery = {
        "delivery_class": "on-demand",
        "discovery": "store-only",
        "store_is_install_authority": False,
        "install_owner": "platform-component-lifecycle",
        "pre_store_delivery": "official-signed-stable-release",
        "auto_install": False,
    }
    if delivery != expected_delivery:
        fail("Notes delivery/Store model drifted")

    source_cutover = plan.get("source_cutover") or {}
    expected_cutover = {
        "mode": "remove-platform-first",
        "prelaunch_only": True,
        "temporary_app_absence_allowed": True,
        "dual_source_allowed": False,
        "platform_absence_proof_required_before_copy": True,
        "package_lifecycle_proof_runs_after_source_cutover": True,
        "production_rule_after_first_user_data": "staged-handoff-no-data-loss",
        "source_gate": "platform-absence-before-copy",
        "distribution_gate": "sdk-app-data-package-lifecycle-after-copy",
    }
    if source_cutover != expected_cutover:
        fail("Notes source cutover mode drifted")

    removal = plan.get("gate_a_platform_removal") or {}
    required_removal_proofs = {
        "notes-not-in-installed-app-catalog",
        "notes-not-in-installed-component-catalog",
        "no-local-notes-runtime-import",
        "no-legacy-notes-endpoint",
        "no-fixed-notes-launcher",
        "platform-boots-with-notes-absent",
        "notes-remains-on-demand-store-only-product",
    }
    if set(removal.get("required_proofs") or []) != required_removal_proofs:
        fail("Notes Gate A platform-removal proof set drifted")
    retained = set(removal.get("retain_platform_owned") or [])
    for required in {
        "first-party delivery policy for notes",
        "ordax.app-data/1 owner and verified install binding",
        "owner-managed Notes App Data quota policy",
        "generic component lifecycle/trust/probation infrastructure",
    }:
        if required not in retained:
            fail(f"Notes Gate A must retain platform owner: {required}")

    proofs = plan.get("proofs_required")
    if not isinstance(proofs, list) or set(proofs) != REQUIRED_PROOFS:
        fail("Notes cutover proof set drifted")

    source_present = TARGET_PATH.exists()

    current_sdk = notes_sdk_lock.get("bundle_version")
    current_sdk_tuple = version_tuple(current_sdk)
    target_sdk_tuple = version_tuple(target_version)

    if source_cutover_allowed:
        if not source_present:
            fail("source cutover cannot be enabled without apps/notes")
    elif source_present:
        fail("apps/notes must not exist before Gate A platform absence is proven")

    if distribution_activation_allowed:
        if not source_cutover_allowed or not source_present:
            fail("distribution cannot activate before ordax-apps is the canonical Notes source")
        if current_sdk_tuple < target_sdk_tuple:
            fail("distribution cannot activate below the Notes target SDK")
        if storage.get("state") != "ready-app-data-runtime":
            fail("distribution cannot activate before Notes uses ordax.app-data/1")

    print("NOTES_EXTERNALIZATION=PASS")
    print(f"NOTES_SDK_PIN={current_sdk}")
    print(f"SDK_TARGET={target_version}")
    print("APP_DATA_REQUIRED=YES")
    print("LEGACY_DATA_SEED_REQUIRED=NO")
    print("NOTES_DELIVERY=ON_DEMAND_STORE_ONLY")
    print("STORE_INSTALL_AUTHORITY=NO")
    print("SOURCE_CUTOVER=REMOVE_PLATFORM_FIRST")
    print("TEMPORARY_APP_ABSENCE_ALLOWED=YES")
    print("DUAL_SOURCE_ALLOWED=NO")
    print("GATE_A_PLATFORM_REMOVAL=DEFINED")
    print(f"NOTES_SOURCE_PRESENT={'YES' if source_present else 'NO'}")
    print(f"NOTES_SOURCE_CUTOVER_ALLOWED={'YES' if source_cutover_allowed else 'NO'}")
    print(f"NOTES_DISTRIBUTION_ACTIVATION_ALLOWED={'YES' if distribution_activation_allowed else 'NO'}")
    print(
        "NOTES_SOURCE_CUTOVER_READY="
        + ("YES" if source_cutover_allowed and source_present else "NO")
    )
    print(
        "NOTES_DISTRIBUTION_READY="
        + (
            "YES"
            if distribution_activation_allowed
            and source_cutover_allowed
            and source_present
            and current_sdk_tuple >= target_sdk_tuple
            and storage.get("state") == "ready-app-data-runtime"
            else "NO"
        )
    )


if __name__ == "__main__":
    main()
