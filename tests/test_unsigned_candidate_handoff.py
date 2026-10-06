import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HANDOFF_PATH = ROOT / "tools" / "app-package" / "render_unsigned_handoff.py"

spec = importlib.util.spec_from_file_location("ordax_unsigned_handoff", HANDOFF_PATH)
handoff = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(handoff)


class UnsignedCandidateHandoffTests(unittest.TestCase):
    def build_notes_candidate(self, root: Path, source_commit: str):
        package = root / "notes.zip"
        release_dir = root / "release"
        handoff.builder.build_package(
            ROOT / "apps" / "notes",
            source_commit,
            package,
        )
        release, compatibility = handoff.builder.write_release_v2(
            package,
            ROOT / "migrations" / "notes.compatibility.json",
            release_dir,
        )
        return package, release, compatibility

    def test_notes_handoff_binds_exact_unsigned_candidate_without_authority(self):
        source_commit = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            package, release, compatibility = self.build_notes_candidate(
                Path(temporary),
                source_commit,
            )
            value, payload = handoff.render_handoff(
                package=package,
                release=release,
                compatibility=compatibility,
                app_id="notes",
                source_commit=source_commit,
            )

        self.assertEqual(value["$schema"], "ordax-apps.unsigned-component-candidate/1")
        self.assertEqual(value["status"], "unsigned-candidate")
        self.assertEqual(value["component"]["id"], "notes")
        self.assertEqual(value["component"]["version"], "0.4.3")
        self.assertEqual(value["component"]["releaseMode"], "component-slot")
        self.assertEqual(value["source"]["repository"], "washingtonmsdj/ordax-apps")
        self.assertEqual(value["source"]["commit"], source_commit)
        self.assertEqual(value["trust"]["domain"], "runtime-components")
        self.assertEqual(value["trust"]["requiredKeyId"], "ordax-runtime-components-v1")
        self.assertTrue(
            value["trust"]["canonicalPublicAnchorRequiredBeforeProductionSigning"]
        )
        self.assertEqual(
            value["authority"],
            {
                "signing": False,
                "publication": False,
                "installation": False,
                "activation": False,
            },
        )
        self.assertFalse(value["safety"]["containsPrivateKeyMaterial"])
        self.assertFalse(value["safety"]["directActivationAllowed"])
        self.assertTrue(value["safety"]["platformLifecycleRequired"])
        self.assertTrue(payload.endswith(b"\n"))

    def test_handoff_rejects_source_commit_mismatch(self):
        with tempfile.TemporaryDirectory() as temporary:
            package, release, compatibility = self.build_notes_candidate(
                Path(temporary),
                "a" * 40,
            )
            with self.assertRaisesRegex(
                handoff.HandoffError,
                "source commit does not match",
            ):
                handoff.render_handoff(
                    package=package,
                    release=release,
                    compatibility=compatibility,
                    app_id="notes",
                    source_commit="b" * 40,
                )


if __name__ == "__main__":
    unittest.main()
