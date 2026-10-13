"""Verify pinned migration source with Git blobs, never a second app source."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SHA = re.compile(r"^[a-f0-9]{40}$")
SOURCE_ARCHIVES = ("assistant", "activity")
CANONICAL_OS = "ordaxsystems/ordax-os"
CANONICAL_APPS = "ordaxsystems/ordax-apps"


class PendingSourceSnapshotTests(unittest.TestCase):
    def test_snapshot_is_source_provenance_only(self):
        commits = set()
        for app in SOURCE_ARCHIVES:
            with self.subTest(app=app):
                plan = json.loads((ROOT / "migrations" / f"{app}.externalization.json").read_text(encoding="utf-8"))
                snapshot = json.loads((ROOT / "migrations" / f"{app}.source-snapshot.json").read_text(encoding="utf-8"))
                self.assertEqual(plan["app_id"], app)
                self.assertFalse(plan["distribution_activation_allowed"])
                self.assertEqual(plan["target_repository"], CANONICAL_APPS)
                state = plan["source_of_truth_state"]
                if state == "platform-until-cutover":
                    self.assertFalse(plan["source_cutover_allowed"])
                    self.assertEqual(plan["source_repository_current"], CANONICAL_OS)
                    self.assertFalse((ROOT / "apps" / app).exists(),
                                     "parallel app source before Gate A is forbidden")
                else:
                    self.assertEqual(state, "ordax-apps-canonical")
                    self.assertTrue(plan["source_cutover_allowed"])
                    self.assertEqual(plan["source_repository_current"], CANONICAL_APPS)
                    self.assertEqual(plan["source_path_current"], f"apps/{app}")
                    self.assertTrue((ROOT / "apps" / app / "app.json").is_file())
                    gate_a = plan["gate_a_platform_commit"]
                    self.assertTrue(SHA.fullmatch(gate_a))
                    self.assertEqual(plan["source_cutover"]["platform_absence_proven_at"], gate_a)
                    self.assertTrue(plan["gate_b"]["platform_absence_proven"])
                    self.assertFalse(plan["gate_b"]["signed_distribution_verified"])
                self.assertEqual(snapshot["$schema"], f"ordax.{app}-source-snapshot/1")
                self.assertEqual(snapshot["repository"], CANONICAL_OS)
                self.assertEqual(snapshot["authority"], "none")
                self.assertTrue(snapshot["captured_before_gate_a_removal"])
                self.assertTrue(SHA.fullmatch(snapshot["commit"]))
                commits.add(snapshot["commit"])
                lock = plan["source_snapshot"]
                self.assertEqual(lock["state"], "pinned")
                self.assertEqual(lock["commit"], snapshot["commit"])
                self.assertEqual(lock["repository"], snapshot["repository"])
                self.assertEqual(lock["file_count"], snapshot["file_count"])
                self.assertEqual(lock["inventory_file"], f"migrations/{app}.source-snapshot.json")
                files = snapshot["files"]
                self.assertEqual(len(files), snapshot["file_count"])
                paths = [item["path"] for item in files]
                self.assertEqual(paths, sorted(set(paths)))
                self.assertIn(f"system/apps/{app}/runtime.mjs", paths)
                self.assertIn(f"system/services/i18n/catalog/{app}.mjs", paths)
                for item in files:
                    self.assertEqual(set(item), {"path", "blob_sha", "size"})
                    self.assertTrue(item["path"].startswith(f"system/apps/{app}/") or
                                    item["path"] == f"system/services/i18n/catalog/{app}.mjs")
                    self.assertTrue(SHA.fullmatch(item["blob_sha"]))
                    self.assertGreater(item["size"], 0)

                checked_out = os.environ.get("ORDAX_PLATFORM_SNAPSHOT_ROOT")
                if checked_out:
                    root = Path(checked_out).resolve()
                    self.assertTrue((root / ".git").exists(), "verified OS checkout is required")
                    resolved = subprocess.run(
                        ["git", "-C", str(root), "rev-parse", "HEAD"],
                        check=True, capture_output=True, text=True,
                    ).stdout.strip()
                    self.assertEqual(resolved, snapshot["commit"])
                    for item in files:
                        file_path = root / item["path"]
                        self.assertTrue(file_path.is_file() and not file_path.is_symlink())
                        self.assertEqual(file_path.stat().st_size, item["size"])
                        actual = subprocess.run(
                            ["git", "-C", str(root), "hash-object", "--", item["path"]],
                            check=True, capture_output=True, text=True,
                        ).stdout.strip()
                        self.assertEqual(actual, item["blob_sha"], item["path"])
        self.assertEqual(len(commits), 1, "use a single pinned platform state for both app snapshots")


if __name__ == "__main__":
    unittest.main()
