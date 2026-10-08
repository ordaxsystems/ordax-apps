from __future__ import annotations

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
FUTURE = "ordaxsystems/ordax-os"
PRE_RENAME = "ordaxsystems/prototipo-ordax-os"
PLANS = ("activity", "assistant", "files", "internet", "network", "projects")
VERIFIER = ROOT / "tools" / "verify_projects_externalization.py"
spec = importlib.util.spec_from_file_location("ordax_projects_externalization", VERIFIER)
project_verifier = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(project_verifier)


class ProjectsExternalizationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "migrations").mkdir()
        (self.root / "apps").mkdir()
        self.plan = json.loads(
            (ROOT / "migrations" / "projects.externalization.json").read_text(encoding="utf-8")
        )
        self.workspace = json.loads((ROOT / "ordax-apps.workspace.json").read_text(encoding="utf-8"))
        self.workspace["platform_repository"] = self.plan["source_repository_current"]
        self.snapshot = json.loads(
            (ROOT / "migrations" / "projects.source-snapshot.json").read_text(encoding="utf-8")
        )
        self._write()

    def _write(self):
        (self.root / "ordax-apps.workspace.json").write_text(
            json.dumps(self.workspace, ensure_ascii=False), encoding="utf-8",
        )
        (self.root / "migrations" / "projects.externalization.json").write_text(
            json.dumps(self.plan, ensure_ascii=False), encoding="utf-8",
        )
        (self.root / "migrations" / "projects.source-snapshot.json").write_text(
            json.dumps(self.snapshot, ensure_ascii=False), encoding="utf-8",
        )

    def verify(self):
        previous = project_verifier.ROOT, project_verifier.PLAN_PATH, project_verifier.TARGET
        project_verifier.ROOT = self.root
        project_verifier.PLAN_PATH = self.root / "migrations" / "projects.externalization.json"
        project_verifier.TARGET = self.root / "apps" / "projects"
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                project_verifier.main()
        finally:
            project_verifier.ROOT, project_verifier.PLAN_PATH, project_verifier.TARGET = previous

    def test_pinned_sdk_and_snapshot_are_structurally_valid_without_cutover(self):
        self.verify()
        self.assertFalse(self.plan["source_cutover_allowed"])
        self.assertFalse(self.plan["distribution_activation_allowed"])

    def test_sdk_merged_pr_is_required_and_cannot_revert_to_pending(self):
        self.plan["target_sdk"]["state"] = "pending-platform-merge"
        self._write()
        with self.assertRaisesRegex(SystemExit, "SDK 1.9 prerequisite"):
            self.verify()

    def test_platform_source_removal_cannot_be_silently_bypassed(self):
        self.plan["source_cutover_allowed"] = True
        self._write()
        with self.assertRaisesRegex(SystemExit, "cutover must remain blocked"):
            self.verify()
        self.plan["source_cutover_allowed"] = False
        (self.root / "apps" / "projects").mkdir()
        self._write()
        with self.assertRaisesRegex(SystemExit, "dual source"):
            self.verify()

    def test_snapshot_rejects_unreviewed_paths_and_duplicate_entries(self):
        self.snapshot["files"][0]["path"] = "system/apps/files/forged.mjs"
        self._write()
        with self.assertRaisesRegex(SystemExit, "outside the app ownership boundary"):
            self.verify()
        self.snapshot = json.loads(
            (ROOT / "migrations" / "projects.source-snapshot.json").read_text(encoding="utf-8")
        )
        self.snapshot["files"][1]["path"] = self.snapshot["files"][0]["path"]
        self._write()
        with self.assertRaisesRegex(SystemExit, "sorted and unique"):
            self.verify()

    def test_single_workspace_owner_and_immutable_pre_rename_projects_snapshot(self):
        self.assertEqual(self.plan["source_repository_current"], "ordaxsystems/ordax-os")
        self.assertEqual(
            self.plan["source_snapshot"]["repository"],
            "ordaxsystems/prototipo-ordax-os",
        )
        self.verify()
        self.workspace["platform_repository"] = "ordaxsystems/prototipo-ordax-os"
        self._write()
        with self.assertRaisesRegex(SystemExit, "source must remain in the platform"):
            self.verify()
        self.workspace["platform_repository"] = self.plan["source_repository_current"]
        self.plan["source_snapshot"]["repository"] = "ordaxsystems/ordax-os"
        self._write()
        with self.assertRaisesRegex(SystemExit, "pinned historical snapshot repository drifted"):
            self.verify()

    def test_snapshot_rejects_identity_and_authority_drift(self):
        self.snapshot["repository"] = "washingtonmsdj/prototipo-ordax-os"
        self._write()
        with self.assertRaisesRegex(SystemExit, "provenance drifted"):
            self.verify()
        self.snapshot["repository"] = self.plan["source_snapshot"]["repository"]
        self.snapshot["authority"] = "install"
        self._write()
        with self.assertRaisesRegex(SystemExit, "cannot grant authority"):
            self.verify()


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
