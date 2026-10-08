"""Offline G1 contract tests: app compatibility vs pinned SDK contract-major policy."""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import verify_app_sdk_compatibility as sdk  # noqa: E402

fixture_spec = importlib.util.spec_from_file_location(
    "readiness_fixture", ROOT / "tests" / "test_audit_app_readiness.py"
)
fixtures = importlib.util.module_from_spec(fixture_spec)
assert fixture_spec.loader is not None
fixture_spec.loader.exec_module(fixtures)
COMMIT = "a" * 40


def bundle(*schemas: str) -> dict:
    return {
        "$schema": "ordax.app-sdk-bundle/1",
        "bundle_version": "1.12.0",
        "compatibility_policy": "contract-major",
        "authority": "none",
        "contracts": [{"schema": schema} for schema in schemas],
    }


def set_requirements(root: Path, requirements: list[dict]) -> None:
    path = root / "apps" / "alpha" / "compatibility.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    value["requires"] = requirements
    fixtures.write_json(path, value)


def requirement(name: str, minimum: int, maximum: int, optional: bool = False) -> dict:
    return {
        "id": name, "minMajor": minimum, "maxMajor": maximum,
        "optional": optional,
    }


class SdkCompatibilityTests(unittest.TestCase):
    def test_resolves_required_contracts_from_canonical_descriptor(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures.make_workspace(root, ["alpha", "studio", "files"])
            fixtures.make_app(root)
            fixtures.make_app(root, "studio", compatibility=False)
            set_requirements(root, [
                requirement("ordax.localization", 2, 2),
                requirement("ordax.surface-render-lifecycle", 5, 5),
            ])
            report = sdk.audit_compatibility(root, bundle(
                "ordax.localization/2",
                "ordax.surface-render-lifecycle/5",
            ), COMMIT)
            self.assertEqual(report["summary"]["target_count"], 3)
            self.assertEqual(report["summary"]["required_contracts_verified_apps"], 1)
            self.assertEqual(report["summary"]["not_assessed_apps"], 2)
            self.assertEqual(report["summary"]["production_releases_verified"], 0)
            self.assertEqual(report["summary"]["runtime_executions_verified"], 0)
            self.assertEqual(report["apps"][0]["status"], "required-contracts-published")
            self.assertEqual(report["apps"][0]["resolved_requirements"], [
                {"id": "ordax.localization", "major": 2, "optional": False},
                {"id": "ordax.surface-render-lifecycle", "major": 5, "optional": False},
            ])
            self.assertEqual(report["apps"][1]["status"], "not-assessed-no-compatibility")
            self.assertEqual(report["apps"][2]["status"], "not-assessed-no-canonical-source")
            self.assertIn("alpha", sdk.render_markdown(report))

    def test_missing_required_contract_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures.make_workspace(root, ["alpha"])
            fixtures.make_app(root)
            set_requirements(root, [requirement("ordax.file-space", 11, 11)])
            with self.assertRaisesRegex(sdk.SdkCompatibilityError, "alpha: required SDK contract"):
                sdk.audit_compatibility(root, bundle("ordax.localization/2"), COMMIT)

    def test_disjoint_major_range_fails_even_when_contract_name_exists(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures.make_workspace(root, ["alpha"])
            fixtures.make_app(root)
            set_requirements(root, [requirement("ordax.localization", 3, 4)])
            with self.assertRaisesRegex(sdk.SdkCompatibilityError, "ordax.localization/3..4"):
                sdk.audit_compatibility(root, bundle("ordax.localization/2"), COMMIT)

    def test_optional_contract_gap_is_visible_but_does_not_block(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures.make_workspace(root, ["alpha"])
            fixtures.make_app(root)
            set_requirements(root, [
                requirement("ordax.localization", 2, 2),
                requirement("ordax.file-space", 11, 11, optional=True),
            ])
            report = sdk.audit_compatibility(root, bundle("ordax.localization/2"), COMMIT)
            self.assertEqual(report["summary"]["required_contracts_verified_apps"], 1)
            self.assertEqual(report["summary"]["unresolved_optional_requirements"], 1)
            self.assertEqual(report["apps"][0]["unresolved_optional"], ["ordax.file-space/11"])

    def test_highest_published_compatible_major_is_selected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures.make_workspace(root, ["alpha"])
            fixtures.make_app(root)
            set_requirements(root, [requirement("ordax.file-space", 10, 12)])
            report = sdk.audit_compatibility(root, bundle(
                "ordax.file-space/10", "ordax.file-space/11", "ordax.file-space/13"
            ), COMMIT)
            self.assertEqual(report["apps"][0]["resolved_requirements"][0]["major"], 11)

    def test_bundle_schema_policy_and_entries_are_not_trusted(self):
        original = bundle("ordax.localization/2")
        for mutated in [
            {**original, "authority": "install"},
            {**original, "compatibility_policy": "anything"},
            {**original, "contracts": [{"schema": "ordax.localization/0"}]},
            {**original, "contracts": [{"schema": "ordax.localization/2"}, {}]},
            {**original, "contracts": []},
        ]:
            with self.subTest(mutated=mutated):
                with self.assertRaises(sdk.SdkCompatibilityError):
                    sdk.published_contracts(mutated)

    def test_canonical_source_ownership_cannot_be_bypassed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures.make_workspace(root, ["projects"])
            fixtures.make_app(root, "projects")
            fixtures.write_json(root / "migrations" / "projects.externalization.json", {
                "app_id": "projects",
                "source_repository_current": "washingtonmsdj/prototipo-ordax-os",
                "source_cutover_allowed": False,
            })
            with self.assertRaisesRegex(sdk.SdkCompatibilityError, "duplicate app source"):
                sdk.audit_compatibility(root, bundle("ordax.localization/2"), COMMIT)

    def test_commit_identity_must_be_exact(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaisesRegex(sdk.SdkCompatibilityError, "exact 40-hex"):
                sdk.audit_compatibility(root, bundle("ordax.localization/2"), "main")


if __name__ == "__main__":
    unittest.main()
