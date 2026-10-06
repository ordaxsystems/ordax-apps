#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "migrations" / "notes.externalization.json"
SDK_LOCK_PATH = ROOT / "platform-sdk.lock.json"
TARGET_PATH = ROOT / "apps" / "notes"

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
    lock = json.loads(SDK_LOCK_PATH.read_text(encoding="utf-8"))

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

    contracts = plan.get("platform_contracts_required")
    if not isinstance(contracts, list) or "ordax.app-data/1" not in contracts:
        fail("Notes cutover must require ordax.app-data/1")

    target_sdk = plan.get("target_sdk") or {}
    target_version = target_sdk.get("minimum_bundle_version")
    if target_version != "1.6.0":
        fail("Notes App Data migration must target App SDK 1.6.0 baseline")

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
    if storage.get("current_runtime_injection") != "createStore":
        fail("current Notes runtime storage injection must remain explicit until migrated")
    if storage.get("target_contract") != "ordax.app-data/1":
        fail("Notes durable state must target ordax.app-data/1")
    if storage.get("state") != "blocked-pending-runtime-port-cutover":
        fail("unexpected Notes storage migration state")
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

    current_sdk = lock.get("bundle_version")
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
    print(f"SDK_PIN={current_sdk}")
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
