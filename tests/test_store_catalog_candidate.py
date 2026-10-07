from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "app-package" / "render_store_catalog_candidate.py"
_spec = importlib.util.spec_from_file_location("store_catalog_candidate", TOOL)
catalog = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(catalog)

SOURCE_COMMIT = "a" * 40


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def app_manifest(app_id: str, title: str, version: str) -> dict:
    return {
        "schema": "ordax.component-manifest/1",
        "id": app_id,
        "title": title,
        "kind": "app",
        "version": version,
        "releaseMode": "component-slot",
        "criticality": "optional",
        "failureDomain": "app",
        "restartScope": "component",
        "healthMode": "runtime",
        "owner": "washingtonmsdj/ordax-apps",
        "dependencies": [],
    }


def artifact(name: str, char: str) -> dict:
    return {"name": name, "sha256": char * 64, "size": 123}


def handoff(app_id: str, version: str, char: str = "b") -> dict:
    return {
        "$schema": "ordax-apps.unsigned-component-candidate/1",
        "status": "unsigned-candidate",
        "component": {
            "id": app_id,
            "version": version,
            "releaseMode": "component-slot",
        },
        "source": {
            "repository": "washingtonmsdj/ordax-apps",
            "commit": SOURCE_COMMIT,
        },
        "artifacts": {
            "package": artifact(f"{app_id}.zip", char),
            "release": artifact("runtime-component-release.json", "c"),
            "compatibility": artifact("compatibility.json", "d"),
        },
        "trust": {
            "domain": "runtime-components",
            "requiredKeyId": "ordax-runtime-components-v1",
            "canonicalPublicAnchorRequiredBeforeProductionSigning": True,
        },
        "authority": {
            "signing": False,
            "publication": False,
            "installation": False,
            "activation": False,
        },
        "safety": {
            "containsPrivateKeyMaterial": False,
            "directActivationAllowed": False,
            "platformLifecycleRequired": True,
        },
    }


class StoreCatalogCandidateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.apps = self.root / "apps"
        for app_id, title, version in [
            ("notes", "Notas", "0.4.3"),
            ("studio", "ORDAX Studio", "0.5.3"),
        ]:
            directory = self.apps / app_id
            directory.mkdir(parents=True)
            (directory / "app.json").write_bytes(
                canonical_json(app_manifest(app_id, title, version))
            )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_handoff(self, app_id: str, version: str, char: str = "b") -> Path:
        path = self.root / f"{app_id}.unsigned-candidate.json"
        path.write_bytes(canonical_json(handoff(app_id, version, char)))
        return path

    def test_catalog_is_deterministic_sorted_and_authority_free(self) -> None:
        studio = self.write_handoff("studio", "0.5.3", "e")
        notes = self.write_handoff("notes", "0.4.3", "f")

        value_a, bytes_a = catalog.render_catalog_candidate(
            handoffs=[studio, notes],
            apps_root=self.apps,
            source_commit=SOURCE_COMMIT,
        )
        value_b, bytes_b = catalog.render_catalog_candidate(
            handoffs=[notes, studio],
            apps_root=self.apps,
            source_commit=SOURCE_COMMIT,
        )

        self.assertEqual(bytes_a, bytes_b)
        self.assertEqual([entry["appId"] for entry in value_a["entries"]], ["notes", "studio"])
        self.assertEqual(value_a["entries"][0]["version"], "0.4.3")
        self.assertEqual(value_a["entries"][1]["version"], "0.5.3")
        self.assertEqual(value_a["authority"], {
            "signing": False,
            "publication": False,
            "installation": False,
            "activation": False,
            "rollback": False,
        })
        self.assertFalse(value_a["safety"]["catalogGrantsAuthority"])
        self.assertFalse(value_a["safety"]["requestSelectsArtifact"])
        self.assertFalse(value_a["safety"]["requestSelectsVersion"])

    def test_catalog_rejects_duplicate_app_identity(self) -> None:
        first = self.write_handoff("notes", "0.4.3")
        second = self.root / "notes-copy.json"
        second.write_bytes(first.read_bytes())
        with self.assertRaisesRegex(catalog.CatalogCandidateError, "must be unique"):
            catalog.render_catalog_candidate(
                handoffs=[first, second],
                apps_root=self.apps,
                source_commit=SOURCE_COMMIT,
            )

    def test_catalog_rejects_handoff_with_authority_or_direct_activation(self) -> None:
        for mutation, message in [
            (lambda value: value["authority"].update({"installation": True}), "authority-free"),
            (lambda value: value["safety"].update({"directActivationAllowed": True}), "safety boundary"),
        ]:
            value = handoff("notes", "0.4.3")
            mutation(value)
            path = self.root / "mutated.json"
            path.write_bytes(canonical_json(value))
            with self.assertRaisesRegex(catalog.CatalogCandidateError, message):
                catalog.render_catalog_candidate(
                    handoffs=[path],
                    apps_root=self.apps,
                    source_commit=SOURCE_COMMIT,
                )

    def test_catalog_rejects_manifest_version_or_owner_drift(self) -> None:
        candidate = self.write_handoff("notes", "0.4.3")
        manifest_path = self.apps / "notes" / "app.json"

        drifted = app_manifest("notes", "Notas", "0.4.4")
        manifest_path.write_bytes(canonical_json(drifted))
        with self.assertRaisesRegex(catalog.CatalogCandidateError, "version mismatch"):
            catalog.render_catalog_candidate(
                handoffs=[candidate],
                apps_root=self.apps,
                source_commit=SOURCE_COMMIT,
            )

        drifted = app_manifest("notes", "Notas", "0.4.3")
        drifted["owner"] = "example/other"
        manifest_path.write_bytes(canonical_json(drifted))
        with self.assertRaisesRegex(catalog.CatalogCandidateError, "owner is not canonical"):
            catalog.render_catalog_candidate(
                handoffs=[candidate],
                apps_root=self.apps,
                source_commit=SOURCE_COMMIT,
            )

    def test_catalog_rejects_cross_commit_or_noncanonical_handoff(self) -> None:
        value = handoff("notes", "0.4.3")
        value["source"]["commit"] = "b" * 40
        path = self.root / "wrong-commit.json"
        path.write_bytes(canonical_json(value))
        with self.assertRaisesRegex(catalog.CatalogCandidateError, "source identity"):
            catalog.render_catalog_candidate(
                handoffs=[path],
                apps_root=self.apps,
                source_commit=SOURCE_COMMIT,
            )

        path.write_text(json.dumps(handoff("notes", "0.4.3")), encoding="utf-8")
        with self.assertRaisesRegex(catalog.CatalogCandidateError, "not canonical"):
            catalog.render_catalog_candidate(
                handoffs=[path],
                apps_root=self.apps,
                source_commit=SOURCE_COMMIT,
            )


if __name__ == "__main__":
    unittest.main()
