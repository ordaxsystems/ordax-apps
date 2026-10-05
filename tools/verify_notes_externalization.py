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
    if plan.get("source_repository_current") != "washingtonmsdj/prototipo-ordax-os":
        fail("platform must remain the Notes source before cutover")
    if plan.get("source_path_current") != "system/apps/notes":
        fail("current Notes source path drifted")
    if plan.get("target_repository") != "washingtonmsdj/ordax-apps":
        fail("wrong Notes target repository")
    if plan.get("target_path") != "apps/notes":
        fail("wrong Notes target path")
    if plan.get("source_of_truth_state") != "platform-until-cutover":
        fail("Notes must have exactly one authoritative source before cutover")
    if plan.get("authority") != "none":
        fail("app externalization metadata must not carry authority")

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

    proofs = plan.get("proofs_required")
    if not isinstance(proofs, list) or set(proofs) != REQUIRED_PROOFS:
        fail("Notes cutover proof set drifted")

    cutover_allowed = plan.get("cutover_allowed")
    source_present = TARGET_PATH.exists()
    if cutover_allowed is not False and cutover_allowed is not True:
        fail("cutover_allowed must be boolean")

    current_sdk = lock.get("bundle_version")
    current_sdk_tuple = version_tuple(current_sdk)
    target_sdk_tuple = version_tuple(target_version)

    if cutover_allowed:
        if not source_present:
            fail("cutover cannot be enabled without apps/notes")
        if current_sdk_tuple < target_sdk_tuple:
            fail("cutover cannot be enabled below the Notes target SDK")
    elif source_present:
        fail("apps/notes must not exist while cutover is blocked; dual source is forbidden")

    print("NOTES_EXTERNALIZATION=PASS")
    print(f"SDK_PIN={current_sdk}")
    print(f"SDK_TARGET={target_version}")
    print("APP_DATA_REQUIRED=YES")
    print(f"NOTES_SOURCE_PRESENT={'YES' if source_present else 'NO'}")
    print(f"NOTES_CUTOVER_ALLOWED={'YES' if cutover_allowed else 'NO'}")
    print(
        "NOTES_CUTOVER_READY="
        + ("YES" if cutover_allowed and source_present and current_sdk_tuple >= target_sdk_tuple else "NO")
    )


if __name__ == "__main__":
    main()
