from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "app-package" / "render_store_catalog_publication_v2.py"
_spec = importlib.util.spec_from_file_location("store_catalog_publication_v2", TOOL)
publication = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(publication)

COMMIT = "a" * 40


def canonical(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


class Result:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class StoreCatalogPublicationV2Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.artifacts = self.root / "artifacts"
        self.notes = self.artifacts / "notes"
        self.notes.mkdir(parents=True)

        self.package = self.notes / "notes.zip"
        self.release = self.notes / "notes.release.json"
        self.compatibility = self.notes / "notes.compatibility.json"
        self.envelope = self.notes / "notes.runtime-component-envelope.json"
        self.package.write_bytes(b"notes-package")
        self.release.write_bytes(b'{"release":"notes"}\n')
        self.compatibility.write_bytes(b'{"compatibility":"notes"}\n')
        self.envelope.write_bytes(b'{"signed":"component-envelope"}\n')

        self.verifier = self.root / "ordax-runtime-component-channel"
        self.verifier.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        self.verifier.chmod(self.verifier.stat().st_mode | stat.S_IXUSR)
        self.trust = self.root / "runtime-components-trust.json"
        self.trust.write_text('{"public":"test-only"}\n', encoding="utf-8")

        self.candidate_value = {
            "$schema": "ordax-apps.store-catalog-candidate/1",
            "status": "unsigned-catalog-candidate",
            "source": {
                "repository": "washingtonmsdj/ordax-apps",
                "commit": COMMIT,
            },
            "entries": [
                {
                    "appId": "notes",
                    "title": "Notas",
                    "version": "0.4.3",
                    "releaseMode": "component-slot",
                    "sourceCommit": COMMIT,
                    "artifacts": {
                        "package": self.identity(self.package),
                        "release": self.identity(self.release),
                        "compatibility": self.identity(self.compatibility),
                    },
                    "trust": {
                        "domain": "runtime-components",
                        "requiredKeyId": "ordax-runtime-components-v1",
                    },
                }
            ],
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
                "rollback": False,
            },
            "safety": {
                "catalogGrantsAuthority": False,
                "platformLifecycleRequired": True,
                "requestSelectsArtifact": False,
                "requestSelectsVersion": False,
            },
        }
        self.candidate_path = self.root / "catalog-candidate.json"
        self.candidate_path.write_bytes(canonical(self.candidate_value))

    def tearDown(self) -> None:
        self.temp.cleanup()

    @staticmethod
    def identity(path: Path) -> dict:
        payload = path.read_bytes()
        return {
            "name": path.name,
            "sha256": hashlib.sha256(payload).hexdigest(),
            "size": len(payload),
        }

    @staticmethod
    def verifier_stdout(
        *,
        app_id: str = "notes",
        version: str = "0.4.3",
        source_commit: str = COMMIT,
    ) -> str:
        return "\n".join([
            "RUNTIME_COMPONENT_RELEASE_V2_VERIFIED=YES",
            f"COMPONENT_ID={app_id}",
            f"COMPONENT_VERSION={version}",
            f"SOURCE_COMMIT={source_commit}",
            "PENDING_HEALTH_REQUIRED=YES",
            "DIRECT_ACTIVATION_ALLOWED=NO",
            "",
        ])

    def runner(self, argv, **kwargs):
        self.assertEqual(argv[0], str(self.verifier))
        self.assertEqual(argv[1], "verify-envelope-v2")
        self.assertIn("--envelope", argv)
        self.assertIn("--trust", argv)
        self.assertIn("--compatibility", argv)
        self.assertFalse(kwargs["check"])
        self.assertTrue(kwargs["capture_output"])
        self.assertTrue(kwargs["text"])
        self.assertEqual(kwargs["timeout"], 15)
        return Result(stdout=self.verifier_stdout())

    def render(self, *, runner=None, sequence: int = 9):
        candidate, candidate_bytes = publication.read_candidate(self.candidate_path)
        return publication.render_publication_v2(
            candidate=candidate,
            candidate_bytes=candidate_bytes,
            artifacts_root=self.artifacts,
            verifier=self.verifier,
            trust=self.trust,
            sequence=sequence,
            runner=runner or self.runner,
        )

    def test_v2_binds_verified_component_envelope_and_remains_authority_free(self) -> None:
        first, bytes_first = self.render()
        second, bytes_second = self.render()

        self.assertEqual(bytes_first, bytes_second)
        self.assertEqual(first["$schema"], "ordax-apps.store-catalog-publication/2")
        self.assertEqual(first["sequence"], 9)
        self.assertEqual(first["authority"], {
            "signing": False,
            "publication": False,
            "installation": False,
            "activation": False,
            "rollback": False,
        })
        self.assertEqual(first["safety"], {
            "requiresExternalSignature": True,
            "canonicalPublicAnchorRequired": True,
            "componentEnvelopesRequired": True,
            "componentEnvelopesVerifiedBeforeCatalogAssembly": True,
            "componentEnvelopesReverifiedByPlatformLifecycle": True,
            "platformLifecycleRequired": True,
            "payloadGrantsAuthority": False,
        })
        envelope = first["entries"][0]["artifacts"]["componentEnvelope"]
        self.assertEqual(envelope, self.identity(self.envelope))
        self.assertEqual(
            first["provenance"]["candidateSha256"],
            hashlib.sha256(self.candidate_path.read_bytes()).hexdigest(),
        )

    def test_v2_rejects_candidate_artifact_hash_drift_before_verifier(self) -> None:
        self.package.write_bytes(b"tampered-package")
        calls = []

        def runner(*args, **kwargs):
            calls.append((args, kwargs))
            return Result(stdout=self.verifier_stdout())

        with self.assertRaisesRegex(
            publication.CatalogPublicationV2Error,
            "package (size|sha256) does not match candidate",
        ):
            self.render(runner=runner)
        self.assertEqual(calls, [])

    def test_v2_rejects_platform_verifier_failure_and_identity_mismatch(self) -> None:
        with self.assertRaisesRegex(
            publication.CatalogPublicationV2Error,
            "failed canonical platform verification",
        ):
            self.render(runner=lambda *args, **kwargs: Result(returncode=1, stderr="invalid signature"))

        for stdout, expected in [
            (self.verifier_stdout(app_id="studio"), "app id mismatch"),
            (self.verifier_stdout(version="9.9.9"), "version mismatch"),
            (self.verifier_stdout(source_commit="b" * 40), "source commit mismatch"),
        ]:
            with self.subTest(expected=expected):
                with self.assertRaisesRegex(publication.CatalogPublicationV2Error, expected):
                    self.render(runner=lambda *args, _stdout=stdout, **kwargs: Result(stdout=_stdout))

    def test_v2_rejects_missing_or_symlink_component_envelope(self) -> None:
        self.envelope.unlink()
        with self.assertRaisesRegex(publication.CatalogPublicationV2Error, "component envelope is unavailable"):
            self.render()

        target = self.root / "envelope-target.json"
        target.write_text("{}\n", encoding="utf-8")
        try:
            self.envelope.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest("symlink creation unavailable")
        with self.assertRaisesRegex(publication.CatalogPublicationV2Error, "non-symlink"):
            self.render()

    def test_v2_rejects_invalid_sequence_and_noncanonical_verifier_output(self) -> None:
        for sequence in [0, -1, True]:
            with self.subTest(sequence=sequence):
                with self.assertRaisesRegex(publication.CatalogPublicationV2Error, "positive integer"):
                    self.render(sequence=sequence)

        duplicate = (
            "RUNTIME_COMPONENT_RELEASE_V2_VERIFIED=YES\n"
            "COMPONENT_ID=notes\n"
            "COMPONENT_ID=notes\n"
            "COMPONENT_VERSION=0.4.3\n"
            f"SOURCE_COMMIT={COMMIT}\n"
            "PENDING_HEALTH_REQUIRED=YES\n"
            "DIRECT_ACTIVATION_ALLOWED=NO\n"
        )
        with self.assertRaisesRegex(publication.CatalogPublicationV2Error, "duplicate"):
            self.render(runner=lambda *args, **kwargs: Result(stdout=duplicate))


if __name__ == "__main__":
    unittest.main()
