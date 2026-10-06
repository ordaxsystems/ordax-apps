import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
MANIFEST = ROOT / "app.json"

FORBIDDEN = (
    "/__ordax/native/notes",
    "/var/lib/ordax/notes.json",
    "system/apps/notes",
    "system/contracts/",
    "system/services/",
    "createNativeNotesStore",
)

class NotesPortableBoundaryTests(unittest.TestCase):
    def source_text(self):
        return "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted(SRC.rglob("*.mjs"))
        )

    def test_manifest_is_external_component_slot(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema"], "ordax.component-manifest/1")
        self.assertEqual(manifest["id"], "notes")
        self.assertEqual(manifest["version"], "0.4.1")
        self.assertEqual(manifest["releaseMode"], "component-slot")
        self.assertEqual(manifest["owner"], "washingtonmsdj/ordax-apps")

    def test_source_has_no_platform_private_or_legacy_native_paths(self):
        text = self.source_text()
        for token in FORBIDDEN:
            self.assertNotIn(token, text)

    def test_runtime_version_mirror_matches_manifest(self):
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        runtime = (SRC / "runtime.mjs").read_text(encoding="utf-8")
        self.assertIn(
            f'const NOTES_RUNTIME_VERSION = "{manifest["version"]}";',
            runtime,
        )

    def test_public_contract_facade_is_sdk_pinned_and_authority_free(self):
        facade = (SRC / "sdk" / "public-contracts.mjs").read_text(encoding="utf-8")
        self.assertIn("App SDK 1.6.0", facade)
        self.assertIn('ordax.app-data/1', facade)
        self.assertIn('ordax.localization/2', facade)
        self.assertIn('ordax.surface-render-lifecycle/5', facade)
        self.assertNotIn("install", facade.lower())
        self.assertNotIn("signing", facade.lower())

if __name__ == "__main__":
    unittest.main()
