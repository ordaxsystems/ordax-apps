import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "ordax_presentation_package_test_fixture", ROOT / "tests" / "test_app_package_builder.py"
)
helper = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(helper)
builder = helper.builder
write_json = helper.write_json
source_fixture = helper.fixture
SOURCE_COMMIT = helper.SOURCE_COMMIT

BASE = {
    "schema": "ordax.app-presentation-manifest/1",
    "appId": "fixture",
    "appVersion": "0.1.0",
    "authority": "none",
    "sourceLocale": "pt-BR",
    "description": "Aplicativo de teste.",
    "monogram": "FX",
    "singleton": True,
    "translations": {"en-US": {"title": "Fixture", "description": "Test app."}},
}


class AppPresentationContractTests(unittest.TestCase):
    def test_build_and_verify_share_the_same_presentation_contract(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = source_fixture(root)
            write_json(app / "presentation" / "manifest.json", BASE)
            package = root / "fixture.zip"
            builder.build_package(app, SOURCE_COMMIT, package)
            verified, _ = builder.verify_package(package)
            self.assertEqual(verified["component"]["id"], "fixture")
            with zipfile.ZipFile(package) as archive:
                member = "system/apps/fixture/presentation/manifest.json"
                self.assertIn(member, archive.namelist())
                parsed = builder.presentation_contract.validate_manifest_bytes(
                    archive.read(member), app_id="fixture", version="0.1.0"
                )
                self.assertEqual(parsed["authority"], "none")

    def test_builder_rejects_identity_authority_and_translation_drift(self):
        changes = [
            {"authority": "install"},
            {"appVersion": "0.9.0"},
            {"appId": "another-app"},
            {"sourceLocale": "bad_locale"},
            {"singleton": "true"},
            {"permissions": ["filesystem"]},
            {"translations": {"pt-BR": {"title": "Duplicado", "description": "Duplicado"}}},
            {"translations": {"en-US": {"title": "X", "description": "Y", "capabilities": []}}},
        ]
        for changed in changes:
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                app = source_fixture(root)
                write_json(app / "presentation" / "manifest.json", {**BASE, **changed})
                package = root / "fixture.zip"
                with self.assertRaisesRegex(builder.AppPackageError, "presentation manifest"):
                    builder.build_package(app, SOURCE_COMMIT, package)
                self.assertFalse(package.exists())

    def test_presentation_directory_and_bytes_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = source_fixture(root)
            (app / "presentation").mkdir()
            with self.assertRaises(builder.AppPackageError):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")
        raw = json.dumps(BASE, ensure_ascii=False).encode("utf-8")
        self.assertEqual(
            builder.presentation_contract.validate_manifest_bytes(
                raw, app_id="fixture", version="0.1.0"
            )["appId"],
            "fixture",
        )
        for payload in [
            b"{}",
            b'{"schema":"x","schema":"y"}',
            b"\xff",
            b" " * (builder.presentation_contract.MAX_MANIFEST_BYTES + 1),
        ]:
            with self.subTest(payload=payload[:25]):
                with self.assertRaises(builder.presentation_contract.PresentationContractError):
                    builder.presentation_contract.validate_manifest_bytes(
                        payload, app_id="fixture", version="0.1.0"
                    )


if __name__ == "__main__":
    unittest.main()
