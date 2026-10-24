import assert from "node:assert/strict";
import test from "node:test";
import { assessModelEnvelope, boundsWithinPrintableSpace, objectsWithinPrintableSpace } from "../features/fatiamento-3d/bed-envelope.mjs";
import { parseBedShape } from "../shared/orca-slicer-development.mjs";

test("normaliza o polígono imprimível ao centro do espaço de trabalho", () => {
  const bed = parseBedShape({
    printable_area: ["0x0", "235x0", "235x235", "0x235"],
    bed_exclude_area: ["0x0"],
  });
  assert.deepEqual(bed.bedSizeMm, [235, 235]);
  assert.deepEqual(bed.bedOutlineMm, [[-117.5, -117.5], [117.5, -117.5], [117.5, 117.5], [-117.5, 117.5]]);
  assert.deepEqual(bed.bedExcludeAreasMm, []);
});

test("recusa contorno de mesa inválido ou auto-intersectante", () => {
  assert.equal(parseBedShape({ printable_area: ["0x0", "100x100", "0x100", "100x0"] }), null);
  assert.equal(parseBedShape({ printable_area: ["0x0", "40x0", "40x40", "0x40"] }), null);
});

test("usa o contorno poligonal real em vez de aceitar qualquer ponto do retângulo externo", () => {
  const diamond = [[0, -50], [50, 0], [0, 50], [-50, 0]];
  assert.equal(boundsWithinPrintableSpace({ min: [-5, -5], max: [5, 5] }, { bedOutlineMm: diamond }), true);
  assert.equal(boundsWithinPrintableSpace({ min: [-45, -45], max: [45, 45] }, { bedOutlineMm: diamond }), false);
});

test("detecta a borda de um contorno côncavo que cruza uma reentrância", () => {
  const concave = [[-50, -50], [50, -50], [50, 50], [10, 50], [10, -10], [-10, -10], [-10, 50], [-50, 50]];
  assert.equal(boundsWithinPrintableSpace({ min: [-35, 5], max: [35, 15] }, { bedOutlineMm: concave }), false);
  assert.equal(boundsWithinPrintableSpace({ min: [-45, 20], max: [-30, 35] }, { bedOutlineMm: concave }), true);
});

test("lê várias zonas excluídas do formato de perfil Orca e bloqueia sobreposição", () => {
  const bed = parseBedShape({
    printable_area: ["0x0", "256x0", "256x256", "0x256"],
    bed_exclude_area: ["0x0", "28x0", "28x28", "0x28", "0x28", "8x28", "8x256", "0x256"],
  });
  assert.equal(bed.bedExcludeAreasMm.length, 2);
  assert.equal(boundsWithinPrintableSpace({ min: [-127, -127], max: [-125, -125] }, bed), false);
  assert.equal(boundsWithinPrintableSpace({ min: [0, 0], max: [10, 10] }, bed), true);
});

test("avalia cada objeto separadamente sem preencher o vão entre as peças", () => {
  const space = {
    bedSizeMm: [200, 200],
    heightMm: 200,
    bedExcludeAreasMm: [[[ -5, -5], [5, -5], [5, 5], [-5, 5]]],
  };
  assert.equal(objectsWithinPrintableSpace([
    { min: [-90, -5, 0], max: [-80, 5, 10] },
    { min: [80, -5, 0], max: [90, 5, 10] },
  ], space), true);
  assert.equal(objectsWithinPrintableSpace([
    { min: [-90, -5, 0], max: [-80, 5, 10] },
    { min: [-1, -1, 0], max: [1, 1, 10] },
  ], space), false);
});

test("produz estado de triagem bounded para a IA e diferencia perfil real de referência", () => {
  const objects = [
    { min: [-10, -10, 0], max: [10, 10, 20] },
    { min: [80, 0, 0], max: [110, 30, 20] },
  ];
  const profileFit = assessModelEnvelope(objects, { bedSizeMm: [200, 200], heightMm: 100 });
  assert.equal(profileFit.status, "outside-profile-envelope");
  assert.equal(profileFit.checkedObjectCount, 2);
  assert.equal(profileFit.outsideObjectCount, 1);
  assert.deepEqual(profileFit.outsideObjectItems, [2]);
  assert.match(profileFit.method, /per-object-axis-aligned-bounds/);
  const referenceFit = assessModelEnvelope([objects[0]], { bedSizeMm: [200, 200], heightMm: 100, reference: true });
  assert.equal(referenceFit.status, "within-reference-envelope");
  assert.equal(assessModelEnvelope([], { bedSizeMm: [200, 200], heightMm: 100 }).status, "not-assessed");
});

test("mantém a mesa retangular para perfis sem contorno e bloqueia dados de exclusão malformados", () => {
  assert.equal(boundsWithinPrintableSpace({ min: [-49, -49], max: [49, 49] }, { bedSizeMm: [100, 100] }), true);
  assert.equal(boundsWithinPrintableSpace({ min: [-51, -1], max: [-49, 1] }, { bedSizeMm: [100, 100] }), false);
  assert.equal(boundsWithinPrintableSpace({ min: [0, 0], max: [1, 1] }, { bedSizeMm: [100, 100], bedExcludeAreasMm: [null] }), false);
});
