const TYPE_COLORS = Object.freeze({
  outer: "#ff914d", inner: "#ffc857", infill: "#ff5b54", support: "#62df92", bridge: "#69b7ff", travel: "#64747b", other: "#bb9aff",
});

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

export function parseGcodePreview(text) {
  const segments = [];
  let x = 0, y = 0, z = 0, e = 0, relativeXYZ = false, relativeE = false, type = "other", layer = -1, lastLayerZ = null;
  const unsupported = new Set();
  for (const line of text.split(/\r?\n/)) {
    const divider = line.indexOf(";");
    const command = (divider < 0 ? line : line.slice(0, divider)).trim().toUpperCase();
    const comment = divider < 0 ? "" : line.slice(divider + 1).trim();
    if (comment) {
      if (/^TYPE\s*:/i.test(comment) || /^FEATURE\s*:/i.test(comment)) type = typeFromComment(comment.replace(/^(?:TYPE|FEATURE)\s*:/i, ""));
      if (/LAYER_CHANGE/i.test(comment) || /^LAYER\s*:/i.test(comment)) { layer++; lastLayerZ = null; }
    }
    if (/^G90(?:\s|$)/.test(command)) { relativeXYZ = false; continue; }
    if (/^G91(?:\s|$)/.test(command)) { relativeXYZ = true; continue; }
    if (/^M82(?:\s|$)/.test(command)) { relativeE = false; continue; }
    if (/^M83(?:\s|$)/.test(command)) { relativeE = true; continue; }
    if (/^G92(?:\s|$)/.test(command)) {
      const values = Object.fromEntries([...command.matchAll(/([XYZE])\s*(-?[\d.]+)/g)].map(match => [match[1], Number(match[2])]));
      if (values.X !== undefined) x = values.X; if (values.Y !== undefined) y = values.Y; if (values.Z !== undefined) z = values.Z; if (values.E !== undefined) e = values.E;
      continue;
    }
    const code = command.match(/^(G\d+)/)?.[1];
    if (!code) continue;
    if (code === "G2" || code === "G3") { unsupported.add(code); continue; }
    if (code !== "G0" && code !== "G00" && code !== "G1" && code !== "G01") continue;
    const values = Object.fromEntries([...command.matchAll(/([XYZE])\s*(-?[\d.]+)/g)].map(match => [match[1], Number(match[2])]));
    const nextX = values.X === undefined ? x : relativeXYZ ? x + values.X : values.X;
    const nextY = values.Y === undefined ? y : relativeXYZ ? y + values.Y : values.Y;
    const nextZ = values.Z === undefined ? z : relativeXYZ ? z + values.Z : values.Z;
    const nextE = values.E === undefined ? e : relativeE ? e + values.E : values.E;
    if (values.Z !== undefined && Math.abs(nextZ - z) > 0.00001 && lastLayerZ !== nextZ) {
      if (layer < 0) layer = 0;
      else if (lastLayerZ !== null) layer++;
      lastLayerZ = nextZ;
    }
    const extrusion = values.E !== undefined && (relativeE ? values.E > 0 : nextE > e + 0.000001);
    if (values.X !== undefined || values.Y !== undefined) {
      segments.push({ x1: x, y1: y, x2: nextX, y2: nextY, z: nextZ, layer: Math.max(0, layer), type: extrusion ? type : "travel", extrusion });
    }
    x = nextX; y = nextY; z = nextZ; e = nextE;
  }
  const layers = [...new Set(segments.filter(segment => segment.extrusion).map(segment => segment.layer))].sort((a, b) => a - b);
  return { segments, layers, unsupported: [...unsupported], colors: TYPE_COLORS };
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
