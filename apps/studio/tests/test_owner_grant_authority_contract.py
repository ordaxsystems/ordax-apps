from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
COMPUTER = (ROOT / "assets" / "computer_access.js").read_text(encoding="utf-8")
BROWSER = (ROOT / "assets" / "browser_access.js").read_text(encoding="utf-8")


class OwnerGrantAuthorityContractTests(unittest.TestCase):
    def test_ui_has_no_device_link_authority(self) -> None:
        source = COMPUTER + "\n" + BROWSER
        for forbidden in (
            "link_id",
            "remoteComputerLink",
            "remoteBrowserLink",
            "custom-device-grant",
            "data?.links",
            "data?.grants",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)

    def test_computer_observe_is_recommended_least_privilege_profile(self) -> None:
        self.assertIn("mode:'computer-observe'", COMPUTER)
        self.assertIn("recommended:true", COMPUTER)
        for capability in (
            "screenshot, clique, digitação, clipboard, filesystem",
            "grant groups",
            "client_id",
        ):
            self.assertIn(capability, COMPUTER)

    def test_browser_grant_creation_fails_closed_without_canonical_scope(self) -> None:
        self.assertIn("space_id + project_id", BROWSER)
        self.assertIn("o slug local não é aceito", BROWSER)
        self.assertIn("Autorizar indisponível", BROWSER)
        self.assertNotIn("authorize_remote_project_browser_grant',link", BROWSER)


if __name__ == "__main__":
    unittest.main()
