import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NOTES = ROOT / "apps" / "notes"


class NotesSurfaceSlotContractTests(unittest.TestCase):
    def test_external_notes_panel_uses_the_component_identity(self):
        component = json.loads((NOTES / "app.json").read_text(encoding="utf-8"))
        presentation = json.loads(
            (NOTES / "presentation" / "manifest.json").read_text(encoding="utf-8")
        )
        runtime = (NOTES / "src" / "ui" / "workspace-controls.mjs").read_text(
            encoding="utf-8"
        )
        css = (NOTES / "assets" / "notes.css").read_text(encoding="utf-8")
        app_id = component["id"]
        self.assertEqual(app_id, "notes")
        self.assertEqual(presentation["appId"], app_id)
        self.assertEqual(presentation["appVersion"], component["version"])
        self.assertIn(f'data-window-id="{app_id}"', runtime)
        self.assertIn(f'data-app-extension="{app_id}"', runtime)
        self.assertIn(f'data-app-extension="{app_id}"', css)
        self.assertNotIn("notes-workspace", runtime)
        self.assertNotIn("notes-workspace", css)


if __name__ == "__main__":
    unittest.main()
