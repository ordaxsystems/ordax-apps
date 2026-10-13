"""Internet Gate B: verify transferred source, SDK provenance and dependency closure."""
import hashlib
import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "apps/internet"
MIGRATION = ROOT / "migrations/internet.externalization.json"
TRANSFER = ROOT / "migrations/internet.gate-b-transfer-map.json"
SNAPSHOT = ROOT / "migrations/internet.source-snapshot.json"
PROVENANCE = APP / "sdk-provenance.json"
IMPORTS = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]|\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]""")


def blob_hash(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def audit(root=ROOT):
    app = root / "apps/internet"
    m = json.loads((root / "migrations/internet.externalization.json").read_text("utf-8"))
    plan = json.loads((root / "migrations/internet.gate-b-transfer-map.json").read_text("utf-8"))
    snap = json.loads((root / "migrations/internet.source-snapshot.json").read_text("utf-8"))
    prov = json.loads((app / "sdk-provenance.json").read_text("utf-8"))
    manifest = json.loads((app / "app.json").read_text("utf-8"))
    assert m["source_of_truth_state"] == "ordax-apps-canonical"
    assert m["source_repository_current"] == "ordaxsystems/ordax-apps"
    assert m["source_cutover"]["platform_absence_proven_at"] == "cba650185d890dc29ab266c95997f8d284da0ed6"
    assert not m["distribution_activation_allowed"]
    assert not m["gate_status"]["component_package_install_verified"]
    assert not m["gate_status"]["rollback_verified"]
    assert len(snap["files"]) == len(plan["mappings"]) == 13
    assert {x["source"] for x in plan["mappings"]} == {x["path"] for x in snap["files"]}
    assert all(re.fullmatch(r"[0-9a-f]{40}", x["blob_sha"]) for x in snap["files"])
    assert manifest["id"] == "internet" and manifest["owner"] == "ordaxsystems/ordax-apps"
    assert manifest["releaseMode"] == "component-slot" and manifest["version"] == "0.3.0"
    assert prov["sdk_bundle_version"] == "1.18.0"
    assert prov["source_commit"] == "d4061166b86c6601dbf75f47ba2c5981d0586804"
    assert len(prov["contracts"]) == 24
    sdk_paths = set()
    for item in prov["contracts"]:
        p = root / item["target"]
        assert p.is_relative_to(app) and p.is_file() and not p.is_symlink()
        assert p.name == item["name"] + ".mjs"
        assert blob_hash(p.read_bytes()) == item["git_blob_sha"], item["target"]
        assert str(p) not in sdk_paths
        sdk_paths.add(str(p))
    for mapping in plan["mappings"]:
        target = root / mapping["target"]
        assert target.is_relative_to(app) and target.is_file() and not target.is_symlink()
    modules = list(app.rglob("*.mjs"))
    assert len(modules) >= 32  # app source, Intelligence manifest and SDK contract closure
    for module in modules:
        contents = module.read_text("utf-8")
        assert not re.search(r"""(?:from|import)\s*["\'][^"\']*system/apps/internet/""", contents), module
        for match in IMPORTS.finditer(contents):
            value = match.group(1) or match.group(2)
            if not value.startswith("."):
                assert not value.startswith(("system/", "file:", "/", "../system")), (module, value)
                continue
            expected = (module.parent / value).resolve()
            assert expected.is_relative_to(app.resolve()), (module, value)
            assert expected.is_file(), (module, value)
    runtime = (app / "src/runtime.mjs").read_text("utf-8")
    ai = (app / "ai/manifest.mjs").read_text("utf-8")
    assert 'import appManifest from "../app.json"' in runtime
    assert 'import appManifest from "../app.json"' in ai
    assert 'new URL("../assets/internet.css", import.meta.url)' in runtime
    return len(modules)


class InternetGateBTests(unittest.TestCase):
    def test_manifest_snapshot_sdk_and_graph(self):
        self.assertGreaterEqual(audit(), 32)

    def test_native_activation_remains_denied(self):
        state = json.loads(MIGRATION.read_text("utf-8"))
        self.assertFalse(state["distribution_activation_allowed"])
        self.assertFalse(state["gate_status"]["component_package_install_verified"])
        self.assertFalse(state["gate_status"]["rollback_verified"])

    def test_real_esm_loader_resolves_transferred_runtime(self):
        import shutil
        if not shutil.which("node"):
            self.fail("Node runtime required for native module import verification")
        code = ('import("./apps/internet/src/runtime.mjs").then(m => { '
                'if(m.componentRuntime?.componentId !== "internet" || '
                'm.componentRuntime?.version !== "0.3.0") process.exitCode=1; '
                '}).catch(e => { console.error(e); process.exitCode=1; });')
        r = subprocess.run(["node", "--input-type=module", "-e", code],
                           cwd=ROOT, text=True, capture_output=True, timeout=15)
        self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == "__main__":
    unittest.main()
