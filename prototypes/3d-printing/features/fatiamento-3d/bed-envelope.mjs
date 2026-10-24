function validPolygon(value) {
  return Array.isArray(value) && value.length >= 3 && value.length <= 100
    && value.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite));
}

function cross(ax, ay, bx, by) { return ax * by - ay * bx; }

function onSegment(point, start, end, epsilon = 1e-7) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  if (Math.abs(cross(point[0] - start[0], point[1] - start[1], dx, dy)) > epsilon) return false;
  return point[0] >= Math.min(start[0], end[0]) - epsilon && point[0] <= Math.max(start[0], end[0]) + epsilon
    && point[1] >= Math.min(start[1], end[1]) - epsilon && point[1] <= Math.max(start[1], end[1]) + epsilon;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous], b = polygon[index];
    if (onSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function intersectionParameters(start, end, edgeStart, edgeEnd) {
  const rx = end[0] - start[0], ry = end[1] - start[1];
  const sx = edgeEnd[0] - edgeStart[0], sy = edgeEnd[1] - edgeStart[1];
  const qx = edgeStart[0] - start[0], qy = edgeStart[1] - start[1];
  const denominator = cross(rx, ry, sx, sy);
  const numerator = cross(qx, qy, rx, ry);
  if (Math.abs(denominator) <= 1e-9) {
    if (Math.abs(numerator) > 1e-7) return [];
    const lengthSquared = rx * rx + ry * ry;
    if (lengthSquared <= 1e-12) return [];
    const first = (qx * rx + qy * ry) / lengthSquared;
    const second = ((edgeEnd[0] - start[0]) * rx + (edgeEnd[1] - start[1]) * ry) / lengthSquared;
    return [first, second].filter(value => value >= -1e-9 && value <= 1 + 1e-9).map(value => Math.max(0, Math.min(1, value)));
  }
  const t = cross(qx, qy, sx, sy) / denominator;
  const u = cross(qx, qy, rx, ry) / denominator;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9
    ? [Math.max(0, Math.min(1, t))]
    : [];
}

function segmentWithinPolygon(start, end, polygon) {
  const cuts = [0, 1];
  for (let index = 0; index < polygon.length; index++) {
    cuts.push(...intersectionParameters(start, end, polygon[index], polygon[(index + 1) % polygon.length]));
  }
  cuts.sort((left, right) => left - right);
  const unique = cuts.filter((value, index) => index === 0 || value - cuts[index - 1] > 1e-8);
  for (let index = 0; index < unique.length - 1; index++) {
    const t = (unique[index] + unique[index + 1]) / 2;
    if (!pointInPolygon([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t], polygon)) return false;
  }
  return true;
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
  const abD = cross(b[0] - a[0], b[1] - a[1], d[0] - a[0], d[1] - a[1]);
  const cdA = cross(d[0] - c[0], d[1] - c[1], a[0] - c[0], a[1] - c[1]);
  const cdB = cross(d[0] - c[0], d[1] - c[1], b[0] - c[0], b[1] - c[1]);
  if (Math.abs(abC) <= 1e-7 && onSegment(c, a, b)) return true;
  if (Math.abs(abD) <= 1e-7 && onSegment(d, a, b)) return true;
  if (Math.abs(cdA) <= 1e-7 && onSegment(a, c, d)) return true;
  if (Math.abs(cdB) <= 1e-7 && onSegment(b, c, d)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function rectangleFor(bounds) {
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max)
    || bounds.min.length < 2 || bounds.max.length < 2
    || ![bounds.min[0], bounds.min[1], bounds.max[0], bounds.max[1]].every(Number.isFinite)
    || bounds.min[0] > bounds.max[0] || bounds.min[1] > bounds.max[1]) return null;
  const [minX, minY, maxX, maxY] = [bounds.min[0], bounds.min[1], bounds.max[0], bounds.max[1]];
  const corners = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
  return { corners, edges: corners.map((point, index) => [point, corners[(index + 1) % corners.length]]) };
}

function rectangleInside(rectangle, polygon) {
  return rectangle.corners.every(point => pointInPolygon(point, polygon))
    && rectangle.edges.every(([start, end]) => segmentWithinPolygon(start, end, polygon));
}

function rectangleOverlapsPolygon(rectangle, polygon) {
  return rectangle.corners.some(point => pointInPolygon(point, polygon))
    || polygon.some(([x, y]) => x >= rectangle.corners[0][0] - 1e-7 && x <= rectangle.corners[2][0] + 1e-7
      && y >= rectangle.corners[0][1] - 1e-7 && y <= rectangle.corners[2][1] + 1e-7)
    || rectangle.edges.some(([start, end]) => polygon.some((point, index) => segmentsIntersect(start, end, point, polygon[(index + 1) % polygon.length])));
}

function rectangularOutline(bedSizeMm) {
  if (!Array.isArray(bedSizeMm) || bedSizeMm.length < 2 || !bedSizeMm.slice(0, 2).every(value => Number.isFinite(value) && value > 0)) return null;
  const halfX = bedSizeMm[0] / 2, halfY = bedSizeMm[1] / 2;
  return [[-halfX, -halfY], [halfX, -halfY], [halfX, halfY], [-halfX, halfY]];
}

export function boundsWithinPrintableSpace(bounds, { bedSizeMm, bedOutlineMm, bedExcludeAreasMm = [], xyMarginMm = 0 } = {}) {
  if (!Number.isFinite(xyMarginMm) || xyMarginMm < 0 || xyMarginMm > 50) return false;
  const source = rectangleFor(bounds);
  if (!source) return false;
  const expandedBounds = xyMarginMm === 0 ? bounds : {
    min: [bounds.min[0] - xyMarginMm, bounds.min[1] - xyMarginMm, bounds.min[2]],
    max: [bounds.max[0] + xyMarginMm, bounds.max[1] + xyMarginMm, bounds.max[2]],
  };
  const rectangle = rectangleFor(expandedBounds);
  const outline = validPolygon(bedOutlineMm) ? bedOutlineMm : rectangularOutline(bedSizeMm);
  if (!rectangle || !validPolygon(outline) || !Array.isArray(bedExcludeAreasMm)) return false;
  if (!rectangleInside(rectangle, outline)) return false;
  return bedExcludeAreasMm.every(area => validPolygon(area) && !rectangleOverlapsPolygon(rectangle, area));
}

export function assessModelEnvelope(objectBounds, { bedSizeMm, bedOutlineMm, bedExcludeAreasMm = [], heightMm, reference = false, xyMarginMm = 0 } = {}) {
  if (!Array.isArray(objectBounds) || !objectBounds.length || !Number.isFinite(heightMm) || heightMm <= 0
    || !Number.isFinite(xyMarginMm) || xyMarginMm < 0 || xyMarginMm > 50
    || objectBounds.some(bounds => !rectangleFor(bounds) || !Array.isArray(bounds.min) || !Array.isArray(bounds.max)
      || bounds.min.length < 3 || bounds.max.length < 3 || ![bounds.min[2], bounds.max[2]].every(Number.isFinite))) {
    return Object.freeze({ status: "not-assessed", method: "per-object-expanded-bounds/2", objectCount: Array.isArray(objectBounds) ? objectBounds.length : 0, checkedObjectCount: 0, outsideObjectCount: null, outsideObjectItems: [] });
  }
  const outsideObjectItems = [];
  for (let index = 0; index < objectBounds.length; index++) {
    const bounds = objectBounds[index];
    const insideXY = boundsWithinPrintableSpace(bounds, { bedSizeMm, bedOutlineMm, bedExcludeAreasMm, xyMarginMm });
    const insideZ = bounds.min[2] >= 0 && bounds.max[2] <= heightMm;
    if (!insideXY || !insideZ) outsideObjectItems.push(index + 1);
  }
  const outsideObjectCount = outsideObjectItems.length;
  return Object.freeze({
    status: reference
      ? outsideObjectCount ? "outside-reference-envelope" : "within-reference-envelope"
      : outsideObjectCount ? "outside-profile-envelope" : "within-profile-envelope",
    method: "per-object-expanded-bounds/2",
    xyMarginMm,
    objectCount: objectBounds.length,
    checkedObjectCount: objectBounds.length,
    outsideObjectCount,
    outsideObjectItems: Object.freeze(outsideObjectItems.slice(0, 12)),
    omittedOutsideObjectCount: Math.max(0, outsideObjectCount - 12),
    limitations: "caixa envolvente conservadora por objeto expandida pela margem XY informada e comparada ao contorno e às zonas excluídas; não analisa colisões, skirt, saliências ou suporte e não substitui o motor",
  });
}

export function objectsWithinPrintableSpace(objectBounds, space) {
  return ["within-profile-envelope", "within-reference-envelope"].includes(assessModelEnvelope(objectBounds, space).status);
}
