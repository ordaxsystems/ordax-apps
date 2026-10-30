import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KITCHEN_DISPLAY_CONFIGURATION,
  kitchenDisplayStage,
  resizeKitchenDisplayConfiguration,
  validateKitchenDisplayConfiguration,
} from "../src/application/kitchen-display-configuration.mjs";

test("single-screen setup keeps the complete order flow on one display", () => {
  const configuration = resizeKitchenDisplayConfiguration(DEFAULT_KITCHEN_DISPLAY_CONFIGURATION, 1, "complete-cycle");

  assert.deepEqual(configuration, { mode: "complete-cycle", screenCount: 1, assignments: ["all"] });
  assert.equal(kitchenDisplayStage(configuration, 1), "all");
});

test("specialized screens default to the current order-level stages and keep custom assignments when resized", () => {
  const initial = resizeKitchenDisplayConfiguration(DEFAULT_KITCHEN_DISPLAY_CONFIGURATION, 4, "by-stage");
  const customized = validateKitchenDisplayConfiguration({
    ...initial,
    assignments: ["received", "preparing", "preparing", "ready"],
  });
  const resized = resizeKitchenDisplayConfiguration(customized, 5, "by-stage");

  assert.deepEqual(initial.assignments, ["received", "preparing", "ready", "received"]);
  assert.deepEqual(resized.assignments, ["received", "preparing", "preparing", "ready", "preparing"]);
  assert.equal(kitchenDisplayStage(resized, 3), "preparing");
});

test("configuration rejects unsupported screen counts, statuses and inconsistent full-cycle assignments", () => {
  assert.throws(() => resizeKitchenDisplayConfiguration(DEFAULT_KITCHEN_DISPLAY_CONFIGURATION, 0, "by-stage"), /1 a 8 telas/);
  assert.throws(() => validateKitchenDisplayConfiguration({ mode: "by-stage", screenCount: 1, assignments: ["baking"] }), /inválida/);
  assert.throws(() => validateKitchenDisplayConfiguration({ mode: "complete-cycle", screenCount: 1, assignments: ["received"] }), /fluxo completo/);
  assert.throws(() => kitchenDisplayStage(DEFAULT_KITCHEN_DISPLAY_CONFIGURATION, 2), /não está configurada/);
});
