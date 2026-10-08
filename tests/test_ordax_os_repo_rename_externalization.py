"""Cutover-only migration plans must never rewrite captured source evidence."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
FUTURE = "ordaxsystems/ordax-os"
PRE_RENAME = "ordaxsystems/prototipo-ordax-os"
PLANS = ("activity", "assistant", "files", "internet", "network", "projects")


class CutoverExternalizationSourceTests(unittest.TestCase):
    def test_single_future_source_no_dual_source_and_no_early_activation(self):
        for app in PLANS:
            with self.subTest(app=app):
                doc = json.loads((ROOT / "migrations" / (app + ".externalization.json")).read_text(encoding="utf-8"))
                self.assertEqual(doc["app_id"], app)
                self.assertEqual(doc["source_of_truth_state"], "platform-until-cutover")
                self.assertEqual(doc["source_repository_current"], FUTURE)
                self.assertEqual(doc["target_repository"], "ordaxsystems/ordax-apps")
                self.assertIs(doc["source_cutover_allowed"], False)
                self.assertIs(doc["distribution_activation_allowed"], False)
                self.assertIs(doc["source_cutover"]["dual_source_allowed"], False)
                self.assertEqual(doc["source_cutover"]["mode"], "remove-platform-first")
                snap = doc["source_snapshot"]
                if snap["state"] == "not-captured":
                    self.assertEqual(snap["repository"], FUTURE)
                    self.assertIsNone(snap["commit"])
                    self.assertIsNone(snap["inventory_file"])
                elif snap["state"] == "pinned":
                    self.assertEqual(app, "projects")
                    self.assertEqual(snap["repository"], PRE_RENAME)
                    self.assertEqual(snap["commit"], "d2abf5a6012c744ba66568d4ff27661913c81489")
                    self.assertEqual(snap["inventory_file"], "migrations/projects.source-snapshot.json")
                else:
                    self.fail("unknown source snapshot state")

    def test_unrelated_snapshot_history_is_not_rewritten(self):
        for app in ("notes", "studio"):
            path = ROOT / "migrations" / (app + ".externalization.json")
            doc = json.loads(path.read_text(encoding="utf-8"))
            self.assertNotEqual(doc["source_of_truth_state"], "platform-until-cutover")
            self.assertNotEqual(doc["source_repository_current"], FUTURE)


if __name__ == "__main__":
    unittest.main()
