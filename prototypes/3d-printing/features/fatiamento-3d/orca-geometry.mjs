const MAX_TRIANGLES = 300_000;
const MAX_STL_BYTES = 16 * 1024 * 1024;
const UNIT_TO_MM = Object.freeze({ mm: 1, cm: 10, in: 25.4 });

function checkedPoint(x, y, z) {
  if (![x, y, z].every(Number.isFinite) || Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 1e7) {
    throw new Error("A transformação produziu coordenadas fora do limite seguro para o motor.");
  }
  return [x, y, z];
}

function transformPoint(point, object, objectTransform, model, draft, global) {
  const center = object.bounds.min.map((value, axis) => (value + object.bounds.max[axis]) / 2);
  let x = (point[0] - center[0]) * objectTransform.scale;
  let y = (point[1] - center[1]) * objectTransform.scale;
  let z = (point[2] - center[2]) * objectTransform.scale;

  const rx = objectTransform.rotationX * Math.PI / 180;
  const ry = objectTransform.rotationY * Math.PI / 180;
  const rz = objectTransform.rotationZ * Math.PI / 180;
  const y1 = y * Math.cos(rx) - z * Math.sin(rx);
  const z1 = y * Math.sin(rx) + z * Math.cos(rx);
  const x2 = x * Math.cos(ry) + z1 * Math.sin(ry);
  const z2 = -x * Math.sin(ry) + z1 * Math.cos(ry);
  const x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz) + center[0];
  const y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz) + center[1];
  const z3 = z2 + center[2];

  const x4 = (x3 - global.centerX) * global.cos - (y3 - global.centerY) * global.sin;
  const y4 = (x3 - global.centerX) * global.sin + (y3 - global.centerY) * global.cos;
  const unitScale = model.format === "STL" ? UNIT_TO_MM[draft.stlUnit] : 1;
  return checkedPoint(
    x4 * draft.scale * unitScale + objectTransform.x,
    y4 * draft.scale * unitScale + objectTransform.y,
    (z3 - model.bounds.min[2]) * draft.scale * unitScale + objectTransform.z,
  );
}

function triangleNormal(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const length = Math.hypot(...normal);
  return length > 1e-12 ? normal.map(value => value / length) : [0, 0, 0];
}

export function createOrcaInputStl(model, draft) {
  if (!model || !Array.isArray(model.objects) || !model.objects.length || model.objects.length > 500) {
    throw new Error("O trabalho não contém uma lista de peças válida para o motor.");
  }
  const triangleCount = model.objects.reduce((sum, object) => sum + Number(object.triangleCount || 0), 0);
  if (!Number.isInteger(triangleCount) || triangleCount < 1 || triangleCount > MAX_TRIANGLES) {
    throw new Error(`O trabalho precisa ter entre 1 e ${MAX_TRIANGLES.toLocaleString("pt-BR")} triângulos para esta versão do adaptador.`);
  }
  const byteLength = 84 + triangleCount * 50;
  if (byteLength > MAX_STL_BYTES) throw new Error("A malha preparada excede o limite seguro do adaptador local.");

  const output = new ArrayBuffer(byteLength);
  const view = new DataView(output);
  const header = new TextEncoder().encode("OrdaX 3D · malha transformada localmente para OrcaSlicer");
  new Uint8Array(output, 0, Math.min(80, header.length)).set(header.subarray(0, 80));
  view.setUint32(80, triangleCount, true);

  const radians = draft.rotation * Math.PI / 180;
  const global = {
    centerX: (model.bounds.min[0] + model.bounds.max[0]) / 2,
    centerY: (model.bounds.min[1] + model.bounds.max[1]) / 2,
    cos: Math.cos(radians), sin: Math.sin(radians),
  };
  let triangleOffset = 84;
  for (const object of model.objects) {
    if (!(object.positions instanceof Float32Array) || object.positions.length !== object.triangleCount * 9 || !object.bounds?.min || !object.bounds?.max) {
      throw new Error("Uma peça não contém a geometria triangular esperada pelo adaptador.");
    }
    const transform = draft.objectTransforms?.[object.id] || { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scale: 1 };
    for (let cursor = 0; cursor < object.positions.length; cursor += 9) {
      const points = [0, 3, 6].map(offset => transformPoint(
        [object.positions[cursor + offset], object.positions[cursor + offset + 1], object.positions[cursor + offset + 2]],
        object, transform, model, draft, global,
      ));
      const normal = triangleNormal(points[0], points[1], points[2]);
      for (const component of normal) { view.setFloat32(triangleOffset, component, true); triangleOffset += 4; }
      for (const point of points) for (const component of point) {
        view.setFloat32(triangleOffset, component, true);
        triangleOffset += 4;
      }
      view.setUint16(triangleOffset, 0, true);
      triangleOffset += 2;
    }
  }
  return Object.freeze({ file: new Blob([output], { type: "model/stl" }), triangleCount, byteLength });
}

export const orcaGeometryLimits = Object.freeze({ maxTriangles: MAX_TRIANGLES, maxStlBytes: MAX_STL_BYTES });
