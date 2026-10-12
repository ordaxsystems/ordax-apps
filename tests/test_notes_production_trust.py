import base64
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "verify_notes_production_trust.py"

spec = importlib.util.spec_from_file_location("verify_notes_production_trust", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def trust_bytes():
    payload = {
        "$schema": module.TRUST_SCHEMA,
        "key_id": "ordax-runtime-components-v1",
        "public_key_base64": base64.b64encode(bytes(range(32))).decode("ascii"),
    }
    return (json.dumps(payload, indent=2) + "\n").encode("utf-8")


def policy(*, pinned=False, publish=False, activation=False, status=None, sha256=None):
    return {
        "$schema": "prototype-ordax.runtime-component-trust-policy/1",
        "status": status or ("canonical-public-trust-pinned" if pinned else "operator-ceremony-pending"),
        "trust_domain": "runtime-components",
        "key_id": "ordax-runtime-components-v1",
        "public_anchor": {
            "repository_path": module.TRUST_REPOSITORY_PATH,
            "runtime_path": module.TRUST_RUNTIME_PATH,
            "pinned": pinned,
            "sha256": sha256,
        },
        "current_gates": {
            "canonical_component_trust_anchor_pinned": pinned,
            "component_publish_allowed": publish,
            "production_component_slot_activation_allowed": activation,
        },
    }


class NotesProductionTrustAnchorTests(unittest.TestCase):
    def test_unpinned_policy_requires_anchor_absence(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkout = Path(temporary)
            module.validate_public_anchor(
                checkout,
                policy(),
                "ordax-runtime-components-v1",
            )

    def test_unpinned_policy_rejects_staged_anchor_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkout = Path(temporary)
            anchor = checkout / module.TRUST_REPOSITORY_PATH
            anchor.parent.mkdir(parents=True)
            anchor.write_bytes(trust_bytes())
            with self.assertRaises(SystemExit):
                module.validate_public_anchor(
                    checkout,
                    policy(),
                    "ordax-runtime-components-v1",
                )

    def test_pinned_policy_verifies_exact_anchor_digest_and_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkout = Path(temporary)
            payload = trust_bytes()
            anchor = checkout / module.TRUST_REPOSITORY_PATH
            anchor.parent.mkdir(parents=True)
            anchor.write_bytes(payload)
            module.validate_public_anchor(
                checkout,
                policy(
                    pinned=True,
                    sha256=hashlib.sha256(payload).hexdigest(),
                ),
                "ordax-runtime-components-v1",
            )

    def test_pinned_policy_rejects_anchor_digest_mismatch(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkout = Path(temporary)
            anchor = checkout / module.TRUST_REPOSITORY_PATH
            anchor.parent.mkdir(parents=True)
            anchor.write_bytes(trust_bytes())
            with self.assertRaises(SystemExit):
                module.validate_public_anchor(
                    checkout,
                    policy(pinned=True, sha256="0" * 64),
                    "ordax-runtime-components-v1",
                )

    def test_publish_cannot_precede_anchor(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(SystemExit):
                module.validate_public_anchor(
                    Path(temporary),
                    policy(publish=True),
                    "ordax-runtime-components-v1",
                )

    def test_activation_cannot_precede_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkout = Path(temporary)
            payload = trust_bytes()
            anchor = checkout / module.TRUST_REPOSITORY_PATH
            anchor.parent.mkdir(parents=True)
            anchor.write_bytes(payload)
            with self.assertRaises(SystemExit):
                module.validate_public_anchor(
                    checkout,
                    policy(
                        pinned=True,
                        publish=False,
                        activation=True,
                        sha256=hashlib.sha256(payload).hexdigest(),
                    ),
                    "ordax-runtime-components-v1",
                )


if __name__ == "__main__":
    unittest.main()
