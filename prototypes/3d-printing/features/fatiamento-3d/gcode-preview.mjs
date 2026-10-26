const TYPE_COLORS = Object.freeze({ outer: "#ff914d", inner: "#ffc857", infill: "#ff5b54", support: "#62df92", bridge: "#69b7ff", travel: "#64747b", other: "#bb9aff" });
const TAU = Math.PI * 2;
const ARC_CHORD_ERROR_MM = 0.1;
const MAX_ARC_SEGMENTS = 512;
const WORD_PATTERN = /([A-Z])\s*([+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[Ee][+-]?\d+)?)/g;
export const gcodePreviewLimits = Object.freeze({ xyArcChordErrorMm: ARC_CHORD_ERROR_MM, maxArcSegmentsPerArc: MAX_ARC_SEGMENTS });

function typeFromComment(comment) {
  const value = comment.toLowerCase();
  if (/outer|external|parede externa/.test(value)) return "outer";
  if (/inner|internal perimeter|parede interna/.test(value)) return "inner";
  if (/support|suporte/.test(value)) return "support";
  if (/bridge|ponte/.test(value)) return "bridge";
  if (/infill|solid infill|preenchimento/.test(value)) return "infill";
  if (/travel|retract|wipe/.test(value)) return "travel";
  return "other";
}

function parseWords(command) {
  const words = Object.create(null);
  for (const match of command.matchAll(WORD_PATTERN)) {
    const value = Number(match[2]);
    if (Number.isFinite(value)) words[match[1]] = value;
  }
  return words;
}

function directedSweep(start, end, clockwise, fullCircle) {
  if (fullCircle) return clockwise ? -TAU : TAU;
  let delta = end - start;
  if (clockwise) {
    while (delta >= 0) delta -= TAU;
  } else {
    while (delta <= 0) delta += TAU;
  }
  return delta;
}

function arcGeometry(x1, y1, x2, y2, words, clockwise, unitScale, relativeArcCenter) {
  let centerX, centerY;
  if (words.I !== undefined || words.J !== undefined) {
    if (!relativeArcCenter && (words.I === undefined || words.J === undefined)) return null;
    centerX = relativeArcCenter ? x1 + (words.I || 0) * unitScale : words.I * unitScale;
    centerY = relativeArcCenter ? y1 + (words.J || 0) * unitScale : words.J * unitScale;
  } else if (words.R !== undefined) {
    const signedRadius = words.R * unitScale;
    const radius = Math.abs(signedRadius);
    const dx = x2 - x1, dy = y2 - y1, chord = Math.hypot(dx, dy);
    if (chord < 1e-7 || radius < 1e-7 || chord > radius * 2 + 1e-5) return null;
    const midpointX = (x1 + x2) / 2, midpointY = (y1 + y2) / 2;
    const halfHeight = Math.sqrt(Math.max(0, radius * radius - chord * chord / 4));
    const perpendicularX = -dy / chord, perpendicularY = dx / chord;
    const centers = [
      [midpointX + perpendicularX * halfHeight, midpointY + perpendicularY * halfHeight],
      [midpointX - perpendicularX * halfHeight, midpointY - perpendicularY * halfHeight],
    ];
    const fullCircle = false;
    const candidates = centers.map(([cx, cy]) => {
      const startAngle = Math.atan2(y1 - cy, x1 - cx);
      const endAngle = Math.atan2(y2 - cy, x2 - cx);
      return { cx, cy, sweep: directedSweep(startAngle, endAngle, clockwise, fullCircle) };
    });
    const wantsLongArc = signedRadius < 0;
    const matching = candidates.find(candidate => (Math.abs(candidate.sweep) > Math.PI + 1e-6) === wantsLongArc);
    const selected = matching || candidates[0];
    return { centerX: selected.cx, centerY: selected.cy, radius, sweep: selected.sweep };
  } else {
    return null;
  }

  const radiusStart = Math.hypot(x1 - centerX, y1 - centerY);
  const radiusEnd = Math.hypot(x2 - centerX, y2 - centerY);
  if (!Number.isFinite(radiusStart) || radiusStart < 1e-7 || Math.abs(radiusStart - radiusEnd) > Math.max(0.05, radiusStart * 0.001)) return null;
  const startAngle = Math.atan2(y1 - centerY, x1 - centerX);
  const endAngle = Math.atan2(y2 - centerY, x2 - centerX);
  const fullCircle = Math.hypot(x2 - x1, y2 - y1) < 1e-7;
  return { centerX, centerY, radius: radiusStart, sweep: directedSweep(startAngle, endAngle, clockwise, fullCircle) };
}

function tessellateArc({ x1, y1, x2, y2, z1, z2, geometry, layer, type, extrusion, nozzleTemperatureC }) {
  const { centerX, centerY, radius, sweep } = geometry;
  const maxAngle = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - ARC_CHORD_ERROR_MM / radius)));
  const segmentCount = Math.min(MAX_ARC_SEGMENTS, Math.max(2, Math.ceil(Math.abs(sweep) / Math.max(0.01, maxAngle))));
  const startAngle = Math.atan2(y1 - centerY, x1 - centerX);
  const segments = [];
  for (let index = 1; index <= segmentCount; index++) {
    const t = index / segmentCount;
    const angle = startAngle + sweep * t;
    segments.push({
      x1: index === 1 ? x1 : segments[index - 2].x2,
      y1: index === 1 ? y1 : segments[index - 2].y2,
      x2: index === segmentCount ? x2 : centerX + radius * Math.cos(angle),
      y2: index === segmentCount ? y2 : centerY + radius * Math.sin(angle),
      z: z1 + (z2 - z1) * t,
      layer,
      type: extrusion ? type : "travel",
      extrusion,
      nozzleTemperatureC,
      arc: true,
    });
  }
  return segments;
}

function formatSummaryNumber(value) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
}

function parseFilamentSummary(source) {
  const match = [...source.matchAll(/filament used(?:\s*\[([^\]]+)\])?\s*=\s*(-?\d+(?:[.,]\d+)?)/gi)].at(-1);
  if (!match) return "Não informado";
  const amount = Number(match[2].replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) return "Não informado";
  const unit = match[1]?.trim().toLowerCase().replace("³", "3");
  if (unit === "g" || unit === "gram" || unit === "grams") return `${formatSummaryNumber(amount)} g`;
  if (unit === "mm" || unit === "m" || unit === "cm3") return `${formatSummaryNumber(amount)} ${unit === "cm3" ? "cm³" : unit}`;
  return "Não informado";
}

export function parseGcodePreview(text) {
  const source = String(text ?? "");
  const segments = [];
  const hasLayerMarkers = source.split(/\r?\n/).some(line => {
    const divider = line.indexOf(";");
    if (divider < 0) return false;
    const comment = line.slice(divider + 1).trim();
    return /LAYER_CHANGE/i.test(comment) || /^LAYER\s*:/i.test(comment);
  });
  let x = 0, y = 0, z = 0, e = 0;
  let relativeXYZ = false, relativeE = false, relativeArcCenter = true, unitScale = 1;
  let plane = "XY", type = "other", layer = -1, lastLayerZ = null;
  let nozzleTemperatureC = null, nozzle = null, bed = null, maxObservedLayer = 0;
  let unsupportedArcCount = 0;
  const unsupported = new Set();

  for (const line of source.split(/\r?\n/)) {
    const divider = line.indexOf(";");
    const command = (divider < 0 ? line : line.slice(0, divider)).trim().toUpperCase();
    const comment = divider < 0 ? "" : line.slice(divider + 1).trim();
    if (comment) {
      if (/^TYPE\s*:/i.test(comment) || /^FEATURE\s*:/i.test(comment)) type = typeFromComment(comment.replace(/^(?:TYPE|FEATURE)\s*:/i, ""));
      if (/LAYER_CHANGE/i.test(comment) || /^LAYER\s*:/i.test(comment)) { layer++; lastLayerZ = null; }
    }

    const code = command.match(/^(?:N\d+\s+)?([GMT]\d+(?:\.\d+)?)(?:\s|$)/)?.[1];
    if (!code) continue;
    const words = parseWords(command);
    if (code === "M104" || code === "M109") {
      if (words.S !== undefined && words.S >= 0) {
        nozzleTemperatureC = words.S;
        if (words.S > 0) nozzle = words.S;
      }
      continue;
    }
    if (code === "M140" || code === "M190") {
      if (words.S !== undefined && words.S > 0) bed = words.S;
      continue;
    }
    if (code === "M82") { relativeE = false; continue; }
    if (code === "M83") { relativeE = true; continue; }
    if (!code.startsWith("G")) continue;
    if (code === "G90.1") { relativeArcCenter = false; continue; }
    if (code === "G91.1") { relativeArcCenter = true; continue; }
    if (code === "G90") { relativeXYZ = false; continue; }
    if (code === "G91") { relativeXYZ = true; continue; }
    if (code === "G17") { plane = "XY"; continue; }
    if (code === "G18") { plane = "XZ"; continue; }
    if (code === "G19") { plane = "YZ"; continue; }
    if (code === "G20") { unitScale = 25.4; continue; }
    if (code === "G21") { unitScale = 1; continue; }

    if (code === "G92") {
      if (words.X !== undefined) x = words.X * unitScale;
      if (words.Y !== undefined) y = words.Y * unitScale;
      if (words.Z !== undefined) z = words.Z * unitScale;
      if (words.E !== undefined) e = words.E * unitScale;
      continue;
    }

    if (code !== "G0" && code !== "G00" && code !== "G1" && code !== "G01" && code !== "G2" && code !== "G02" && code !== "G3" && code !== "G03") continue;
    const nextX = words.X === undefined ? x : relativeXYZ ? x + words.X * unitScale : words.X * unitScale;
    const nextY = words.Y === undefined ? y : relativeXYZ ? y + words.Y * unitScale : words.Y * unitScale;
    const nextZ = words.Z === undefined ? z : relativeXYZ ? z + words.Z * unitScale : words.Z * unitScale;
    const nextE = words.E === undefined ? e : relativeE ? e + words.E * unitScale : words.E * unitScale;
    const extrusion = words.E !== undefined && (relativeE ? words.E > 0 : nextE > e + 0.000001);
    if (!hasLayerMarkers && extrusion && (lastLayerZ === null || Math.abs(nextZ - lastLayerZ) > 0.00001)) {
      if (layer < 0) layer = 0;
      else layer++;
      lastLayerZ = nextZ;
    }
    const moveLayer = Math.max(0, layer);
    maxObservedLayer = Math.max(maxObservedLayer, moveLayer);

    if (code === "G2" || code === "G02" || code === "G3" || code === "G03") {
      const clockwise = code === "G2" || code === "G02";
      const arcCode = clockwise ? "G2" : "G3";
      const hasXYMotion = words.X !== undefined || words.Y !== undefined || words.I !== undefined || words.J !== undefined || words.R !== undefined;
      const planarArc = Math.abs(nextZ - z) <= 0.00001;
      const geometry = plane === "XY" && planarArc && hasXYMotion
        ? arcGeometry(x, y, nextX, nextY, words, clockwise, unitScale, relativeArcCenter)
        : null;
      if (geometry) {
        segments.push(...tessellateArc({ x1: x, y1: y, x2: nextX, y2: nextY, z1: z, z2: nextZ, geometry, layer: moveLayer, type, extrusion, nozzleTemperatureC }));
      } else {
        unsupported.add(arcCode);
        unsupportedArcCount += 1;
      }
    } else if (words.X !== undefined || words.Y !== undefined) {
      segments.push({ x1: x, y1: y, x2: nextX, y2: nextY, z: nextZ, layer: moveLayer, type: extrusion ? type : "travel", extrusion, nozzleTemperatureC });
    }
    x = nextX; y = nextY; z = nextZ; e = nextE;
  }

  const layers = [...new Set(segments.filter(segment => segment.extrusion).map(segment => segment.layer))].sort((a, b) => a - b);
  const estimatedTime = source.match(/estimated printing time(?:\s*\([^)]*\))?\s*=\s*([^\r\n]+)/i)?.[1]?.trim() ?? "Não informado";
  const filament = parseFilamentSummary(source);
  const layerHeightValue = source.match(/layer_height\s*=\s*(\d+(?:[.,]\d+)?)/i)?.[1];
  const layerHeight = layerHeightValue ? `${formatSummaryNumber(Number(layerHeightValue.replace(",", ".")))} mm` : "Não informado";
  const previewLines = source.split(/\r?\n/).filter(line => /^\s*(?:N\d+\s*)?G0?[0-3]\b/i.test(line)).slice(0, 3).join("\n") || "Nenhum movimento G0–G3 encontrado";
  return {
    segments,
    layers,
    layerCount: Math.max(1, maxObservedLayer + 1),
    unsupported: [...unsupported],
    unsupportedArcCount,
    colors: TYPE_COLORS,
    printTime: estimatedTime,
    filament,
    layerHeight,
    nozzle,
    bed,
    previewLines,
  };
}

export function selectGcodeLayerFrame(segments, layer, requestedCount = Number.POSITIVE_INFINITY) {
  const selectedLayer = Number(layer);
  const layerSegments = Array.isArray(segments) && Number.isInteger(selectedLayer)
    ? segments.filter(segment => segment?.layer === selectedLayer)
    : [];
  const requested = Number(requestedCount);
  const visibleCount = requested === Number.POSITIVE_INFINITY
    ? layerSegments.length
    : Number.isFinite(requested)
      ? Math.max(0, Math.min(layerSegments.length, Math.trunc(requested)))
      : 0;
  const visibleSegments = layerSegments.slice(0, visibleCount);
  return {
    segments: layerSegments,
    visibleSegments,
    totalCount: layerSegments.length,
    visibleCount,
    currentSegment: visibleSegments.at(-1) ?? null,
  };
}

export function drawGcodeLayer(canvas, preview, layer, progress, bed = [256, 256]) {
  const bounds = canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(bounds.width * ratio)), height = Math.max(1, Math.floor(bounds.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#091216"; ctx.fillRect(0, 0, bounds.width, bounds.height);
  const side = Math.min(bounds.width - 60, bounds.height - 50), left = (bounds.width - side) / 2, top = (bounds.height - side) / 2;
  const widthMm = Math.max(1, bed[0]), depthMm = Math.max(1, bed[1]);
  const scale = side / Math.max(widthMm, depthMm), plateWidth = widthMm * scale, plateDepth = depthMm * scale;
  const plateLeft = (bounds.width - plateWidth) / 2, plateTop = (bounds.height - plateDepth) / 2;
  ctx.fillStyle = "#101d22"; ctx.fillRect(plateLeft, plateTop, plateWidth, plateDepth);
  ctx.strokeStyle = "#1c3036"; ctx.lineWidth = 1;
  for (let x = 0; x <= widthMm; x += 20) { const px = plateLeft + x * scale; ctx.beginPath(); ctx.moveTo(px, plateTop); ctx.lineTo(px, plateTop + plateDepth); ctx.stroke(); }
  for (let y = 0; y <= depthMm; y += 20) { const py = plateTop + y * scale; ctx.beginPath(); ctx.moveTo(plateLeft, py); ctx.lineTo(plateLeft + plateWidth, py); ctx.stroke(); }
  const selected = preview.segments.filter(segment => segment.layer === layer);
  const visibleCount = Math.floor(selected.length * Math.max(0.01, Math.min(1, progress)));
  const offset = (x, y) => [plateLeft + (x + widthMm / 2) * scale, plateTop + plateDepth - (y + depthMm / 2) * scale];
  ctx.lineCap = "round";
  for (let i = 0; i < visibleCount; i++) {
    const segment = selected[i], a = offset(segment.x1, segment.y1), b = offset(segment.x2, segment.y2);
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b);
    ctx.strokeStyle = preview.colors[segment.type] || preview.colors.other;
    ctx.lineWidth = segment.extrusion ? 1.7 : 0.7;
    ctx.globalAlpha = segment.extrusion ? 0.92 : 0.35; ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (!selected.length) {
    ctx.fillStyle = "#84979b"; ctx.textAlign = "center"; ctx.font = "13px system-ui";
    ctx.fillText("Esta camada não contém trajetórias XY reconhecidas.", bounds.width / 2, bounds.height / 2);
  }
  return { visibleCount, totalCount: selected.length, layers: preview.layers.length, unsupported: preview.unsupported };
}
