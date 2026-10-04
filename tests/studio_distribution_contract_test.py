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
        self.assertEqual(product["portable_source_after_cutover"], "apps/studio")
        self.assertEqual(targets["ordax_os"]["portable_source"], "apps/studio")
        self.assertEqual(targets["windows"]["portable_source"], "apps/studio")

    def test_both_targets_share_one_canonical_app_version(self) -> None:
        versioning = self.contract["release_versioning"]
        self.assertTrue(versioning["single_app_version"])
        self.assertEqual(
            versioning["current_transitional_source"],
            "washingtonmsdj/mcp-blender:pyproject.toml#project.version",
        )
        self.assertEqual(versioning["source_after_cutover"], "apps/studio/app.json#version")
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

    def test_os_and_provider_forks_are_forbidden(self) -> None:
        invariants = self.contract["shared_release_invariants"]
        self.assertTrue(invariants["os_specific_forks_forbidden"])
        self.assertTrue(invariants["provider_specific_forks_forbidden"])
        self.assertTrue(invariants["same_typed_action_semantics"])
        self.assertTrue(invariants["same_portable_product_source"])
        self.assertTrue(invariants["same_canonical_app_version"])


if __name__ == "__main__":
    unittest.main()
