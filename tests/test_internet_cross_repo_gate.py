"""The source transition accepts only complete, exclusive Git states."""
from __future__ import annotations
import copy
import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "tools/verify_internet_cross_repo_gate.py"
SPEC = importlib.util.spec_from_file_location("internet_cross_repo_gate", SCRIPT)
gate = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(gate)

FILES = {"system/apps/internet/" + str(i) for i in range(12)} | {
    "system/services/i18n/catalog/internet.mjs"
}
HOST = list(gate.REQUIRED_HOST)
DEFAULT_POLICY = {
    "$schema": "prototype-ordax.runtime-component-package-policy/1",
    "canonical_package_source_repository_by_component": {},
    "prelaunch_remove_first_pending": {},
    "supported_components": ["internet", "local-ai-service"],
    "native_loopback_broker_supported_components": ["internet", "notes"],
    "native_loopback_broker_health_mutation_components": ["internet", "notes"],
    "runtime_health_bridge_supported_components": ["internet", "notes"],
}
DEFAULT_REPORT = {
    "schema": "ordax.internet-externalization/1", "source_cutover_allowed": False,
    "distribution_activation_allowed": False, "source_file_count": 13,
    "source_snapshot_ready": True,
    "current_platform_source": {
        "current_platform_commit": "a" * 40, "snapshot_current": True,
        "current_file_count": 13, "changed": [], "added": [], "deleted": [],
    },
    "gate_a_platform_consumers": {
        "schema": "ordax.internet-gate-a-platform-consumers/1",
        "platform_commit": "a" * 40, "owned_source_paths": sorted(FILES),
        "consumer_imports": [{"consumer": "catalog", "source_dependency": "internet"}],
        "literal_source_path_references": [], "ignored_source_symlinks": [],
        "absence_preflight_ready": False, "host_boundary_intact": True,
        "retained_host_paths": HOST,
    },
}


class CrossRepoGateTests(unittest.TestCase):
    def test_live_owner_is_verifiable(self):
        self.assertEqual(gate.verify(copy.deepcopy(DEFAULT_REPORT), copy.deepcopy(DEFAULT_POLICY), FILES),
                         "platform-is-sole-current-owner")

    def test_complete_absence_remains_uninstalled(self):
        report, policy = copy.deepcopy(DEFAULT_REPORT), copy.deepcopy(DEFAULT_POLICY)
        report["current_platform_source"].update(snapshot_current=False,
            current_file_count=0, deleted=sorted(FILES))
        report["gate_a_platform_consumers"].update(owned_source_paths=[], consumer_imports=[],
            literal_source_path_references=[], ignored_source_symlinks=[], absence_preflight_ready=True)
        policy["prelaunch_remove_first_pending"]["internet"] = gate.PENDING
        for key in ("supported_components", "native_loopback_broker_supported_components",
                    "native_loopback_broker_health_mutation_components",
                    "runtime_health_bridge_supported_components"):
            policy[key] = [name for name in policy[key] if name != "internet"]
        self.assertEqual(gate.verify(report, policy, FILES), "platform-source-absent-await-gate-b")
        for injection in (
            lambda r,p: r["gate_a_platform_consumers"]["consumer_imports"].append({"consumer": "old"}),
            lambda r,p: r["current_platform_source"]["deleted"].pop(),
            lambda r,p: p["native_loopback_broker_supported_components"].append("internet"),
            lambda r,p: p["prelaunch_remove_first_pending"]["internet"].update(distribution_activation_allowed=True),
            lambda r,p: p["canonical_package_source_repository_by_component"].update(internet=gate.APP_OWNER),
        ):
            with self.subTest(injection=injection):
                altered, forged = copy.deepcopy(report), copy.deepcopy(policy)
                injection(altered, forged)
                with self.assertRaises(gate.InternetCrossRepoGateError):
                    gate.verify(altered, forged, FILES)

    def test_partial_and_foreign_source_rejected(self):
        report = copy.deepcopy(DEFAULT_REPORT)
        report["current_platform_source"]["changed"] = [sorted(FILES)[0]]
        with self.assertRaises(gate.InternetCrossRepoGateError):
            gate.verify(report, DEFAULT_POLICY, FILES)
        report = copy.deepcopy(DEFAULT_REPORT)
        report["gate_a_platform_consumers"]["platform_commit"] = "b" * 40
        with self.assertRaises(gate.InternetCrossRepoGateError):
            gate.verify(report, DEFAULT_POLICY, FILES)


if __name__ == "__main__":
    unittest.main()
