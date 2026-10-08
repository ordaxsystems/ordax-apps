"""MVP minimum is a matrix, never a fabricated Store installation claim."""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
MODULE = ROOT / "tools" / "verify_mvp_app_minimum.py"
spec = importlib.util.spec_from_file_location("mvp_app_minimum", MODULE)
minimum = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(minimum)

fixtures_path = ROOT / "tests" / "test_audit_app_readiness.py"
fixtures_spec = importlib.util.spec_from_file_location("readiness_fixtures_for_mvp", fixtures_path)
fixtures = importlib.util.module_from_spec(fixtures_spec)
assert fixtures_spec.loader is not None
fixtures_spec.loader.exec_module(fixtures)


class MvpMinimumTests(unittest.TestCase):
    def fixture(self, root: Path):
        fixtures.make_workspace(root, ["alpha", "studio", "files", "projects", "internet"])
        fixtures.make_app(root, "alpha")
        fixtures.make_app(root, "studio", compatibility=False)
        fixtures.write_json(root / "migrations" / "projects.externalization.json", {
            "app_id": "projects",
            "source_repository_current": "washingtonmsdj/prototipo-ordax-os",
            "source_cutover_allowed": False,
            "distribution_activation_allowed": False,
        })

    def test_all_targets_reported_without_claiming_installation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            result = minimum.audit_mvp_minimum(root, minimum_candidates=1)
            rows = {item["app_id"]: item for item in result["apps"]}
            self.assertEqual(result["summary"]["target_count"], 5)
            self.assertEqual(result["summary"]["unsigned_catalog_inputs"], 1)
            self.assertEqual(result["summary"]["blocked"], 4)
            self.assertEqual(result["summary"]["verified_public_store_installations"], 0)
            self.assertEqual(result["summary"]["production_releases_verified"], 0)
            self.assertEqual(rows["alpha"]["minimum_entry_status"], "unsigned-store-catalog-input")
            self.assertEqual(rows["studio"]["minimum_entry_status"], "blocked-missing-component-package-boundary")
            self.assertEqual(rows["projects"]["minimum_entry_status"], "blocked-platform-source-cutover")
            self.assertEqual(rows["files"]["minimum_entry_status"], "blocked-no-canonical-source")
            self.assertEqual(rows["internet"]["minimum_entry_status"], "blocked-no-canonical-source")
            self.assertTrue(all(row["production_installable"] is False for row in rows.values()))
            self.assertIn("alpha", minimum.markdown(result))
            self.assertIn("projects", minimum.markdown(result))

    def test_quality_floor_stops_silent_catalog_regression(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            with self.assertRaisesRegex(minimum.MvpMinimumError, "regression"):
                minimum.audit_mvp_minimum(root, minimum_candidates=2)

    def test_ambiguous_compatibility_cannot_be_catalogued(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            fixtures.write_json(root / "migrations" / "alpha.compatibility.json", {
                "schema": "ordax.component-compatibility/1",
                "componentId": "alpha", "componentVersion": "0.1.0",
            })
            with self.assertRaisesRegex(minimum.MvpMinimumError, "duplicate compatibility"):
                minimum.audit_mvp_minimum(root)

    def test_store_inventory_cannot_include_unowned_or_unknown_entry(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            invented = {"appId": "ghost", "appRoot": "apps/ghost",
                        "compatibility": "apps/ghost/compatibility.json"}
            with patch.object(minimum, "discover_catalog_apps", return_value=[invented]):
                with self.assertRaisesRegex(minimum.MvpMinimumError, "outside"):
                    minimum.audit_mvp_minimum(root)

    def test_store_inventory_and_metadata_must_match_exactly(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fixture(root)
            with patch.object(minimum, "discover_catalog_apps", return_value=[]):
                with self.assertRaisesRegex(minimum.MvpMinimumError, "diverged"):
                    minimum.audit_mvp_minimum(root)

    def test_negative_and_boolean_quality_floor_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaisesRegex(minimum.MvpMinimumError, "nonnegative"):
                minimum.audit_mvp_minimum(root, minimum_candidates=-1)
            with self.assertRaisesRegex(minimum.MvpMinimumError, "nonnegative"):
                minimum.audit_mvp_minimum(root, minimum_candidates=True)


if __name__ == "__main__":
    unittest.main()
