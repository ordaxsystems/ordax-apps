from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "app-package" / "materialize_store_artifact_bundle.py"
_spec = importlib.util.spec_from_file_location("store_artifact_bundle", TOOL)
bundle = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(bundle)

COMMIT = "a" * 40


def canonical(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def identity(name: str, payload: bytes) -> dict:
    return {"name": name, "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload)}


class StoreArtifactBundleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.artifacts = self.root / "artifacts"
        self.notes = self.artifacts / "notes"
        self.notes.mkdir(parents=True)
        self.bytes = {
            "package": b"notes-package",
            "release": b'{"release":"notes"}\n',
            "compatibility": b'{"compatibility":"notes"}\n',
            "componentEnvelope": b'{"envelope":"notes"}\n',
        }
        names = {
            "package": "notes.zip",
            "release": "notes.release.json",
            "compatibility": "notes.compatibility.json",
            "componentEnvelope": "notes.runtime-component-envelope.json",
        }
        self.identities = {}
        for role, payload in self.bytes.items():
            record = identity(names[role], payload)
            self.identities[role] = record
            (self.notes / record["name"]).write_bytes(payload)
        self.publication = {
            "$schema": "ordax-apps.store-catalog-publication/2",
            "status": "unsigned-publication-payload",
            "sequence": 9,
            "source": {"repository": "ordaxsystems/ordax-apps", "commit": COMMIT},
            "entries": [{
                "appId": "notes",
                "title": "Notas",
                "version": "0.4.3",
                "releaseMode": "component-slot",
                "sourceCommit": COMMIT,
                "artifacts": self.identities,
                "trust": {
                    "domain": "runtime-components",
                    "requiredKeyId": "ordax-runtime-components-v1",
                },
            }],
            "trust": {
                "domain": "runtime-components",
                "requiredKeyId": "ordax-runtime-components-v1",
            },
            "provenance": {
                "candidateSchema": "ordax-apps.store-catalog-candidate/1",
                "candidateSha256": "b" * 64,
            },
            "authority": {
                "signing": False,
                "publication": False,
                "installation": False,
                "activation": False,
                "rollback": False,
            },
            "safety": {
                "requiresExternalSignature": True,
                "canonicalPublicAnchorRequired": True,
                "componentEnvelopesRequired": True,
                "componentEnvelopesVerifiedBeforeCatalogAssembly": True,
                "componentEnvelopesReverifiedByPlatformLifecycle": True,
                "platformLifecycleRequired": True,
                "payloadGrantsAuthority": False,
            },
        }
        self.publication_path = self.root / "publication.json"
        self.publication_path.write_bytes(canonical(self.publication))

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_bundle_materializes_only_content_addressed_blobs_without_urls(self) -> None:
        out = self.root / "bundle"
        descriptor = bundle.materialize_bundle(
            publication_path=self.publication_path,
            artifacts_root=self.artifacts,
            out_root=out,
        )
        self.assertEqual(descriptor["$schema"], "ordax-apps.store-artifact-layout/1")
        self.assertEqual(descriptor["addressing"], {
            "algorithm": "sha256",
            "pathTemplate": "sha256/{prefix2}/{sha256}",
        })
        self.assertEqual(descriptor["blobCount"], 4)
        self.assertEqual(descriptor["authority"], {
            "publication": False,
            "installation": False,
            "activation": False,
        })
        self.assertNotIn("url", json.dumps(descriptor).lower())
        for role, record in self.identities.items():
            path = out / bundle.blob_relative_path(record["sha256"])
            self.assertEqual(path.read_bytes(), self.bytes[role])

    def test_bundle_is_bound_to_exact_publication_bytes(self) -> None:
        out = self.root / "bundle"
        descriptor = bundle.materialize_bundle(
            publication_path=self.publication_path,
            artifacts_root=self.artifacts,
            out_root=out,
        )
        self.assertEqual(
            descriptor["sourcePublication"]["sha256"],
            hashlib.sha256(self.publication_path.read_bytes()).hexdigest(),
        )

    def test_bundle_rejects_tampered_or_oversized_identity_before_output(self) -> None:
        self.publication["entries"][0]["artifacts"]["package"]["sha256"] = "c" * 64
        self.publication_path.write_bytes(canonical(self.publication))
        with self.assertRaisesRegex(bundle.StoreArtifactBundleError, "sha256 does not match"):
            bundle.materialize_bundle(
                publication_path=self.publication_path,
                artifacts_root=self.artifacts,
                out_root=self.root / "tampered",
            )

        self.publication["entries"][0]["artifacts"]["package"] = {
            "name": "notes.zip",
            "sha256": "d" * 64,
            "size": (32 * 1024 * 1024) + 1,
        }
        self.publication_path.write_bytes(canonical(self.publication))
        with self.assertRaisesRegex(bundle.StoreArtifactBundleError, "identity is invalid"):
            bundle.read_publication(self.publication_path)

    def test_bundle_rejects_authority_or_url_smuggling(self) -> None:
        self.publication["authority"]["publication"] = True
        self.publication_path.write_bytes(canonical(self.publication))
        with self.assertRaisesRegex(bundle.StoreArtifactBundleError, "authority-free"):
            bundle.read_publication(self.publication_path)

        self.publication["authority"]["publication"] = False
        self.publication["entries"][0]["artifacts"]["package"]["url"] = "https://example.invalid/notes.zip"
        self.publication_path.write_bytes(canonical(self.publication))
        with self.assertRaisesRegex(bundle.StoreArtifactBundleError, "identity fields"):
            bundle.read_publication(self.publication_path)

    def test_bundle_refuses_output_overwrite(self) -> None:
        out = self.root / "bundle"
        out.mkdir()
        with self.assertRaisesRegex(bundle.StoreArtifactBundleError, "refusing to overwrite"):
            bundle.materialize_bundle(
                publication_path=self.publication_path,
                artifacts_root=self.artifacts,
                out_root=out,
            )


    def test_bundle_rejects_provenance_or_safety_drift(self) -> None:
        self.publication["provenance"]["candidateSha256"] = "not-a-digest"
        self.publication_path.write_bytes(canonical(self.publication))
        with self.assertRaisesRegex(bundle.StoreArtifactBundleError, "provenance is invalid"):
            bundle.read_publication(self.publication_path)

        self.publication["provenance"]["candidateSha256"] = "b" * 64
        self.publication["safety"]["unexpected"] = True
        self.publication_path.write_bytes(canonical(self.publication))
        with self.assertRaisesRegex(bundle.StoreArtifactBundleError, "safety boundary drifted"):
            bundle.read_publication(self.publication_path)

    def test_failed_materialization_leaves_no_partial_bundle(self) -> None:
        out = self.root / "partial"
        self.package = self.notes / self.identities["package"]["name"]
        self.package.write_bytes(b"tampered-after-publication")
        with self.assertRaisesRegex(bundle.StoreArtifactBundleError, "(size|sha256) does not match"):
            bundle.materialize_bundle(
                publication_path=self.publication_path,
                artifacts_root=self.artifacts,
                out_root=out,
            )
        self.assertFalse(out.exists())
        self.assertEqual(list(self.root.glob(".partial.stage-*")), [])


    def test_raced_blob_owned_by_another_writer_must_never_be_deleted(self):
        import errno
        from unittest.mock import patch

        payload = b"our verified bytes"
        digest = hashlib.sha256(payload).hexdigest()
        target = self.root / bundle.blob_relative_path(digest)
        competitor = b"a different publisher's bytes"
        original_open = bundle.os.open
        races = []

        def competing_open(path, flags, mode=0o777):
            if Path(path) == target and flags & bundle.os.O_EXCL:
                target.write_bytes(competitor)
                races.append(True)
                raise FileExistsError(errno.EEXIST, "existing concurrent blob", str(path))
            return original_open(path, flags, mode)

        with patch.object(bundle.os, "open", side_effect=competing_open):
            with self.assertRaisesRegex(bundle.StoreArtifactBundleError, "does not match"):
                bundle._write_blob(target, payload)
        self.assertEqual(races, [True])
        self.assertEqual(target.read_bytes(), competitor, "must not unlink another publisher's blob")

    def test_raced_blob_with_identical_content_is_only_read_not_rewritten(self):
        import errno
        from unittest.mock import patch

        payload = b"identical content-addressed data"
        target = self.root / bundle.blob_relative_path(hashlib.sha256(payload).hexdigest())
        original_open = bundle.os.open

        def competing_open(path, flags, mode=0o777):
            if Path(path) == target and flags & bundle.os.O_EXCL:
                target.write_bytes(payload)
                raise FileExistsError(errno.EEXIST, "another writer won", str(path))
            return original_open(path, flags, mode)

        with patch.object(bundle.os, "open", side_effect=competing_open):
            bundle._write_blob(target, payload)
        self.assertEqual(target.read_bytes(), payload)

    def test_failed_owned_blob_write_removes_only_our_new_file(self):
        from unittest.mock import patch

        payload = b"owned incomplete blob"
        target = self.root / bundle.blob_relative_path(hashlib.sha256(payload).hexdigest())
        with patch.object(bundle.os, "fsync", side_effect=OSError("injected disk failure")):
            with self.assertRaisesRegex(bundle.StoreArtifactBundleError, "persistence failed"):
                bundle._write_blob(target, payload)
        self.assertFalse(target.exists(), "our incomplete blob must not remain")

    def test_failed_exclusive_open_does_not_remove_external_destination(self):
        from unittest.mock import patch

        payload = b"not written"
        target = self.root / bundle.blob_relative_path(hashlib.sha256(payload).hexdigest())
        original_open = bundle.os.open
        def blocked_open(path, flags, mode=0o777):
            if Path(path) == target and flags & bundle.os.O_EXCL:
                raise PermissionError("injected exclusive open denied")
            return original_open(path, flags, mode)

        with patch.object(bundle.os, "open", side_effect=blocked_open):
            with self.assertRaisesRegex(bundle.StoreArtifactBundleError, "creation failed"):
                bundle._write_blob(target, payload)
        self.assertFalse(target.exists())

    def test_atomic_no_replace_survives_destination_race_after_exists_check(self):
        from unittest.mock import patch

        staging = self.root / ".race.stage"
        staging.mkdir()
        (staging / "payload").write_text("staged", encoding="utf-8")
        destination = self.root / "race"
        destination.mkdir()
        sentinel = destination / "winner"
        sentinel.write_text("prior writer", encoding="utf-8")

        # Deliberately simulate a destination that appears after the
        # optimistic existence check: only the kernel primitive may decide.
        original_exists = Path.exists
        def exists_before_race(path):
            if path == destination:
                return False
            return original_exists(path)
        with patch.object(Path, "exists", exists_before_race):
            with self.assertRaises(OSError):
                bundle.publish_directory_exclusive(staging, destination)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "prior writer")
        self.assertEqual((staging / "payload").read_text(encoding="utf-8"), "staged")

    def test_bundle_race_does_not_replace_concurrent_output_or_leave_staging(self):
        from unittest.mock import patch
        output = self.root / "concurrent-bundle"
        original_publish = bundle.publish_directory_exclusive

        def competing_writer(stage, destination):
            destination.mkdir()
            (destination / "winner").write_text("other publisher", encoding="utf-8")
            return original_publish(stage, destination)

        with patch.object(bundle, "publish_directory_exclusive", side_effect=competing_writer):
            with self.assertRaisesRegex(bundle.StoreArtifactBundleError, "commit failed"):
                bundle.materialize_bundle(
                    publication_path=self.publication_path,
                    artifacts_root=self.artifacts,
                    out_root=output,
                )
        self.assertEqual((output / "winner").read_text(encoding="utf-8"), "other publisher")
        self.assertFalse(list(self.root.glob(".concurrent-bundle.stage-*")))



if __name__ == "__main__":
    unittest.main()
