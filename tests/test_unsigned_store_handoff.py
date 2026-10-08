from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "app-package"))

import materialize_unsigned_store_handoff as handoff  # noqa: E402
import render_store_catalog_candidate as candidate_tool  # noqa: E402
import render_store_catalog_publication as publication_tool  # noqa: E402


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(candidate_tool._canonical_json(value))


def artifact(path: Path, payload: bytes) -> dict:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return {
        "name": path.name,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "size": len(payload),
    }


class UnsignedStoreHandoffTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.apps_root = self.root / "apps"
        self.artifacts = self.root / "artifacts"
        self.output = self.root / "export"
        self.commit = "b" * 40
        self.handoffs = []
        for app_id in ("calculator", "notes"):
            manifest = {
                "schema": "ordax.component-manifest/1",
                "id": app_id,
                "title": app_id.title(),
                "owner": "ordaxsystems/ordax-apps",
                "releaseMode": "component-slot",
                "version": "0.2.0",
            }
            write_json(self.apps_root / app_id / "app.json", manifest)
            paths = self.artifacts / app_id
            package = artifact(paths / (app_id + ".zip"), b"unsigned-test-package-" + app_id.encode())
            release = artifact(paths / (app_id + ".release.json"), b'{"schema":"test"}\n')
            compatibility = artifact(paths / (app_id + ".compatibility.json"), b'{"schema":"test"}\n')
            record = {
                "$schema": "ordax-apps.unsigned-component-candidate/1",
                "status": "unsigned-candidate",
                "component": {"id": app_id, "version": "0.2.0", "releaseMode": "component-slot"},
                "source": {"repository": "ordaxsystems/ordax-apps", "commit": self.commit},
                "artifacts": {"package": package, "release": release, "compatibility": compatibility},
                "trust": {
                    "domain": "runtime-components",
                    "requiredKeyId": "ordax-runtime-components-v1",
                    "canonicalPublicAnchorRequiredBeforeProductionSigning": True,
                },
                "authority": {
                    "signing": False, "publication": False, "installation": False, "activation": False,
                },
                "safety": {
                    "containsPrivateKeyMaterial": False,
                    "directActivationAllowed": False,
                    "platformLifecycleRequired": True,
                },
            }
            path = self.root / (app_id + ".unsigned-candidate.json")
            write_json(path, record)
            self.handoffs.append(path)

        self.candidate, candidate_bytes = candidate_tool.render_catalog_candidate(
            handoffs=self.handoffs, apps_root=self.apps_root, source_commit=self.commit,
        )
        self.candidate_path = self.root / "store.catalog-candidate.json"
        self.candidate_path.write_bytes(candidate_bytes)
        publication, publication_bytes = publication_tool.render_publication(
            candidate=self.candidate, candidate_bytes=candidate_bytes, sequence=1,
        )
        self.assertEqual(publication["status"], "unsigned-publication-payload")
        self.publication_path = self.root / "store.catalog-publication-v1.json"
        self.publication_path.write_bytes(publication_bytes)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def materialize(self) -> dict:
        return handoff.create_handoff(
            candidate_path=self.candidate_path,
            publication_path=self.publication_path,
            artifacts_root=self.artifacts,
            handoffs_dir=self.root,
            apps_root=self.apps_root,
            output_root=self.output,
        )

    def test_public_handoff_contains_all_expected_unsigned_files_and_no_test_signatures(self):
        # The build directory may contain ephemeral signed protocol proofs.
        # The handoff must copy strictly its own allowlisted inputs.
        artifact(self.artifacts / "notes/notes.runtime-component-envelope.json", b"ephemeral-envelope")
        artifact(self.root / "runtime-components-ci-trust.json", b"ephemeral-trust")
        artifact(self.root / "private-key.pem", b"ephemeral-key")
        record = self.materialize()
        self.assertEqual(record, {
            "app_count": 2, "file_count": 10, "source_commit": self.commit,
        })
        actual = {
            p.relative_to(self.output).as_posix()
            for p in self.output.rglob("*") if p.is_file()
        }
        expected = {"store.catalog-candidate.json", "store.catalog-publication-v1.json"}
        for app_id in ("calculator", "notes"):
            expected.add(f"unsigned/{app_id}.unsigned-candidate.json")
            for extension in (".zip", ".release.json", ".compatibility.json"):
                expected.add(f"artifacts/{app_id}/{app_id}{extension}")
        self.assertEqual(actual, expected)
        self.assertTrue(all(
            "trust" not in x and "envelope" not in x and ".pem" not in x
            for x in actual
        ))
        self.assertEqual(
            (self.output / "store.catalog-candidate.json").read_bytes(),
            self.candidate_path.read_bytes(),
        )

    def test_modified_package_fails_without_partial_output(self):
        (self.artifacts / "notes/notes.zip").write_bytes(b"tampered-package")
        with self.assertRaisesRegex(handoff.UnsignedHandoffError, "hash or size mismatch"):
            self.materialize()
        self.assertFalse(self.output.exists())

    def test_missing_or_symlinked_handoff_fails_closed(self):
        path = self.handoffs[0]
        original = path.read_bytes()
        path.unlink()
        with self.assertRaisesRegex(handoff.UnsignedHandoffError, "missing"):
            self.materialize()
        path.symlink_to(self.root / "store.catalog-candidate.json")
        with self.assertRaisesRegex(handoff.UnsignedHandoffError, "non-symlink"):
            self.materialize()
        path.unlink()
        path.write_bytes(original)

    def test_noncanonical_publication_or_wrong_catalog_identity_rejected(self):
        self.publication_path.write_bytes(b'{"status":"fake"}\n')
        with self.assertRaisesRegex(handoff.UnsignedHandoffError, "publication v1"):
            self.materialize()
        self.assertFalse(self.output.exists())

    def test_output_never_overwrites_existing_directory(self):
        self.output.mkdir()
        with self.assertRaisesRegex(handoff.UnsignedHandoffError, "refusing to overwrite"):
            self.materialize()


if __name__ == "__main__":
    unittest.main()
