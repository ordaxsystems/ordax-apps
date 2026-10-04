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

    def test_os_and_provider_forks_are_forbidden(self) -> None:
        invariants = self.contract["shared_release_invariants"]
        self.assertTrue(invariants["os_specific_forks_forbidden"])
        self.assertTrue(invariants["provider_specific_forks_forbidden"])
        self.assertTrue(invariants["same_typed_action_semantics"])
        self.assertTrue(invariants["same_portable_product_source"])


if __name__ == "__main__":
    unittest.main()
