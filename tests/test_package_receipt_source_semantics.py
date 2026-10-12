"""Received packages must satisfy canonical source validation even after hash forgery."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "package_receipt_source_fixtures", ROOT / "tests" / "test_app_package_builder.py",
)
fixtures = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(fixtures)
builder = fixtures.builder
APP_ID = "fixture"
PREFIX = f"system/apps/{APP_ID}/"


def forge_package(original: Path, output: Path, replacements: dict[str, bytes],
                  mutate_manifest=None) -> None:
    """Rewrite a structurally clean ZIP with every changed file hash recomputed."""
    with zipfile.ZipFile(original) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    manifest = json.loads(parts["component-package.json"])
    for member, payload in replacements.items():
        assert member in parts
        parts[member] = payload
        record, = [record for record in manifest["files"] if record["path"] == member]
        record["sha256"] = hashlib.sha256(payload).hexdigest()
        record["size"] = len(payload)
    if mutate_manifest:
        mutate_manifest(manifest)
    parts["component-package.json"] = builder.canonical_json_bytes(manifest)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name in sorted(parts):
            archive.writestr(builder.zip_info(name), parts[name])


class PackageReceiptSourceSemanticsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.app = fixtures.fixture(self.root)
        self.original = self.root / "fixture.zip"
        builder.build_package(self.app, fixtures.SOURCE_COMMIT, self.original)
        self.forged = self.root / "reconstructed.zip"

    def test_receipt_succeeds_from_verified_zip_without_source_tree(self):
        shutil.rmtree(self.app)
        manifest, _ = builder.verify_package(self.original)
        self.assertEqual(manifest["component"]["id"], APP_ID)

    def test_self_consistent_forged_app_owner_is_rejected(self):
        app = json.loads((self.app / "app.json").read_text(encoding="utf-8"))
        app["owner"] = "foreign/owner"
        forge_package(
            self.original, self.forged,
            {PREFIX + "app.json": json.dumps(app).encode("utf-8")},
        )
        with self.assertRaisesRegex(builder.AppPackageError, "owner must be"):
            builder.verify_package(self.forged)

    def test_self_consistent_forged_title_is_rejected_against_component_identity(self):
        app = json.loads((self.app / "app.json").read_text(encoding="utf-8"))
        app["title"] = "A different app"
        forge_package(
            self.original, self.forged,
            {PREFIX + "app.json": json.dumps(app).encode("utf-8")},
        )
        with self.assertRaisesRegex(builder.AppPackageError, "manifest identity differs"):
            builder.verify_package(self.forged)

    def test_receipt_rejects_forged_remote_import_after_hashes_recomputed(self):
        original = (self.app / "src" / "runtime.mjs").read_text(encoding="utf-8")
        payload = ('import "node:fs";\n' + original).encode("utf-8")
        forge_package(
            self.original, self.forged, {PREFIX + "src/runtime.mjs": payload},
        )
        with self.assertRaisesRegex(builder.AppPackageError, "bare/remote import"):
            builder.verify_package(self.forged)

    def test_receipt_rejects_forged_missing_relative_module(self):
        original = (self.app / "src" / "runtime.mjs").read_text(encoding="utf-8")
        payload = ('import "./nonexistent.mjs";\n' + original).encode("utf-8")
        forge_package(
            self.original, self.forged, {PREFIX + "src/runtime.mjs": payload},
        )
        with self.assertRaisesRegex(builder.AppPackageError, "not self-contained"):
            builder.verify_package(self.forged)

    def test_receipt_rejects_forged_extra_package_manifest_authority(self):
        forge_package(
            self.original, self.forged, {},
            mutate_manifest=lambda manifest: manifest.update({"install_authority": True}),
        )
        with self.assertRaisesRegex(builder.AppPackageError, "manifest identity differs"):
            builder.verify_package(self.forged)

    def test_receipt_rejects_forged_invalid_app_json_even_with_new_digest(self):
        forge_package(
            self.original, self.forged, {PREFIX + "app.json": b"{bad json"},
        )
        with self.assertRaisesRegex(builder.AppPackageError, "app.json is invalid"):
            builder.verify_package(self.forged)


if __name__ == "__main__":
    unittest.main()
