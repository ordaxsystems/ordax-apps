from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "app-package" / "render_store_catalog_publication.py"
_spec = importlib.util.spec_from_file_location("store_catalog_publication", TOOL)
publication = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(publication)


def canonical(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def candidate() -> dict:
    return {
        "$schema": "ordax-apps.store-catalog-candidate/1",
        "status": "unsigned-catalog-candidate",
        "source": {
            "repository": "washingtonmsdj/ordax-apps",
            "commit": "a" * 40,
        },
        "entries": [
            {
                "appId": "notes",
                "title": "Notas",
                "version": "0.4.3",
                "releaseMode": "component-slot",
                "sourceCommit": "a" * 40,
                "artifacts": {
                    "package": {"name": "notes.zip", "sha256": "b" * 64, "size": 123},
                    "release": {"name": "notes.release.json", "sha256": "c" * 64, "size": 124},
                    "compatibility": {"name": "notes.compatibility.json", "sha256": "d" * 64, "size": 125},
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


class StoreCatalogPublicationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_candidate(self, value: dict | None = None) -> Path:
        path = self.root / "catalog-candidate.json"
        path.write_bytes(canonical(candidate() if value is None else value))
        return path

    def test_publication_is_deterministic_sequence_bound_and_authority_free(self) -> None:
        path = self.write_candidate()
        value, source_bytes = publication.read_candidate(path)
        pub_a, bytes_a = publication.render_publication(
            candidate=value,
            candidate_bytes=source_bytes,
            sequence=17,
        )
        pub_b, bytes_b = publication.render_publication(
            candidate=value,
            candidate_bytes=source_bytes,
            sequence=17,
        )
        self.assertEqual(bytes_a, bytes_b)
        self.assertEqual(pub_a["$schema"], "ordax-apps.store-catalog-publication/1")
        self.assertEqual(pub_a["sequence"], 17)
        self.assertEqual(
            pub_a["provenance"]["candidateSha256"],
            hashlib.sha256(source_bytes).hexdigest(),
        )
        self.assertEqual(pub_a["authority"], {
            "signing": False,
            "publication": False,
            "installation": False,
            "activation": False,
            "rollback": False,
        })
        self.assertTrue(pub_a["safety"]["requiresExternalSignature"])
        self.assertFalse(pub_a["safety"]["payloadGrantsAuthority"])

    def test_publication_rejects_noncanonical_or_authoritative_candidate(self) -> None:
        path = self.root / "catalog-candidate.json"
        path.write_text(json.dumps(candidate()), encoding="utf-8")
        with self.assertRaisesRegex(publication.CatalogPublicationError, "canonical deterministic"):
            publication.read_candidate(path)

        value = candidate()
        value["authority"]["publication"] = True
        path.write_bytes(canonical(value))
        with self.assertRaisesRegex(publication.CatalogPublicationError, "authority-free"):
            publication.read_candidate(path)

    def test_publication_rejects_invalid_sequence_and_entry_order(self) -> None:
        value = candidate()
        path = self.write_candidate(value)
        parsed, payload = publication.read_candidate(path)
        for sequence in [0, -1, True]:
            with self.assertRaisesRegex(publication.CatalogPublicationError, "positive integer"):
                publication.render_publication(
                    candidate=parsed,
                    candidate_bytes=payload,
                    sequence=sequence,
                )

        duplicate = candidate()
        duplicate["entries"].append(dict(duplicate["entries"][0]))
        path.write_bytes(canonical(duplicate))
        with self.assertRaisesRegex(publication.CatalogPublicationError, "sorted and unique"):
            publication.read_candidate(path)


if __name__ == "__main__":
    unittest.main()
