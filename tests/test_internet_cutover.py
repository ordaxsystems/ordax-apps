"""Fail-closed tests for the pinned remove-first Internet source gate."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/verify_internet_cutover.py"
spec = importlib.util.spec_from_file_location("internet_cutover_test", SCRIPT)
verifier = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(verifier)


def run_git(root: Path, *args: str) -> str:
    p = subprocess.run(["git", "-C", str(root), *args], check=True,
                       capture_output=True, text=True, encoding="utf-8")
    return p.stdout.strip()


class InternetCutoverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "migrations").mkdir()
        (self.root / "apps").mkdir()
        self.plan = json.loads((ROOT / verifier.PLAN_FILE).read_text(encoding="utf-8"))
        self.snapshot = json.loads((ROOT / "migrations/internet.source-snapshot.json").read_text(encoding="utf-8"))
        self.lock = json.loads((ROOT / "platform-sdk.lock.json").read_text(encoding="utf-8"))
        self.write_fixture()

    def write_fixture(self):
        for path, value in (
            (verifier.PLAN_FILE, self.plan),
            ("migrations/internet.source-snapshot.json", self.snapshot),
            ("platform-sdk.lock.json", self.lock),
        ):
            dst = self.root / path
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")

    def test_canonical_snapshot_is_pinned_and_no_duplicate_source_exists(self):
        result = verifier.audit(self.root)
        self.assertEqual(result["sourceFileCount"], self.snapshot["file_count"])
        self.assertGreater(result["sourceBytes"], 0)
        self.assertEqual(result["sourceCommit"], self.plan["source_snapshot"]["commit"])
        self.assertFalse(result["sourceCutoverAuthorized"])
        self.assertFalse(result["distributionActivated"])
        self.assertFalse(result["snapshotVerifiedAgainstGit"])
        self.assertIn("remove-first-gate-a-not-proven", result["blockers"])

    def test_cannot_infer_cutover_from_sdk_pin_or_missing_manifest(self):
        (self.root / "apps/internet").mkdir()
        with self.assertRaisesRegex(verifier.InternetCutoverError, "duplicate Internet source"):
            verifier.audit(self.root)
        (self.root / "apps/internet").rmdir()
        self.plan["source_cutover_allowed"] = True
        self.write_fixture()
        with self.assertRaisesRegex(verifier.InternetCutoverError, "cutover must remain blocked"):
            verifier.audit(self.root)

    def test_missing_suspicious_and_unsorted_snapshot_items_fail_closed(self):
        self.snapshot["files"].pop()
        self.snapshot["file_count"] -= 1
        self.plan["source_snapshot"]["file_count"] -= 1
        self.write_fixture()
        with self.assertRaisesRegex(verifier.InternetCutoverError, "mandatory owner files"):
            verifier.audit(self.root)
        self.snapshot = json.loads((ROOT / "migrations/internet.source-snapshot.json").read_text(encoding="utf-8"))
        self.plan = json.loads((ROOT / verifier.PLAN_FILE).read_text(encoding="utf-8"))
        self.snapshot["files"][0]["path"] = "system/contracts/browser-session.mjs"
        self.write_fixture()
        with self.assertRaisesRegex(verifier.InternetCutoverError, "non-app-owned"):
            verifier.audit(self.root)
        self.snapshot["files"][0]["path"] = self.snapshot["files"][1]["path"]
        self.write_fixture()
        with self.assertRaisesRegex(verifier.InternetCutoverError, "sorted and unique"):
            verifier.audit(self.root)

    def test_tampered_git_identity_and_sdk_release_fail_closed(self):
        self.snapshot["files"][0]["blob_sha"] = "wrong"
        self.write_fixture()
        with self.assertRaisesRegex(verifier.InternetCutoverError, "blob identity"):
            verifier.audit(self.root)
        self.snapshot = json.loads((ROOT / "migrations/internet.source-snapshot.json").read_text(encoding="utf-8"))
        self.lock["bundle_version"] = "1.14.0"
        self.write_fixture()
        with self.assertRaisesRegex(verifier.InternetCutoverError, "older than"):
            verifier.audit(self.root)
        self.lock["bundle_version"] = "1.16.0"
        self.lock["sha256"] = "bad"
        self.write_fixture()
        with self.assertRaisesRegex(verifier.InternetCutoverError, "digest invalid"):
            verifier.audit(self.root)

    def test_exact_clean_git_snapshot_matches_every_blob_and_rejects_drift(self):
        checkout = self.root / "platform-checkout"
        checkout.mkdir()
        run_git(checkout, "init", "-q")
        run_git(checkout, "config", "user.name", "OrdaX Test")
        run_git(checkout, "config", "user.email", "tester@example.invalid")
        run_git(checkout, "remote", "add", "origin", "https://github.com/ordaxsystems/ordax-os.git")
        rows = self.snapshot["files"]
        for index, row in enumerate(rows):
            target = checkout / row["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(f"Internet verified source {index}\n", encoding="utf-8")
        run_git(checkout, "add", ".")
        run_git(checkout, "commit", "-qm", "snapshot fixture")
        commit = run_git(checkout, "rev-parse", "HEAD")
        self.plan["source_snapshot"]["commit"] = commit
        self.snapshot["commit"] = commit
        for row in rows:
            file = checkout / row["path"]
            row["blob_sha"] = run_git(checkout, "rev-parse", "HEAD:" + row["path"])
            row["size"] = file.stat().st_size
        self.write_fixture()
        self.assertTrue(verifier.audit(self.root, checkout)["snapshotVerifiedAgainstGit"])
        (checkout / rows[0]["path"]).write_text("changed\n", encoding="utf-8")
        with self.assertRaisesRegex(verifier.InternetCutoverError, "dirty"):
            verifier.audit(self.root, checkout)
        run_git(checkout, "restore", ".")
        self.snapshot["files"][0]["blob_sha"] = "a" * 40
        self.write_fixture()
        with self.assertRaisesRegex(verifier.InternetCutoverError, "differs"):
            verifier.audit(self.root, checkout)
        self.snapshot["files"][0]["blob_sha"] = run_git(checkout, "rev-parse", "HEAD:" + rows[0]["path"])
        self.write_fixture()
        run_git(checkout, "remote", "set-url", "origin", "https://github.com/other/repo.git")
        with self.assertRaisesRegex(verifier.InternetCutoverError, "canonical repository"):
            verifier.audit(self.root, checkout)


if __name__ == "__main__":
    unittest.main()
