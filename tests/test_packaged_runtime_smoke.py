"""G2 regression tests: real package extraction, runtime identity and fail-closed ports."""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import verify_packaged_runtimes as smoke  # noqa: E402

fixture_spec = importlib.util.spec_from_file_location(
    "readiness_fixtures", ROOT / "tests" / "test_audit_app_readiness.py"
)
fixtures = importlib.util.module_from_spec(fixture_spec)
assert fixture_spec.loader is not None
fixture_spec.loader.exec_module(fixtures)

COMMIT = "a" * 40


def write_runtime(root: Path, *, component_id: str = "alpha",
                  version: str = "0.1.0", refuses_host: bool = True) -> None:
    action = (
        'throw new TypeError("host lifecycle is required")'
        if refuses_host else 'return {destroy() {}}'
    )
    (root / "apps" / "alpha" / "src" / "runtime.mjs").write_text(
        "export const componentRuntime = Object.freeze({"
        '"schema":"ordax.component-runtime/1",'
        f'"componentId":{json.dumps(component_id)},'
        f'"version":{json.dumps(version)},'
        f"async mount(){{{action}}}"
        "});\n",
        encoding="utf-8",
    )


class PackagedRuntimeTests(unittest.TestCase):
    def test_valid_packaged_entrypoint_imports_and_denies_missing_host_ports(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures.make_workspace(root, ["alpha", "studio", "files"])
            fixtures.make_app(root)
            fixtures.make_app(root, "studio", compatibility=False)
            write_runtime(root)
            report = smoke.run_audit(root, COMMIT)
            self.assertEqual(report["summary"]["packaged_modules_verified"], 1)
            self.assertEqual(report["summary"]["not_assessed"], 2)
            self.assertEqual(report["summary"]["host_mounts_verified"], 0)
            self.assertEqual(report["summary"]["production_releases_verified"], 0)
            self.assertEqual(report["apps"][0]["evidence"]["component_version"], "0.1.0")
            self.assertEqual(report["apps"][1]["status"], "not-assessed-no-package-boundary")
            self.assertEqual(report["apps"][2]["status"], "not-assessed-no-canonical-source")
            self.assertFalse(list(root.rglob("*.zip")))

    def test_prebuilt_verified_package_reuses_same_smoke_without_rebuilding(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures.make_workspace(root, ["alpha"])
            fixtures.make_app(root)
            write_runtime(root)
            package = root / "candidate.zip"
            manifest, _ = smoke.builder.build_package(root / "apps" / "alpha", COMMIT, package)
            before = package.read_bytes()
            evidence = smoke.probe_verified_package(
                package, "alpha", root / "smoke", expected_manifest=manifest,
            )
            self.assertEqual(evidence["module_import"], "verified")
            self.assertEqual(evidence["missing_host_ports"], "rejected")
            self.assertEqual(evidence["component_version"], "0.1.0")
            self.assertEqual(package.read_bytes(), before)
            imported = smoke.probe_verified_package(
                package, "alpha", root / "import-only",
                expected_manifest=manifest, probe_mode="import-only",
            )
            self.assertEqual(imported["module_import"], "verified")
            self.assertEqual(imported["missing_host_ports"], "not-assessed")
            with self.assertRaisesRegex(smoke.RuntimeSmokeError, "unsupported packaged runtime probe mode"):
                smoke.probe_verified_package(
                    package, "alpha", root / "invalid-probe", probe_mode="skip-all",
                )
            with self.assertRaisesRegex(smoke.RuntimeSmokeError, "identity or manifest drifted"):
                smoke.probe_verified_package(package, "other", root / "other-smoke")
            with self.assertRaisesRegex(smoke.RuntimeSmokeError, "output is not empty"):
                smoke.probe_verified_package(package, "alpha", root / "smoke")

    def test_prebuilt_package_refuses_missing_host_port_denial_regression(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures.make_workspace(root, ["alpha"])
            fixtures.make_app(root)
            write_runtime(root, refuses_host=False)
            package = root / "candidate.zip"
            smoke.builder.build_package(root / "apps" / "alpha", COMMIT, package)
            with self.assertRaisesRegex(smoke.RuntimeSmokeError, "mounted without mandatory host ports"):
                smoke.probe_verified_package(package, "alpha", root / "smoke")

    def test_manifest_runtime_version_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures.make_workspace(root, ["alpha"])
            fixtures.make_app(root)
            write_runtime(root, version="0.9.0")
            with self.assertRaisesRegex(smoke.RuntimeSmokeError, "version differs"):
                smoke.run_audit(root, COMMIT)

    def test_manifest_runtime_identity_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures.make_workspace(root, ["alpha"])
            fixtures.make_app(root)
            write_runtime(root, component_id="other")
            with self.assertRaisesRegex(smoke.RuntimeSmokeError, "identity drifted"):
                smoke.run_audit(root, COMMIT)

    def test_runtime_accepting_empty_host_ports_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures.make_workspace(root, ["alpha"])
            fixtures.make_app(root)
            write_runtime(root, refuses_host=False)
            with self.assertRaisesRegex(smoke.RuntimeSmokeError, "mounted without mandatory host ports"):
                smoke.run_audit(root, COMMIT)

    def test_runtime_with_forbidden_import_is_rejected_before_execution(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixtures.make_workspace(root, ["alpha"])
            fixtures.make_app(root)
            write_runtime(root)
            with (root / "apps" / "alpha" / "src" / "runtime.mjs").open("a", encoding="utf-8") as out:
                out.write('import "node:fs";\n')
            with self.assertRaisesRegex(smoke.RuntimeSmokeError, "bare/remote import"):
                smoke.run_audit(root, COMMIT)


if __name__ == "__main__":
    unittest.main()
