"""Files portable layout proof: no second source tree or install authority."""
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from verify_files_cutover import FilesCutoverError  # noqa: E402
from verify_files_portable_layout import (  # noqa: E402
    derive_layout,
    ENTRYPOINT_BYTES,
    COMPONENT_RUNTIME_SOURCE,
    PACKAGE_RUNTIME_ENTRYPOINT,
    PACKAGE_PROVIDER_ENTRYPOINT,
    PROVIDER_ENTRYPOINT_BYTES,
)


def sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def fixture(root):
    source, sdk = root / "platform", root / "sdk"
    files = {
        "system/apps/files/app.mjs": 'import "../../contracts/first-party-app.mjs";\nimport "./component.mjs";\n',
        "system/apps/files/component.mjs": "export const component = true;\n",
        "system/surface/ui/file-space-controls.mjs": 'import "../../contracts/file-space.mjs";\n',
        "system/apps/files/actions/manifest.mjs": 'export const action = "files.browse";\n',
        "system/apps/files/actions/providers/files-native.mjs": 'export const createFilesApplicationActionProvider = () => ({});\n',
        "system/surface/ui/files-component-runtime.mjs": 'export const style = new URL("./files.css", import.meta.url).href;\n',
        "system/surface/ui/files.css": ".files {display:block;}\n",
    }
    contracts = {
        "system/contracts/first-party-app.mjs": 'import "./file-space.mjs";\n',
        "system/contracts/file-space.mjs": "export const schema = 11;\n",
    }
    for base, records in ((source, files), (sdk, contracts)):
        for name, body in records.items():
            path = base / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")
    inventory = {"commit": "a" * 40, "files": [
        {"path": name, "git_blob_sha": sha(body.encode())} for name, body in sorted(files.items())
    ]}
    bundle = {"bundle_version": "1.16.0", "contracts": [
        {"source_path": name, "source_git_blob": sha(body.encode())}
        for name, body in sorted(contracts.items())
    ]}
    audit = {"sdk_boundary_clean": True, "source_commit": inventory["commit"],
             "sdk_bundle_version": "1.16.0",
             "public_contracts": ["system/contracts/first-party-app.mjs"],
             "transitive_public_contracts": ["system/contracts/file-space.mjs"]}
    return source, sdk, inventory, bundle, audit


class PortableFilesLayoutTests(unittest.TestCase):
    def test_pinned_source_and_transitive_sdk_keep_imports_without_rewriting(self):
        with tempfile.TemporaryDirectory() as temp:
            source, sdk, inventory, bundle, audit = fixture(Path(temp))
            report = derive_layout(source, sdk, inventory, bundle, audit)
            paths = {entry["package_path"] for entry in report["source_modules_and_assets"]}
            self.assertIn("src/system/apps/files/app.mjs", paths)
            self.assertIn("src/system/contracts/first-party-app.mjs", paths)
            self.assertIn("src/system/contracts/file-space.mjs", paths)
            self.assertIn("src/system/surface/ui/files.css", paths)
            self.assertTrue(report["source_graph_self_contained"])
            self.assertTrue(report["canonical_package_source_graph_verified"])
            self.assertEqual(report["proposed_entrypoint"], PACKAGE_RUNTIME_ENTRYPOINT)
            self.assertEqual(report["component_runtime_module"], COMPONENT_RUNTIME_SOURCE)
            self.assertEqual(report["entrypoint_sha256"], hashlib.sha256(ENTRYPOINT_BYTES).hexdigest())
            self.assertEqual(report["proposed_provider_entrypoint"], PACKAGE_PROVIDER_ENTRYPOINT)
            self.assertEqual(report["provider_entrypoint_sha256"],
                             hashlib.sha256(PROVIDER_ENTRYPOINT_BYTES).hexdigest())
            self.assertTrue(report["provider_entrypoint_generated_for_validation_only"])
            self.assertTrue(report["entrypoint_generated_for_validation_only"])
            self.assertIn(b"export { componentRuntime }", ENTRYPOINT_BYTES)
            self.assertEqual(report["app_source_count"], 7)
            self.assertEqual(report["component_runtime_module"], "src/system/surface/ui/files-component-runtime.mjs")
            self.assertEqual(report["sdk_contract_count"], 2)
            self.assertFalse(report["runtime_entrypoint_provided"])
            self.assertFalse(report["package_built"])
            self.assertFalse(report["source_cutover_authorized"])
            self.assertEqual(report["distribution_activation"], "blocked")
            self.assertFalse((Path(temp) / "apps/files").exists())

    def test_runtime_entrypoint_stays_virtual_and_not_duplicated(self):
        with tempfile.TemporaryDirectory() as temp:
            source, sdk, inventory, bundle, audit = fixture(Path(temp))
            result = derive_layout(source, sdk, inventory, bundle, audit)
            self.assertNotIn(PACKAGE_RUNTIME_ENTRYPOINT,
                             [record["package_path"] for record in result["source_modules_and_assets"]])
            self.assertNotIn(PACKAGE_PROVIDER_ENTRYPOINT,
                             [record["package_path"] for record in result["source_modules_and_assets"]])
            self.assertFalse((source / PACKAGE_RUNTIME_ENTRYPOINT).exists())
            self.assertFalse((sdk / PACKAGE_RUNTIME_ENTRYPOINT).exists())
            self.assertFalse((source / PACKAGE_PROVIDER_ENTRYPOINT).exists())
            self.assertFalse((Path(temp) / "apps" / "files").exists())
            self.assertFalse(result["external_app_manifest_provided"])
            self.assertFalse(result["runtime_entrypoint_provided"])
            self.assertFalse(result["package_built"])

    def test_missing_canonical_action_provider_cannot_be_hidden_by_virtual_wrapper(self):
        with tempfile.TemporaryDirectory() as temp:
            source, sdk, inventory, bundle, audit = fixture(Path(temp))
            inventory["files"] = [
                record for record in inventory["files"]
                if record["path"] != "system/apps/files/actions/providers/files-native.mjs"
            ]
            with self.assertRaisesRegex(FilesCutoverError, "action provider is absent"):
                derive_layout(source, sdk, inventory, bundle, audit)

    def test_builder_validator_is_called_and_does_not_accept_partial_module_graph(self):
        with tempfile.TemporaryDirectory() as temp:
            source, sdk, inventory, bundle, audit = fixture(Path(temp))
            # The canonical runtime module is mandatory for the proposed re-export
            # entrypoint, even if an erroneous boundary report claimed portability.
            inventory["files"] = [
                record for record in inventory["files"]
                if record["path"] != "system/surface/ui/files-component-runtime.mjs"
            ]
            with self.assertRaisesRegex(FilesCutoverError, "component runtime is absent"):
                derive_layout(source, sdk, inventory, bundle, audit)

    def test_tampered_app_and_sdk_blobs_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            source, sdk, inventory, bundle, audit = fixture(Path(temp))
            changed = source / "system/apps/files/component.mjs"
            changed.write_text("export const component = false;\n")
            with self.assertRaisesRegex(FilesCutoverError, "identity mismatch"):
                derive_layout(source, sdk, inventory, bundle, audit)
            changed.write_text("export const component = true;\n")
            changed_sdk = sdk / "system/contracts/file-space.mjs"
            changed_sdk.write_text("export const schema = 12;\n")
            with self.assertRaisesRegex(FilesCutoverError, "identity mismatch"):
                derive_layout(source, sdk, inventory, bundle, audit)

    def test_missing_import_and_duplicate_source_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            source, sdk, inventory, bundle, audit = fixture(Path(temp))
            app = source / "system/apps/files/app.mjs"
            content = app.read_text().replace("./component.mjs", "./missing.mjs")
            app.write_text(content)
            inventory["files"][0]["git_blob_sha"] = sha(content.encode())
            with self.assertRaisesRegex(FilesCutoverError, "import does not resolve"):
                derive_layout(source, sdk, inventory, bundle, audit)
            app.write_text(content.replace("./missing.mjs", "./component.mjs"))
            inventory["files"][0]["git_blob_sha"] = sha(app.read_bytes())
            inventory["files"].append(dict(inventory["files"][0]))
            with self.assertRaisesRegex(FilesCutoverError, "duplicate paths"):
                derive_layout(source, sdk, inventory, bundle, audit)


if __name__ == "__main__":
    unittest.main()
