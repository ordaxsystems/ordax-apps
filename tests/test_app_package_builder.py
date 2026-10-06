import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "tools" / "app-package" / "build.py"

spec = importlib.util.spec_from_file_location("ordax_app_package_builder", BUILDER_PATH)
builder = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(builder)


SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567"


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def fixture(root: Path, *, runtime_source: str = 'import { value } from "./domain.mjs";\nexport const componentRuntime = { value };\n') -> Path:
    app = root / "apps" / "fixture"
    (app / "src").mkdir(parents=True)
    (app / "assets").mkdir(parents=True)
    write_json(
        app / "app.json",
        {
            "schema": "ordax.component-manifest/1",
            "id": "fixture",
            "title": "Fixture",
            "kind": "app",
            "version": "0.1.0",
            "releaseMode": "component-slot",
            "criticality": "optional",
            "failureDomain": "app",
            "restartScope": "component",
            "healthMode": "runtime",
            "owner": "washingtonmsdj/ordax-apps",
            "dependencies": [],
        },
    )
    (app / "src" / "runtime.mjs").write_text(runtime_source, encoding="utf-8")
    (app / "src" / "domain.mjs").write_text("export const value = 7;\n", encoding="utf-8")
    (app / "assets" / "fixture.css").write_text(".fixture { display: block; }\n", encoding="utf-8")
    write_json(
        app / "ai" / "manifest.json",
        {
            "schema": "ordax.app-intelligence-manifest/1",
            "appId": "fixture",
            "appVersion": "0.1.0",
            "authority": "none",
            "execution": "declarative-only",
            "instructions": ["Use o Fixture apenas para os recursos declarados pelo app."],
            "intents": [
                {
                    "id": "fixture.read-value",
                    "description": "Ler o valor de teste do app.",
                    "effect": "read",
                    "confirmation": "none",
                    "parameters": [],
                    "examples": ["Leia o valor do Fixture."],
                }
            ],
        },
    )
    write_json(
        app / "actions" / "manifest.json",
        {
            "schema": "ordax.application-action-manifest/1",
            "appId": "fixture",
            "appVersion": "0.1.0",
            "authority": "none",
            "execution": "proposal-only",
            "capabilities": [
                {
                    "schema": "ordax.application-action-capability/1",
                    "appId": "fixture",
                    "actionId": "fixture.read-value",
                    "title": "Ler valor",
                    "description": "Consultar o valor de teste do Fixture.",
                    "sourceClass": "first-party",
                    "platform": "ordax",
                    "provider": {
                        "kind": "first-party-native",
                        "adapterId": "fixture-native",
                        "revision": "1",
                    },
                    "binding": {"payloadSha256": None},
                    "parameters": [],
                    "riskClass": "read-only",
                    "confirmation": "none",
                    "executionAuthorized": False,
                    "modelDirectExecutionAuthorized": False,
                    "provenance": "ordax-apps:fixture/actions/manifest.json",
                }
            ],
        },
    )
    provider_source = (
        'export const applicationActionProviderArtifact = Object.freeze({\n'
        '  schema: "ordax.application-action-provider-artifact/1",\n'
        '  appId: "fixture",\n'
        '  adapterId: "fixture-native",\n'
        '  revision: "1",\n'
        '  authority: "none",\n'
        '  execution: "unavailable",\n'
        '});\n'
    )
    provider_path = app / "actions" / "providers" / "fixture-native.mjs"
    provider_path.parent.mkdir(parents=True, exist_ok=True)
    provider_path.write_text(provider_source, encoding="utf-8")
    write_json(
        app / "actions" / "providers" / "manifest.json",
        {
            "schema": "ordax.application-action-provider-manifest/1",
            "appId": "fixture",
            "appVersion": "0.1.0",
            "authority": "none",
            "execution": "unavailable",
            "providers": [{
                "kind": "first-party-native",
                "adapterId": "fixture-native",
                "revision": "1",
                "module": "actions/providers/fixture-native.mjs",
                "sha256": builder.sha256_bytes(provider_source.encode("utf-8")),
            }],
        },
    )
    write_json(
        app / "compatibility.json",
        {
            "schema": "ordax.component-compatibility/1",
            "componentId": "fixture",
            "componentVersion": "0.1.0",
            "provides": [],
            "requires": [
                {"id": "ordax.app-data", "minMajor": 1, "maxMajor": 1, "optional": False},
                {"id": "ordax.localization", "minMajor": 1, "maxMajor": 1, "optional": False},
            ],
            "state": {
                "id": "fixture-state",
                "writeVersion": 1,
                "readableFrom": 1,
                "readableThrough": 1,
            },
            "authority": "none",
        },
    )
    return app


class DeterministicAppPackageTests(unittest.TestCase):
    def test_build_is_byte_for_byte_deterministic_and_platform_compatible(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            out_a = root / "out-a"
            out_b = root / "out-b"
            package_a = out_a / "fixture.zip"
            package_b = out_b / "fixture.zip"
            out_a.mkdir()
            out_b.mkdir()

            manifest_a, _ = builder.build_package(app, SOURCE_COMMIT, package_a)
            release_a, compat_a = builder.write_release_v2(package_a, app / "compatibility.json", out_a)
            manifest_b, _ = builder.build_package(app, SOURCE_COMMIT, package_b)
            release_b, compat_b = builder.write_release_v2(package_b, app / "compatibility.json", out_b)

            self.assertEqual(package_a.read_bytes(), package_b.read_bytes())
            self.assertEqual(release_a.read_bytes(), release_b.read_bytes())
            self.assertEqual(compat_a.read_bytes(), compat_b.read_bytes())
            self.assertEqual(manifest_a, manifest_b)

            verified, _ = builder.verify_package(package_a)
            self.assertEqual(verified["entrypoint"], "system/apps/fixture/src/runtime.mjs")
            self.assertEqual(verified["component"]["owner"], "washingtonmsdj/ordax-apps")
            self.assertFalse(verified["activation_allowed"])
            self.assertTrue(verified["signature_required_before_activation"])

            with zipfile.ZipFile(package_a, "r") as archive:
                names = set(archive.namelist())
                self.assertIn("component-package.json", names)
                self.assertIn("system/apps/fixture/app.json", names)
                self.assertIn("system/apps/fixture/src/runtime.mjs", names)
                self.assertIn("system/apps/fixture/src/domain.mjs", names)
                self.assertIn("system/apps/fixture/assets/fixture.css", names)
                self.assertIn("system/apps/fixture/ai/manifest.json", names)
                self.assertIn("system/apps/fixture/actions/manifest.json", names)
                self.assertIn("system/apps/fixture/actions/providers/manifest.json", names)
                self.assertIn("system/apps/fixture/actions/providers/fixture-native.mjs", names)
                self.assertNotIn("system/apps/fixture/compatibility.json", names)

            release = json.loads(release_a.read_text(encoding="utf-8"))
            self.assertEqual(release["$schema"], "prototype-ordax.runtime-component-release/2")
            self.assertEqual(release["source_repository"], "washingtonmsdj/ordax-apps")
            self.assertEqual(release["source_commit"], SOURCE_COMMIT)
            self.assertEqual(release["created_from_ci_recipe"], "runtime-component/package/1")
            self.assertEqual(release["component"]["release_mode"], "component-slot")
            self.assertFalse(release["activation"]["direct_activation_allowed"])
            self.assertTrue(release["activation"]["pending_health_required"])
            self.assertEqual(release["compatibility"]["name"], "fixture.compatibility.json")

    def test_verify_rejects_tampered_package(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            package = root / "fixture.zip"
            builder.build_package(app, SOURCE_COMMIT, package)
            with zipfile.ZipFile(package, "a", compression=zipfile.ZIP_STORED) as archive:
                archive.writestr("system/apps/fixture/src/runtime.mjs", b"tampered")
            with self.assertRaisesRegex(builder.AppPackageError, "duplicated"):
                builder.verify_package(package)

    def test_import_keywords_inside_strings_are_not_treated_as_dependencies(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(
                root,
                runtime_source=(
                    'const mode = "import";\n'
                    'const prose = "from \\"not-a-module\\"";\n'
                    'const dynamic_example = "import(\\\"remote-package\\\")";\n'
                    'import { value } from "./domain.mjs";\n'
                    'export const componentRuntime = { value, mode, prose, dynamic_example };\n'
                ),
            )
            manifest, _ = builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")
            self.assertEqual(manifest["component"]["id"], "fixture")

    def test_regex_literal_with_quotes_is_not_treated_as_a_string(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(
                root,
                runtime_source=(
                    "const count = (value) => value.match(/[\\\\p{L}\\\\p{N}]+(?:[’'][\\\\p{L}\\\\p{N}]+)*/gu)?.length ?? 0;\\n"
                    'import { value } from "./domain.mjs";\\n'
                    "export const componentRuntime = { count, value };\\n"
                ),
            )
            manifest, _ = builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")
            self.assertEqual(manifest["component"]["id"], "fixture")

    def test_dynamic_remote_import_inside_template_expression_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(
                root,
                runtime_source='export const componentRuntime = `\${import("remote-package")}`;\\n',
            )
            with self.assertRaisesRegex(builder.AppPackageError, "bare/remote import"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_literal_dynamic_remote_import_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(
                root,
                runtime_source='export async function load() { return import("remote-package"); }\n',
            )
            with self.assertRaisesRegex(builder.AppPackageError, "bare/remote import"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_export_from_remote_module_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root, runtime_source='export { value } from "remote-package";\n')
            with self.assertRaisesRegex(builder.AppPackageError, "bare/remote import"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_bare_platform_or_remote_import_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root, runtime_source='import "ordax-private-service";\nexport const componentRuntime = {};\n')
            with self.assertRaisesRegex(builder.AppPackageError, "bare/remote import"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_relative_import_may_not_escape_app_root(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root, runtime_source='import "../../outside.mjs";\nexport const componentRuntime = {};\n')
            with self.assertRaisesRegex(builder.AppPackageError, "escapes app ownership"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_missing_relative_import_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root, runtime_source='import "./missing.mjs";\nexport const componentRuntime = {};\n')
            with self.assertRaisesRegex(builder.AppPackageError, "not self-contained"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_manifest_must_be_external_component_slot_owned_by_ordax_apps(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            manifest_path = app / "app.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["owner"] = "washingtonmsdj/prototipo-ordax-os"
            write_json(manifest_path, manifest)
            with self.assertRaisesRegex(builder.AppPackageError, "owner must be"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_first_party_app_requires_ai_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            (app / "ai" / "manifest.json").unlink()
            with self.assertRaisesRegex(builder.AppPackageError, "must provide ai/manifest.json"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_first_party_app_requires_action_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            (app / "actions" / "manifest.json").unlink()
            with self.assertRaisesRegex(
                builder.AppPackageError,
                "must provide actions/manifest.json",
            ):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_first_party_app_requires_provider_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            (app / "actions" / "providers" / "manifest.json").unlink()
            with self.assertRaisesRegex(
                builder.AppPackageError,
                "must provide actions/providers/manifest.json",
            ):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_provider_artifact_hash_and_declared_provider_are_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            provider = app / "actions" / "providers" / "fixture-native.mjs"
            provider.write_text("export const changed = true;\n", encoding="utf-8")
            with self.assertRaisesRegex(builder.AppPackageError, "SHA-256 mismatch"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            manifest_path = app / "actions" / "providers" / "manifest.json"
            value = json.loads(manifest_path.read_text(encoding="utf-8"))
            value["providers"][0]["adapterId"] = "other-native"
            value["providers"][0]["module"] = "actions/providers/other-native.mjs"
            write_json(manifest_path, value)
            with self.assertRaisesRegex(
                builder.AppPackageError,
                "artifact is unavailable|do not exactly cover",
            ):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_provider_manifest_cannot_claim_execution(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            manifest_path = app / "actions" / "providers" / "manifest.json"
            value = json.loads(manifest_path.read_text(encoding="utf-8"))
            value["execution"] = "direct"
            write_json(manifest_path, value)
            with self.assertRaisesRegex(builder.AppPackageError, "cannot grant execution"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_action_manifest_identity_and_authority_are_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            path = app / "actions" / "manifest.json"
            value = json.loads(path.read_text(encoding="utf-8"))
            value["appVersion"] = "0.2.0"
            write_json(path, value)
            with self.assertRaisesRegex(builder.AppPackageError, "identity does not match"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            path = app / "actions" / "manifest.json"
            value = json.loads(path.read_text(encoding="utf-8"))
            value["authority"] = "write"
            write_json(path, value)
            with self.assertRaisesRegex(builder.AppPackageError, "must not carry authority"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_action_manifest_rejects_hidden_raw_authority_and_semantic_drift(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            path = app / "actions" / "manifest.json"
            value = json.loads(path.read_text(encoding="utf-8"))
            value["capabilities"][0]["parameters"] = [
                {
                    "id": "path",
                    "type": "string",
                    "required": True,
                    "maxLength": 1024,
                }
            ]
            write_json(path, value)
            with self.assertRaisesRegex(builder.AppPackageError, "exposes raw authority"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            path = app / "actions" / "manifest.json"
            value = json.loads(path.read_text(encoding="utf-8"))
            value["capabilities"][0]["actionId"] = "fixture.unknown-action"
            write_json(path, value)
            with self.assertRaisesRegex(builder.AppPackageError, "no matching AI intent"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_ai_manifest_identity_must_match_app_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            path = app / "ai" / "manifest.json"
            value = json.loads(path.read_text(encoding="utf-8"))
            value["appId"] = "other"
            write_json(path, value)
            with self.assertRaisesRegex(builder.AppPackageError, "identity does not match"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    def test_ai_manifest_cannot_grant_execution_or_skip_external_confirmation(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            path = app / "ai" / "manifest.json"
            value = json.loads(path.read_text(encoding="utf-8"))
            value["execution"] = "direct"
            write_json(path, value)
            with self.assertRaisesRegex(builder.AppPackageError, "cannot grant execution"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            path = app / "ai" / "manifest.json"
            value = json.loads(path.read_text(encoding="utf-8"))
            value["intents"][0]["effect"] = "external-write"
            value["intents"][0]["confirmation"] = "none"
            write_json(path, value)
            with self.assertRaisesRegex(builder.AppPackageError, "require confirmation policy"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")

    @unittest.skipIf(os.name == "nt", "symlink creation semantics are platform-dependent on Windows")
    def test_symlink_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            app = fixture(root)
            target = app / "assets" / "fixture.css"
            link = app / "assets" / "linked.css"
            link.symlink_to(target)
            with self.assertRaisesRegex(builder.AppPackageError, "symlink"):
                builder.build_package(app, SOURCE_COMMIT, root / "fixture.zip")


if __name__ == "__main__":
    unittest.main()
