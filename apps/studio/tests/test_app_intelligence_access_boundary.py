from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ACCESS = ROOT / "assets" / "app_intelligence_access.js"
STUDIO = ROOT / "assets" / "studio.js"
HOST = ROOT / "src" / "host_contract.js"
HTML = ROOT / "src" / "index.html"


class AppIntelligenceAccessBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.access = ACCESS.read_text(encoding="utf-8")
        cls.studio = STUDIO.read_text(encoding="utf-8")
        cls.host = HOST.read_text(encoding="utf-8")
        cls.html = HTML.read_text(encoding="utf-8")

    def test_app_intelligence_is_a_first_class_separate_surface(self) -> None:
        self.assertIn('data-view="app-intelligence"', self.html)
        self.assertIn('id="appIntelligenceCanvas"', self.html)
        self.assertIn("../assets/app_intelligence_access.js", self.html)
        self.assertIn("'app-intelligence':'Inteligência dos apps'", self.studio)
        self.assertIn("loadRemoteAppIntelligenceGrants()", self.studio)

    def test_surface_exposes_only_read_profile_and_explicit_actions(self) -> None:
        self.assertIn("app-intelligence-read", self.access)
        self.assertIn("intelligence.app_catalog", self.access)
        self.assertIn("intelligence.app_detail", self.access)
        for forbidden in (
            "full-computer-control",
            "computer.click",
            "computer.hotkey",
            "browser.start",
            "terminal.exec",
            "workspace.text_write",
        ):
            self.assertNotIn(forbidden, self.access)

    def test_portable_ui_has_no_control_plane_or_token_implementation(self) -> None:
        for forbidden in (
            "/v3/product/device-intelligence-grants",
            "Authorization: Bearer",
            "access_token",
            "CloudflareControlPlane",
            "ProductRemoteClient",
            "fetch(",
        ):
            self.assertNotIn(forbidden, self.access)

    def test_owner_consent_is_explicit_and_model_cannot_self_authorize(self) -> None:
        self.assertIn("window.confirm", self.access)
        self.assertIn("somente a leitura", self.access)
        self.assertIn("não permite executar ações", self.access)
        self.assertIn("authorize_remote_app_intelligence_grant", self.studio)
        self.assertIn("revoke_remote_app_intelligence_grant", self.studio)

    def test_host_methods_are_optional_capabilities(self) -> None:
        for method in (
            "remoteAppIntelligenceGrants",
            "authorizeRemoteAppIntelligenceGrant",
            "revokeRemoteAppIntelligenceGrant",
        ):
            self.assertIn(method, self.host)
            self.assertIn(method, self.studio)
        required_block = self.host.split("const REQUIRED_METHODS", 1)[1].split("]);", 1)[0]
        self.assertNotIn("remoteAppIntelligenceGrants", required_block)
        self.assertIn("const OPTIONAL_METHODS", self.host)


if __name__ == "__main__":
    unittest.main()
