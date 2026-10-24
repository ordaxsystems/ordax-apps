import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMeshGeometry, meshTopologyTriangleLimit } from "../features/fatiamento-3d/mesh-analysis.mjs";

function modelFromFaces(faces, id = "mesh") {
  const flat = faces.flat(2);
  const positions = new Float32Array(flat);
  const points = Array.from({ length: positions.length / 3 }, (_, index) => [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]]);
  const min = [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis])));
  return { objects: [{ id, positions, bounds: { dimensions: min.map((value, axis) => max[axis] - value) } }] };
}

function tetrahedron() {
  const a = [0, 0, 0], b = [1, 0, 0], c = [0, 1, 0], d = [0, 0, 1];
  return [[a, c, b], [a, b, d], [a, d, c], [b, c, d]];
}

test("conta arestas abertas sem declarar verificação topológica completa", async () => {
  const result = await analyzeMeshGeometry(modelFromFaces([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]));
  assert.deepEqual(result.edgeIncidence, {
    method: "exact-float32-coordinate-matching-per-object",
    complete: true,
    checkedObjectCount: 1,
    skippedObjectCount: 0,
    triangleLimitPerObject: meshTopologyTriangleLimit,
    boundaryEdgeCount: 3,
    nonManifoldEdgeCount: 0,
    inconsistentWindingEdgeCount: 0,
  });
  assert.deepEqual(result.vertexLinks, {
    method: "connected-path-or-cycle-per-vertex",
    complete: true,
    checkedObjectCount: 1,
    skippedObjectCount: 0,
    triangleLimitPerObject: meshTopologyTriangleLimit,
    checkedVertexCount: 3,
    boundaryVertexCount: 3,
    interiorVertexCount: 0,
    nonManifoldVertexCount: 0,
  });
  assert.equal(result.topologyVerified, false);
  assert.equal(result.watertightness, "not-checked");
});

test("reconhece incidência fechada em um tetraedro com orientação consistente", async () => {
  const result = await analyzeMeshGeometry(modelFromFaces(tetrahedron()));
  assert.equal(result.edgeIncidence.complete, true);
  assert.equal(result.edgeIncidence.boundaryEdgeCount, 0);
  assert.equal(result.edgeIncidence.nonManifoldEdgeCount, 0);
  assert.equal(result.edgeIncidence.inconsistentWindingEdgeCount, 0);
  assert.equal(result.vertexLinks.boundaryVertexCount, 0);
  assert.equal(result.vertexLinks.interiorVertexCount, 4);
  assert.equal(result.vertexLinks.nonManifoldVertexCount, 0);
});

test("detecta duas regiões de faces que só se tocam em um vértice", async () => {
  const faces = [
    [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    [[0, 0, 0], [-1, 0, 0], [0, -1, 0]],
  ];
  const result = await analyzeMeshGeometry(modelFromFaces(faces));
  assert.equal(result.vertexLinks.complete, true);
  assert.equal(result.vertexLinks.nonManifoldVertexCount, 1);
  assert.equal(result.vertexLinks.boundaryVertexCount, 4);
});

test("atribui contagens de faces degeneradas a cada objeto da mesa", async () => {
  const clean = modelFromFaces([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]], "clean").objects[0];
  const degenerate = modelFromFaces([[[0, 0, 0], [0, 0, 0], [1, 1, 1]]], "degenerate").objects[0];
  const result = await analyzeMeshGeometry({ objects: [clean, degenerate] });
  assert.deepEqual(result.surfaceAreaByObject.map(item => [item.objectId, item.degenerateTriangleCount]), [["clean", 0], ["degenerate", 1]]);
});

test("detecta aresta compartilhada por mais de duas faces", async () => {
  const faces = [
    [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    [[0, 0, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
  ];
  const result = await analyzeMeshGeometry(modelFromFaces(faces));
  assert.equal(result.edgeIncidence.nonManifoldEdgeCount, 1);
  assert.equal(result.edgeIncidence.boundaryEdgeCount, 6);
  assert.equal(result.vertexLinks.nonManifoldVertexCount, 2);
});

test("detecta duas faces vizinhas que percorrem a aresta comum na mesma direção", async () => {
  const faces = [
    [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    [[0, 0, 0], [1, 0, 0], [0, -1, 0]],
  ];
  const result = await analyzeMeshGeometry(modelFromFaces(faces));
  assert.equal(result.edgeIncidence.inconsistentWindingEdgeCount, 1);
  assert.equal(result.edgeIncidence.boundaryEdgeCount, 4);
  assert.equal(result.vertexLinks.nonManifoldVertexCount, 0);
});

test("pula incidência de arestas acima do limite de memória documentado", async () => {
  const triangleCount = meshTopologyTriangleLimit + 1;
  const positions = new Float32Array(triangleCount * 9);
  for (let offset = 0; offset < positions.length; offset += 9) {
    positions[offset + 3] = 1;
    positions[offset + 7] = 1;
  }
  const result = await analyzeMeshGeometry({ objects: [{ id: "large", positions, bounds: { dimensions: [1, 1, 0] } }] });
  assert.equal(result.edgeIncidence.complete, false);
  assert.equal(result.edgeIncidence.checkedObjectCount, 0);
  assert.equal(result.edgeIncidence.skippedObjectCount, 1);
  assert.equal(result.edgeIncidenceByObject[0].reason, "triangle-limit");
  assert.equal(result.vertexLinks.complete, false);
  assert.equal(result.vertexLinks.checkedObjectCount, 0);
  assert.equal(result.vertexLinks.skippedObjectCount, 1);
  assert.equal(result.vertexLinksByObject[0].nonManifoldVertexCount, null);
});
