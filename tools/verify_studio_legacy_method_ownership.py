#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "migrations" / "studio.legacy-method-ownership.json"

EXPECTED_OWNERS = {
    "studio-runtime",
    "memory",
    "intelligence",
    "host-policy",
    "identity-host",
    "adapter",
}
FORBIDDEN_RUNTIME_METHODS = {
    "computer_access_settings",
    "save_computer_access_settings",
    "connect_product_account",
    "blender_prepare",
    "blender_install_bridge",
    "blender_instances",
    "blender_adopt",
    "blender_start",
    "memory_context",
    "ai_sessions_status",
}
FORBIDDEN_GENERIC_DISPATCH = {"call", "execute", "deviceAgent"}


def fail(message: str) -> None:
    raise SystemExit(f"ORDAX_STUDIO_METHOD_OWNERSHIP=FAIL\n{message}")


def main() -> None:
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    if plan.get("$schema") != "ordax-apps.studio-legacy-method-ownership/1":
        fail("unexpected ownership schema")

    owners = plan.get("owners")
    if not isinstance(owners, dict) or set(owners) != EXPECTED_OWNERS:
        fail("legacy method owners are incomplete or contain an unreviewed owner")

    seen: dict[str, str] = {}
    for owner, methods in owners.items():
        if not isinstance(methods, list):
            fail(f"owner {owner} must contain a method list")
        for method in methods:
            if not isinstance(method, str) or not method:
                fail(f"owner {owner} contains an invalid method")
            if method in seen:
                fail(f"method {method} is assigned to both {seen[method]} and {owner}")
            seen[method] = owner

    runtime = set(owners["studio-runtime"])
    leaked = sorted(runtime & FORBIDDEN_RUNTIME_METHODS)
    if leaked:
        fail("studio-runtime absorbed foreign authority: " + ", ".join(leaked))

    invariants = plan.get("invariants")
    if not isinstance(invariants, dict):
        fail("migration invariants are missing")
    if invariants.get("cutover_allowed") is not False:
        fail("source cutover must remain blocked")
    if set(invariants.get("studio_runtime_must_not_own", [])) != FORBIDDEN_RUNTIME_METHODS:
        fail("studio-runtime foreign-authority denylist drifted")
    if set(invariants.get("generic_dispatch_forbidden", [])) != FORBIDDEN_GENERIC_DISPATCH:
        fail("generic dispatch denylist drifted")

    print("ORDAX_STUDIO_METHOD_OWNERSHIP=PASS")
    print(f"LEGACY_METHOD_COUNT={len(seen)}")
    print("CUTOVER_ALLOWED=false")


if __name__ == "__main__":
    main()
