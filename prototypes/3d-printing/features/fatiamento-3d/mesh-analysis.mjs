const ANALYSIS_SCHEMA = "ordax.mesh-diagnostics/3";
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

export async function analyzeMeshGeometry(model, { signal } = {}) {
  if (!model || !Array.isArray(model.objects) || !model.objects.length) throw new TypeError("O modelo não contém objetos para analisar.");

  let triangleCount = 0, degenerateTriangleCount = 0, surfaceAreaSquareUnits = 0, processedSinceYield = 0;
  let boundaryEdgeCount = 0, nonManifoldEdgeCount = 0, inconsistentWindingEdgeCount = 0;
  let checkedObjectCount = 0, skippedObjectCount = 0;
  const surfaceAreaByObject = [];
  const edgeIncidenceByObject = [];

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
    let edgeCount = 0;
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
      if (crossMagnitude * crossMagnitude <= thresholdSquared) degenerateTriangleCount++;
      objectSurfaceAreaSquareUnits += crossMagnitude / 2;

      if (topologySupported) {
        const a = vertexId(positions, offset, vertices);
        const b = vertexId(positions, offset + 3, vertices);
        const c = vertexId(positions, offset + 6, vertices);
        if (a !== b && b !== c && c !== a) {
          edgeCount = appendEdgeCode(edgeCodes, edgeCount, a, b, vertexStride);
          edgeCount = appendEdgeCode(edgeCodes, edgeCount, b, c, vertexStride);
          edgeCount = appendEdgeCode(edgeCodes, edgeCount, c, a, vertexStride);
        }
      }

      processedSinceYield++;
      if (processedSinceYield >= TRIANGLES_PER_CHUNK) {
        processedSinceYield = 0;
        await nextFrame();
      }
    }

    surfaceAreaSquareUnits += objectSurfaceAreaSquareUnits;
    surfaceAreaByObject.push(Object.freeze({ objectId: object.id, triangleCount: objectTriangleCount, surfaceAreaSquareUnits: objectSurfaceAreaSquareUnits }));
    if (topologySupported) {
      const incidence = summarizeEdgeIncidence(edgeCodes, edgeCount);
      boundaryEdgeCount += incidence.boundaryEdgeCount;
      nonManifoldEdgeCount += incidence.nonManifoldEdgeCount;
      inconsistentWindingEdgeCount += incidence.inconsistentWindingEdgeCount;
      checkedObjectCount++;
      edgeIncidenceByObject.push(Object.freeze({ objectId: object.id, checked: true, ...incidence }));
    } else {
      skippedObjectCount++;
      edgeIncidenceByObject.push(Object.freeze({ objectId: object.id, checked: false, reason: "triangle-limit", boundaryEdgeCount: null, nonManifoldEdgeCount: null, inconsistentWindingEdgeCount: null }));
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
    threshold: "área nula ou muito próxima de zero em relação à diagonal de cada objeto",
    topologyVerified: false,
    watertightness: "not-checked",
  });
}

export const meshAnalysisSchema = ANALYSIS_SCHEMA;
