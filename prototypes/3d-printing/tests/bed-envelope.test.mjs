import assert from "node:assert/strict";
import test from "node:test";
import { assessModelEnvelope, assessObjectEnvelopeOverlaps, boundsWithinPrintableSpace, estimateBrimMarginMm, objectsWithinPrintableSpace } from "../features/fatiamento-3d/bed-envelope.mjs";
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

test("marca pares com interseção entre caixas 3D como candidatos, sem afirmar colisão de malha", () => {
  const assessment = assessObjectEnvelopeOverlaps([
    { min: [0, 0, 0], max: [10, 10, 10] },
    { min: [8, 3, 4], max: [14, 12, 16] },
    { min: [20, 0, 0], max: [30, 10, 10] },
  ]);
  assert.equal(assessment.status, "overlap-candidates");
  assert.equal(assessment.checkedPairCount, 3);
  assert.equal(assessment.overlapPairCount, 1);
  assert.deepEqual(assessment.pairs, [{ firstObject: 1, secondObject: 2, overlapMm: [2, 7, 6] }]);
  assert.match(assessment.limitations, /não confirmam interseção entre malhas/);
});

test("não marca caixas separadas, apenas tocando, ou afastadas no eixo Z", () => {
  const assessment = assessObjectEnvelopeOverlaps([
    { min: [0, 0, 0], max: [10, 10, 10] },
    { min: [10, 0, 0], max: [20, 10, 10] },
    { min: [0, 0, 10], max: [10, 10, 20] },
  ]);
  assert.equal(assessment.status, "no-overlap-candidates");
  assert.equal(assessment.checkedPairCount, 3);
  assert.equal(assessment.overlapPairCount, 0);
  assert.deepEqual(assessment.pairs, []);
});

test("limita os pares exibidos e recusa parâmetros ou caixas inválidas", () => {
  const bounds = Array.from({ length: 6 }, () => ({ min: [0, 0, 0], max: [5, 5, 5] }));
  const assessment = assessObjectEnvelopeOverlaps(bounds, { limit: 2 });
  assert.equal(assessment.overlapPairCount, 15);
  assert.equal(assessment.pairs.length, 2);
  assert.equal(assessment.omittedPairCount, 13);
  assert.equal(assessObjectEnvelopeOverlaps([{ min: [0, 0], max: [1, 1] }, bounds[0]]).status, "not-assessed");
  assert.equal(assessObjectEnvelopeOverlaps(bounds, { toleranceMm: -1 }).status, "not-assessed");
});

test("estima somente brim externo de largura conhecida e não inventa margem para modos automáticos", () => {
  assert.equal(estimateBrimMarginMm({ brimType: "auto_brim", brimWidthMm: 18, brimGapMm: 0.2 }), null);
  assert.equal(estimateBrimMarginMm({ brimType: "brim_ears", brimWidthMm: 5, brimGapMm: 0.2 }), null);
  assert.equal(estimateBrimMarginMm({ brimType: "leading_edge_only", brimWidthMm: 5, brimGapMm: 0.2 }), null);
  assert.equal(estimateBrimMarginMm({ brimType: "outer_only", brimWidthMm: 5, brimGapMm: 0.2 }), 5.2);
  assert.equal(estimateBrimMarginMm({ brimType: "outer_only", brimWidthMm: 0, brimGapMm: 0.2 }), 0);
  assert.equal(estimateBrimMarginMm({ brimType: "inner_only", brimWidthMm: 5, brimGapMm: 0.2 }), 0);
  assert.equal(estimateBrimMarginMm({ brimType: "no_brim", brimWidthMm: 5, brimGapMm: 0.2 }), 0);
  assert.equal(estimateBrimMarginMm({ brimType: "painted", brimWidthMm: 5, brimGapMm: 0.2 }), null);
});

test("expande a caixa por margem XY de brim antes de validar bordas e zonas excluídas", () => {
  const bed = {
    bedSizeMm: [100, 100],
    bedExcludeAreasMm: [[[-5, -5], [5, -5], [5, 5], [-5, 5]]],
  };
  const nearEdge = { min: [44, 10, 0], max: [46, 12, 1] };
  assert.equal(boundsWithinPrintableSpace(nearEdge, bed), true);
  assert.equal(boundsWithinPrintableSpace(nearEdge, { ...bed, xyMarginMm: 5 }), false);
  const nearKeepout = { min: [7, -1, 0], max: [9, 1, 1] };
  assert.equal(boundsWithinPrintableSpace(nearKeepout, bed), true);
  assert.equal(boundsWithinPrintableSpace(nearKeepout, { ...bed, xyMarginMm: 3 }), false);
  assert.equal(boundsWithinPrintableSpace(nearKeepout, { ...bed, xyMarginMm: 1.9 }), true);
  assert.equal(boundsWithinPrintableSpace(nearEdge, { ...bed, xyMarginMm: 50.1 }), false);
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
  assert.match(profileFit.method, /per-object-expanded-bounds/);
  assert.equal(profileFit.xyMarginMm, 0);
  const referenceFit = assessModelEnvelope([objects[0]], { bedSizeMm: [200, 200], heightMm: 100, reference: true });
  assert.equal(referenceFit.status, "within-reference-envelope");
  assert.equal(assessModelEnvelope([], { bedSizeMm: [200, 200], heightMm: 100 }).status, "not-assessed");
});

test("não declara encaixe quando a largura automática do brim depende do motor", () => {
  const fit = assessModelEnvelope([{ min: [-10, -10, 0], max: [10, 10, 20] }], {
    bedSizeMm: [200, 200],
    heightMm: 100,
    xyMarginMm: null,
  });
  assert.equal(fit.status, "not-assessed");
  assert.equal(fit.xyMarginMm, null);
  assert.match(fit.reason, /depende do OrcaSlicer/);
});

test("mantém a mesa retangular para perfis sem contorno e bloqueia dados de exclusão malformados", () => {
  assert.equal(boundsWithinPrintableSpace({ min: [-49, -49], max: [49, 49] }, { bedSizeMm: [100, 100] }), true);
  assert.equal(boundsWithinPrintableSpace({ min: [-51, -1], max: [-49, 1] }, { bedSizeMm: [100, 100] }), false);
  assert.equal(boundsWithinPrintableSpace({ min: [0, 0], max: [1, 1] }, { bedSizeMm: [100, 100], bedExcludeAreasMm: [null] }), false);
});
