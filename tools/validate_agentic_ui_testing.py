from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ID_RE = re.compile(r"^[a-z][a-z0-9.-]{1,80}$")
FORBIDDEN_KEYS = {"x", "y", "left", "top", "screen_x", "screen_y", "password", "token", "secret", "cookie"}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_app(app_dir: Path) -> list[str]:
    errors: list[str] = []
    app_manifest = load_json(app_dir / "app.json")
    testing = app_dir / "testing"
    semantic_path = app_dir / "presentation" / "semantic-ui.json"
    scenarios_path = testing / "agentic-scenarios.json"
    if not semantic_path.exists() and not scenarios_path.exists():
        return errors
    if not semantic_path.exists() or not scenarios_path.exists():
        return [f"{app_dir.name}: semantic map and agentic scenarios must be adopted together"]

    semantic = load_json(semantic_path)
    scenarios = load_json(scenarios_path)
    expected = (app_manifest["id"], app_manifest["version"])
    if semantic.get("schema") != "ordax-apps.ui-semantic-map/1": errors.append(f"{app_dir.name}: invalid semantic schema")
    if scenarios.get("schema") != "ordax-apps.agentic-test-scenarios/1": errors.append(f"{app_dir.name}: invalid scenarios schema")
    for name, value in (("semantic", semantic), ("scenarios", scenarios)):
        if (value.get("appId"), value.get("appVersion")) != expected: errors.append(f"{app_dir.name}: {name} identity/version drift")
        if value.get("authority") != "none": errors.append(f"{app_dir.name}: {name} must never declare authority")
    if semantic.get("execution") != "descriptive-only": errors.append(f"{app_dir.name}: semantic execution must be descriptive-only")
    if scenarios.get("execution") != "plan-only": errors.append(f"{app_dir.name}: scenarios execution must be plan-only")
    privacy = semantic.get("privacy") or {}
    if privacy.get("captureInputValues") is not False or privacy.get("captureCredentials") is not False: errors.append(f"{app_dir.name}: semantic snapshots must redact inputs and credentials")

    element_ids: set[str] = set()
    for element in semantic.get("elements") or []:
        element_id = element.get("id")
        if not isinstance(element_id, str) or not ID_RE.fullmatch(element_id): errors.append(f"{app_dir.name}: invalid semantic element id {element_id!r}"); continue
        if element_id in element_ids: errors.append(f"{app_dir.name}: duplicate semantic element {element_id}")
        element_ids.add(element_id)
        selector = element.get("selector")
        if not isinstance(selector, str) or not selector.startswith("#"): errors.append(f"{app_dir.name}: semantic selector must be a stable local id for {element_id}")
        if FORBIDDEN_KEYS.intersection(element): errors.append(f"{app_dir.name}: coordinates/secrets forbidden in semantic element {element_id}")

    defaults = scenarios.get("defaults") or {}
    if defaults.get("coordinateFallback") is not False: errors.append(f"{app_dir.name}: coordinate fallback must be opt-in outside first-party semantic scenarios")
    if defaults.get("repeatUncertainEffects") is not False: errors.append(f"{app_dir.name}: uncertain effects must never be repeated")
    if not isinstance(defaults.get("maxSteps"), int) or not 1 <= defaults["maxSteps"] <= 100: errors.append(f"{app_dir.name}: invalid maxSteps")

    scenario_ids: set[str] = set()
    for scenario in scenarios.get("scenarios") or []:
        scenario_id = scenario.get("id")
        if not isinstance(scenario_id, str) or not ID_RE.fullmatch(scenario_id): errors.append(f"{app_dir.name}: invalid scenario id {scenario_id!r}"); continue
        if scenario_id in scenario_ids: errors.append(f"{app_dir.name}: duplicate scenario {scenario_id}")
        scenario_ids.add(scenario_id)
        if not isinstance(scenario.get("goal"), str) or not scenario["goal"].strip(): errors.append(f"{app_dir.name}: scenario {scenario_id} has no goal")
        capabilities = scenario.get("allowedCapabilities") or []
        if not capabilities or any(not isinstance(item, str) or not item.strip() for item in capabilities): errors.append(f"{app_dir.name}: scenario {scenario_id} needs explicit capabilities")
        probes = scenario.get("probeCapabilities")
        if not isinstance(probes, list) or any(not isinstance(item, str) or not item.strip() for item in probes): errors.append(f"{app_dir.name}: scenario {scenario_id} needs an explicit probeCapabilities list")
        elif not set(probes).issubset(set(capabilities)): errors.append(f"{app_dir.name}: scenario {scenario_id} probes capabilities outside its allowlist")
        referenced = set(scenario.get("semanticElements") or [])
        missing = referenced.difference(element_ids)
        if missing: errors.append(f"{app_dir.name}: scenario {scenario_id} references unknown semantic ids {sorted(missing)}")
        if not scenario.get("success"): errors.append(f"{app_dir.name}: scenario {scenario_id} has no success criteria")
        if not scenario.get("evidence"): errors.append(f"{app_dir.name}: scenario {scenario_id} has no evidence requirements")
        serialized = json.dumps(scenario, sort_keys=True).lower()
        if any(f'"{key}"' in serialized for key in FORBIDDEN_KEYS): errors.append(f"{app_dir.name}: scenario {scenario_id} contains coordinate/secret fields")
    return errors


def main() -> int:
    all_errors: list[str] = []; adopted = 0
    for app_dir in sorted((ROOT / "apps").iterdir()):
        if not app_dir.is_dir() or not (app_dir / "app.json").exists(): continue
        if (app_dir / "presentation" / "semantic-ui.json").exists() or (app_dir / "testing" / "agentic-scenarios.json").exists(): adopted += 1
        all_errors.extend(validate_app(app_dir))
    if all_errors:
        for error in all_errors: print(f"ERROR: {error}")
        return 1
    print(f"AGENTIC_UI_TESTING_VALID=YES apps={adopted}")
    return 0


if __name__ == "__main__": raise SystemExit(main())
