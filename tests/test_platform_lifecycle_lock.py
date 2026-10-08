"""Prevent a transferred platform verifier from being fetched via a legacy owner."""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIFECYCLE_LOCK = ROOT / "migrations" / "notes.platform-lifecycle.lock.json"
WORKSPACE = ROOT / "ordax-apps.workspace.json"
WORKFLOWS = (
    ROOT / ".github/workflows/foundation.yml",
    ROOT / ".github/workflows/store-catalog-candidate.yml",
)


class CanonicalLifecycleLockTests(unittest.TestCase):
    def test_pin_has_exact_current_platform_owner_and_no_authority(self):
        lock = json.loads(LIFECYCLE_LOCK.read_text(encoding="utf-8"))
        workspace = json.loads(WORKSPACE.read_text(encoding="utf-8"))
        canonical_repo = workspace["platform_repository"]
        self.assertEqual(canonical_repo, "ordaxsystems/prototipo-ordax-os")
        self.assertEqual(lock["repository"], canonical_repo)
        self.assertRegex(lock["commit"], r"\A[0-9a-f]{40}\Z")
        self.assertEqual(lock["tool_path"], "tools/runtime-component-channel")
        self.assertEqual(lock["authority"], "none")
        self.assertEqual(lock["canonical_source_repository"], "ordaxsystems/ordax-apps")

    def test_both_workflows_resolve_identity_from_one_lock(self):
        for path in WORKFLOWS:
            workflow = path.read_text(encoding="utf-8")
            with self.subTest(workflow=path.name):
                self.assertIn('lock.get("repository")', workflow)
                self.assertIn('lock.get("commit")', workflow)
                self.assertIn('workspace["platform_repository"]', workflow)
                self.assertIn('assert repository == canonical_repository', workflow)
                self.assertIn("steps.lifecycle-lock.outputs.repository", workflow)
                self.assertIn("steps.lifecycle-lock.outputs.commit", workflow)
                self.assertNotIn("washingtonmsdj/prototipo-ordax-os", workflow)
                self.assertIn("notes.platform-lifecycle.lock.json", workflow)


if __name__ == "__main__":
    unittest.main()
