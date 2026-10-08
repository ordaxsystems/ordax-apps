import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "tools" / "app-package" / "catalog_inventory.py"
spec = importlib.util.spec_from_file_location("catalog_inventory", MODULE_PATH)
catalog_inventory = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(catalog_inventory)


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def manifest(app_id: str, *, release_mode: str = "component-slot") -> dict:
    return {
        "schema": "ordax.component-manifest/1",
        "id": app_id,
        "title": app_id,
        "kind": "app",
        "version": "0.1.0",
        "releaseMode": release_mode,
        "criticality": "optional",
        "failureDomain": "app",
        "restartScope": "component",
        "healthMode": "runtime",
        "owner": "ordaxsystems/ordax-apps",
        "dependencies": [],
    }


def compatibility(app_id: str) -> dict:
    return {
        "schema": "ordax.component-compatibility/1",
        "componentId": app_id,
        "componentVersion": "0.1.0",
        "provides": [{"id": "ordax.component-runtime", "major": 1}],
        "requires": [],
        "state": {
            "id": f"ordax.{app_id}-stateless",
            "writeVersion": 1,
            "readableFrom": 1,
            "readableThrough": 1,
        },
        "authority": "none",
    }


class CatalogInventoryTests(unittest.TestCase):
    def test_discovers_local_and_migration_compatibility_without_allowlist(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            apps = root / "apps"
            migrations = root / "migrations"
            migrations.mkdir()
            write_json(apps / "alpha" / "app.json", manifest("alpha"))
            write_json(apps / "alpha" / "compatibility.json", compatibility("alpha"))
            write_json(apps / "beta" / "app.json", manifest("beta"))
            write_json(migrations / "beta.compatibility.json", compatibility("beta"))
            write_json(apps / "not-ready" / "app.json", manifest("not-ready"))
            write_json(apps / "bundled" / "app.json", manifest("bundled", release_mode="bundled"))

            entries = catalog_inventory.discover_catalog_apps(apps, migrations)
            self.assertEqual([entry["appId"] for entry in entries], ["alpha", "beta"])
            self.assertTrue(entries[0]["compatibility"].endswith("apps/alpha/compatibility.json"))
            self.assertTrue(entries[1]["compatibility"].endswith("migrations/beta.compatibility.json"))

    def test_rejects_ambiguous_compatibility_ssot(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            apps = root / "apps"
            migrations = root / "migrations"
            migrations.mkdir()
            write_json(apps / "alpha" / "app.json", manifest("alpha"))
            write_json(apps / "alpha" / "compatibility.json", compatibility("alpha"))
            write_json(migrations / "alpha.compatibility.json", compatibility("alpha"))
            with self.assertRaisesRegex(catalog_inventory.CatalogInventoryError, "ambiguous"):
                catalog_inventory.discover_catalog_apps(apps, migrations)

    def test_rejects_compatibility_identity_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            apps = root / "apps"
            migrations = root / "migrations"
            migrations.mkdir()
            write_json(apps / "alpha" / "app.json", manifest("alpha"))
            wrong = compatibility("alpha")
            wrong["componentId"] = "other"
            write_json(apps / "alpha" / "compatibility.json", wrong)
            with self.assertRaisesRegex(catalog_inventory.CatalogInventoryError, "identity"):
                catalog_inventory.discover_catalog_apps(apps, migrations)


    def test_rejects_symlinked_app_directory_even_when_manifest_is_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            apps = root / "apps"
            apps.mkdir()
            migrations = root / "migrations"
            migrations.mkdir()
            external = root / "external" / "alpha"
            write_json(external / "app.json", manifest("alpha"))
            write_json(external / "compatibility.json", compatibility("alpha"))
            (apps / "alpha").symlink_to(external, target_is_directory=True)
            with self.assertRaisesRegex(catalog_inventory.CatalogInventoryError, "symlink"):
                catalog_inventory.discover_catalog_apps(apps, migrations)

    def test_rejects_symlinked_manifest_or_compatibility_including_dangling(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            apps = root / "apps"
            migrations = root / "migrations"
            migrations.mkdir()
            write_json(root / "external" / "app.json", manifest("alpha"))
            path = apps / "alpha" / "app.json"
            path.parent.mkdir(parents=True)
            path.symlink_to(root / "external" / "app.json")
            write_json(apps / "alpha" / "compatibility.json", compatibility("alpha"))
            with self.assertRaisesRegex(catalog_inventory.CatalogInventoryError, "non-symlink"):
                catalog_inventory.discover_catalog_apps(apps, migrations)

            path.unlink()
            write_json(path, manifest("alpha"))
            compat = apps / "alpha" / "compatibility.json"
            compat.unlink()
            compat.symlink_to(root / "does-not-exist.json")
            with self.assertRaisesRegex(catalog_inventory.CatalogInventoryError, "non-symlink"):
                catalog_inventory.discover_catalog_apps(apps, migrations)

    def test_rejects_nonregular_compatibility_instead_of_silent_skip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            apps = root / "apps"
            migrations = root / "migrations"
            migrations.mkdir()
            write_json(apps / "alpha" / "app.json", manifest("alpha"))
            (apps / "alpha" / "compatibility.json").mkdir()
            with self.assertRaisesRegex(catalog_inventory.CatalogInventoryError, "regular"):
                catalog_inventory.discover_catalog_apps(apps, migrations)

    def test_rejects_symlinked_inventory_roots(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            apps = root / "apps"
            migrations = root / "migrations"
            migrations.mkdir()
            write_json(apps / "alpha" / "app.json", manifest("alpha"))
            write_json(apps / "alpha" / "compatibility.json", compatibility("alpha"))
            alias_apps = root / "apps-alias"
            alias_apps.symlink_to(apps, target_is_directory=True)
            with self.assertRaisesRegex(catalog_inventory.CatalogInventoryError, "real directory"):
                catalog_inventory.discover_catalog_apps(alias_apps, migrations)
            alias_migrations = root / "migrations-alias"
            alias_migrations.symlink_to(migrations, target_is_directory=True)
            with self.assertRaisesRegex(catalog_inventory.CatalogInventoryError, "real directory"):
                catalog_inventory.discover_catalog_apps(apps, alias_migrations)


    def test_rejects_app_fields_builder_would_reject(self):
        mutations = [
            ({"dependencies": ["duplicate", "duplicate"]}, "dependencies"),
            ({"version": "not-semver"}, "version"),
            ({"owner": "foreign/signer"}, "owner"),
            ({"kind": "service"}, "kind"),
            ({"extraAuthority": True}, "fields"),
            ({"title": ""}, "title"),
        ]
        for patch, message in mutations:
            with self.subTest(patch=patch), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                apps, migrations = root / "apps", root / "migrations"
                migrations.mkdir()
                write_json(apps / "alpha" / "app.json", {**manifest("alpha"), **patch})
                write_json(apps / "alpha" / "compatibility.json", compatibility("alpha"))
                with self.assertRaisesRegex(catalog_inventory.CatalogInventoryError, message):
                    catalog_inventory.discover_catalog_apps(apps, migrations)

    def test_rejects_compatibility_contract_and_state_forgery(self):
        cases = [
            ({"provides": [{"id": "ordax.component-runtime", "major": True}]}, "major"),
            ({"provides": [{"id": "ordax.component-runtime", "major": 1}] * 2}, "unique"),
            ({"requires": [{"id": "ordax.other", "minMajor": 1, "maxMajor": 3, "optional": "false"}]}, "optional"),
            ({"state": {"id": "ordax.alpha-stateless", "writeVersion": 3, "readableFrom": 1, "readableThrough": 2}}, "readable range"),
            ({"extraPermission": "install"}, "fields"),
        ]
        for patch, message in cases:
            with self.subTest(patch=patch), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                apps, migrations = root / "apps", root / "migrations"
                migrations.mkdir()
                write_json(apps / "alpha" / "app.json", manifest("alpha"))
                write_json(apps / "alpha" / "compatibility.json", {**compatibility("alpha"), **patch})
                with self.assertRaisesRegex(catalog_inventory.CatalogInventoryError, message):
                    catalog_inventory.discover_catalog_apps(apps, migrations)

    def test_oversized_manifest_and_compatibility_fail_before_eligibility(self):
        for size_target in ("manifest", "compatibility"):
            with self.subTest(size_target=size_target), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                apps, migrations = root / "apps", root / "migrations"
                migrations.mkdir()
                app_path = apps / "alpha" / "app.json"
                compatibility_path = apps / "alpha" / "compatibility.json"
                write_json(app_path, manifest("alpha"))
                write_json(compatibility_path, compatibility("alpha"))
                path = app_path if size_target == "manifest" else compatibility_path
                path.write_bytes(b" " * (64 * 1024 + 1))
                with self.assertRaisesRegex(catalog_inventory.CatalogInventoryError, "size is outside allowed bounds"):
                    catalog_inventory.discover_catalog_apps(apps, migrations)

    def test_catalog_invokes_exact_builder_contract_not_independent_schema(self):
        from unittest import mock
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            apps, migrations = root / "apps", root / "migrations"
            migrations.mkdir()
            write_json(apps / "alpha" / "app.json", manifest("alpha"))
            write_json(apps / "alpha" / "compatibility.json", compatibility("alpha"))
            canonical = catalog_inventory.builder.validate_compatibility
            with mock.patch.object(
                catalog_inventory.builder, "validate_compatibility",
                side_effect=catalog_inventory.builder.AppPackageError("owner contract drift"),
            ) as verify:
                with self.assertRaisesRegex(catalog_inventory.CatalogInventoryError, "owner contract drift"):
                    catalog_inventory.discover_catalog_apps(apps, migrations)
                verify.assert_called_once()
            self.assertEqual(
                [entry["appId"] for entry in catalog_inventory.discover_catalog_apps(apps, migrations)],
                ["alpha"],
            )


if __name__ == "__main__":
    unittest.main()
