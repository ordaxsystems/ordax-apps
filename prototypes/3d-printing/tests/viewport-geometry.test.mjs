import assert from "node:assert/strict";
import test from "node:test";
import { fitMovesToBed, measureBedViewport, projectPointToBed } from "../features/visualizador-gcode/viewport-geometry.mjs";

test("trajetos quadrados ficam centralizados e dentro do recuo da mesa", () => {
  const projection = fitMovesToBed([{ x1: 30, y1: 30, x2: 170, y2: 170 }], 220, 12);
  assert.deepEqual(projectPointToBed(projection, 30, 30), { x: 12, y: 208 });
  assert.deepEqual(projectPointToBed(projection, 170, 170), { x: 208, y: 12 });
});

test("trajetos retangulares preservam proporção e centralização vertical", () => {
  const projection = fitMovesToBed([{ x1: 0, y1: 0, x2: 100, y2: 200 }], 220, 12);
  assert.equal(projection.scale, 0.98);
  assert.deepEqual(projectPointToBed(projection, 0, 0), { x: 61, y: 208 });
  assert.deepEqual(projectPointToBed(projection, 100, 200), { x: 159, y: 12 });
});

test("geometria vazia não produz projeção", () => {
  assert.equal(fitMovesToBed([], 220), null);
  assert.equal(projectPointToBed(null, 0, 0), null);
});

test("viewport oculto ou pequeno demais não tenta criar mesa de impressão", () => {
  assert.equal(measureBedViewport(0, 400), null);
  assert.equal(measureBedViewport(300, 0), null);
  assert.equal(measureBedViewport(60, 50), null);
  assert.deepEqual(measureBedViewport(300, 320), { bedSize: 230, left: 35, top: 45 });
});

test("dimensões e coordenadas inválidas são rejeitadas", () => {
  assert.throws(() => fitMovesToBed([{ x1: 0, y1: 0, x2: Infinity, y2: 1 }], 220), /coordenadas inválidas/);
  assert.throws(() => fitMovesToBed([{ x1: 0, y1: 0, x2: 1, y2: 1 }], 0), /dimensões válidas/);
});
