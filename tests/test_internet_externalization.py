"""Protect the single-source Internet remove-first externalization gate."""
import importlib.util
import json
import subprocess
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/"tools/verify_internet_externalization.py"
spec=importlib.util.spec_from_file_location("internet_externalization_verifier",SCRIPT)
gate=importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(gate)
NAMES=(
    "migrations/internet.externalization.json",
    "migrations/internet.source-snapshot.json",
    "migrations/internet.gate-b-transfer-map.json",
    "platform-sdk.lock.json",
)

class InternetExternalizationTests(unittest.TestCase):
    def fixture(self, root):
        for name in NAMES:
            src=ROOT/name
            dest=root/name
            dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(src,dest)

    def change(self,root,name,transform):
        p=root/name
        doc=json.loads(p.read_text(encoding="utf-8"))
        transform(doc)
        p.write_text(json.dumps(doc,indent=2)+"\n",encoding="utf-8")

    def test_actual_plan_preserves_source_and_distribution_blocks(self):
        report=gate.audit(ROOT)
        self.assertEqual(report["schema"],gate.SCHEMA)
        self.assertEqual(report["source_file_count"],13)
        self.assertEqual(report["transfer_mapping_count"],13)
        self.assertTrue(report["source_snapshot_ready"])
        self.assertIs(report["source_cutover_allowed"],False)
        self.assertIs(report["distribution_activation_allowed"],False)
        self.assertIs(report["checked_out_blob_integrity_verified"],False)
        self.assertFalse((ROOT/"apps/internet").exists())

    def test_untouched_external_source_never_materializes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            self.fixture(root)
            old=sorted(p.relative_to(root).as_posix() for p in root.rglob("*"))
            gate.audit(root)
            self.assertEqual(old,sorted(p.relative_to(root).as_posix() for p in root.rglob("*")))

    def test_duplicate_product_source_even_without_manifest_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root)
            (root/"apps/internet/src").mkdir(parents=True)
            (root/"apps/internet/src/runtime.mjs").write_text("export default 1;\n")
            with self.assertRaisesRegex(gate.InternetExternalizationError,"source exists"):
                gate.audit(root)

    def test_source_or_transfer_digest_drift_fails(self):
        for path,key in (
            ("migrations/internet.externalization.json","source_snapshot"),
            ("migrations/internet.gate-b-transfer-map.json","source_commit"),
        ):
            with self.subTest(path=path),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);self.fixture(root)
                if key=="source_snapshot":
                    self.change(root,path,lambda d:d[key].update(commit="0"*40))
                else:
                    self.change(root,path,lambda d:d.update(source_commit="0"*40))
                with self.assertRaises(gate.InternetExternalizationError):
                    gate.audit(root)

    def test_no_missing_or_duplicate_mapped_product_files(self):
        for mutate in (
            lambda d:d["mappings"].pop(),
            lambda d:d["mappings"].__setitem__(0,{**d["mappings"][0],"source":d["mappings"][1]["source"]}),
            lambda d:d["mappings"].__setitem__(0,{**d["mappings"][0],"target":"apps/internet/../../private"}),
        ):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);self.fixture(root)
                self.change(root,gate.MAP,mutate)
                with self.assertRaises(gate.InternetExternalizationError):
                    gate.audit(root)

    def test_cannot_enable_cutover_or_distribution_by_flags(self):
        for flag in ("source_cutover_allowed","distribution_activation_allowed"):
            with self.subTest(flag=flag),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);self.fixture(root)
                self.change(root,gate.PLAN,lambda d:d.update({flag:True}))
                with self.assertRaises(gate.InternetExternalizationError):
                    gate.audit(root)

    def test_sdk_lock_floor_and_authority_guards(self):
        for mutate in (
            lambda d:d.update(bundle_version="1.13.0"),
            lambda d:d.update(authority="host"),
            lambda d:d.update(sha256="0"*12),
        ):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);self.fixture(root)
                self.change(root,gate.LOCK,mutate)
                with self.assertRaises(gate.InternetExternalizationError):
                    gate.audit(root)

    def test_git_checkout_requires_clean_canonical_origin_and_complete_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            self.fixture(root)
            checkout=root/"platform"
            checkout.mkdir()
            def git(*args):
                result=subprocess.run(
                    ["git","-C",str(checkout),*args],
                    check=True,capture_output=True,text=True,encoding="utf-8",
                )
                return result.stdout.strip()
            git("init","-q")
            git("config","user.name","OrdaX CI")
            git("config","user.email","test@example.invalid")
            git("remote","add","origin","https://github.com/ordaxsystems/ordax-os.git")
            snap=json.loads((root/gate.SNAPSHOT).read_text(encoding="utf-8"))
            for i,item in enumerate(snap["files"]):
                path=checkout/item["path"]
                path.parent.mkdir(parents=True,exist_ok=True)
                path.write_text(f"pinned source {i}\\n",encoding="utf-8")
            sdk=checkout/"sdk/app-sdk-v1/bundle.json"
            sdk.parent.mkdir(parents=True)
            sdk.write_text(json.dumps({"contracts":[]}),encoding="utf-8")
            git("add",".")
            git("commit","-qm","immutable source fixture")
            commit=git("rev-parse","HEAD")
            for row in snap["files"]:
                row["blob_sha"]=git("rev-parse","HEAD:"+row["path"])
                row["size"]=(checkout/row["path"]).stat().st_size
            self.change(root,gate.PLAN,lambda d:d["source_snapshot"].update(commit=commit))
            self.change(root,gate.MAP,lambda d:d.update(source_commit=commit))
            snap["commit"]=commit
            (root/gate.SNAPSHOT).write_text(json.dumps(snap,indent=2)+"\n",encoding="utf-8")
            self.assertTrue(gate.audit(root,platform_root=checkout)["checked_out_blob_integrity_verified"])
            (checkout/snap["files"][0]["path"]).write_text("dirty\n",encoding="utf-8")
            with self.assertRaisesRegex(gate.InternetExternalizationError,"dirty"):
                gate.audit(root,platform_root=checkout)
            git("restore",".")
            git("remote","set-url","origin","https://github.com/someone/other.git")
            with self.assertRaisesRegex(gate.InternetExternalizationError,"canonical Git origin"):
                gate.audit(root,platform_root=checkout)

    def test_current_platform_diff_reports_changed_added_and_deleted_blobs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            self.fixture(root)
            checkout=root/"platform"
            checkout.mkdir()
            def git(*args):
                result=subprocess.run(
                    ["git","-C",str(checkout),*args],
                    check=True,capture_output=True,text=True,encoding="utf-8",
                )
                return result.stdout.strip()
            git("init","-q")
            git("config","user.name","OrdaX CI")
            git("config","user.email","test@example.invalid")
            git("remote","add","origin","https://github.com/ordaxsystems/ordax-os.git")
            snap=json.loads((root/gate.SNAPSHOT).read_text(encoding="utf-8"))
            for index,item in enumerate(snap["files"]):
                dest=checkout/item["path"]
                dest.parent.mkdir(parents=True,exist_ok=True)
                dest.write_text(f"source {index}\\n",encoding="utf-8")
            git("add",".")
            git("commit","-qm","initial source")
            pinned={item["path"]:git("rev-parse","HEAD:"+item["path"])
                    for item in snap["files"]}
            stable=gate.current_source_drift(
                checkout,[{"path":path,"blob_sha":digest}
                          for path,digest in pinned.items()],
            )
            self.assertTrue(stable["snapshot_current"])
            self.assertEqual(stable["changed"],[])
            self.assertEqual(stable["added"],[])
            self.assertEqual(stable["deleted"],[])
            changed="system/apps/internet/runtime.mjs"
            removed="system/apps/internet/version.mjs"
            new="system/apps/internet/ui/new-panel.mjs"
            (checkout/changed).write_text("new version\\n",encoding="utf-8")
            (checkout/removed).unlink()
            (checkout/new).write_text("new source\\n",encoding="utf-8")
            git("add","-A")
            git("commit","-qm","change Internet")
            diff=gate.current_source_drift(
                checkout,[{"path":path,"blob_sha":digest}
                          for path,digest in pinned.items()],
            )
            self.assertFalse(diff["snapshot_current"])
            self.assertEqual(diff["changed"],[changed])
            self.assertEqual(diff["deleted"],[removed])
            self.assertEqual(diff["added"],[new])
            self.assertEqual(diff["current_file_count"],len(pinned))
            (checkout/changed).write_text("dirty\\n",encoding="utf-8")
            with self.assertRaisesRegex(gate.InternetExternalizationError,"dirty"):
                gate.current_source_drift(checkout,[
                    {"path":path,"blob_sha":digest}
                    for path,digest in pinned.items()
                ])

    def test_portability_import_obligations_are_derived_without_copying_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            app=root/"system/apps/internet"
            app.mkdir(parents=True)
            contracts=root/"system/contracts"
            contracts.mkdir(parents=True)
            (app/"runtime.mjs").write_text(
                'import { x } from "../../contracts/browser-session.mjs";\n'
                'import "./services/history.mjs";\n'
                'const style=new URL("./internet.css", import.meta.url);\n'
                'import { y } from "./version.mjs";\n',
                encoding="utf-8",
            )
            (app/"version.mjs").write_text('export const y="0.3.0";\n')
            (app/"internet.css").write_text("body{}\n")
            services=app/"services"
            services.mkdir()
            (services/"history.mjs").write_text("export const history=true;\n")
            mapping={"mappings":[
                {"source":"system/apps/internet/runtime.mjs",
                 "target":"apps/internet/src/runtime.mjs",
                 "operation":"relocate-and-rewire-public-sdk-imports"},
                {"source":"system/apps/internet/version.mjs",
                 "target":"apps/internet/app.json",
                 "operation":"fold-version-into-manifest"},
                {"source":"system/apps/internet/services/history.mjs",
                 "target":"apps/internet/src/services/history.mjs",
                 "operation":"relocate-and-rewire-public-sdk-imports"},
                {"source":"system/apps/internet/internet.css",
                 "target":"apps/internet/assets/internet.css",
                 "operation":"relocate"},
            ]}
            valid={"system/contracts/browser-session.mjs"}
            report=gate.check_portability_rewrites(root,mapping,valid)
            self.assertEqual(report["source_imports_scanned"],4)
            obligations={row["specifier"]:row for row in report["obligations"]}
            self.assertEqual(
                obligations["./internet.css"]["rewritten_specifier"],
                "../assets/internet.css",
            )
            self.assertEqual(
                obligations["./internet.css"]["target_dependency"],
                "apps/internet/assets/internet.css",
            )
            self.assertEqual(
                obligations["./services/history.mjs"]["rewritten_specifier"],
                "./services/history.mjs",
            )
            self.assertIsNone(
                obligations["../../contracts/browser-session.mjs"]["rewritten_specifier"]
            )
            self.assertIsNone(obligations["./version.mjs"]["rewritten_specifier"])
            self.assertEqual({row["requirement"] for row in report["obligations"]},{
                "resolve-public-sdk-contract","manifest-replacement",
                "relocate-app-owned-import",
            })
            self.assertIs(report["runtime_package_ready"],False)
            self.assertFalse((root/"apps/internet").exists())
            with self.assertRaisesRegex(gate.InternetExternalizationError,"private"):
                gate.check_portability_rewrites(root,mapping,set())
            with (app/"runtime.mjs").open("a") as stream:
                stream.write('import "../../../../system/adapters/native/browser-session.mjs";\n')
            with self.assertRaises(gate.InternetExternalizationError):
                gate.check_portability_rewrites(root,mapping,valid)
            (app/"runtime.mjs").write_text("import(untrustedModule);\n",encoding="utf-8")
            with self.assertRaisesRegex(gate.InternetExternalizationError,"non-literal"):
                gate.check_portability_rewrites(root,mapping,valid)


    def test_gate_a_inventory_tracks_os_consumers_without_moving_app_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            checkout = Path(tmp)
            def git(*args):
                return subprocess.run(
                    ["git", "-C", str(checkout), *args],
                    check=True, capture_output=True, text=True,
                    encoding="utf-8",
                ).stdout.strip()
            git("init", "-q")
            git("config", "user.name", "OrdaX CI")
            git("config", "user.email", "test@example.invalid")
            source = checkout / "system/apps/internet/runtime.mjs"
            source.parent.mkdir(parents=True)
            source.write_text("export const componentRuntime = {};\n")
            translations = checkout / "system/services/i18n/catalog/internet.mjs"
            translations.parent.mkdir(parents=True)
            translations.write_text("export const messages = {};\n")
            catalog = checkout / "system/apps/component-catalog.mjs"
            catalog.write_text('import "./internet/runtime.mjs";\n')
            surface = checkout / "system/services/i18n/surface.mjs"
            surface.write_text('import "./catalog/internet.mjs";\n')
            meta = checkout / "tools/component-package/metadata.mjs"
            meta.parent.mkdir(parents=True)
            meta.write_text('const source="system/apps/internet/runtime.mjs";\n')
            hosts = [
                "system/surface/runtime/ordax_browser_host.py",
                "system/adapters/native/browser-session.mjs",
                "system/adapters/web/browser-session.mjs",
            ]
            for name in hosts:
                target = checkout / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("export const host = true;\n")
            git("add", ".")
            git("commit", "-qm", "original platform")
            report = gate.scan_platform_gate_a_consumers(checkout)
            self.assertFalse(report["absence_preflight_ready"])
            self.assertTrue(report["host_boundary_intact"])
            self.assertEqual(len(report["owned_source_paths"]), 2)
            self.assertEqual(len(report["consumer_imports"]), 2)
            self.assertEqual(report["literal_source_path_references"],
                             ["tools/component-package/metadata.mjs"])
            self.assertIs(report["platform_boot_verified"], False)
            self.assertIs(report["external_distribution_verified"], False)
            source.unlink()
            translations.unlink()
            catalog.write_text("export const appManifests = [];\n")
            surface.write_text("export const messages = {};\n")
            meta.write_text("export const entries = [];\n")
            git("add", "-A")
            git("commit", "-qm", "remove embedded browser without removing host")
            after = gate.scan_platform_gate_a_consumers(checkout)
            self.assertTrue(after["absence_preflight_ready"])
            self.assertEqual(after["owned_source_paths"], [])
            self.assertEqual(after["consumer_imports"], [])
            self.assertEqual(after["literal_source_path_references"], [])
            self.assertFalse((checkout / "system/apps/internet/runtime.mjs").exists())

    def test_actual_source_checkout_requires_exact_pinned_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root)
            with self.assertRaises(gate.InternetExternalizationError):
                gate.audit(root,platform_root=root)

if __name__=="__main__":
    unittest.main()
