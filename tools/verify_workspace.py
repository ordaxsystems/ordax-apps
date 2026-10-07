#!/usr/bin/env python3
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT / "ordax-apps.workspace.json"
NOTES_MIGRATION = ROOT / "migrations" / "notes.externalization.json"
STUDIO_MIGRATION = ROOT / "migrations" / "studio.externalization.json"


def fail(message: str) -> None:
    raise SystemExit(f"ORDAX_APPS_WORKSPACE=FAIL\n{message}")


def validate_notes_migration() -> tuple[bool, bool]:
    plan = json.loads(NOTES_MIGRATION.read_text(encoding="utf-8"))
    if plan.get("$schema") != "ordax.app-externalization-plan/1":
        fail("unexpected Notes externalization plan schema")
    if plan.get("app_id") != "notes":
        fail("Notes externalization plan has wrong app id")
    source_cutover_allowed = plan.get("source_cutover_allowed")
    distribution_activation_allowed = plan.get("distribution_activation_allowed")
    if source_cutover_allowed not in (False, True):
        fail("Notes source_cutover_allowed must be boolean")
    if distribution_activation_allowed not in (False, True):
        fail("Notes distribution_activation_allowed must be boolean")

    expected_source_repo = (
        "ordaxsystems/ordax-apps"
        if source_cutover_allowed
        else "washingtonmsdj/prototipo-ordax-os"
    )
    expected_source_path = "apps/notes" if source_cutover_allowed else "system/apps/notes"
    expected_source_state = (
        "ordax-apps-canonical"
        if source_cutover_allowed
        else "platform-until-cutover"
    )
    if plan.get("source_repository_current") != expected_source_repo:
        fail("Notes source repository does not match source cutover state")
    if plan.get("source_path_current") != expected_source_path:
        fail("Notes source path does not match source cutover state")
    if plan.get("target_repository") != "ordaxsystems/ordax-apps":
        fail("Notes target repository is invalid")
    if plan.get("source_of_truth_state") != expected_source_state:
        fail("Notes source-of-truth state does not match source cutover state")
    if distribution_activation_allowed and not source_cutover_allowed:
        fail("Notes distribution cannot activate before source cutover")
    if plan.get("authority") != "none":
        fail("externalization metadata must not carry authority")

    contracts = plan.get("platform_contracts_required")
    if not isinstance(contracts, list) or "ordax.app-data/1" not in contracts:
        fail("Notes migration must require the public App Data contract")

    target_sdk = plan.get("target_sdk") or {}
    if target_sdk.get("minimum_bundle_version") != "1.6.0":
        fail("Notes App Data cutover must target App SDK 1.6.0")

    private_dependencies = plan.get("private_dependencies_to_remove")
    if private_dependencies != []:
        fail("known private Notes dependencies are resolved; new ones require explicit review")

    resolved_dependencies = plan.get("resolved_dependencies")
    if not isinstance(resolved_dependencies, list) or not any(
        item.get("former_dependency") == "system/services/intelligence/client-actions.mjs"
        and "ordax.intelligence/1" in item.get("replacement", "")
        for item in resolved_dependencies
        if isinstance(item, dict)
    ):
        fail("Notes migration must record the former private Intelligence helper as resolved")

    source_couplings = plan.get("source_couplings_to_remove")
    dependencies = {
        item.get("dependency")
        for item in source_couplings or []
        if isinstance(item, dict)
    }
    if dependencies != {
        "system/apps/notes/app.mjs",
        "system/apps/notes/component.mjs",
    }:
        fail("Notes source coupling inventory drifted")

    storage = plan.get("storage_migration") or {}
    if storage.get("current_runtime_injection") != "appData":
        fail("Notes runtime storage injection must be App Data")
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
        fail("Notes must use clean pre-launch cutover")
    if storage.get("production_user_data_present") is not False:
        fail("Notes plan must record no production user data")
    if storage.get("legacy_seed_required") is not False:
        fail("Notes legacy seed must remain disabled before first production data")
    if storage.get("uninstall_data_separation_required") is not True:
        fail("Notes uninstall/data separation invariant is required")

    delivery = plan.get("delivery") or {}
    if delivery.get("delivery_class") != "on-demand":
        fail("Notes must remain on-demand")
    if delivery.get("discovery") != "store-only":
        fail("Notes discovery must remain store-only")
    if delivery.get("store_is_install_authority") is not False:
        fail("Store UI must not own Notes install authority")
    if delivery.get("install_owner") != "platform-component-lifecycle":
        fail("Notes install authority must remain platform-owned")
    if delivery.get("pre_store_delivery") != "official-signed-stable-release":
        fail("pre-Store Notes delivery must use the official signed Stable channel")
    if delivery.get("auto_install") is not False:
        fail("on-demand Notes must not auto-install")

    source_cutover = plan.get("source_cutover") or {}
    if source_cutover.get("mode") != "remove-platform-first":
        fail("Notes must use remove-platform-first source cutover")
    if source_cutover.get("prelaunch_only") is not True:
        fail("remove-first Notes cutover must remain prelaunch-only")
    if source_cutover.get("temporary_app_absence_allowed") is not True:
        fail("prelaunch Notes cutover must allow temporary app absence")
    if source_cutover.get("dual_source_allowed") is not False:
        fail("Notes dual source must remain forbidden")
    if source_cutover.get("platform_absence_proof_required_before_copy") is not True:
        fail("platform absence proof is required before copying Notes")
    if source_cutover.get("package_lifecycle_proof_runs_after_source_cutover") is not True:
        fail("Notes package lifecycle proof must run from canonical external source")
    if source_cutover.get("production_rule_after_first_user_data") != "staged-handoff-no-data-loss":
        fail("production Notes cutover rule must preserve real user data")

    proofs = plan.get("proofs_required")
    required_proofs = {
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
    if not isinstance(proofs, list) or set(proofs) != required_proofs:
        fail("Notes cutover proof set drifted")

    return source_cutover_allowed, distribution_activation_allowed


def validate_studio_migration() -> None:
    plan = json.loads(STUDIO_MIGRATION.read_text(encoding="utf-8"))
    if plan.get("$schema") != "ordax.app-externalization-plan/1":
        fail("unexpected Studio externalization plan schema")
    if plan.get("app_id") != "studio":
        fail("Studio externalization plan has wrong app id")
    if plan.get("source_repository_current") != "ordaxsystems/ordax-apps":
        fail("Studio portable source must be canonical in ordax-apps after source cutover")
    if plan.get("source_path_current") != "apps/studio":
        fail("Studio canonical source path drifted")
    if plan.get("legacy_source_repository") != "washingtonmsdj/mcp-blender":
        fail("Studio legacy source repository must remain explicitly tracked until removal")
    if plan.get("legacy_source_path") != "ordax_studio":
        fail("Studio legacy source path drifted")
    if plan.get("target_repository") != "ordaxsystems/ordax-apps":
        fail("Studio target repository is invalid")
    if plan.get("target_path") != "apps/studio":
        fail("Studio target path is invalid")
    if plan.get("source_of_truth_state") != "ordax-apps-canonical-legacy-retired":
        fail("Studio source of truth must record completed legacy retirement")
    if plan.get("cutover_scope") != "distribution":
        fail("Studio cutover_allowed must describe distribution cutover, not source ownership")
    if plan.get("cutover_allowed") is not False:
        fail("Studio distribution cutover must remain blocked until lifecycle proofs are complete")
    if plan.get("cutover_phase") != "legacy-retired":
        fail("Studio cutover phase must record completed legacy retirement")
    if not (ROOT / "apps" / "studio" / "app.json").is_file():
        fail("canonical Studio app manifest is missing from ordax-apps")
    if plan.get("authority") != "none":
        fail("Studio externalization metadata must not carry authority")

    inventory_commit = plan.get("inventory_commit")
    if not isinstance(inventory_commit, str) or re.fullmatch(r"[0-9a-f]{40}", inventory_commit) is None:
        fail("Studio inventory commit must be an exact Git commit")

    required_contracts = {
        "ordax.app-activation/1",
        "ordax.component-manifest/1",
        "ordax.component-runtime/1",
        "ordax.device-action-receipt/1",
        "ordax.device-action-request/1",
        "ordax.device-agent-capabilities/1",
        "ordax.device-agent-capability-reader/1",
        "ordax.file-space/11",
        "ordax.intelligence/1",
        "ordax.localization/1",
        "ordax.memory/1",
        "ordax.project-catalog/1",
        "ordax.studio-runtime/1",
        "ordax.surface-render-lifecycle/4",
    }
    contracts = plan.get("platform_contracts_required")
    if not isinstance(contracts, list) or set(contracts) != required_contracts:
        fail("Studio required public contract set drifted")

    private_dependencies = plan.get("private_dependencies_to_remove")
    if not isinstance(private_dependencies, list) or len(private_dependencies) < 7:
        fail("Studio migration must track private Runtime/Control Plane dependencies")
    dependencies = {
        item.get("dependency")
        for item in private_dependencies
        if isinstance(item, dict)
    }
    for required in {
        "ordax_dev_agent.actions.ActionRegistry",
        "ordax_dev_agent.config.AgentConfig",
        "ordax_dev_agent.cloudflare_control_plane.CloudflareControlPlane",
        "ordax_dev_agent.mcp_server",
        "direct self.agent.execute action dispatch",
    }:
        if required not in dependencies:
            fail(f"Studio migration is missing dependency classification: {required}")

    ownership = plan.get("non_app_ownership") or {}
    if "ordax_dev_agent" not in ownership.get("runtime_host", []):
        fail("Studio plan must keep ordax_dev_agent outside app ownership")
    if "ordax_device_agent" not in ownership.get("runtime_host", []):
        fail("Studio plan must keep ordax_device_agent outside app ownership")
    if ownership.get("remote_infrastructure") != ["control-plane"]:
        fail("Studio plan must keep Control Plane outside app ownership")
    if "plugins/ordax-chatgpt" not in ownership.get("provider_connectors", []):
        fail("Studio plan must classify ChatGPT integration as a connector")

    legacy_gate = plan.get("legacy_repository_deletion_gate") or {}
    if legacy_gate.get("portable_app_canonical") is not True:
        fail("Studio legacy-removal gate must recognize ordax-apps as canonical")
    if legacy_gate.get("legacy_app_new_features_allowed") is not False:
        fail("legacy Studio app source must be frozen for new product features")
    if legacy_gate.get("retirement_requested") is not True:
        fail("legacy repository retirement must be explicitly requested")
    if legacy_gate.get("portable_source_dependency_remaining") is not False:
        fail("portable Studio must not depend on the legacy repository")
    if legacy_gate.get("runtime_host_repointed") is not True:
        fail("Runtime must be repointed before legacy deletion")
    if legacy_gate.get("provider_connector_repointed") is not True:
        fail("provider connector must be repointed before legacy deletion")
    if legacy_gate.get("production_control_plane_repointed") is not True:
        fail("production Control Plane must be repointed before legacy deletion")
    if legacy_gate.get("chatgpt_control_plane_runtime_e2e_green") is not True:
        fail("post-cutover GPT to Runtime smoke must be green")
    if legacy_gate.get("no_functional_legacy_build_deploy_launch_reference") is not True:
        fail("functional legacy reference audit must be green")
    if legacy_gate.get("safe_to_delete_legacy_repository") is not True:
        fail("legacy repository deletion must be authorized after all gates")
    blockers = legacy_gate.get("blockers")
    if blockers != []:
        fail("retired legacy repository must have no remaining blockers")
    if legacy_gate.get("legacy_repository_contents_removed") is not True:
        fail("legacy repository contents must be recorded as removed")
    retirement_commit = legacy_gate.get("retirement_commit")
    if not isinstance(retirement_commit, str) or re.fullmatch(r"[0-9a-f]{40}", retirement_commit) is None:
        fail("legacy retirement commit must be exact")
    if legacy_gate.get("post_retirement_smoke_status") != "succeeded":
        fail("post-retirement smoke must remain green")

    proofs = plan.get("proofs_required")
    required_proofs = {
        "sdk-contracts-pinned",
        "no-private-runtime-imports",
        "provider-neutral-core",
        "ordax-os-windows-port-parity",
        "external-deterministic-package",
        "platform-package-verification",
        "install-stage-health-promote",
        "rollback-last-known-good",
        "platform-operates-without-app",
        "offline-reinstall-from-local-artifact",
        "uninstall-preserves-user-data",
        "old-historical-app-source-removed",
        "no-residual-launch-path",
    }
    if not isinstance(proofs, list) or set(proofs) != required_proofs:
        fail("Studio cutover proof set drifted")


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

    migration = data.get("repository_migration") or {}
    expected_migration = {
        "status": "cutover-complete",
        "previous_repository": "washingtonmsdj/ordax-apps",
        "canonical_repository": "ordaxsystems/ordax-apps",
        "current_platform_repository": "washingtonmsdj/prototipo-ordax-os",
        "target_platform_repository": "ordaxsystems/prototipo-ordax-os",
        "current_runtime_repository": "ordaxsystems/ordax-runtime",
        "target_runtime_repository": "ordaxsystems/ordax-runtime",
        "current_control_plane_repository": "ordaxsystems/ordax-control-plane",
        "target_control_plane_repository": "ordaxsystems/ordax-control-plane",
        "redirect_dependency_allowed": False,
        "mirror_repository_allowed": False,
        "dual_authority_allowed": False,
        "rename_during_transfer_allowed": False,
        "provenance_rewrite_allowed": False,
        "transfer_first_then_repoint": True,
    }
    if migration != expected_migration:
        fail("repository namespace migration contract drifted")

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

    expected_contracts = {
        "component_manifest": "ordax.component-manifest/1",
        "delivery_policy": "ordax.first-party-app-delivery-policy/1",
        "intelligence": "ordax.intelligence/1",
        "memory": "ordax.memory/1",
        "localization_pack": "prototype-ordax.localization-pack/1",
        "runtime_release": "prototype-ordax.runtime-component-release/2",
    }
    if data.get("contracts") != expected_contracts:
        fail("published platform contract set drifted")
    if data.get("planned_contracts") != {}:
        fail("planned platform contract set drifted")

    invariants = data.get("invariants") or {}
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

    source_cutover_allowed, distribution_activation_allowed = validate_notes_migration()
    validate_studio_migration()

    print("ORDAX_APPS_WORKSPACE=PASS")
    print(f"FIRST_PARTY_TARGET_COUNT={len(targets)}")
    print(f"PUBLISHED_CONTRACT_COUNT={len(expected_contracts)}")
    print("STORE_STRUCTURAL_NON_REMOVABLE=YES")
    print(f"NOTES_SOURCE_CUTOVER_ALLOWED={'YES' if source_cutover_allowed else 'NO'}")
    print(f"NOTES_DISTRIBUTION_ACTIVATION_ALLOWED={'YES' if distribution_activation_allowed else 'NO'}")
    print("STUDIO_SOURCE_CANONICAL=ORDAX_APPS")
    print("STUDIO_DISTRIBUTION_CUTOVER_ALLOWED=NO")
    print("APP_INSTALL_AUTHORITY=PLATFORM_ONLY")


if __name__ == "__main__":
    main()
