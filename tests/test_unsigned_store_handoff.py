from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "app-package"))

import materialize_unsigned_store_handoff as handoff  # noqa: E402
import render_store_catalog_candidate as candidate_tool  # noqa: E402
import render_store_catalog_publication as publication_tool  # noqa: E402

fixture_spec = importlib.util.spec_from_file_location(
    "readiness_fixtures", ROOT / "tests" / "test_audit_app_readiness.py",
)
fixtures = importlib.util.module_from_spec(fixture_spec)
assert fixture_spec.loader is not None
fixture_spec.loader.exec_module(fixtures)


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
            # Real component packages are essential: exporter verification must
            # reject self-consistent forged hashes, not merely match JSON data.
            fixtures.make_app(self.root, app_id)
            paths = self.artifacts / app_id
            paths.mkdir(parents=True, exist_ok=True)
            package_path = paths / f"{app_id}.zip"
            handoff.unsigned_module.builder.build_package(
                self.apps_root / app_id, self.commit, package_path,
            )
            release_path, compatibility_path = handoff.unsigned_module.builder.write_release_v2(
                package_path, self.apps_root / app_id / "compatibility.json", paths,
            )
            record, record_bytes = handoff.unsigned_module.render_handoff(
                package=package_path,
                release=release_path,
                compatibility=compatibility_path,
                app_id=app_id,
                source_commit=self.commit,
            )
            self.assertEqual(record["status"], "unsigned-candidate")
            path = self.root / f"{app_id}.unsigned-candidate.json"
            path.write_bytes(record_bytes)
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

    def test_self_consistent_forged_package_digest_still_fails_closed(self):
        # Modify the real ZIP, then forge the matching hash in the handoff,
        # catalog and v1 publication. Pure digest comparisons would all pass.
        app_id = "calculator"
        package_path = self.artifacts / app_id / f"{app_id}.zip"
        with zipfile.ZipFile(package_path, "a") as archive:
            archive.writestr("unexpected-file.txt", b"not-from-canonical-build")
        handoff_path = self.root / f"{app_id}.unsigned-candidate.json"
        record = json.loads(handoff_path.read_text(encoding="utf-8"))
        payload = package_path.read_bytes()
        record["artifacts"]["package"]["sha256"] = hashlib.sha256(payload).hexdigest()
        record["artifacts"]["package"]["size"] = len(payload)
        write_json(handoff_path, record)

        forged_catalog, candidate_bytes = candidate_tool.render_catalog_candidate(
            handoffs=self.handoffs, apps_root=self.apps_root, source_commit=self.commit,
        )
        self.candidate_path.write_bytes(candidate_bytes)
        _, publication_bytes = publication_tool.render_publication(
            candidate=forged_catalog, candidate_bytes=candidate_bytes, sequence=1,
        )
        self.publication_path.write_bytes(publication_bytes)

        with self.assertRaisesRegex(
            handoff.UnsignedHandoffError, "canonical package/descriptor verification failed",
        ):
            self.materialize()
        self.assertFalse(self.output.exists())

    def test_output_never_overwrites_existing_directory(self):
        self.output.mkdir()
        with self.assertRaisesRegex(handoff.UnsignedHandoffError, "refusing to overwrite"):
            self.materialize()


if __name__ == "__main__":
    unittest.main()
