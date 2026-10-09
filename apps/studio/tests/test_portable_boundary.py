import unittest
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORTABLE_PATHS = (ROOT / "src", ROOT / "assets", ROOT / "conversation" / "src", ROOT / "conversation" / "assets")
FORBIDDEN = (
    "ordax_dev_agent",
    "ordax_device_agent",
    "CloudflareControlPlane",
    "window.chrome.webview",
    "window.pywebview",
    "pywebview",
    "ActionRegistry",
)

def portable_text():
    parts = []
    for base in PORTABLE_PATHS:
        for path in base.rglob("*"):
            if path.is_file() and path.suffix.lower() in {".mjs", ".js", ".html", ".css", ".json"}:
                parts.append(path.read_text(encoding="utf-8", errors="ignore"))
    parts.append((ROOT / "app.json").read_text(encoding="utf-8"))
    return "\n".join(parts)

class PortableBoundaryTests(unittest.TestCase):
    def test_no_private_runtime_or_host_transport(self):
        text = portable_text()
        for token in FORBIDDEN:
            self.assertNotIn(token, text)

    def test_component_manifest(self):
        manifest = json.loads((ROOT / "app.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema"], "ordax.component-manifest/1")
        self.assertEqual(manifest["id"], "studio")
        self.assertRegex(manifest["version"], r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")

    def test_html_uses_host_contract(self):
        html = (ROOT / "src" / "index.html").read_text(encoding="utf-8")
        self.assertIn('src="host_contract.js"', html)
        self.assertNotIn("host_bridge.js", html)

if __name__ == "__main__":
    unittest.main()
