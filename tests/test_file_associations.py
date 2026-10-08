from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(value)
    return value


fixture_module = module("association_package_fixtures", ROOT / "tests" / "test_app_package_builder.py")
builder = fixture_module.builder
source_fixture = fixture_module.fixture
write_json = fixture_module.write_json
associations_audit = module("ordax_file_associations_audit", ROOT / "tools" / "verify_file_associations.py")
CONTRACT = module("association_contract_tests", ROOT / "tools" / "app-package" / "association_contract.py")


def association(app_id: str = "fixture", version: str = "0.1.0", ext=None) -> dict:
    return {
        "schema": CONTRACT.SCHEMA,
        "appId": app_id,
        "appVersion": version,
        "authority": "none",
        "role": "viewer",
        "extensions": ["txt"] if ext is None else ext,
    }


class AssociationSingleSourceTests(unittest.TestCase):
    def test_built_and_received_package_use_same_canonical_validator(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = source_fixture(root)
            write_json(app / "associations" / "manifest.json", association())
            package = root / "fixture.zip"
            builder.build_package(app, fixture_module.SOURCE_COMMIT, package)
            manifest, _ = builder.verify_package(package)
            self.assertEqual(manifest["component"]["id"], "fixture")
            with zipfile.ZipFile(package) as archive:
                self.assertIn("system/apps/fixture/associations/manifest.json", archive.namelist())

    def test_build_rejects_unsafe_manifest_semantics(self):
        mutations = [
            {"authority": "install"},
            {"role": "editor"},
            {"appVersion": "9.9.9"},
            {"appId": "other-app"},
            {"extensions": ["txt", "txt"]},
            {"extensions": ["webp", "png"]},
            {"extensions": ["../danger"]},
            {"extensions": [4]},
            {"unexpected": "extra"},
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                app = source_fixture(root)
                write_json(app / "associations" / "manifest.json", {**association(), **mutation})
                with self.assertRaisesRegex(builder.AppPackageError, "association manifest"):
                    builder.build_package(app, fixture_module.SOURCE_COMMIT, root / "fixture.zip")
                self.assertFalse((root / "fixture.zip").exists())

    def test_build_rejects_directory_without_manifest_and_dangling_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = source_fixture(root)
            (app / "associations").mkdir()
            (app / "associations" / "other.txt").write_text("not a manifest")
            with self.assertRaisesRegex(builder.AppPackageError, "association manifest"):
                builder.build_package(app, fixture_module.SOURCE_COMMIT, root / "fixture.zip")
            (app / "associations" / "manifest.json").symlink_to(app / "absent.json")
            with self.assertRaisesRegex(builder.AppPackageError, "association manifest"):
                builder.build_package(app, fixture_module.SOURCE_COMMIT, root / "fixture.zip")

    def test_package_receipt_rejects_semantic_forgery_even_with_recomputed_sha(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = source_fixture(root)
            write_json(app / "associations" / "manifest.json", association())
            original = root / "fixture.zip"
            builder.build_package(app, fixture_module.SOURCE_COMMIT, original)
            with zipfile.ZipFile(original) as archive:
                contents = {name: archive.read(name) for name in archive.namelist()}
            item = "system/apps/fixture/associations/manifest.json"
            contents[item] = json.dumps({**association(), "authority": "installation"}, sort_keys=True).encode()
            manifest = json.loads(contents["component-package.json"])
            records = {record["path"]: record for record in manifest["files"]}
            records[item]["size"] = len(contents[item])
            records[item]["sha256"] = hashlib.sha256(contents[item]).hexdigest()
            contents["component-package.json"] = builder.canonical_json_bytes(manifest)
            forged = root / "forged.zip"
            with zipfile.ZipFile(forged, "w", compression=zipfile.ZIP_STORED) as archive:
                for name, data in sorted(contents.items()):
                    archive.writestr(builder.zip_info(name), data)
            with self.assertRaisesRegex(builder.AppPackageError, "association manifest"):
                builder.verify_package(forged)

    def test_workspace_audit_rejects_dangling_symlink_and_collision(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            apps = root / "apps"
            apps.mkdir()
            app_a = source_fixture(root)
            write_json(app_a / "associations" / "manifest.json", association())
            old_apps = associations_audit.APPS
            associations_audit.APPS = apps
            try:
                associations_audit.main()
                dangling = app_a / "associations" / "manifest.json"
                dangling.unlink()
                dangling.symlink_to(app_a / "missing.json")
                with self.assertRaisesRegex(SystemExit, "regular non-symlink"):
                    associations_audit.main()
                dangling.unlink()
                write_json(dangling, association())
                another = apps / "second"
                another.mkdir()
                write_json(another / "app.json", {"id": "second", "version": "0.1.0"})
                write_json(another / "associations" / "manifest.json", association("second"))
                with self.assertRaisesRegex(SystemExit, "claimed by both"):
                    associations_audit.main()
                (another / "associations" / "manifest.json").unlink()
                (another / "associations").rmdir()
                another.rmdir() if False else None
                linked = apps / "linked"
                linked.symlink_to(app_a, target_is_directory=True)
                with self.assertRaisesRegex(SystemExit, "must not be a symlink"):
                    associations_audit.main()
            finally:
                associations_audit.APPS = old_apps


if __name__ == "__main__":
    unittest.main()
