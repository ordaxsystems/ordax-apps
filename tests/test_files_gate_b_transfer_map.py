"""Files Gate B transfer map: source is materialized once in ordax-apps."""
from __future__ import annotations
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class FilesGateBTransferMapTests(unittest.TestCase):
    def setUp(self):
        self.plan = json.loads((ROOT / "migrations/files.externalization.json").read_text(encoding="utf-8"))
        self.mapping = json.loads((ROOT / "migrations/files.gate-b-transfer-map.json").read_text(encoding="utf-8"))

    def test_locked_transfer_map_covers_all_ten_historical_sources(self):
        rows = self.mapping["mappings"]
        self.assertEqual(self.mapping["source_file_count"], 10)
        self.assertEqual(len(rows), 10)
        self.assertEqual(len({row["source"] for row in rows}), 10)
        targets = [row["target"] for row in rows]
        self.assertTrue(all(path.startswith("apps/files/") for path in targets))
        self.assertEqual(targets.count("apps/files/app.json"), 2)
        self.assertEqual(len([p for p in targets if p != "apps/files/app.json"]),
                         len(set(p for p in targets if p != "apps/files/app.json")))
        self.assertEqual(self.mapping["state"], "materialized-unsigned")
        self.assertEqual(self.mapping["authority"], "none")

    def test_gate_b_has_one_canonical_source_and_no_distribution_authority(self):
        self.assertEqual(self.plan["source_of_truth_state"], "ordax-apps-canonical")
        self.assertEqual(self.plan["source_repository_current"], "ordaxsystems/ordax-apps")
        self.assertEqual(self.plan["source_path_current"], "apps/files")
        self.assertEqual(self.plan["source_cutover"]["target_materialization_state"], "materialized")
        self.assertTrue(self.plan["source_cutover"]["target_source_present"])
        self.assertTrue((ROOT / "apps/files/app.json").is_file())
        self.assertEqual(self.plan["gate_b"]["state"], "source-materialized-unsigned")
        self.assertFalse(self.plan["distribution_activation_allowed"])
        self.assertFalse(self.plan["gate_b"]["signed_distribution_verified"])
        self.assertFalse(self.plan["gate_b"]["native_install_verified"])
        self.assertFalse(self.plan["gate_b"]["rollback_verified"])

    def test_forbidden_platform_authorities_stay_out_of_files_source(self):
        rules = self.mapping["rules"]
        for key in (
            "copy_platform_private_imports", "copy_native_filesystem_adapters",
            "copy_platform_persistence_or_identity", "copy_host_grant_or_install_authority",
            "dual_source_allowed",
        ):
            self.assertFalse(rules[key])

if __name__ == "__main__":
    unittest.main()
