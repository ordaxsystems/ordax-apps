"""Tampering tests for Assistant remove-first Gate B planning."""
import copy
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "assistant_gate_b", ROOT / "tools/verify_assistant_gate_b.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
FILES = ("migrations/assistant.externalization.json",
         "migrations/assistant.source-snapshot.json",
         "migrations/assistant.gate-b-transfer-map.json",
         "platform-sdk.lock.json")

class AssistantGateBTests(unittest.TestCase):
    def fixture(self, dest):
        root = Path(dest)
        for item in FILES:
            path = root / item
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / item, path)
        shutil.copytree(ROOT / "apps/assistant", root / "apps/assistant")
        return root

    def mutation(self, root, path, transform):
        target = root / path
        value = json.loads(target.read_text(encoding="utf-8"))
        transform(value)
        target.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")

    def test_real_plan_is_complete_without_fake_execution(self):
        report = gate.audit()
        self.assertEqual(report["source_file_count"], 11)
        self.assertEqual(report["mapped_source_count"], 11)
        self.assertTrue(report["app_source_materialized"])
        self.assertEqual(report["required_sdk_version"], "1.18.0")
        lock = json.loads((ROOT / "platform-sdk.lock.json").read_text(encoding="utf-8"))
        self.assertEqual(report["sdk_version_sufficient"],
                         gate.semver(lock["bundle_version"]) >= (1, 18, 0))
        self.assertFalse(report["sdk_graph_verified"])  # No SDK checkout was passed
        self.assertFalse(report["gate_b_allowed_now"])
        self.assertFalse(report["platform_gate_a_main_proven"])

    def test_incomplete_duplicate_private_escaping_or_unknown_mapping_fails(self):
        mutations = (
            lambda m: m["mappings"].pop(),
            lambda m: m["mappings"].append(copy.deepcopy(m["mappings"][0])),
            lambda m: m["mappings"][0].update(source="system/services/memory/runtime.mjs"),
            lambda m: m["mappings"][0].update(target="apps/assistant/../evil"),
            lambda m: m["mappings"][0].update(operation="copy-host-service"),
        )
        for change in mutations:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as tmp:
                root = self.fixture(tmp)
                self.mutation(root, FILES[2], change)
                with self.assertRaises(gate.AssistantGateError):
                    gate.audit(root)

    def test_activation_flags_are_not_transfer_authorization(self):
        for key, bad_value in (("source_cutover_allowed", False),
                               ("distribution_activation_allowed", True)):
            with tempfile.TemporaryDirectory() as tmp:
                root = self.fixture(tmp)
                self.mutation(root, FILES[0], lambda p: p.update({key: bad_value}))
                with self.assertRaises(gate.AssistantGateError):
                    gate.audit(root)

    def test_no_duplicate_source_even_if_manifest_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.fixture(tmp)
            # Regress the owner metadata without deleting staged source; even
            # a missing manifest must not disguise a duplicate implementation.
            self.mutation(root, FILES[0], lambda p: p.update({
                "source_repository_current": "ordaxsystems/ordax-os",
                "source_of_truth_state": "platform-until-cutover",
                "source_cutover_allowed": False,
            }))
            (root / "apps/assistant/app.json").unlink()
            with self.assertRaisesRegex(gate.AssistantGateError, "second Assistant"):
                gate.audit(root)

    def test_real_source_manifest_version_is_immutable_and_single_owned(self):
        mapping = json.loads((ROOT / FILES[2]).read_text(encoding="utf-8"))
        self.assertEqual(mapping["manifest_replacement"]["version"], "0.1.1")
        self.assertEqual({row["source"] for row in mapping["mappings"] if
                          row["operation"] in gate.MANIFEST_OPS},
                         {"system/apps/assistant/app.mjs",
                          "system/apps/assistant/component.mjs",
                          "system/apps/assistant/version.mjs"})

    def test_virtual_paths_cannot_be_replaced_by_second_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.fixture(tmp)
            self.mutation(root, FILES[2], lambda d:
                          d["mappings"][-1].update(target="apps/assistant/app.json"))
            with self.assertRaises(gate.AssistantGateError):
                gate.audit(root)

    def test_real_main_absence_requires_canonical_source_policy_and_no_runtime_imports(self):
        import subprocess
        def run_git(root, *args):
            return subprocess.run(["git", "-C", str(root), *args],
                                  capture_output=True, text=True, check=True).stdout.strip()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run_git(root, "init", "-q", "-b", "main")
            run_git(root, "config", "user.name", "OrdaX Test")
            run_git(root, "config", "user.email", "test@example.invalid")
            run_git(root, "remote", "add", "origin",
                    "https://github.com/ordaxsystems/ordax-os.git")
            policy = root / "docs/contracts/runtime-component-package.json"
            policy.parent.mkdir(parents=True)
            policy.write_text(json.dumps({
                "canonical_package_source_repository_by_component": {
                    "assistant": "ordaxsystems/ordax-apps",
                },
                "canonical_external_source_repository_by_component": {},
                "native_loopback_broker_supported_components": [],
                "slot_activation_available": False,
            }), encoding="utf-8")
            app = root / "system/apps/catalog.mjs"
            app.parent.mkdir(parents=True)
            app.write_text('export const apps = [];\n', encoding="utf-8")
            run_git(root, "add", ".")
            run_git(root, "commit", "-qm", "first canonical OS base")
            run_git(root, "update-ref", "refs/remotes/origin/main",
                    run_git(root, "rev-parse", "HEAD"))
            baseline = gate.probe_platform_gate_a(root)
            self.assertTrue(baseline["platform_gate_a_main_proven"])
            self.assertEqual(baseline["tracked_assistant_source"], [])
            # A source import is enough to block Gate A, even when the file
            # itself has been removed. Do not accept broken Native consumers.
            app.write_text('import "./assistant/runtime.mjs";\n', encoding="utf-8")
            run_git(root, "add", ".")
            run_git(root, "commit", "-qm", "orphaned app import")
            run_git(root, "update-ref", "refs/remotes/origin/main",
                    run_git(root, "rev-parse", "HEAD"))
            report = gate.probe_platform_gate_a(root)
            self.assertFalse(report["platform_gate_a_main_proven"])
            self.assertEqual(len(report["live_assistant_source_imports"]), 1)
            # A still-tracked Assistant source cannot be reported as cutover.
            app.write_text('export const apps = [];\n', encoding="utf-8")
            old = root / "system/apps/assistant/runtime.mjs"
            old.parent.mkdir(parents=True, exist_ok=True)
            old.write_text("export const runtime = {};\n", encoding="utf-8")
            run_git(root, "add", ".")
            run_git(root, "commit", "-qm", "old source returned")
            run_git(root, "update-ref", "refs/remotes/origin/main",
                    run_git(root, "rev-parse", "HEAD"))
            report = gate.probe_platform_gate_a(root)
            self.assertFalse(report["platform_gate_a_main_proven"])
            self.assertIn("system/apps/assistant/runtime.mjs",
                          report["tracked_assistant_source"])
            # A canonical source owner does not imply that the runtime may
            # install or load the app. Distribution and Native authority stay
            # disabled while this audit proves source ownership only.
            old.unlink()
            current_policy = json.loads(policy.read_text(encoding="utf-8"))
            current_policy["canonical_external_source_repository_by_component"] = {
                "assistant": "ordaxsystems/ordax-apps",
            }
            policy.write_text(json.dumps(current_policy), encoding="utf-8")
            run_git(root, "add", "-A")
            run_git(root, "commit", "-qm", "premature external Assistant authority")
            run_git(root, "update-ref", "refs/remotes/origin/main",
                    run_git(root, "rev-parse", "HEAD"))
            report = gate.probe_platform_gate_a(root)
            self.assertFalse(report["platform_gate_a_main_proven"])
            self.assertFalse(report["canonical_source_policy_fail_closed"])

            # Even after restoring the canonical package owner, enabling any
            # Native install/read path must keep this source-only gate closed.
            current_policy["canonical_external_source_repository_by_component"] = {}
            current_policy["slot_activation_available"] = True
            policy.write_text(json.dumps(current_policy), encoding="utf-8")
            run_git(root, "add", "-A")
            run_git(root, "commit", "-qm", "premature Assistant slot activation")
            run_git(root, "update-ref", "refs/remotes/origin/main",
                    run_git(root, "rev-parse", "HEAD"))
            report = gate.probe_platform_gate_a(root)
            self.assertFalse(report["platform_gate_a_main_proven"])
            self.assertFalse(report["canonical_source_policy_fail_closed"])

            current_policy["slot_activation_available"] = False
            current_policy["native_loopback_broker_supported_components"] = ["assistant"]
            policy.write_text(json.dumps(current_policy), encoding="utf-8")
            run_git(root, "add", "-A")
            run_git(root, "commit", "-qm", "premature Assistant Native broker")
            run_git(root, "update-ref", "refs/remotes/origin/main",
                    run_git(root, "rev-parse", "HEAD"))
            report = gate.probe_platform_gate_a(root)
            self.assertFalse(report["platform_gate_a_main_proven"])
            self.assertFalse(report["canonical_source_policy_fail_closed"])

    def test_security_rules_and_published_contract_floor_are_required(self):
        for key in ("copy_host_memory_service", "inline_private_contracts"):
            with tempfile.TemporaryDirectory() as tmp:
                root = self.fixture(tmp)
                self.mutation(root, FILES[2], lambda p: p["rules"].update({key: True}))
                with self.assertRaises(gate.AssistantGateError):
                    gate.audit(root)
        with tempfile.TemporaryDirectory() as tmp:
            root = self.fixture(tmp)
            self.mutation(root, FILES[0], lambda p: p["target_sdk"]["sdk_contract_source_paths"].pop())
            with self.assertRaises(gate.AssistantGateError):
                gate.audit(root)

    def test_platform_main_invalid_utf8_modules_still_scan_removed_assistant_imports(self):
        import subprocess
        def git(root, *args):
            return subprocess.run(["git", "-C", str(root), *args],
                                  capture_output=True, text=True, check=True).stdout.strip()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            git(root, "init", "-q", "-b", "main")
            git(root, "config", "user.name", "OrdaX Test")
            git(root, "config", "user.email", "test@example.invalid")
            git(root, "remote", "add", "origin",
                "https://github.com/ordaxsystems/ordax-os.git")
            policy = root / "docs/contracts/runtime-component-package.json"
            policy.parent.mkdir(parents=True)
            policy.write_text(json.dumps({
                "canonical_package_source_repository_by_component": {
                    "assistant": "ordaxsystems/ordax-apps",
                },
                "canonical_external_source_repository_by_component": {},
                "native_loopback_broker_supported_components": [],
                "slot_activation_available": False,
            }), encoding="utf-8")
            module = root / "system/apps/catalog.mjs"
            module.parent.mkdir(parents=True)
            # A binary prefix cannot prevent scanning a real ASCII import.
            module.write_bytes(b'\xaa\xbbimport "./assistant/runtime.mjs";\n')
            git(root, "add", ".")
            git(root, "commit", "-qm", "invalid bytes and orphaned import")
            git(root, "update-ref", "refs/remotes/origin/main", git(root, "rev-parse", "HEAD"))
            report = gate.probe_platform_gate_a(root)
            self.assertFalse(report["platform_gate_a_main_proven"])
            self.assertEqual(report["live_assistant_source_imports"], [{
                "module": "system/apps/catalog.mjs",
                "dependency": "system/apps/assistant/runtime.mjs",
            }])
            # Bytes alone must not be falsely interpreted as a live import.
            module.write_bytes(b'\xaa\xbbexport const otherApps = [];\n')
            git(root, "add", ".")
            git(root, "commit", "-qm", "remove orphaned import, keep bytes")
            git(root, "update-ref", "refs/remotes/origin/main", git(root, "rev-parse", "HEAD"))
            report = gate.probe_platform_gate_a(root)
            self.assertTrue(report["platform_gate_a_main_proven"])
            self.assertEqual(report["live_assistant_source_imports"], [])

if __name__ == "__main__":
    unittest.main()
