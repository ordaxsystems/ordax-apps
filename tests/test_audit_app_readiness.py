"""Contract tests for the G0 app-readiness auditor (no network or platform checkout)."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "audit_app_readiness.py"
spec = importlib.util.spec_from_file_location("audit_app_readiness", SCRIPT)
audit = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(audit)


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def make_workspace(root: Path, targets: list[str]) -> None:
    (root / "apps").mkdir()
    (root / "migrations").mkdir()
    write_json(root / "ordax-apps.workspace.json", {
        "role": "first-party-app-source",
        "authority": "none",
        "source_of_truth_policy": "single-repository-per-app",
        "first_party_app_targets": targets,
        "structural_surfaces_owned_by_platform": ["store", "settings", "account", "system"],
    })


def make_app(root: Path, app_id: str = "alpha", *, compatibility: bool = True) -> None:
    base = root / "apps" / app_id
    version = "0.1.0"
    write_json(base / "app.json", {
        "schema": "ordax.component-manifest/1",
        "id": app_id,
        "title": app_id.title(),
        "kind": "app",
        "version": version,
        "releaseMode": "component-slot",
        "criticality": "optional",
        "failureDomain": "app",
        "restartScope": "component",
        "healthMode": "runtime",
        "owner": "ordaxsystems/ordax-apps",
        "dependencies": [],
    })
    write_json(base / "ai" / "manifest.json", {
        "schema": "ordax.app-intelligence-manifest/1",
        "appId": app_id,
        "appVersion": version,
        "authority": "none",
        "execution": "declarative-only",
        "instructions": ["Read only the currently authorized item."],
        "intents": [{
            "id": f"{app_id}.inspect",
            "description": "Inspect an authorized item.",
            "effect": "read",
            "confirmation": "none",
            "parameters": [],
            "examples": ["Inspect current item"],
        }],
    })
    adapter = f"{app_id}-native"
    write_json(base / "actions" / "manifest.json", {
        "schema": "ordax.application-action-manifest/1",
        "appId": app_id,
        "appVersion": version,
        "authority": "none",
        "execution": "proposal-only",
        "capabilities": [{
            "schema": "ordax.application-action-capability/1",
            "appId": app_id,
            "actionId": f"{app_id}.inspect",
            "title": "Inspect item",
            "description": "Inspect an authorized item.",
            "sourceClass": "first-party",
            "platform": "ordax",
            "provider": {"kind": "first-party-native", "adapterId": adapter, "revision": "1"},
            "binding": {"payloadSha256": None},
            "parameters": [],
            "riskClass": "read-only",
            "confirmation": "none",
            "executionAuthorized": False,
            "modelDirectExecutionAuthorized": False,
            "provenance": f"ordax-apps:apps/{app_id}/actions/manifest.json",
        }],
    })
    module = base / "actions" / "providers" / f"{adapter}.mjs"
    module.parent.mkdir(parents=True, exist_ok=True)
    module.write_text("export const authority = 'none';\n", encoding="utf-8")
    write_json(base / "actions" / "providers" / "manifest.json", {
        "schema": "ordax.application-action-provider-manifest/1",
        "appId": app_id,
        "appVersion": version,
        "authority": "none",
        "execution": "unavailable",
        "providers": [{
            "kind": "first-party-native",
            "adapterId": adapter,
            "revision": "1",
            "module": f"actions/providers/{adapter}.mjs",
            "sha256": hashlib.sha256(module.read_bytes()).hexdigest(),
        }],
    })
    runtime = base / "src" / "runtime.mjs"
    runtime.parent.mkdir(parents=True, exist_ok=True)
    runtime.write_text("export const authority = 'none';\n", encoding="utf-8")
    if compatibility:
        write_json(base / "compatibility.json", {
            "schema": "ordax.component-compatibility/1",
            "componentId": app_id,
            "componentVersion": version,
            "provides": [{"id": "ordax.component-runtime", "major": 1}],
            "requires": [],
            "state": {
                "id": f"ordax.{app_id}-stateless",
                "writeVersion": 1,
                "readableFrom": 1,
                "readableThrough": 1,
            },
            "authority": "none",
        })


class ReadinessAuditTests(unittest.TestCase):
    def test_metadata_verified_but_production_never_claimed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["alpha", "files", "projects"])
            make_app(root)
            write_json(root / "migrations" / "projects.externalization.json", {
                "app_id": "projects",
                "source_repository_current": "ordaxsystems/ordax-os",
                "source_cutover_allowed": False,
                "distribution_activation_allowed": False,
            })
            report = audit.audit_workspace(root)
            self.assertEqual(report["summary"]["target_count"], 3)
            self.assertEqual(report["summary"]["canonical_source_count"], 1)
            self.assertEqual(report["summary"]["metadata_verified_count"], 1)
            self.assertEqual(report["summary"]["production_releases_verified"], 0)
            self.assertEqual(report["apps"][0]["release_evidence"]["production_activation"], "not-assessed")
            self.assertEqual(report["apps"][1]["source_state"], "bootstrap-candidate")
            self.assertEqual(report["apps"][2]["source_state"], "platform-until-cutover")
            self.assertIn("source-cutover-not-authorized", report["apps"][2]["blockers"])
            self.assertIn("production-activation-not-authorized", report["apps"][2]["blockers"])
            self.assertIn("§alpha§".replace("§", chr(96)), audit.render_markdown(report))

    def test_missing_compatibility_is_blocker_not_fake_release(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["alpha"])
            make_app(root, compatibility=False)
            row = audit.audit_workspace(root)["apps"][0]
            self.assertEqual(row["source_state"], "canonical-source")
            self.assertFalse(row["metadata"]["metadata_verified"])
            self.assertIn("missing-compatibility-descriptor", row["blockers"])

    def test_manifest_version_drift_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["alpha"])
            make_app(root)
            path = root / "apps" / "alpha" / "compatibility.json"
            value = json.loads(path.read_text(encoding="utf-8"))
            value["componentVersion"] = "9.9.9"
            write_json(path, value)
            with self.assertRaisesRegex(audit.AuditError, "compatibility identity"):
                audit.audit_workspace(root)

    def test_duplicate_compatibility_sources_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["alpha"])
            make_app(root)
            write_json(root / "migrations" / "alpha.compatibility.json", {})
            with self.assertRaisesRegex(audit.AuditError, "duplicate compatibility"):
                audit.audit_workspace(root)

    def test_platform_owned_app_cannot_be_duplicated(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["projects"])
            make_app(root, "projects")
            write_json(root / "migrations" / "projects.externalization.json", {
                "app_id": "projects",
                "source_repository_current": "ordaxsystems/ordax-os",
                "source_cutover_allowed": False,
            })
            with self.assertRaisesRegex(audit.AuditError, "duplicate app source"):
                audit.audit_workspace(root)

    def test_provider_digest_drift_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["alpha"])
            make_app(root)
            module = root / "apps" / "alpha" / "actions" / "providers" / "alpha-native.mjs"
            module.write_text("export const authority = 'privileged';\n", encoding="utf-8")
            with self.assertRaisesRegex(audit.AuditError, "SHA-256 mismatch"):
                audit.audit_workspace(root)

    def test_unlisted_app_and_structural_target_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["alpha"])
            make_app(root)
            make_app(root, "unexpected")
            with self.assertRaisesRegex(audit.AuditError, "unlisted canonical"):
                audit.audit_workspace(root)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["store"])
            with self.assertRaisesRegex(audit.AuditError, "structural surfaces"):
                audit.audit_workspace(root)

    def test_unsigned_package_candidate_is_verified_twice_without_release_authority(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["alpha", "files"])
            make_app(root)
            report = audit.prove_package_candidates(
                root, audit.audit_workspace(root), "a" * 40
            )
            self.assertEqual(report["summary"]["package_candidates_verified"], 1)
            self.assertEqual(report["summary"]["production_releases_verified"], 0)
            row = report["apps"][0]
            self.assertEqual(
                row["release_evidence"]["package_build"], "verified-deterministic-candidate"
            )
            candidate = row["release_evidence"]["package_candidate"]
            self.assertEqual(candidate["source_commit"], "a" * 40)
            self.assertRegex(candidate["package_sha256"], r"^[0-9a-f]{64}$")
            self.assertGreater(candidate["package_size"], 0)
            self.assertEqual(row["release_evidence"]["production_activation"], "not-assessed")
            self.assertEqual(report["apps"][1]["release_evidence"]["package_build"], "not-assessed")
            self.assertFalse(list(root.rglob("*.zip")), "no unsigned candidate should remain in repo")

    def test_missing_compatibility_cannot_be_reported_as_verified_package(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["alpha"])
            make_app(root, compatibility=False)
            report = audit.prove_package_candidates(
                root, audit.audit_workspace(root), "a" * 40
            )
            self.assertEqual(report["summary"]["package_candidates_verified"], 0)
            self.assertEqual(
                report["apps"][0]["release_evidence"]["package_build"],
                "blocked-missing-compatibility",
            )

    def test_invalid_portable_source_fails_package_proof_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["alpha"])
            make_app(root)
            (root / "apps" / "alpha" / "src" / "runtime.mjs").write_text(
                "import { secret } from 'private-platform';\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(audit.AuditError, "bare/remote import"):
                audit.prove_package_candidates(root, audit.audit_workspace(root), "a" * 40)

    def test_non_deterministic_candidate_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["alpha"])
            make_app(root)
            fake = {
                "package_sha256": "a" * 64, "package_size": 1,
                "release_sha256": "b" * 64, "compatibility_sha256": "c" * 64,
                "source_commit": "a" * 40,
            }
            changed = {**fake, "package_sha256": "d" * 64}
            with patch.object(audit, "_build_candidate_once", side_effect=[fake, changed]):
                with self.assertRaisesRegex(audit.AuditError, "non-deterministic"):
                    audit.prove_package_candidates(root, audit.audit_workspace(root), "a" * 40)

    def test_git_provenance_requires_clean_canonical_checkout(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["alpha"])
            make_app(root)
            def git(*args: str) -> str:
                return subprocess.run(
                    ["git", "-C", str(root), *args],
                    check=True, capture_output=True, text=True, timeout=10,
                ).stdout.strip()
            git("init", "-q")
            git("config", "user.name", "OrdaX Test")
            git("config", "user.email", "ordax-test@invalid.example")
            git("remote", "add", "origin", "https://github.com/ordaxsystems/ordax-apps.git")
            git("add", "--all")
            git("commit", "-qm", "fixture")
            commit = audit.checked_git_commit(root)
            self.assertRegex(commit, r"^[0-9a-f]{40}$")
            (root / "unexpected-untracked").write_text("dirty", encoding="utf-8")
            with self.assertRaisesRegex(audit.AuditError, "clean Git checkout"):
                audit.checked_git_commit(root)
            (root / "unexpected-untracked").unlink()
            git("remote", "set-url", "origin", "https://github.com/attacker/fake.git")
            with self.assertRaisesRegex(audit.AuditError, "Git origin"):
                audit.checked_git_commit(root)

    def test_git_provenance_rejects_non_git_root(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(audit.AuditError):
                audit.checked_git_commit(Path(temp))

    def test_notes_production_gate_remains_blocked(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            make_workspace(root, ["notes"])
            make_app(root, "notes")
            write_json(root / "migrations" / "notes.externalization.json", {
                "app_id": "notes",
                "source_repository_current": "ordaxsystems/ordax-apps",
                "source_path_current": "apps/notes",
                "distribution_activation_allowed": False,
            })
            row = audit.audit_workspace(root)["apps"][0]
            self.assertEqual(row["release_evidence"]["production_activation"], "blocked-by-known-gate")


if __name__ == "__main__":
    unittest.main()
