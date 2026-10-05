#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DISTRIBUTION = ROOT / "migrations" / "studio.distribution.json"
EXTERNALIZATION = ROOT / "migrations" / "studio.externalization.json"


def fail(message: str) -> None:
    raise SystemExit(f"ORDAX_STUDIO_DISTRIBUTION=FAIL\n{message}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def main() -> None:
    distribution = json.loads(DISTRIBUTION.read_text(encoding="utf-8"))
    externalization = json.loads(EXTERNALIZATION.read_text(encoding="utf-8"))

    require(distribution.get("$schema") == "ordax-apps.studio-distribution/1", "unexpected distribution schema")
    require(distribution.get("authority") == "none", "distribution metadata must carry no authority")
    require(distribution.get("cutover_allowed") is False, "distribution contract must not bypass source cutover gates")

    product = distribution.get("product") or {}
    require(product.get("app_id") == "studio", "Studio app id drifted")
    require(product.get("name") == "ORDAX Studio", "Studio product name drifted")
    require(product.get("provider_neutral") is True, "Studio core must remain provider-neutral")
    require(product.get("single_portable_source") is True, "Studio must have one portable source")

    target_source = externalization.get("target_path")
    require(target_source == "apps/studio", "externalization target must remain apps/studio")
    require(product.get("portable_source") == target_source, "distribution and externalization source targets disagree")

    versioning = distribution.get("release_versioning") or {}
    require(versioning.get("single_app_version") is True, "Studio must have one canonical application version")
    require(
        versioning.get("current_transitional_source") == "apps/studio/app.json#version",
        "Studio version must come from apps/studio/app.json",
    )
    require(
        versioning.get("source_after_cutover") == "apps/studio/app.json#version",
        "Studio version source must remain apps/studio/app.json",
    )
    require(versioning.get("legacy_version_source_allowed") is False, "legacy repository must not remain a Studio version authority")
    require(versioning.get("windows_consumes_canonical_app_version") is True, "Windows must consume the canonical Studio app version")
    require(versioning.get("ordax_os_consumes_canonical_app_version") is True, "OrdaX OS must consume the canonical Studio app version")
    require(versioning.get("target_specific_feature_versions_forbidden") is True, "target-specific Studio feature versions are forbidden")
    require(versioning.get("target_build_metadata_allowed") is True, "target build metadata policy must stay explicit")

    targets = distribution.get("targets") or {}
    require(set(targets) == {"ordax_os", "windows"}, "Studio must have exactly OrdaX OS and Windows distribution targets")

    ordax_os = targets["ordax_os"]
    windows = targets["windows"]
    for name, target in targets.items():
        require(target.get("supported") is True, f"{name} must be an official supported Studio target")
        require(target.get("portable_source") == target_source, f"{name} must consume the same portable Studio source")
        require(isinstance(target.get("host_adapter"), str) and target["host_adapter"], f"{name} must declare a host adapter")

    require(ordax_os.get("distribution_kind") == "first-party-app-component", "OrdaX OS Studio must be a first-party app component")
    require(ordax_os.get("runtime_owner") == "ordax-os-platform", "OrdaX OS must own its platform runtime")
    require(ordax_os.get("bundles_ordax_runtime") is False, "OrdaX OS Studio must not bundle a duplicate ORDAX Runtime")
    require(ordax_os.get("uses_platform_ports") is True, "OrdaX OS Studio must use platform ports")

    require(windows.get("distribution_kind") == "standalone-desktop-product", "Windows Studio must remain separately distributable")
    require(windows.get("requires_ordax_os") is False, "Windows Studio must not require OrdaX OS")
    require(windows.get("bundles_ordax_runtime") is True, "Windows distribution must carry its provider-neutral ORDAX Runtime")
    require(windows.get("runtime_product_name") == "ORDAX Runtime", "Windows runtime product identity drifted")
    require(windows.get("launcher_name") == "ORDAX Studio.exe", "Windows launcher identity drifted")
    require(windows.get("installer_name_pattern") == "ORDAX-Studio-Setup-<version>-x64.exe", "Windows installer naming drifted")
    require(windows.get("account_optional_for_local_use") is True, "Windows local Studio use must not require an ORDAX account")
    require(windows.get("cloud_pairing_optional_for_local_use") is True, "Windows local Studio use must not require Cloudflare pairing")
    require(windows.get("offline_local_launch_supported") is True, "Windows Studio must support local launch without internet")
    require(windows.get("local_device_identity_account_independent") is True, "Windows local device identity must not depend on account state")
    require(windows.get("account_connection_extends_remote_capabilities_only") is True, "account connection must extend remote capabilities without replacing local identity")
    require(windows.get("computer_control_modes") == ["bounded", "full-access"], "Windows Computer Control modes drifted")
    require(windows.get("full_access_owner_approval_local_only") is True, "Full Access must require local owner approval")
    require(windows.get("remote_client_cannot_enable_full_access") is True, "remote clients must not enable Full Access")
    require(windows.get("full_access_removes_ordax_root_and_app_allowlists") is True, "Full Access must remove ORDAX root/app allowlists")
    require(windows.get("full_filesystem_intermediate_mode_supported") is True, "filesystem-wide/app-bounded intermediate mode must stay supported")
    require(windows.get("windows_uac_remains_final_platform_boundary") is True, "Windows/UAC must remain the final platform boundary")

    remote_full = windows.get("remote_full_access_gate") or {}
    require(remote_full.get("status") == "required-before-cutover", "remote Full Access gate status drifted")
    require(remote_full.get("device_scoped") is True, "remote Full Access must be device-scoped")
    require(remote_full.get("project_id_nullable_for_device_control") is True, "device control must not fabricate a project id")
    require(remote_full.get("derived_from_authenticated_subject_and_active_device_link") is True, "remote owner authorization must derive from subject + active device link")
    require(remote_full.get("operator_token_not_required_for_normal_owner_use") is True, "normal owner Full Access must not require operator/admin token")
    require(remote_full.get("model_callable_grant_mint_forbidden") is True, "model-callable grant mint must stay forbidden")
    require(remote_full.get("local_full_access_consent_required") is True, "remote Full Access must remain bound to local owner consent")
    require(remote_full.get("legacy_operator_only_project_grant_is_not_product_path") is True, "legacy operator-only project grant must not become the normal product path")

    invariants = distribution.get("shared_release_invariants") or {}
    required_true = {
        "same_portable_product_source",
        "same_portable_ui_semantics",
        "same_public_port_contracts",
        "same_typed_action_semantics",
        "same_provider_neutral_core",
        "same_canonical_app_version",
        "windows_local_first_semantics",
        "windows_full_access_is_host_policy_not_portable_authority",
        "remote_full_access_must_use_runtime_v2_device_scope",
        "os_specific_forks_forbidden",
        "provider_specific_forks_forbidden",
        "raw_device_execute_in_portable_app_forbidden",
        "runtime_implementation_in_portable_app_forbidden",
    }
    missing_invariants = sorted(key for key in required_true if invariants.get(key) is not True)
    require(not missing_invariants, f"required shared invariants are not enforced: {', '.join(missing_invariants)}")

    proofs = set(distribution.get("parity_proofs_required_before_cutover") or [])
    required_proofs = {
        "ordax-os-adapter-conformance",
        "windows-adapter-conformance",
        "portable-core-identical-inputs",
        "typed-action-semantic-parity",
        "canonical-app-version-parity",
        "provider-neutral-core",
        "windows-local-first-no-account-offline",
        "windows-owner-approved-full-access",
        "windows-full-access-device-scoped-remote",
        "windows-clean-install-upgrade-uninstall",
        "ordax-os-install-stage-health-promote-rollback",
    }
    require(required_proofs.issubset(proofs), "dual-target parity proof set is incomplete")

    external_proofs = set(externalization.get("proofs_required") or [])
    require("ordax-os-windows-port-parity" in external_proofs, "externalization plan lost OrdaX OS/Windows port parity gate")

    forbidden_core_owners = set(distribution.get("outside_studio_core") or [])
    require("Identity and device pairing authority" in forbidden_core_owners, "pairing authority must stay outside Studio core")
    require("Computer Control policy authority" in forbidden_core_owners, "computer policy authority must stay outside Studio core")
    require("provider connectors" in forbidden_core_owners, "provider connectors must stay outside Studio core")

    print("ORDAX_STUDIO_DISTRIBUTION=PASS")
    print("STUDIO_TARGETS=ordax_os,windows")
    print("STUDIO_PORTABLE_SOURCE=apps/studio")
    print("STUDIO_VERSION_SOURCE=apps/studio/app.json#version")
    print("WINDOWS_STANDALONE=true")
    print("WINDOWS_LOCAL_FIRST=true")
    print("WINDOWS_ACCOUNT_OPTIONAL=true")
    print("WINDOWS_OFFLINE_LOCAL_LAUNCH=true")
    print("WINDOWS_FULL_ACCESS_OWNER_APPROVED=true")
    print("WINDOWS_FULL_ACCESS_REMOTE_ENABLE=false")
    print("WINDOWS_FULL_ACCESS_REMOTE_SCOPE=device")
    print("WINDOWS_FULL_ACCESS_OPERATOR_TOKEN_REQUIRED=false")
    print("ORDAX_OS_DUPLICATE_RUNTIME=false")
    print("STUDIO_AUTHORITY=none")


if __name__ == "__main__":
    main()
