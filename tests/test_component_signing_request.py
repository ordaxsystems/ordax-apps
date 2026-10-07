from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HANDOFF_TOOL = ROOT / "tools" / "app-package" / "render_unsigned_handoff.py"
SIGNING_TOOL = ROOT / "tools" / "app-package" / "render_component_signing_request.py"

handoff_spec = importlib.util.spec_from_file_location("ordax_unsigned_handoff_for_signing", HANDOFF_TOOL)
handoff = importlib.util.module_from_spec(handoff_spec)
assert handoff_spec.loader is not None
handoff_spec.loader.exec_module(handoff)

signing_spec = importlib.util.spec_from_file_location("ordax_component_signing_request", SIGNING_TOOL)
signing = importlib.util.module_from_spec(signing_spec)
assert signing_spec.loader is not None
signing_spec.loader.exec_module(signing)

COMMIT = "a" * 40


class ComponentSigningRequestTests(unittest.TestCase):
    def build_candidate(self, root: Path):
        package = root / "notes.zip"
        release_dir = root / "release"
        handoff.builder.build_package(
            ROOT / "apps" / "notes",
            COMMIT,
            package,
        )
        release, compatibility = handoff.builder.write_release_v2(
            package,
            ROOT / "migrations" / "notes.compatibility.json",
            release_dir,
        )
        handoff_value, handoff_bytes = handoff.render_handoff(
            package=package,
            release=release,
            compatibility=compatibility,
            app_id="notes",
            source_commit=COMMIT,
        )
        handoff_path = root / "notes.unsigned-candidate.json"
        handoff_path.write_bytes(handoff_bytes)

        artifacts = root / "artifacts"
        artifacts.mkdir()
        for source in (package, release, compatibility):
            (artifacts / source.name).write_bytes(source.read_bytes())
        return handoff_path, artifacts, handoff_value, handoff_bytes

    def test_request_binds_exact_unsigned_candidate_without_authority(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            handoff_path, artifacts, handoff_value, handoff_bytes = self.build_candidate(root)
            value, payload = signing.render_signing_request(
                handoff_path=handoff_path,
                artifacts_root=artifacts,
            )

        self.assertEqual(value["$schema"], "ordax-apps.component-signing-request/1")
        self.assertEqual(value["status"], "external-signature-required")
        self.assertEqual(value["component"], handoff_value["component"])
        self.assertEqual(value["source"], handoff_value["source"])
        self.assertEqual(
            value["sourceHandoff"],
            {
                "schema": "ordax-apps.unsigned-component-candidate/1",
                "sha256": hashlib.sha256(handoff_bytes).hexdigest(),
            },
        )
        self.assertEqual(set(value["inputs"]), {"package", "release", "compatibility"})
        self.assertEqual(
            value["output"]["name"],
            "notes.runtime-component-envelope.json",
        )
        self.assertEqual(
            value["trust"],
            {
                "domain": "runtime-components",
                "requiredKeyId": "ordax-runtime-components-v1",
                "canonicalPublicAnchorRequired": True,
            },
        )
        self.assertEqual(
            value["authority"],
            {
                "signing": False,
                "publication": False,
                "installation": False,
                "activation": False,
                "rollback": False,
            },
        )
        self.assertFalse(value["safety"]["containsPrivateKeyMaterial"])
        self.assertFalse(value["safety"]["privateKeyPathAllowed"])
        self.assertFalse(value["safety"]["remoteSignerCredentialAllowed"])
        self.assertTrue(value["verification"]["signerMustRevalidateInputHashes"])
        self.assertTrue(value["verification"]["signedPayloadMustEqualReleaseBytes"])
        self.assertTrue(
            value["verification"]["canonicalPlatformVerifierRequiredBeforeCatalogAssembly"]
        )
        self.assertTrue(payload.endswith(b"\n"))

    def test_request_rejects_artifact_drift_before_signer_handoff(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            handoff_path, artifacts, _value, _payload = self.build_candidate(root)
            (artifacts / "notes.zip").write_bytes(b"tampered")

            with self.assertRaisesRegex(
                signing.ComponentSigningRequestError,
                "package artifact (size|sha256) does not match",
            ):
                signing.render_signing_request(
                    handoff_path=handoff_path,
                    artifacts_root=artifacts,
                )

    def test_request_rejects_authority_or_trust_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            handoff_path, artifacts, value, _payload = self.build_candidate(root)

            value["authority"]["signing"] = True
            handoff_path.write_bytes(signing.canonical_json(value))
            with self.assertRaisesRegex(
                signing.ComponentSigningRequestError,
                "authority drifted",
            ):
                signing.render_signing_request(
                    handoff_path=handoff_path,
                    artifacts_root=artifacts,
                )

            handoff_path, artifacts, value, _payload = self.build_candidate(root / "second")
            value["trust"]["requiredKeyId"] = "other-key"
            handoff_path.write_bytes(signing.canonical_json(value))
            with self.assertRaisesRegex(
                signing.ComponentSigningRequestError,
                "trust identity is invalid",
            ):
                signing.render_signing_request(
                    handoff_path=handoff_path,
                    artifacts_root=artifacts,
                )

    def test_writer_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            handoff_path, artifacts, _value, _payload = self.build_candidate(root)
            out = root / "signing-request.json"
            signing.write_signing_request(
                handoff_path=handoff_path,
                artifacts_root=artifacts,
                output_path=out,
            )
            with self.assertRaisesRegex(
                signing.ComponentSigningRequestError,
                "overwrite",
            ):
                signing.write_signing_request(
                    handoff_path=handoff_path,
                    artifacts_root=artifacts,
                    output_path=out,
                )


if __name__ == "__main__":
    unittest.main()
