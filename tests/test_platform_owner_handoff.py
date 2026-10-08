"""Read-only platform owner handoff invariants; no GitHub writes or owner spoofing."""
from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/verify_platform_owner_handoff.py"
spec = importlib.util.spec_from_file_location("platform_owner_handoff", SCRIPT)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)


class PlatformOwnerHandoffTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workspace = json.loads(
            (ROOT / "ordax-apps.workspace.json").read_text(encoding="utf-8")
        )
        cls.lock = json.loads(
            (ROOT / "platform-sdk.lock.json").read_text(encoding="utf-8")
        )
        cls.old = mod.OLD_OWNER + "/" + mod.PLATFORM_NAME
        cls.target = mod.NEW_OWNER + "/" + mod.PLATFORM_NAME

    def test_repointed_source_does_not_claim_physical_transfer_or_signature(self):
        state = mod.validate(self.workspace, self.lock)
        self.assertEqual(state["phase"], "post-transfer-source")
        self.assertEqual(state["current_platform"], self.target)
        self.assertEqual(state["target_platform"], self.target)
        self.assertEqual(state["platform_repository_id"], "1371063347")
        report = mod.evaluate(ROOT)
        self.assertTrue(report["source_conformance_after_transfer"])
        self.assertFalse(report["github_physical_transfer_verified"])
        self.assertFalse(report["release_signature_verified"])
        self.assertEqual(report["operational_old_owner_files"], 0)
        self.assertGreater(report["historical_old_owner_files"], 0)

    def test_owner_lock_must_match_workspace_ssot(self):
        inconsistent = copy.deepcopy(self.lock)
        inconsistent["repository"] = self.old
        with self.assertRaisesRegex(ValueError, "lock owner differs"):
            mod.validate(self.workspace, inconsistent)
        inconsistent = copy.deepcopy(self.workspace)
        inconsistent["platform_repository"] = self.old
        with self.assertRaisesRegex(ValueError, "workspace platform owner differs"):
            mod.validate(inconsistent, self.lock)

    def test_target_repoint_must_not_change_exact_sdk_pin(self):
        legacy_workspace = copy.deepcopy(self.workspace)
        legacy_lock = copy.deepcopy(self.lock)
        legacy_workspace["platform_repository"] = self.old
        legacy_workspace["repository_migration"]["current_platform_repository"] = self.old
        legacy_lock["repository"] = self.old
        self.assertEqual(mod.validate(legacy_workspace, legacy_lock)["phase"], "pre-transfer")
        state = mod.validate(self.workspace, self.lock)
        self.assertEqual(state["phase"], "post-transfer-source")
        self.assertEqual(state["sdk_commit"], legacy_lock["commit"])
        self.assertEqual(state["sdk_sha256"], legacy_lock["sha256"])

    def test_never_allow_redirect_mirror_or_dual_owner_authority(self):
        for field in (
            "redirect_dependency_allowed", "mirror_repository_allowed",
            "dual_authority_allowed", "rename_during_transfer_allowed",
            "provenance_rewrite_allowed",
        ):
            with self.subTest(field=field):
                bad = copy.deepcopy(self.workspace)
                bad["repository_migration"][field] = True
                with self.assertRaisesRegex(ValueError, "unsafe namespace authority"):
                    mod.validate(bad, self.lock)
        bad = copy.deepcopy(self.workspace)
        bad["repository_migration"]["transfer_first_then_repoint"] = False
        with self.assertRaisesRegex(ValueError, "transfer must precede"):
            mod.validate(bad, self.lock)

    def test_operational_reference_scan_blocks_code_but_preserves_history(self):
        old = self.old
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tools").mkdir()
            (root / "migrations").mkdir()
            (root / "tools/verify_other.py").write_text(old, encoding="utf-8")
            (root / "migrations/signed-legacy-record.json").write_text(old, encoding="utf-8")
            subprocess.run(["git", "init", "-q"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "add", "."], cwd=root, check=True, capture_output=True)
            result = mod.stale_references(root, old)
            self.assertEqual(result["operational_paths"], ["tools/verify_other.py"])
            self.assertEqual(result["historical_paths"], ["migrations/signed-legacy-record.json"])
            (root / "tools/verify_other.py").write_text(self.target, encoding="utf-8")
            result = mod.stale_references(root, old)
            self.assertEqual(result["operational_paths"], [])

    def test_historical_assertion_exemption_is_exact_not_file_wide(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "tools/verify_notes_platform_sdk.py"
            path.parent.mkdir(parents=True)
            path.write_text(
                'if lock["repository"] != "' + self.old + '":\n',
                encoding="utf-8",
            )
            subprocess.run(["git", "init", "-q"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "add", "."], cwd=root, check=True, capture_output=True)
            self.assertEqual(mod.stale_references(root, self.old)["operational_paths"], [])
            path.write_text(
                path.read_text(encoding="utf-8") +
                'runtime_owner = "' + self.old + '"\n',
                encoding="utf-8",
            )
            self.assertIn(
                "tools/verify_notes_platform_sdk.py",
                mod.stale_references(root, self.old)["operational_paths"],
            )

    def test_unknown_owner_or_unsigned_sdk_lock_fails(self):
        bad = copy.deepcopy(self.workspace)
        bad["repository_migration"]["current_platform_repository"] = "other/repo"
        with self.assertRaisesRegex(ValueError, "unrecognized"):
            mod.validate(bad, self.lock)
        for field,value in (("authority", "device"), ("commit", "latest"), ("sha256", "unknown")):
            with self.subTest(field=field):
                bad_lock = copy.deepcopy(self.lock)
                bad_lock[field] = value
                with self.assertRaises(ValueError):
                    mod.validate(self.workspace, bad_lock)


if __name__ == "__main__":
    unittest.main()
