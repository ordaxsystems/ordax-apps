"""Gate B real: Atividade tem fonte única e pacote unsigned verificável."""
from __future__ import annotations
import hashlib
import importlib.util
import json
import re
import subprocess
import tempfile
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "apps" / "activity"
MIG = ROOT / "migrations"
spec = importlib.util.spec_from_file_location("activity_package_builder", ROOT / "tools" / "app-package" / "build.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def obj(path):
    return json.loads(path.read_text(encoding="utf-8"))


def blob(body):
    return hashlib.sha1(b"blob " + str(len(body)).encode() + bytes([0]) + body).hexdigest()


class ActivityGateBTests(unittest.TestCase):
    def test_snapshot_and_canonical_owner(self):
        snap = obj(MIG / "activity.source-snapshot.json")
        plan = obj(MIG / "activity.externalization.json")
        mapping = obj(MIG / "activity.gate-b-transfer-map.json")
        self.assertEqual(snap["file_count"], 9)
        self.assertEqual(len(snap["files"]), 9)
        self.assertEqual(mapping["source_file_count"], 9)
        self.assertEqual({entry["source"] for entry in mapping["mappings"]},
                         {entry["path"] for entry in snap["files"]})
        self.assertEqual(plan["source_repository_current"], "ordaxsystems/ordax-apps")
        self.assertEqual(plan["source_of_truth_state"], "ordax-apps-canonical")
        self.assertEqual(plan["source_cutover"]["platform_absence_proven_at"],
                         "d7ffe657afe349fa847b40f19ab071bbd9608417")
        self.assertFalse(plan["distribution_activation_allowed"])
        self.assertFalse(plan["gate_b"]["signed_distribution_verified"])
        self.assertFalse(plan["gate_b"]["native_install_verified"])
        self.assertFalse(plan["gate_b"]["rollback_verified"])

    def test_sdk_blobs_are_canonical_and_no_host_service_is_copied(self):
        sdk = obj(APP / "sdk-provenance.json")
        lock = obj(ROOT / "platform-sdk.lock.json")
        self.assertEqual(lock["bundle_version"], "1.19.0")
        self.assertEqual(sdk["source_commit"], lock["commit"])
        self.assertEqual(sdk["sdk_bundle_version"], lock["bundle_version"])
        self.assertEqual(sdk["authority"], "none")
        self.assertEqual(len(sdk["contracts"]), 9)
        for record in sdk["contracts"]:
            self.assertTrue(record["source_path"].startswith("system/contracts/"))
            target = ROOT / record["target"]
            self.assertTrue(target.is_file() and not target.is_symlink())
            self.assertEqual(blob(target.read_bytes()), record["git_blob_sha"])
        for source in (APP / "src/runtime.mjs", APP / "src/view-model.mjs",
                       APP / "src/ui/workspace-controls.mjs"):
            body = source.read_text("utf-8")
            self.assertNotRegex(body, r"(?:system/services/|node:fs|node:child_process)")
            self.assertNotIn("../../../contracts/", body)
        self.assertFalse((APP / "src/sdk/services").exists())

    def test_manifest_prohibits_implicit_action_authority(self):
        app = obj(APP / "app.json")
        ai = obj(APP / "ai/manifest.json")
        actions = obj(APP / "actions/manifest.json")
        providers = obj(APP / "actions/providers/manifest.json")
        self.assertEqual(app["releaseMode"], "component-slot")
        self.assertEqual(app["owner"], "ordaxsystems/ordax-apps")
        self.assertEqual(ai["execution"], "declarative-only")
        self.assertEqual(actions["execution"], "proposal-only")
        self.assertEqual(providers["execution"], "unavailable")
        self.assertTrue(all(x["executionAuthorized"] is False and
                            x["modelDirectExecutionAuthorized"] is False
                            for x in actions["capabilities"]))

    def test_unsigned_candidate_is_deterministic_and_self_contained(self):
        head = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True).strip()
        self.assertRegex(head, r"^[0-9a-f]{40}$")
        with tempfile.TemporaryDirectory() as directory:
            a = Path(directory) / "activity-one.zip"
            b = Path(directory) / "activity-two.zip"
            first, _ = builder.build_package(APP, head, a)
            second, _ = builder.build_package(APP, head, b)
            checked, _ = builder.verify_package(a)
            self.assertEqual(first, second)
            self.assertEqual(first, checked)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            self.assertEqual(first["component"]["id"], "activity")
            self.assertEqual(first["entrypoint"], "system/apps/activity/src/runtime.mjs")
            self.assertFalse(first["activation_allowed"])
            self.assertFalse(first["native_adapters_packaged"])
            self.assertTrue(first["signature_required_before_activation"])


if __name__ == "__main__":
    unittest.main()
