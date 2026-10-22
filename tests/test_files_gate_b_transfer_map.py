"""Fail-closed shape and ownership checks for the Files Gate B map."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class FilesGateBTransferMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = json.loads((ROOT / "migrations/files.externalization.json").read_text(encoding="utf-8"))
        cls.snapshot = json.loads((ROOT / "migrations/files.source-snapshot.json").read_text(encoding="utf-8"))
        cls.mapping = json.loads((ROOT / "migrations/files.gate-b-transfer-map.json").read_text(encoding="utf-8"))

    def test_map_covers_exactly_the_pinned_product_source_without_copying_it(self):
        mapping = self.mapping
        sources = [entry["source"] for entry in mapping["mappings"]]
        self.assertEqual(mapping["source_file_count"], self.snapshot["file_count"])
        self.assertEqual(mapping["source_snapshot"], "migrations/files.source-snapshot.json")
        self.assertEqual(mapping["source_commit"], self.snapshot["commit"])
        self.assertEqual(set(sources), {entry["path"] for entry in self.snapshot["files"]})
        self.assertEqual(len(sources), len(set(sources)))
        self.assertFalse((ROOT / "apps/files").exists())
        self.assertFalse(mapping["rules"]["materialize_target_before_gate_a"])
        self.assertFalse(mapping["rules"]["dual_source_allowed"])

    def test_targets_are_inside_one_product_root_and_keep_platform_owners_out(self):
        targets = [entry["target"] for entry in self.mapping["mappings"]]
        self.assertTrue(all(path.startswith("apps/files/") for path in targets))
        self.assertEqual(targets.count("apps/files/app.json"), 2)
        self.assertEqual(len([path for path in targets if path != "apps/files/app.json"]),
                         len(set(path for path in targets if path != "apps/files/app.json")))
        self.assertTrue(self.mapping["rules"]["copy_native_filesystem_adapters"] is False)
        self.assertTrue(self.mapping["rules"]["copy_host_grant_or_install_authority"] is False)

    def test_all_distribution_and_cutover_gates_remain_closed(self):
        self.assertEqual(self.mapping["state"], "prepared-no-source-copy")
        self.assertFalse(self.plan["source_cutover_allowed"])
        self.assertFalse(self.plan["distribution_activation_allowed"])
        self.assertFalse(self.plan["source_cutover"]["dual_source_allowed"])
        self.assertEqual(self.mapping["authority"], "none")

    def test_test_ownership_is_explicit_and_disjoint(self):
        groups = self.mapping["test_ownership"]
        paths = [path for key in (
            "moves_with_product",
            "remains_with_platform",
            "split_before_cutover",
            "remains_with_apps_migration_infrastructure",
        ) for path in groups[key]]
        self.assertTrue(all(path.startswith("tests/test_") for path in paths))
        self.assertEqual(len(paths), len(set(paths)))
        self.assertIn("tests/test_files_bootstrap_continuity.py", groups["remains_with_platform"])
        self.assertIn("tests/test_files_copy_destination.py", groups["split_before_cutover"])


if __name__ == "__main__":
    unittest.main()
