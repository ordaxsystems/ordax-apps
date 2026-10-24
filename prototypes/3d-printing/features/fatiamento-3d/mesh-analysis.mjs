const ANALYSIS_SCHEMA = "ordax.mesh-diagnostics/1";
const TRIANGLES_PER_CHUNK = 20_000;

function nextFrame() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("Análise de malha cancelada.", "AbortError");
}

export async function analyzeMeshGeometry(model, { signal } = {}) {
  if (!model || !Array.isArray(model.objects) || !model.objects.length) throw new TypeError("O modelo não contém objetos para analisar.");

  let triangleCount = 0, degenerateTriangleCount = 0, processedSinceYield = 0;

  for (const object of model.objects) {
    const positions = object.positions;
    if (!(positions instanceof Float32Array) || positions.length % 9 !== 0) throw new TypeError("A geometria do modelo tem um formato inesperado.");
    const dimensions = object.bounds?.dimensions;
    if (!Array.isArray(dimensions) || dimensions.length !== 3 || !dimensions.every(Number.isFinite)) throw new TypeError("As dimensões do objeto não podem ser analisadas.");
    const diagonal = Math.hypot(...dimensions);
    const crossProductThreshold = diagonal * diagonal * 1e-12;
    const thresholdSquared = crossProductThreshold * crossProductThreshold;
    triangleCount += positions.length / 9;

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
      if (crossX * crossX + crossY * crossY + crossZ * crossZ <= thresholdSquared) degenerateTriangleCount++;

      processedSinceYield++;
      if (processedSinceYield >= TRIANGLES_PER_CHUNK) {
        processedSinceYield = 0;
        await nextFrame();
      }
    }
  }

  throwIfAborted(signal);
  return Object.freeze({
    schema: ANALYSIS_SCHEMA,
    method: "local-triangle-area",
    triangleCount,
    degenerateTriangleCount,
    threshold: "área nula ou muito próxima de zero em relação à diagonal de cada objeto",
    topologyVerified: false,
    watertightness: "not-checked",
  });
}

export const meshAnalysisSchema = ANALYSIS_SCHEMA;
