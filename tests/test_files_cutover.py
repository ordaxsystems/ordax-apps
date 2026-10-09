"""Offline contract tests for Files remove-platform-first preflight."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "verify_files_cutover.py"
spec = importlib.util.spec_from_file_location("verify_files_cutover", SCRIPT)
files = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(files)
GATE_SHA = "a" * 40
SNAPSHOT_SHA = "b" * 40


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def make_root(parent: Path) -> Path:
    root = parent / "apps-workspace"
    (root / "apps").mkdir(parents=True)
    (root / "migrations").mkdir()
    for path in (
        "ordax-apps.workspace.json",
        "platform-sdk.lock.json",
        "migrations/files.externalization.json",
    ):
        shutil.copyfile(ROOT / path, root / path)
    return root


def load_plan(root: Path) -> dict:
    return json.loads((root / "migrations" / "files.externalization.json").read_text(encoding="utf-8"))


def make_platform(parent: Path, plan: dict, *, old_source: bool = False,
                  old_coupling: bool = False, missing_port: bool = False) -> Path:
    platform = parent / "platform"
    platform.mkdir()
    gates = plan["gate_a_platform_removal"]
    for path in gates["retain_platform_owned"]:
        if missing_port and path == "system/contracts/file-space.mjs":
            continue
        target = platform / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("export const owner = 'platform';\n", encoding="utf-8")
    for item in gates["remove_platform_implementation_couplings"]:
        target = platform / item["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        source = "export const unrelated = true;\n"
        if old_coupling and item["path"] == "system/apps/catalog.mjs":
            source += "import { filesApp } from './files/app.mjs';\n"
        target.write_text(source, encoding="utf-8")
    if old_source:
        target = platform / "system/apps/files/app.mjs"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("export const filesApp = {};\n", encoding="utf-8")
    return platform


def authorize(root: Path) -> dict:
    plan = load_plan(root)
    plan["source_cutover_allowed"] = True
    plan["gate_a_platform_commit"] = GATE_SHA
    plan["source_snapshot"]["state"] = "captured"
    plan["source_snapshot"]["commit"] = SNAPSHOT_SHA
    plan["source_snapshot"]["inventory_file"] = "migrations/files.source-snapshot.json"
    write_json(root / "migrations" / "files.externalization.json", plan)
    write_json(root / "migrations" / "files.source-snapshot.json", {
        "$schema": "ordax.source-snapshot-inventory/1",
        "app_id": "files",
        "repository": plan["source_repository_current"],
        "commit": SNAPSHOT_SHA,
        "file_count": 2,
        "files": [
            {"path": "system/apps/files/app.mjs", "git_blob_sha": "c" * 40},
            {"path": "system/surface/ui/file-space-controls.mjs", "git_blob_sha": "d" * 40},
        ],
    })
    return plan


def git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        check=True, capture_output=True, text=True, timeout=10,
    ).stdout.strip()


def make_git_gate(parent: Path, root: Path) -> tuple[Path, str, dict]:
    """Create real source and Gate A commits; no fabricated SHA or Git blob."""
    plan = load_plan(root)
    platform = make_platform(parent, plan, old_source=True)
    for path in plan["gate_a_platform_removal"]["remove_owned_source"]:
        if path == "system/apps/files":
            continue
        file = platform / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text("export const filesOwned = true;\n", encoding="utf-8")
    git(platform, "init", "-q")
    git(platform, "config", "user.name", "OrdaX CI Fixture")
    git(platform, "config", "user.email", "ci-fixture@ordax.invalid")
    git(platform, "remote", "add", "origin", "https://github.com/" + plan["source_repository_current"] + ".git")
    git(platform, "add", "--all")
    git(platform, "commit", "-qm", "source before Files removal")
    inventory = files.capture_source_snapshot(platform, plan)
    for path in plan["gate_a_platform_removal"]["remove_owned_source"]:
        owned = platform / path
        if owned.is_dir():
            shutil.rmtree(owned)
        elif owned.exists():
            owned.unlink()
    git(platform, "add", "--all")
    git(platform, "commit", "-qm", "Gate A remove Files implementation")
    gate_commit = git(platform, "rev-parse", "HEAD")
    plan["source_cutover_allowed"] = True
    plan["source_snapshot"]["state"] = "captured"
    plan["source_snapshot"]["commit"] = inventory["commit"]
    plan["source_snapshot"]["inventory_file"] = "migrations/files.source-snapshot.json"
    plan["gate_a_platform_commit"] = gate_commit
    write_json(root / "migrations" / "files.externalization.json", plan)
    write_json(root / "migrations" / "files.source-snapshot.json", inventory)
    return platform, gate_commit, inventory


class FilesCutoverTests(unittest.TestCase):
    def test_current_plan_blocks_cutover_without_claiming_release(self):
        with tempfile.TemporaryDirectory() as temp:
            root = make_root(Path(temp))
            report = files.report(root)
            self.assertEqual(report["sdk_pin"]["version"], "1.12.0")
            self.assertFalse(report["source_cutover"]["ready"])
            self.assertIn("source-cutover-not-authorized", report["source_cutover"]["blockers"])
            self.assertIn("platform-absence-not-inspected", report["source_cutover"]["blockers"])
            self.assertEqual(report["distribution_activation"], "blocked")
            self.assertEqual(report["authority"], "none")
            self.assertIn("source-cutover-not-authorized", files.render_markdown(report))
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(files.main(["--root", str(root), "--require-cutover-ready"]), 2)

    def test_current_platform_source_and_couplings_block_cutover(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            root = make_root(parent)
            platform = make_platform(parent, load_plan(root), old_source=True, old_coupling=True)
            result = files.report(root, platform, GATE_SHA)
            blockers = result["source_cutover"]["blockers"]
            self.assertIn("platform-files-source-still-present", blockers)
            self.assertIn("platform-files-implementation-couplings-remain", blockers)
            inspection = result["source_cutover"]["platform_inspection"]
            self.assertIn("system/apps/files", inspection["remaining_source"])
            self.assertTrue(inspection["remaining_couplings"])

    def test_second_canonical_manifest_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = make_root(Path(temp))
            write_json(root / "apps" / "files" / "app.json", {"id": "files"})
            with self.assertRaisesRegex(files.FilesCutoverError, "second canonical"):
                files.report(root)

    def test_unmanifested_duplicate_files_runtime_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = make_root(Path(temp))
            runtime = root / "apps" / "files" / "src" / "runtime.mjs"
            runtime.parent.mkdir(parents=True)
            runtime.write_text("export const componentRuntime = {};\n", encoding="utf-8")
            with self.assertRaisesRegex(files.FilesCutoverError, "second canonical"):
                files.report(root)

    def test_empty_premature_files_tree_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = make_root(Path(temp))
            (root / "apps" / "files").mkdir()
            with self.assertRaisesRegex(files.FilesCutoverError, "second canonical"):
                files.report(root)

    def test_platform_owned_port_cannot_be_deleted_in_gate_a(self):
        with tempfile.TemporaryDirectory() as temp:
            root = make_root(Path(temp))
            plan = load_plan(root)
            plan["gate_a_platform_removal"]["remove_owned_source"].append(
                "system/adapters/native/file-space.mjs"
            )
            write_json(root / "migrations" / "files.externalization.json", plan)
            with self.assertRaisesRegex(files.FilesCutoverError, "platform-owned contracts"):
                files.report(root)

    def test_pinned_sdk_version_cannot_drift_backwards(self):
        with tempfile.TemporaryDirectory() as temp:
            root = make_root(Path(temp))
            sdk = json.loads((root / "platform-sdk.lock.json").read_text(encoding="utf-8"))
            sdk["bundle_version"] = "1.5.0"
            write_json(root / "platform-sdk.lock.json", sdk)
            with self.assertRaisesRegex(files.FilesCutoverError, "compatible, pinned"):
                files.report(root)

    def test_public_contracts_must_not_be_silently_omitted(self):
        with tempfile.TemporaryDirectory() as temp:
            root = make_root(Path(temp))
            plan = load_plan(root)
            plan["platform_contracts_required"].remove("ordax.file-space/11")
            write_json(root / "migrations" / "files.externalization.json", plan)
            with self.assertRaisesRegex(files.FilesCutoverError, "public contract"):
                files.report(root)

    def test_authorization_without_snapshot_inventory_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = make_root(Path(temp))
            plan = load_plan(root)
            plan["source_cutover_allowed"] = True
            write_json(root / "migrations" / "files.externalization.json", plan)
            with self.assertRaisesRegex(files.FilesCutoverError, "distinct snapshot"):
                files.report(root)

    def test_real_git_gate_a_can_pass_but_not_production(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            root = make_root(parent)
            platform, gate, inventory = make_git_gate(parent, root)
            result = files.report(root, platform, gate)
            self.assertTrue(result["source_cutover"]["ready"])
            self.assertEqual(result["source_cutover"]["blockers"], [])
            self.assertEqual(result["distribution_activation"], "blocked")
            self.assertTrue(result["source_cutover"]["source_history_evidence"]["verified"])
            self.assertEqual(
                result["source_cutover"]["source_history_evidence"]["snapshot_file_count"],
                inventory["file_count"],
            )
            self.assertIn("opaque-resource-grant-broker", [
                entry["id"] for entry in result["unresolved_capabilities"]
            ])
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(files.main([
                    "--root", str(root), "--platform-root", str(platform),
                    "--require-cutover-ready",
                ]), 0)

    def test_dirty_checkout_wrong_commit_and_missing_port_block(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            root = make_root(parent)
            plan = authorize(root)
            platform = make_platform(parent, plan, missing_port=True)
            result = files.report(root, platform, "c" * 40, dirty=True)
            blockers = result["source_cutover"]["blockers"]
            self.assertIn("platform-checkout-dirty", blockers)
            self.assertIn("platform-commit-does-not-match-gate-a", blockers)
            self.assertIn("platform-owned-file-space-ports-missing", blockers)

    def test_snapshot_inventory_must_match_exact_platform_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = make_root(Path(temp))
            authorize(root)
            inventory_path = root / "migrations" / "files.source-snapshot.json"
            inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
            inventory["commit"] = "c" * 40
            write_json(inventory_path, inventory)
            with self.assertRaisesRegex(files.FilesCutoverError, "snapshot inventory"):
                files.report(root)

    def test_snapshot_cannot_include_platform_owned_contracts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = make_root(Path(temp))
            authorize(root)
            path = root / "migrations" / "files.source-snapshot.json"
            inventory = json.loads(path.read_text(encoding="utf-8"))
            inventory["files"][1]["path"] = "system/contracts/file-space.mjs"
            write_json(path, inventory)
            with self.assertRaisesRegex(files.FilesCutoverError, "unowned or unpinned"):
                files.report(root)

    def test_snapshot_duplicate_paths_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = make_root(Path(temp))
            authorize(root)
            path = root / "migrations" / "files.source-snapshot.json"
            inventory = json.loads(path.read_text(encoding="utf-8"))
            inventory["files"][1]["path"] = inventory["files"][0]["path"]
            write_json(path, inventory)
            with self.assertRaisesRegex(files.FilesCutoverError, "unique Files app source"):
                files.report(root)

    def test_snapshot_generator_derives_exact_git_blobs_without_writing(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            root = make_root(parent)
            platform, gate, inventory = make_git_gate(parent, root)
            # Capture is pre-removal only: the exact Gate A tree no longer has Files.
            with self.assertRaisesRegex(files.FilesCutoverError, "after cutover"):
                files.capture_source_snapshot(platform, load_plan(root))
            self.assertEqual(inventory["file_count"], len(inventory["files"]))
            self.assertGreaterEqual(inventory["file_count"], 5)
            self.assertEqual(
                inventory["files"], sorted(inventory["files"], key=lambda entry: entry["path"])
            )
            self.assertEqual(git(platform, "status", "--porcelain"), "")

    def test_git_blob_tampering_blocks_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            root = make_root(parent)
            platform, gate, _ = make_git_gate(parent, root)
            path = root / "migrations" / "files.source-snapshot.json"
            inventory = json.loads(path.read_text(encoding="utf-8"))
            inventory["files"][0]["git_blob_sha"] = "f" * 40
            write_json(path, inventory)
            result = files.report(root, platform, gate)
            self.assertFalse(result["source_cutover"]["ready"])
            self.assertIn("source-git-history-not-proven", result["source_cutover"]["blockers"])
            self.assertIn("Git blobs", result["source_cutover"]["source_history_evidence"]["reason"])

    def test_missing_snapshot_file_blocks_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            root = make_root(parent)
            platform, gate, _ = make_git_gate(parent, root)
            path = root / "migrations" / "files.source-snapshot.json"
            inventory = json.loads(path.read_text(encoding="utf-8"))
            inventory["files"].pop()
            inventory["file_count"] -= 1
            write_json(path, inventory)
            result = files.report(root, platform, gate)
            self.assertIn("source-git-history-not-proven", result["source_cutover"]["blockers"])

    def test_wrong_git_origin_blocks_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            root = make_root(parent)
            platform, gate, _ = make_git_gate(parent, root)
            git(platform, "remote", "set-url", "origin", "https://github.com/attacker/fake.git")
            result = files.report(root, platform, gate)
            self.assertIn("source-git-history-not-proven", result["source_cutover"]["blockers"])
            self.assertIn("origin", result["source_cutover"]["source_history_evidence"]["reason"])

    def test_dirty_git_checkout_blocks_ready(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            root = make_root(parent)
            platform, gate, _ = make_git_gate(parent, root)
            (platform / "unexpected-untracked.txt").write_text("dirty", encoding="utf-8")
            result = files.report(root, platform, gate, dirty=True)
            self.assertIn("platform-checkout-dirty", result["source_cutover"]["blockers"])
            self.assertIn("source-git-history-not-proven", result["source_cutover"]["blockers"])

    def test_gate_a_must_descend_from_snapshot_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            root = make_root(parent)
            platform, gate, _ = make_git_gate(parent, root)
            # Valid Git commit, but not an ancestor of Gate A.
            git(platform, "checkout", "--orphan", "unrelated")
            git(platform, "rm", "-rfq", ".")
            (platform / "unrelated.txt").write_text("unrelated", encoding="utf-8")
            git(platform, "add", "--all")
            git(platform, "commit", "-qm", "unrelated source")
            unrelated = git(platform, "rev-parse", "HEAD")
            git(platform, "checkout", "--detach", gate)
            plan = load_plan(root)
            plan["source_snapshot"]["commit"] = unrelated
            write_json(root / "migrations" / "files.externalization.json", plan)
            inventory_path = root / "migrations" / "files.source-snapshot.json"
            inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
            inventory["commit"] = unrelated
            write_json(inventory_path, inventory)
            result = files.report(root, platform, gate)
            self.assertIn("source-git-history-not-proven", result["source_cutover"]["blockers"])

    def test_capture_cli_refuses_missing_checkout(self):
        with tempfile.TemporaryDirectory() as temp:
            root = make_root(Path(temp))
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(files.main([
                    "--root", str(root), "--emit-source-snapshot",
                ]), 1)

    def test_missing_coupling_owner_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            root = make_root(parent)
            plan = authorize(root)
            platform = make_platform(parent, plan)
            (platform / "system/apps/catalog.mjs").unlink()
            result = files.report(root, platform, GATE_SHA)
            self.assertIn("platform-coupling-owner-missing", result["source_cutover"]["blockers"])


if __name__ == "__main__":
    unittest.main()
