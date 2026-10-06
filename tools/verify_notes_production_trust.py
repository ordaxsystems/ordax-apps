#!/usr/bin/env python3
import base64
import binascii
import hashlib
import json
import stat
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "migrations" / "notes.externalization.json"
LOCK_PATH = ROOT / "migrations" / "notes.platform-trust.lock.json"
CHECKOUT = ROOT / ".ordax-platform-trust"

TRUST_REPOSITORY_PATH = "system/trust/runtime-components-ed25519.json"
TRUST_RUNTIME_PATH = "/srv/ordax-system/trust/runtime-components-ed25519.json"
TRUST_SCHEMA = "prototype-ordax.runtime-component-trust/1"

REQUIRED_GATES = (
    "canonical_component_trust_anchor_pinned",
    "component_publish_allowed",
    "production_component_slot_activation_allowed",
)

BLOCKER_BY_GATE = {
    "canonical_component_trust_anchor_pinned": "canonical-runtime-component-trust-anchor-not-pinned",
    "component_publish_allowed": "component-publication-not-authorized",
    "production_component_slot_activation_allowed": "production-component-slot-activation-not-authorized",
}


def fail(message: str) -> None:
    raise SystemExit(f"NOTES_PRODUCTION_TRUST=FAIL\n{message}")


def _no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail(f"duplicate JSON key in production trust material: {key}")
        result[key] = value
    return result


def _load_json_bytes(payload: bytes, label: str) -> dict:
    try:
        text = payload.decode("utf-8")
        value = json.loads(text, object_pairs_hook=_no_duplicate_keys)
    except (UnicodeError, json.JSONDecodeError) as exc:
        fail(f"invalid {label} JSON: {exc}")
    if not isinstance(value, dict):
        fail(f"{label} must contain one JSON object")
    return value


def _strict_anchor_file(path: Path) -> bytes:
    try:
        metadata = path.lstat()
    except OSError:
        fail("pinned runtime-component public anchor file is missing")
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        fail("runtime-component public anchor must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > 16 * 1024:
        fail("runtime-component public anchor size is outside the allowed range")
    try:
        return path.read_bytes()
    except OSError as exc:
        fail(f"cannot read runtime-component public anchor: {exc}")


def validate_public_anchor(checkout: Path, policy: dict, expected_key_id: str) -> None:
    gates = policy.get("current_gates") or {}
    anchor_gate = gates.get("canonical_component_trust_anchor_pinned")
    publish_gate = gates.get("component_publish_allowed")
    activation_gate = gates.get("production_component_slot_activation_allowed")

    if publish_gate is True and anchor_gate is not True:
        fail("component publication cannot be authorized before the canonical anchor is pinned")
    if activation_gate is True and publish_gate is not True:
        fail("production component-slot activation cannot be authorized before publication")

    anchor = policy.get("public_anchor")
    if not isinstance(anchor, dict) or set(anchor) != {
        "repository_path",
        "runtime_path",
        "pinned",
        "sha256",
    }:
        fail("platform trust policy public_anchor shape drifted")
    if anchor.get("repository_path") != TRUST_REPOSITORY_PATH:
        fail("platform trust policy repository anchor path drifted")
    if anchor.get("runtime_path") != TRUST_RUNTIME_PATH:
        fail("platform trust policy runtime anchor path drifted")

    anchor_path = checkout / TRUST_REPOSITORY_PATH

    if anchor_gate is False:
        if anchor.get("pinned") is not False or anchor.get("sha256") is not None:
            fail("unpinned platform trust policy has inconsistent anchor metadata")
        if anchor_path.exists() or anchor_path.is_symlink():
            fail("canonical anchor file exists while the platform trust gate says unpinned")
        return

    if anchor_gate is not True:
        fail("canonical component trust anchor gate must be boolean")
    if anchor.get("pinned") is not True:
        fail("canonical anchor gate is green but public_anchor.pinned is not true")

    expected_sha256 = anchor.get("sha256")
    if (
        not isinstance(expected_sha256, str)
        or len(expected_sha256) != 64
        or any(c not in "0123456789abcdef" for c in expected_sha256)
    ):
        fail("pinned runtime-component public anchor must carry an exact lowercase SHA-256")

    payload = _strict_anchor_file(anchor_path)
    actual_sha256 = hashlib.sha256(payload).hexdigest()
    if actual_sha256 != expected_sha256:
        fail(
            "runtime-component public anchor digest mismatch: "
            f"expected {expected_sha256}, got {actual_sha256}"
        )

    trust = _load_json_bytes(payload, "runtime-component public anchor")
    if set(trust) != {"$schema", "key_id", "public_key_base64"}:
        fail("runtime-component public anchor contains unexpected fields")
    if trust.get("$schema") != TRUST_SCHEMA:
        fail("runtime-component public anchor schema drifted")
    if trust.get("key_id") != expected_key_id:
        fail("runtime-component public anchor key id does not match the platform trust policy")

    encoded = trust.get("public_key_base64")
    if not isinstance(encoded, str):
        fail("runtime-component public anchor public key is missing")
    try:
        public_key = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        fail("runtime-component public anchor public key is not strict base64")
    if len(public_key) != 32:
        fail("runtime-component public anchor must contain exactly 32 Ed25519 public bytes")

    if policy.get("status") in {"operator-ceremony-pending", "foundation-only"}:
        fail("pinned runtime-component public anchor cannot use a pending/foundation-only policy status")


def main() -> None:
    plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))

    if lock.get("$schema") != "ordax-apps.notes-platform-trust-lock/1":
        fail("unexpected Notes platform trust lock schema")
    if lock.get("repository") != "washingtonmsdj/prototipo-ordax-os":
        fail("Notes platform trust repository drifted")
    commit = lock.get("commit")
    if not isinstance(commit, str) or len(commit) != 40 or any(c not in "0123456789abcdef" for c in commit):
        fail("Notes platform trust lock must pin an exact lowercase Git commit")
    if lock.get("policy_path") != "docs/contracts/runtime-component-trust-policy.json":
        fail("Notes platform trust policy path drifted")
    if lock.get("policy_schema") != "prototype-ordax.runtime-component-trust-policy/1":
        fail("Notes platform trust policy schema drifted")
    if lock.get("trust_domain") != "runtime-components":
        fail("Notes platform trust domain drifted")
    if lock.get("key_id") != "ordax-runtime-components-v1":
        fail("Notes platform trust key id drifted")
    if lock.get("required_for_distribution_activation") is not True:
        fail("Notes distribution must require the production trust gate")
    if lock.get("authority") != "none":
        fail("Notes trust lock must not carry authority")

    if not CHECKOUT.is_dir():
        fail("pinned platform trust checkout is missing")
    actual = subprocess.check_output(
        ["git", "-C", str(CHECKOUT), "rev-parse", "HEAD"],
        text=True,
    ).strip()
    if actual != commit:
        fail(f"pinned platform trust checkout mismatch: expected {commit}, got {actual}")

    policy_path = CHECKOUT / lock["policy_path"]
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    if policy.get("$schema") != lock["policy_schema"]:
        fail("platform trust policy schema does not match lock")
    if policy.get("trust_domain") != lock["trust_domain"]:
        fail("platform trust domain does not match lock")
    if policy.get("key_id") != lock["key_id"]:
        fail("platform trust key id does not match lock")

    gates = policy.get("current_gates") or {}
    missing = [gate for gate in REQUIRED_GATES if not isinstance(gates.get(gate), bool)]
    if missing:
        fail(f"platform trust policy is missing boolean gates: {missing}")

    validate_public_anchor(CHECKOUT, policy, lock["key_id"])

    activation = plan.get("distribution_activation_allowed")
    if activation not in (False, True):
        fail("Notes distribution_activation_allowed must be boolean")

    evidence = plan.get("distribution_evidence") or {}
    blockers = set(evidence.get("production_blockers") or [])
    expected_blockers = {
        BLOCKER_BY_GATE[gate]
        for gate in REQUIRED_GATES
        if gates.get(gate) is False
    }

    if activation:
        if expected_blockers:
            fail(
                "Notes distribution activation is enabled while platform trust gates are blocked: "
                + ", ".join(sorted(expected_blockers))
            )
        if evidence.get("production_activation") != "authorized":
            fail("authorized Notes distribution must record production_activation=authorized")
        if blockers:
            fail("authorized Notes distribution must have no production blockers")
        if policy.get("status") in {"operator-ceremony-pending", "foundation-only"}:
            fail("authorized Notes distribution cannot use a pending/foundation-only trust policy")
        print("NOTES_PRODUCTION_TRUST=PASS")
        print("NOTES_PRODUCTION_ACTIVATION=AUTHORIZED")
        return

    if blockers != expected_blockers:
        fail(
            "Notes production blockers do not match the pinned platform trust policy: "
            f"expected={sorted(expected_blockers)} actual={sorted(blockers)}"
        )
    if evidence.get("production_activation") != "blocked":
        fail("blocked Notes distribution must record production_activation=blocked")
    if not expected_blockers:
        fail(
            "platform trust gates are all green but Notes distribution remains disabled; "
            "advance the activation decision explicitly"
        )

    print("NOTES_PRODUCTION_TRUST=PASS")
    print("NOTES_PRODUCTION_ACTIVATION=BLOCKED_SAFE")
    for blocker in sorted(expected_blockers):
        print(f"BLOCKER={blocker}")


if __name__ == "__main__":
    main()
