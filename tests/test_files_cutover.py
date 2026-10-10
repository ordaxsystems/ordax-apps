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


def make_pinned_source(parent: Path, root: Path) -> tuple[Path, dict]:
    """Build one real Git snapshot before removing any Files source."""
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
    plan["source_snapshot"]["state"] = "captured"
    plan["source_snapshot"]["commit"] = inventory["commit"]
    plan["source_snapshot"]["inventory_file"] = "migrations/files.source-snapshot.json"
    write_json(root / "migrations" / "files.externalization.json", plan)
    write_json(root / "migrations" / "files.source-snapshot.json", inventory)
    return platform, inventory


def make_git_gate(parent: Path, root: Path, *, change_after_snapshot: bool = False) -> tuple[Path, str, dict]:
    """Build a Gate A; optionally introduce post-snapshot changes to block."""
    platform, inventory = make_pinned_source(parent, root)
    plan = load_plan(root)
    if change_after_snapshot:
        source = platform / "system/apps/files/app.mjs"
        source.write_text("export const filesApp = { changedAfterSnapshot: true };\n", encoding="utf-8")
        git(platform, "add", "--all")
        git(platform, "commit", "-qm", "Files changed between snapshot and Gate A")
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
            lock = json.loads((root / "platform-sdk.lock.json").read_text(encoding="utf-8"))
            self.assertEqual(report["sdk_pin"]["version"], lock["bundle_version"])
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

    def test_files_response_identity_helper_is_app_owned_during_cutover(self):
        with tempfile.TemporaryDirectory() as temp:
            root = make_root(Path(temp))
            plan = load_plan(root)
            self.assertIn(
                "system/surface/ui/file-space-response-identity.mjs",
                plan["gate_a_platform_removal"]["remove_owned_source"],
            )
            self.assertFalse(files.report(root)["source_cutover"]["ready"])

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

    def test_app_owned_files_component_has_no_parallel_platform_definition(self):
        plan = load_plan(ROOT)
        inventory = json.loads((ROOT / plan["source_snapshot"]["inventory_file"]).read_text(encoding="utf-8"))
        files = {entry["path"] for entry in inventory["files"]}
        self.assertIn("system/apps/files/component.mjs", files)
        self.assertIn("system/surface/ui/files-component-runtime.mjs", files)
        self.assertIn("system/apps/files/actions/manifest.mjs", files)
        self.assertIn("system/apps/files/actions/providers/files-native.mjs", files)
        self.assertIn("system/apps/files/app.mjs", files)
        self.assertEqual(len(files), inventory["file_count"])
        couplings = {entry["path"]: entry["forbidden_literals"]
                     for entry in plan["gate_a_platform_removal"]["remove_platform_implementation_couplings"]}
        self.assertIn("./files/component.mjs", couplings["system/apps/component-catalog.mjs"])
        self.assertIn("filesComponent", couplings["system/services/components/manifests/apps.mjs"])
        self.assertIn("system/contracts/first-party-app.mjs",
                      plan["gate_a_platform_removal"]["retain_platform_owned"])
        self.assertIn("ordax.first-party-app/1", plan["platform_contracts_required"])
        self.assertFalse(plan["source_cutover_allowed"])
        self.assertFalse(plan["distribution_activation_allowed"])

    def test_files_sdk_import_graph_uses_snapshot_and_published_contract_inventory(self):
        with tempfile.TemporaryDirectory() as temp:
            platform = Path(temp)
            sources = {
                "system/apps/files/app.mjs":
                    'import "./helper.mjs";\n'
                    'import { port } from "../../contracts/file-space.mjs";\n'
                    'import { catalog } from "../app-contract.mjs";\n'
                    'export { recent } from "../../contracts/recent-files.mjs";\n',
                "system/apps/files/helper.mjs": "export const helper = 1;\n",
            }
            extra = {
                "system/contracts/file-space.mjs": "export const port = 1;\n",
                "system/contracts/recent-files.mjs": "export const recent = 1;\n",
                "system/apps/app-contract.mjs": "export const catalog = 1;\n",
            }
            for path, content in {**sources, **extra}.items():
                file = platform / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(content, encoding="utf-8")
            inventory = {
                "commit": SNAPSHOT_SHA,
                "files": [{"path": path} for path in sorted(sources)],
            }
            sdk = {
                "$schema": "ordax.app-sdk-bundle/1",
                "authority": "none",
                "bundle_version": "1.13.0",
                "contracts": [{
                    "source_path": "system/contracts/file-space.mjs",
                    "schema": "ordax.file-space/11",
                    "major": 11,
                }],
            }
            original = sorted((p.relative_to(platform).as_posix(), p.read_bytes())
                              for p in platform.rglob("*") if p.is_file())
            blocked = files.audit_files_sdk_dependencies(platform, inventory, sdk)
            self.assertEqual(blocked["public_contracts"], ["system/contracts/file-space.mjs"])
            self.assertEqual(blocked["unpublished_contracts"], ["system/contracts/recent-files.mjs"])
            self.assertEqual(blocked["private_platform_imports"], ["system/apps/app-contract.mjs"])
            self.assertEqual(blocked["app_owned_dependencies"], ["system/apps/files/helper.mjs"])
            self.assertEqual(blocked["blockers"], ["unpublished-app-sdk-contracts", "private-platform-imports"])
            self.assertFalse(blocked["sdk_boundary_clean"])
            self.assertEqual(blocked["distribution_activation"], "blocked")
            self.assertEqual(original, sorted(
                (p.relative_to(platform).as_posix(), p.read_bytes())
                for p in platform.rglob("*") if p.is_file()
            ))

            sdk["contracts"].append({
                "source_path": "system/contracts/recent-files.mjs",
                "schema": "ordax.recent-files/1",
                "major": 1,
            })
            still_private = files.audit_files_sdk_dependencies(platform, inventory, sdk)
            self.assertEqual(still_private["blockers"], ["private-platform-imports"])
            source = platform / "system/apps/files/app.mjs"
            source.write_text(source.read_text(encoding="utf-8").replace(
                'import { catalog } from "../app-contract.mjs";\n', ""
            ), encoding="utf-8")
            clean = files.audit_files_sdk_dependencies(platform, inventory, sdk)
            self.assertTrue(clean["sdk_boundary_clean"])
            self.assertEqual(clean["blockers"], [])

    def test_files_sdk_audit_rejects_transitive_unpublished_and_private_imports(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            names = {
                "system/apps/files/app.mjs": 'import "../../contracts/recent-files.mjs";\n',
                "system/contracts/recent-files.mjs": 'export { file } from "./file-space.mjs";\n',
                "system/contracts/file-space.mjs": 'export const file = true;\n',
            }
            for name, content in names.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
            inventory = {
                "commit": SNAPSHOT_SHA,
                "files": [{"path": "system/apps/files/app.mjs"}],
            }
            sdk = {
                "$schema": "ordax.app-sdk-bundle/1",
                "authority": "none",
                "bundle_version": "1.15.0",
                "contracts": [{
                    "source_path": "system/contracts/recent-files.mjs",
                    "schema": "ordax.recent-files/1",
                    "major": 1,
                }],
            }
            missing = files.audit_files_sdk_dependencies(root, inventory, sdk)
            self.assertIn("system/contracts/file-space.mjs", missing["unpublished_contracts"])
            self.assertIn("unpublished-app-sdk-contracts", missing["blockers"])
            sdk["contracts"].append({
                "source_path": "system/contracts/file-space.mjs",
                "schema": "ordax.file-space/11",
                "major": 11,
            })
            ready = files.audit_files_sdk_dependencies(root, inventory, sdk)
            self.assertEqual(ready["unpublished_contracts"], [])
            self.assertEqual(ready["transitive_public_contracts"], ["system/contracts/file-space.mjs"])
            self.assertTrue(ready["sdk_boundary_clean"])
            private_path = root / "system/services/files/recent-files.mjs"
            private_path.parent.mkdir(parents=True, exist_ok=True)
            private_path.write_text("export const service = true;\n", encoding="utf-8")
            source = root / "system/contracts/recent-files.mjs"
            source.write_text('export { service } from "../services/files/recent-files.mjs";\n', encoding="utf-8")
            private = files.audit_files_sdk_dependencies(root, inventory, sdk)
            self.assertEqual(private["private_platform_imports"], ["system/services/files/recent-files.mjs"])
            self.assertFalse(private["sdk_boundary_clean"])

    def test_published_sdk_contract_git_blobs_are_verified_when_sdk_root_is_supplied(self):
        import hashlib
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = root / "system/apps/files/app.mjs"
            app.parent.mkdir(parents=True, exist_ok=True)
            app.write_text('import "../../contracts/recent-files.mjs";\n', encoding="utf-8")
            contract = root / "system/contracts/recent-files.mjs"
            contract.parent.mkdir(parents=True, exist_ok=True)
            contract.write_text("export const recent = true;\n", encoding="utf-8")
            payload = contract.read_bytes()
            valid_blob = hashlib.sha1(
                b"blob " + str(len(payload)).encode() + b"\0" + payload
            ).hexdigest()
            inventory = {"commit": SNAPSHOT_SHA, "files": [{"path": "system/apps/files/app.mjs"}]}
            sdk = {"$schema": "ordax.app-sdk-bundle/1", "authority": "none",
                   "bundle_version": "1.15.0", "contracts": [{
                       "source_path": "system/contracts/recent-files.mjs",
                       "schema": "ordax.recent-files/1", "major": 1,
                       "source_git_blob": valid_blob,
                   }]}
            verified = files.audit_files_sdk_dependencies(root, inventory, sdk, sdk_root=root)
            self.assertEqual(verified["unpublished_contracts"], [])
            self.assertEqual(verified["transitive_public_contracts"], [])
            sdk["contracts"][0]["source_git_blob"] = "0" * 40
            with self.assertRaisesRegex(files.FilesCutoverError, "Git blob mismatch"):
                files.audit_files_sdk_dependencies(root, inventory, sdk, sdk_root=root)

    def test_files_sdk_import_graph_fails_closed_on_nonliteral_or_missing_imports(self):
        for literal in ('const module = import(name);\n',
                        'import "https://example.org/network.mjs";\n',
                        'import "./not-found.mjs";\n'):
            with self.subTest(source=literal):
                with tempfile.TemporaryDirectory() as temp:
                    platform = Path(temp)
                    file = platform / "system/apps/files/app.mjs"
                    file.parent.mkdir(parents=True, exist_ok=True)
                    file.write_text(literal, encoding="utf-8")
                    inventory = {"commit": SNAPSHOT_SHA, "files": [{"path": "system/apps/files/app.mjs"}]}
                    sdk = {"$schema": "ordax.app-sdk-bundle/1", "authority": "none",
                           "bundle_version": "1.13.0", "contracts": []}
                    with self.assertRaises(files.FilesCutoverError):
                        files.audit_files_sdk_dependencies(platform, inventory, sdk)

    def test_pinned_source_proof_succeeds_without_authorizing_cutover(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            root = make_root(parent)
            platform, inventory = make_pinned_source(parent, root)
            proof = files.verify_pinned_source_snapshot(root, platform, load_plan(root))
            self.assertTrue(proof["verified"])
            self.assertEqual(proof["source_commit"], inventory["commit"])
            self.assertEqual(proof["file_count"], inventory["file_count"])
            self.assertEqual(proof["distribution_activation"], "blocked")
            self.assertFalse(proof["source_cutover_allowed"])
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                self.assertEqual(files.main([
                    "--root", str(root), "--platform-root", str(platform),
                    "--verify-pinned-source",
                ]), 0)
            self.assertTrue(json.loads(stdout.getvalue())["verified"])

    def test_pinned_proof_rejects_tampered_blob_wrong_head_and_checkout(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            root = make_root(parent)
            platform, inventory = make_pinned_source(parent, root)
            path = root / "migrations/files.source-snapshot.json"
            altered = json.loads(path.read_text(encoding="utf-8"))
            altered["files"][0]["git_blob_sha"] = "f" * 40
            write_json(path, altered)
            with self.assertRaisesRegex(files.FilesCutoverError, "real Git blobs"):
                files.verify_pinned_source_snapshot(root, platform, load_plan(root))
            write_json(path, inventory)
            (platform / "unrelated.txt").write_text("unrelated", encoding="utf-8")
            with self.assertRaisesRegex(files.FilesCutoverError, "uncommitted"):
                files.verify_pinned_source_snapshot(root, platform, load_plan(root))
            git(platform, "add", "--all")
            git(platform, "commit", "-qm", "newer source HEAD")
            with self.assertRaisesRegex(files.FilesCutoverError, "HEAD differs"):
                files.verify_pinned_source_snapshot(root, platform, load_plan(root))

    def test_snapshot_change_between_capture_and_gate_a_blocks_data_loss(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            root = make_root(parent)
            platform, gate, _ = make_git_gate(parent, root, change_after_snapshot=True)
            report = files.report(root, platform, gate)
            self.assertFalse(report["source_cutover"]["ready"])
            self.assertIn("source-git-history-not-proven", report["source_cutover"]["blockers"])
            self.assertIn("changed after snapshot", report["source_cutover"]["source_history_evidence"]["reason"])

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
