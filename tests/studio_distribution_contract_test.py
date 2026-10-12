from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StudioDistributionContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.contract = json.loads(
            (ROOT / "migrations" / "studio.distribution.json").read_text(encoding="utf-8")
        )

    def test_both_targets_share_one_portable_source(self) -> None:
        product = self.contract["product"]
        targets = self.contract["targets"]
        self.assertTrue(product["single_portable_source"])
        self.assertEqual(product["portable_source"], "apps/studio")
        self.assertEqual(targets["ordax_os"]["portable_source"], "apps/studio")
        self.assertEqual(targets["windows"]["portable_source"], "apps/studio")

    def test_both_targets_share_one_canonical_app_version(self) -> None:
        versioning = self.contract["release_versioning"]
        self.assertTrue(versioning["single_app_version"])
        self.assertEqual(versioning["current_transitional_source"], "apps/studio/app.json#version")
        self.assertEqual(versioning["source_after_cutover"], "apps/studio/app.json#version")
        self.assertFalse(versioning["legacy_version_source_allowed"])
        self.assertTrue(versioning["windows_consumes_canonical_app_version"])
        self.assertTrue(versioning["ordax_os_consumes_canonical_app_version"])
        self.assertTrue(versioning["target_specific_feature_versions_forbidden"])

    def test_ordax_os_uses_platform_runtime_without_duplicate_runtime(self) -> None:
        target = self.contract["targets"]["ordax_os"]
        self.assertTrue(target["uses_platform_ports"])
        self.assertFalse(target["bundles_ordax_runtime"])
        self.assertEqual(target["runtime_owner"], "ordax-os-platform")

    def test_windows_is_standalone_and_carries_provider_neutral_runtime(self) -> None:
        target = self.contract["targets"]["windows"]
        self.assertFalse(target["requires_ordax_os"])
        self.assertTrue(target["bundles_ordax_runtime"])
        self.assertEqual(target["runtime_product_name"], "ORDAX Runtime")
        self.assertEqual(target["launcher_name"], "ORDAX Studio.exe")

    def test_windows_local_use_is_account_optional_and_offline_capable(self) -> None:
        target = self.contract["targets"]["windows"]
        self.assertTrue(target["account_optional_for_local_use"])
        self.assertTrue(target["cloud_pairing_optional_for_local_use"])
        self.assertTrue(target["offline_local_launch_supported"])
        self.assertTrue(target["local_device_identity_account_independent"])
        self.assertTrue(target["account_connection_extends_remote_capabilities_only"])
        self.assertTrue(self.contract["shared_release_invariants"]["windows_local_first_semantics"])
        self.assertIn(
            "windows-local-first-no-account-offline",
            self.contract["parity_proofs_required_before_cutover"],
        )

    def test_windows_full_access_is_owner_approved_host_policy(self) -> None:
        target = self.contract["targets"]["windows"]
        self.assertEqual(target["computer_control_modes"], ["bounded", "full-access"])
        self.assertTrue(target["full_access_owner_approval_local_only"])
        self.assertTrue(target["remote_client_cannot_enable_full_access"])
        self.assertTrue(target["full_access_removes_ordax_root_and_app_allowlists"])
        self.assertTrue(target["full_filesystem_intermediate_mode_supported"])
        self.assertTrue(target["windows_uac_remains_final_platform_boundary"])
        self.assertTrue(
            self.contract["shared_release_invariants"][
                "windows_full_access_is_host_policy_not_portable_authority"
            ]
        )
        self.assertIn(
            "windows-owner-approved-full-access",
            self.contract["parity_proofs_required_before_cutover"],
        )
        self.assertIn(
            "Computer Control policy authority",
            self.contract["outside_studio_core"],
        )

    def test_remote_full_access_requires_runtime_v2_device_scope_not_legacy_operator_grant(self) -> None:
        target = self.contract["targets"]["windows"]
        gate = target["remote_full_access_gate"]
        self.assertEqual(gate["status"], "implemented-validated")
        self.assertTrue(gate["device_scoped"])
        self.assertTrue(gate["project_id_nullable_for_device_control"])
        self.assertTrue(gate["derived_from_authenticated_subject_and_active_device_link"])
        self.assertTrue(gate["operator_token_not_required_for_normal_owner_use"])
        self.assertTrue(gate["model_callable_grant_mint_forbidden"])
        self.assertTrue(gate["local_full_access_consent_required"])
        self.assertTrue(gate["legacy_operator_only_project_grant_is_not_product_path"])
        self.assertEqual(
            gate["evidence"],
            {
                "studio_commit": "f279ebd996a9ee5cdbbd75912dfa5109e91ad3cc",
                "runtime_commit": "435699d30471b8aa1c5080d08be554a23f15a896",
                "control_plane_commit": "124630ee55367ac8fbe2debc8d9ba8545b0915c0",
                "windows_product_build_run": 37536311885,
            },
        )
        self.assertTrue(
            self.contract["shared_release_invariants"][
                "remote_full_access_must_use_runtime_v2_device_scope"
            ]
        )
        self.assertIn(
            "windows-full-access-device-scoped-remote",
            self.contract["parity_proofs_required_before_cutover"],
        )

    def test_os_and_provider_forks_are_forbidden(self) -> None:
        invariants = self.contract["shared_release_invariants"]
        self.assertTrue(invariants["os_specific_forks_forbidden"])
        self.assertTrue(invariants["provider_specific_forks_forbidden"])
        self.assertTrue(invariants["same_typed_action_semantics"])
        self.assertTrue(invariants["same_portable_product_source"])
        self.assertTrue(invariants["same_canonical_app_version"])


if __name__ == "__main__":
    unittest.main()
