#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN_PATH = ROOT / "migrations" / "notes.externalization.json"
LOCK_PATH = ROOT / "migrations" / "notes.platform-trust.lock.json"
CHECKOUT = ROOT / ".ordax-platform-trust"

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
