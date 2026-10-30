import test from "node:test";
import assert from "node:assert/strict";

import { layerIndexFromSliderValue, layerSliderState } from "../features/visualizador-gcode/layer-control.mjs";

test("G-code layer slider uses human layer numbers and maps to zero-based parser indexes", () => {
  assert.deepEqual(layerSliderState(0, 4), {
    min: 1,
    max: 4,
    value: 1,
    valueText: "Camada 1 de 4",
  });
  assert.deepEqual(layerSliderState(3, 4), {
    min: 1,
    max: 4,
    value: 4,
    valueText: "Camada 4 de 4",
  });
  assert.equal(layerIndexFromSliderValue(1, 4), 0);
  assert.equal(layerIndexFromSliderValue(4, 4), 3);
});

test("G-code layer slider clamps boundary values and supports a one-layer file", () => {
  assert.equal(layerIndexFromSliderValue(0, 4), 0);
  assert.equal(layerIndexFromSliderValue(99, 4), 3);
  assert.deepEqual(layerSliderState(0, 1), {
    min: 1,
    max: 1,
    value: 1,
    valueText: "Camada 1 de 1",
  });
  assert.throws(() => layerSliderState(0, 0), RangeError);
});