const ANALYSIS_SCHEMA = "ordax.mesh-diagnostics/4";
const TRIANGLES_PER_CHUNK = 20_000;
export const meshTopologyTriangleLimit = 100_000;

function nextFrame() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("Análise de malha cancelada.", "AbortError");
}

function coordinateKey(positions, offset) {
  const x = positions[offset] || 0;
  const y = positions[offset + 1] || 0;
  const z = positions[offset + 2] || 0;
  return `${x},${y},${z}`;
}

function vertexId(positions, offset, vertices) {
  const key = coordinateKey(positions, offset);
  let id = vertices.get(key);
  if (id === undefined) {
    id = vertices.size;
    vertices.set(key, id);
  }
  return id;
}

function appendEdgeCode(codes, edgeCount, from, to, stride) {
  const lower = Math.min(from, to);
  const higher = Math.max(from, to);
  const pair = lower * stride + higher;
  codes[edgeCount] = pair * 2 + (from < to ? 0 : 1);
  return edgeCount + 1;
}

function summarizeEdgeIncidence(codes, edgeCount) {
  const sorted = codes.subarray(0, edgeCount);
  sorted.sort();
  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  let inconsistentWindingEdgeCount = 0;

  for (let index = 0; index < sorted.length;) {
    const pair = Math.floor(sorted[index] / 2);
    let forward = 0;
    let reverse = 0;
    let end = index;
    while (end < sorted.length && Math.floor(sorted[end] / 2) === pair) {
      if (sorted[end] % 2 === 0) forward++;
      else reverse++;
      end++;
    }
    const uses = end - index;
    if (uses === 1) boundaryEdgeCount++;
    else if (uses > 2) nonManifoldEdgeCount++;
    else if (forward === 2 || reverse === 2) inconsistentWindingEdgeCount++;
    index = end;
  }

  return Object.freeze({ boundaryEdgeCount, nonManifoldEdgeCount, inconsistentWindingEdgeCount });
}

function appendVertexLink(heads, next, neighborA, neighborB, linkCount, vertex, a, b) {
  next[linkCount] = heads[vertex];
  neighborA[linkCount] = a;
  neighborB[linkCount] = b;
  heads[vertex] = linkCount;
  return linkCount + 1;
}

async function summarizeVertexLinks(heads, next, neighborA, neighborB, vertexCount, signal) {
  let checkedVertexCount = 0, boundaryVertexCount = 0, interiorVertexCount = 0, nonManifoldVertexCount = 0;
  let processed = 0;
  const yieldIfNeeded = async () => {
    processed++;
    if (processed < TRIANGLES_PER_CHUNK) return;
    processed = 0;
    throwIfAborted(signal);
    await nextFrame();
  };
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    throwIfAborted(signal);
    if (heads[vertex] === -1) continue;
    const adjacency = new Map();
    for (let link = heads[vertex]; link !== -1; link = next[link]) {
      const a = neighborA[link], b = neighborB[link];
      if (a === b) continue;
      let neighborsA = adjacency.get(a);
      if (!neighborsA) adjacency.set(a, neighborsA = []);
      let neighborsB = adjacency.get(b);
      if (!neighborsB) adjacency.set(b, neighborsB = []);
      neighborsA.push(b);
      neighborsB.push(a);
      await yieldIfNeeded();
    }
    if (!adjacency.size) continue;
    checkedVertexCount++;

    let boundaryNodes = 0, invalidDegree = false;
    for (const neighbors of adjacency.values()) {
      if (neighbors.length === 1) boundaryNodes++;
      else if (neighbors.length !== 2) invalidDegree = true;
      await yieldIfNeeded();
    }
    const visited = new Set();
    let componentCount = 0;
    for (const start of adjacency.keys()) {
      if (visited.has(start)) continue;
      componentCount++;
      const pending = [start];
      visited.add(start);
      while (pending.length) {
        const current = pending.pop();
        for (const neighbor of adjacency.get(current) || []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          pending.push(neighbor);
          await yieldIfNeeded();
        }
      }
    }

    const oneRingIsManifold = componentCount === 1 && !invalidDegree && (boundaryNodes === 0 || boundaryNodes === 2);
    if (!oneRingIsManifold) nonManifoldVertexCount++;
    else if (boundaryNodes === 2) boundaryVertexCount++;
    else interiorVertexCount++;
  }
  return Object.freeze({ checkedVertexCount, boundaryVertexCount, interiorVertexCount, nonManifoldVertexCount });
}

export async function analyzeMeshGeometry(model, { signal } = {}) {
  if (!model || !Array.isArray(model.objects) || !model.objects.length) throw new TypeError("O modelo não contém objetos para analisar.");

  let triangleCount = 0, degenerateTriangleCount = 0, surfaceAreaSquareUnits = 0, processedSinceYield = 0;
  let boundaryEdgeCount = 0, nonManifoldEdgeCount = 0, inconsistentWindingEdgeCount = 0;
  let checkedVertexCount = 0, boundaryVertexCount = 0, interiorVertexCount = 0, nonManifoldVertexCount = 0;
  let checkedObjectCount = 0, skippedObjectCount = 0;
  const surfaceAreaByObject = [];
  const edgeIncidenceByObject = [];
  const vertexLinksByObject = [];

  for (const object of model.objects) {
    const positions = object.positions;
    if (!(positions instanceof Float32Array) || positions.length % 9 !== 0) throw new TypeError("A geometria do modelo tem um formato inesperado.");
    const dimensions = object.bounds?.dimensions;
    if (!Array.isArray(dimensions) || dimensions.length !== 3 || !dimensions.every(Number.isFinite)) throw new TypeError("As dimensões do objeto não podem ser analisadas.");
    const diagonal = Math.hypot(...dimensions);
    const crossProductThreshold = diagonal * diagonal * 1e-12;
    const thresholdSquared = crossProductThreshold * crossProductThreshold;
    const objectTriangleCount = positions.length / 9;
    triangleCount += objectTriangleCount;
    const topologySupported = objectTriangleCount <= meshTopologyTriangleLimit;
    const vertices = topologySupported ? new Map() : null;
    const vertexStride = objectTriangleCount * 3 + 1;
    const edgeCodes = topologySupported ? new Float64Array(objectTriangleCount * 3) : null;
    const vertexLinkCapacity = objectTriangleCount * 3;
    const vertexLinkHeads = topologySupported ? new Int32Array(vertexLinkCapacity).fill(-1) : null;
    const vertexLinkNext = topologySupported ? new Int32Array(vertexLinkCapacity) : null;
    const vertexLinkNeighborA = topologySupported ? new Uint32Array(vertexLinkCapacity) : null;
    const vertexLinkNeighborB = topologySupported ? new Uint32Array(vertexLinkCapacity) : null;
    let edgeCount = 0;
    let vertexLinkCount = 0;
    let objectDegenerateTriangleCount = 0;
    let objectSurfaceAreaSquareUnits = 0;

    for (let offset = 0; offset < positions.length; offset += 9) {
      throwIfAborted(signal);
      const abx = positions[offset + 3] - positions[offset];
      const aby = positions[offset + 4] - positions[offset + 1];
      const abz = positions[offset + 5] - positions[offset + 2];
      const acx = positions[offset + 6] - positions[offset];
      const acy = positions[offset + 7] - positions[offset + 1];
      const acz = positions[offset + 8] - positions[offset + 2];
      const crossX = aby * acz - abz * acy;
      const crossY = abz * acx - abx * acz;
      const crossZ = abx * acy - aby * acx;
      const crossMagnitude = Math.hypot(crossX, crossY, crossZ);
      if (crossMagnitude * crossMagnitude <= thresholdSquared) {
        degenerateTriangleCount++;
        objectDegenerateTriangleCount++;
      }
      objectSurfaceAreaSquareUnits += crossMagnitude / 2;

      if (topologySupported) {
        const a = vertexId(positions, offset, vertices);
        const b = vertexId(positions, offset + 3, vertices);
        const c = vertexId(positions, offset + 6, vertices);
        if (a !== b && b !== c && c !== a) {
          edgeCount = appendEdgeCode(edgeCodes, edgeCount, a, b, vertexStride);
          edgeCount = appendEdgeCode(edgeCodes, edgeCount, b, c, vertexStride);
          edgeCount = appendEdgeCode(edgeCodes, edgeCount, c, a, vertexStride);
          vertexLinkCount = appendVertexLink(vertexLinkHeads, vertexLinkNext, vertexLinkNeighborA, vertexLinkNeighborB, vertexLinkCount, a, b, c);
          vertexLinkCount = appendVertexLink(vertexLinkHeads, vertexLinkNext, vertexLinkNeighborA, vertexLinkNeighborB, vertexLinkCount, b, c, a);
          vertexLinkCount = appendVertexLink(vertexLinkHeads, vertexLinkNext, vertexLinkNeighborA, vertexLinkNeighborB, vertexLinkCount, c, a, b);
        }
      }

      processedSinceYield++;
      if (processedSinceYield >= TRIANGLES_PER_CHUNK) {
        processedSinceYield = 0;
        await nextFrame();
      }
    }

    surfaceAreaSquareUnits += objectSurfaceAreaSquareUnits;
    surfaceAreaByObject.push(Object.freeze({ objectId: object.id, triangleCount: objectTriangleCount, degenerateTriangleCount: objectDegenerateTriangleCount, surfaceAreaSquareUnits: objectSurfaceAreaSquareUnits }));
    if (topologySupported) {
      const incidence = summarizeEdgeIncidence(edgeCodes, edgeCount);
      boundaryEdgeCount += incidence.boundaryEdgeCount;
      nonManifoldEdgeCount += incidence.nonManifoldEdgeCount;
      inconsistentWindingEdgeCount += incidence.inconsistentWindingEdgeCount;
      checkedObjectCount++;
      edgeIncidenceByObject.push(Object.freeze({ objectId: object.id, checked: true, ...incidence }));
      const links = await summarizeVertexLinks(vertexLinkHeads, vertexLinkNext, vertexLinkNeighborA, vertexLinkNeighborB, vertices.size, signal);
      checkedVertexCount += links.checkedVertexCount;
      boundaryVertexCount += links.boundaryVertexCount;
      interiorVertexCount += links.interiorVertexCount;
      nonManifoldVertexCount += links.nonManifoldVertexCount;
      vertexLinksByObject.push(Object.freeze({ objectId: object.id, checked: true, ...links }));
    } else {
      skippedObjectCount++;
      edgeIncidenceByObject.push(Object.freeze({ objectId: object.id, checked: false, reason: "triangle-limit", boundaryEdgeCount: null, nonManifoldEdgeCount: null, inconsistentWindingEdgeCount: null }));
      vertexLinksByObject.push(Object.freeze({ objectId: object.id, checked: false, reason: "triangle-limit", checkedVertexCount: null, boundaryVertexCount: null, interiorVertexCount: null, nonManifoldVertexCount: null }));
    }
  }

  throwIfAborted(signal);
  return Object.freeze({
    schema: ANALYSIS_SCHEMA,
    method: "local-triangle-area-and-edge-incidence",
    triangleCount,
    degenerateTriangleCount,
    surfaceAreaSquareUnits,
    surfaceAreaByObject: Object.freeze(surfaceAreaByObject),
    edgeIncidence: Object.freeze({
      method: "exact-float32-coordinate-matching-per-object",
      complete: skippedObjectCount === 0,
      checkedObjectCount,
      skippedObjectCount,
      triangleLimitPerObject: meshTopologyTriangleLimit,
      boundaryEdgeCount,
      nonManifoldEdgeCount,
      inconsistentWindingEdgeCount,
    }),
    edgeIncidenceByObject: Object.freeze(edgeIncidenceByObject),
    vertexLinks: Object.freeze({
      method: "connected-path-or-cycle-per-vertex",
      complete: skippedObjectCount === 0,
      checkedObjectCount,
      skippedObjectCount,
      triangleLimitPerObject: meshTopologyTriangleLimit,
      checkedVertexCount,
      boundaryVertexCount,
      interiorVertexCount,
      nonManifoldVertexCount,
    }),
    vertexLinksByObject: Object.freeze(vertexLinksByObject),
    threshold: "área nula ou muito próxima de zero em relação à diagonal de cada objeto",
    topologyVerified: false,
    watertightness: "not-checked",
  });
}

export const meshAnalysisSchema = ANALYSIS_SCHEMA;
