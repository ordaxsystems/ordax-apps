export function measureBedViewport(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const bedSize = Math.min(width - 70, height - 55);
  if (bedSize <= 0) return null;
  return { bedSize, left: (width - bedSize) / 2, top: (height - bedSize) / 2 };
}

export function fitMovesToBed(moves, bedSize, padding = 12) {
  if (!Array.isArray(moves) || moves.length === 0) return null;
  if (!Number.isFinite(bedSize) || bedSize <= 0 || !Number.isFinite(padding) || padding < 0) {
    throw new RangeError("A mesa e o recuo precisam ter dimensões válidas.");
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const move of moves) {
    for (const value of [move.x1, move.x2, move.y1, move.y2]) {
      if (!Number.isFinite(value)) throw new TypeError("O trajeto contém coordenadas inválidas.");
    }
    minX = Math.min(minX, move.x1, move.x2);
    maxX = Math.max(maxX, move.x1, move.x2);
    minY = Math.min(minY, move.y1, move.y2);
    maxY = Math.max(maxY, move.y1, move.y2);
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const drawableSize = Math.max(1, bedSize - padding * 2);
  const scale = Math.min(drawableSize / spanX, drawableSize / spanY);
  return {
    minX,
    maxY,
    scale,
    offsetX: (bedSize - spanX * scale) / 2,
    offsetY: (bedSize - spanY * scale) / 2,
  };
}

export function projectPointToBed(projection, x, y) {
  if (!projection || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: projection.offsetX + (x - projection.minX) * projection.scale,
    y: projection.offsetY + (projection.maxY - y) * projection.scale,
  };
}
