from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BROWSER = ROOT / "assets" / "browser_access.js"
STUDIO = ROOT / "assets" / "studio.js"
HOST = ROOT / "src" / "host_contract.js"
HTML = ROOT / "src" / "index.html"
AI = ROOT / "ai" / "manifest.json"


class ManagedBrowserBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.browser = BROWSER.read_text(encoding="utf-8")
        cls.studio = STUDIO.read_text(encoding="utf-8")
        cls.host = HOST.read_text(encoding="utf-8")
        cls.html = HTML.read_text(encoding="utf-8")
        cls.ai = json.loads(AI.read_text(encoding="utf-8"))

    def test_browser_profile_is_explicit_and_project_scoped(self) -> None:
        self.assertIn("project-browser-automation", self.browser)
        self.assertIn("state.project", self.browser)
        self.assertIn("browser.*", self.browser)

    def test_managed_browser_never_falls_back_to_desktop_automation(self) -> None:
        for forbidden in (
            "computer.click",
            "computer.hotkey",
            "computer.type",
            "computer.launch_app",
            "chrome.exe",
            "CTRL",
        ):
            self.assertNotIn(forbidden, self.browser)

    def test_portable_browser_has_no_private_authority_or_control_plane_transport(self) -> None:
        for forbidden in (
            "/v3/product/project-capability-grants",
            "Authorization: Bearer",
            "access_token",
            "ProductRemoteClient",
            "CloudflareControlPlane",
        ):
            self.assertNotIn(forbidden, self.browser)

    def test_browser_host_methods_are_optional_capabilities(self) -> None:
        for method in (
            "remoteProjectBrowserGrants",
            "authorizeRemoteProjectBrowserGrant",
            "revokeRemoteProjectBrowserGrant",
            "browserList",
            "browserStart",
            "browserStatus",
            "browserNavigate",
            "browserSnapshot",
            "browserScreenshot",
            "browserStop",
        ):
            self.assertIn(method, self.host)
            self.assertIn(method, self.studio)
        required = self.host.split("const REQUIRED_METHODS", 1)[1].split("]);", 1)[0]
        self.assertNotIn("browserStart", required)

    def test_studio_exposes_dedicated_browser_surface(self) -> None:
        self.assertIn('data-view="browser"', self.html)
        self.assertIn('id="browserCanvas"', self.html)
        self.assertIn('../assets/browser_access.js', self.html)

    def test_intelligence_manifest_declares_managed_browser_intent_without_authority(self) -> None:
        self.assertEqual(self.ai["authority"], "none")
        intent = next(item for item in self.ai["intents"] if item["id"] == "studio.open-managed-browser")
        self.assertEqual(intent["effect"], "write")
        self.assertEqual(intent["confirmation"], "policy")
        self.assertIn("coordenadas", intent["description"])


if __name__ == "__main__":
    unittest.main()
