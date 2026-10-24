import assert from "node:assert/strict";
import test from "node:test";
import { parseGcodePreview } from "../features/fatiamento-3d/gcode-preview.mjs";

test("desenha arcos G2/G3 XY por I/J com tesselação limitada por erro de corda", () => {
  const preview = parseGcodePreview([
    ";TYPE:Outer wall",
    "G1 X10 Y0",
    "G3 X0 Y10 I-10 J0 E1",
  ].join("\n"));
  const arc = preview.segments.filter(segment => segment.arc);

  assert.equal(preview.unsupported.length, 0);
  assert.ok(arc.length > 1);
  assert.deepEqual([arc[0].x1, arc[0].y1], [10, 0]);
  assert.deepEqual([arc.at(-1).x2, arc.at(-1).y2], [0, 10]);
  assert.ok(arc.every(segment => segment.type === "outer" && segment.extrusion && segment.layer === 0));
  for (const segment of arc) {
    assert.ok(Math.abs(Math.hypot(segment.x2, segment.y2) - 10) <= 0.1);
  }
  assert.deepEqual(preview.layers, [0]);
});

test("interpreta raios positivos como arcos menores e negativos como arcos maiores", () => {
  const shortArc = parseGcodePreview("G2 X10 Y0 R10 E1").segments.filter(segment => segment.arc);
  const longArc = parseGcodePreview("G2 X10 Y0 R-10 E1").segments.filter(segment => segment.arc);
  assert.ok(shortArc.length >= 2);
  assert.ok(longArc.length > shortArc.length * 3);
  assert.deepEqual([shortArc.at(-1).x2, shortArc.at(-1).y2], [10, 0]);
  assert.deepEqual([longArc.at(-1).x2, longArc.at(-1).y2], [10, 0]);
});

test("expande círculos completos com centro I/J e preserva o ponto de fechamento", () => {
  const preview = parseGcodePreview("G1 X10 Y0\nG2 X10 Y0 I-10 J0 E1");
  const arc = preview.segments.filter(segment => segment.arc);
  assert.ok(arc.length >= 20);
  assert.deepEqual([arc[0].x1, arc[0].y1], [10, 0]);
  assert.deepEqual([arc.at(-1).x2, arc.at(-1).y2], [10, 0]);
  assert.ok(arc.every(segment => segment.extrusion));
});

test("respeita modo relativo, unidades em polegadas e centro de arco absoluto", () => {
  const relative = parseGcodePreview("G91\nG1 X10 Y0\nG91.1\nG3 X-10 Y10 I-10 J0 E1");
  const relativeArc = relative.segments.filter(segment => segment.arc);
  assert.ok(relativeArc.length > 1);
  assert.deepEqual([relativeArc.at(-1).x2, relativeArc.at(-1).y2], [0, 10]);

  const absoluteCenter = parseGcodePreview("G1 X10 Y0\nG90.1\nG3 X0 Y10 I0 J0 E1");
  assert.equal(absoluteCenter.unsupported.length, 0);
  assert.deepEqual([absoluteCenter.segments.at(-1).x2, absoluteCenter.segments.at(-1).y2], [0, 10]);

  const inches = parseGcodePreview("G20\nG1 X1 Y0 E1");
  assert.equal(inches.segments[0].x2, 25.4);
  assert.equal(inches.segments[0].extrusion, true);
});

test("sinaliza arcos fora do plano XY e continua a trajetória a partir do endpoint", () => {
  const preview = parseGcodePreview([
    "G1 X10 Y0 E1",
    "G18",
    "G2 X20 Y5 I1 K0 E2",
    "G17",
    "G1 X21 Y5 E3",
  ].join("\n"));
  assert.deepEqual(preview.unsupported, ["G2"]);
  const afterArc = preview.segments.at(-1);
  assert.deepEqual([afterArc.x1, afterArc.y1], [20, 5]);
  assert.deepEqual([afterArc.x2, afterArc.y2], [21, 5]);
});

test("não atribui um arco helicoidal a uma única camada do inspetor", () => {
  const preview = parseGcodePreview("G1 X10 Y0 Z0.2 E1\nG3 X0 Y10 Z0.4 I-10 J0 E2");
  assert.deepEqual(preview.unsupported, ["G3"]);
  assert.equal(preview.segments.some(segment => segment.arc), false);
});

test("sinaliza arcos sem geometria interpretável e ainda avança coordenadas modais", () => {
  const preview = parseGcodePreview("G3 X10 Y10 E1\nG1 X11 Y10 E2");
  assert.deepEqual(preview.unsupported, ["G3"]);
  assert.deepEqual([preview.segments[0].x1, preview.segments[0].y1], [10, 10]);
  assert.deepEqual([preview.segments[0].x2, preview.segments[0].y2], [11, 10]);
});

test("mantém a camada e o tipo de extrusão nos segmentos de um arco", () => {
  const preview = parseGcodePreview([
    ";LAYER_CHANGE",
    ";TYPE:Internal perimeter",
    "G1 X10 Y0 Z0.2 E1",
    "G3 X0 Y10 I-10 J0 Z0.2 E2",
  ].join("\n"));
  const arc = preview.segments.filter(segment => segment.arc);
  assert.ok(arc.length > 1);
  assert.ok(arc.every(segment => segment.layer === 0 && segment.type === "inner" && segment.extrusion));
});

test("limita a expansão de cada arco para não explodir o preview", () => {
  const preview = parseGcodePreview("G1 X10000 Y0\nG3 X10000 Y0 I-10000 J0 E1");
  const arc = preview.segments.filter(segment => segment.arc);
  assert.equal(arc.length, 512);
  assert.deepEqual([arc.at(-1).x2, arc.at(-1).y2], [10000, 0]);
});
