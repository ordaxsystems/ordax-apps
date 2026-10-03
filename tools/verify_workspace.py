#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT / "ordax-apps.workspace.json"


def fail(message: str) -> None:
    raise SystemExit(f"ORDAX_APPS_WORKSPACE=FAIL\n{message}")


def main() -> None:
    data = json.loads(WORKSPACE.read_text(encoding="utf-8"))

    if data.get("$schema") != "ordax.apps-workspace/1":
        fail("unexpected workspace schema")
    if data.get("role") != "first-party-app-source":
        fail("unexpected repository role")
    if data.get("platform_repository") != "washingtonmsdj/prototipo-ordax-os":
        fail("platform repository must remain canonical")
    if data.get("authority") != "none":
        fail("apps workspace must not own authority")
    if data.get("source_of_truth_policy") != "single-repository-per-app":
        fail("single source of truth policy is required")

    structural = data.get("structural_surfaces_owned_by_platform")
    if structural != ["store", "settings", "account", "system"]:
        fail("structural platform surfaces drifted")

    targets = data.get("first_party_app_targets")
    if not isinstance(targets, list) or not targets or len(targets) != len(set(targets)):
        fail("first-party app targets must be a unique non-empty list")
    if set(structural) & set(targets):
        fail("structural surfaces must not be app extraction targets")
    if data.get("initial_extraction_candidate") != "notes":
        fail("initial extraction candidate must remain explicitly reviewed")

    invariants = data.get("invariants") or {}
    required_true = [
        "store_is_structural_and_non_removable",
        "uninstall_implies_user_data_delete",
        "third_party_apps_use_public_contracts",
    ]
    if invariants.get("store_is_structural_and_non_removable") is not True:
        fail("Store must remain structural and non-removable")
    if invariants.get("store_ui_has_install_authority") is not False:
        fail("Store UI must not own install authority")
    if invariants.get("app_package_may_mint_authority") is not False:
        fail("app packages must not mint authority")
    if invariants.get("uninstall_implies_user_data_delete") is not False:
        fail("uninstall and user-data deletion must remain separate")
    if invariants.get("platform_services_may_be_copied_here") is not False:
        fail("platform services must not be copied into app repository")
    if invariants.get("third_party_apps_use_public_contracts") is not True:
        fail("third-party apps must use public contracts")
    if invariants.get("localization_policy") != "component-scoped":
        fail("localization must remain component-scoped")

    forbidden_top_level = {"boot", "bootstrap", "system", "infra"}
    present = {path.name for path in ROOT.iterdir()}
    unexpected = sorted(forbidden_top_level & present)
    if unexpected:
        fail(f"platform-owned top-level paths present: {', '.join(unexpected)}")

    print("ORDAX_APPS_WORKSPACE=PASS")
    print(f"FIRST_PARTY_TARGET_COUNT={len(targets)}")
    print("STORE_STRUCTURAL_NON_REMOVABLE=YES")
    print("APP_INSTALL_AUTHORITY=PLATFORM_ONLY")


if __name__ == "__main__":
    main()
