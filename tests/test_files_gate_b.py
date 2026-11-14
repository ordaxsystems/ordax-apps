"""Gate B real: Files has one canonical unsigned source in ordax-apps."""
from __future__ import annotations
import hashlib
import importlib.util
import json
import subprocess
import tempfile
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "apps" / "files"
MIG = ROOT / "migrations"
spec = importlib.util.spec_from_file_location("files_package_builder", ROOT / "tools" / "app-package" / "build.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

def obj(path):
    return json.loads(path.read_text(encoding="utf-8"))

def blob(body):
    return hashlib.sha1(b"blob " + str(len(body)).encode() + bytes([0]) + body).hexdigest()

class FilesGateBTests(unittest.TestCase):
    def test_canonical_owner_and_unsigned_gate(self):
        plan = obj(MIG / "files.externalization.json")
        self.assertEqual(plan["source_of_truth_state"], "ordax-apps-canonical")
        self.assertEqual(plan["source_repository_current"], "ordaxsystems/ordax-apps")
        self.assertEqual(plan["source_path_current"], "apps/files")
        self.assertEqual(plan["source_cutover"]["target_materialization_state"], "materialized")
        self.assertTrue(plan["source_cutover"]["target_source_present"])
        self.assertEqual(plan["gate_b"]["state"], "source-materialized-unsigned")
        self.assertFalse(plan["distribution_activation_allowed"])
        self.assertFalse(plan["gate_b"]["signed_distribution_verified"])
        self.assertFalse(plan["gate_b"]["native_install_verified"])
        self.assertFalse(plan["gate_b"]["rollback_verified"])

    def test_sdk_blobs_are_exact_published_contracts(self):
        proof = obj(APP / "sdk-provenance.json")
        plan = obj(MIG / "files.externalization.json")
        self.assertEqual(proof["source_commit"], plan["target_sdk"]["published_bundle_commit"])
        self.assertEqual(proof["sdk_bundle_version"], plan["gate_b"]["sdk_bundle_version"])
        self.assertEqual(proof["authority"], "none")
        self.assertFalse(proof["distribution_activation_allowed"])
        self.assertEqual(len(proof["contracts"]), 15)
        for record in proof["contracts"]:
            target = ROOT / record["target"]
            self.assertTrue(target.is_file() and not target.is_symlink())
            self.assertEqual(blob(target.read_bytes()), record["git_blob_sha"])

    def test_manifests_are_external_and_fail_closed(self):
        app = obj(APP / "app.json")
        ai = obj(APP / "ai/manifest.json")
        actions = obj(APP / "actions/manifest.json")
        providers = obj(APP / "actions/providers/manifest.json")
        presentation = obj(APP / "presentation/manifest.json")
        self.assertEqual(app["releaseMode"], "component-slot")
        self.assertEqual(app["owner"], "ordaxsystems/ordax-apps")
        self.assertEqual(ai["execution"], "declarative-only")
        self.assertEqual(actions["execution"], "proposal-only")
        self.assertEqual(providers["execution"], "unavailable")
        self.assertEqual(presentation["appId"], "files")
        self.assertTrue(all(not c["executionAuthorized"] and not c["modelDirectExecutionAuthorized"]
                            for c in actions["capabilities"]))

    def test_runtime_uses_only_app_source_and_vendored_public_sdk(self):
        for source in (
            APP / "src/runtime.mjs", APP / "src/ui/file-space-controls.mjs",
            APP / "src/ui/file-space-response-identity.mjs",
            APP / "actions/providers/files-native.mjs",
        ):
            body = source.read_text(encoding="utf-8")
            self.assertNotIn("../../contracts/", body)
            self.assertNotIn("system/services/", body)
            self.assertNotIn("node:fs", body)
            self.assertNotIn("node:child_process", body)
        self.assertFalse((APP / "src/system").exists())
        self.assertFalse((APP / "src/sdk/services").exists())

    def test_unsigned_candidate_is_deterministic_and_self_contained(self):
        head = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip()
        self.assertRegex(head, r"^[0-9a-f]{40}$")
        with tempfile.TemporaryDirectory() as directory:
            a = Path(directory) / "files-one.zip"
            b = Path(directory) / "files-two.zip"
            first, _ = builder.build_package(APP, head, a)
            second, _ = builder.build_package(APP, head, b)
            checked, _ = builder.verify_package(a)
            self.assertEqual(first, second)
            self.assertEqual(first, checked)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            self.assertEqual(first["component"]["id"], "files")
            self.assertEqual(first["entrypoint"], "src/runtime.mjs")
            self.assertFalse(first["activation_allowed"])
            self.assertFalse(first["native_adapters_packaged"])
            self.assertTrue(first["signature_required_before_activation"])

if __name__ == "__main__":
    unittest.main()
