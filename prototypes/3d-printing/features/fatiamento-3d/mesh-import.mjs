import { normalizeZipPath, readZipDirectory, readZipEntry } from "./zip-container.mjs";
import { readProjectBundle, projectBundleLimits } from "./project-bundle.mjs";
import { fingerprintSourceBytes } from "./source-fingerprint.mjs";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_MODEL_XML_BYTES = 50 * 1024 * 1024;
const MAX_TRIANGLES = 300_000;
const MAX_BUILD_OBJECTS = 500;
const UNIT_TO_MM = Object.freeze({
  micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000,
});

function finiteVertex(x, y, z) {
  if (![x, y, z].every(Number.isFinite) || Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 1e9) {
    throw new Error("O arquivo contém coordenadas inválidas ou fora do limite suportado.");
  }
  return [x, y, z];
}

function finalizeObject({ id, name, positions, sourceUnit = "millimeter", unitScale = 1 }) {
  if (!positions.length || positions.length % 9 !== 0) throw new Error("O modelo não contém triângulos válidos.");
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return {
    id: String(id ?? "object"), name: String(name || "Objeto"),
    positions: new Float32Array(positions), triangleCount: positions.length / 9,
    bounds: { min, max, dimensions: min.map((value, axis) => max[axis] - value) },
    sourceUnit, unitScale,
  };
}

function parseBinaryStl(buffer) {
  if (buffer.byteLength < 84) return null;
  const view = buffer instanceof ArrayBuffer
    ? new DataView(buffer)
    : new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const triangleCount = view.getUint32(80, true);
  if (triangleCount > MAX_TRIANGLES || 84 + triangleCount * 50 !== buffer.byteLength) return null;
  const positions = new Array(triangleCount * 9);
  let cursor = 0;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const offset = 84 + triangle * 50 + 12;
    for (let vertex = 0; vertex < 3; vertex++) {
      const point = finiteVertex(
        view.getFloat32(offset + vertex * 12, true),
        view.getFloat32(offset + vertex * 12 + 4, true),
        view.getFloat32(offset + vertex * 12 + 8, true),
      );
      positions[cursor++] = point[0]; positions[cursor++] = point[1]; positions[cursor++] = point[2];
    }
  }
  return finalizeObject({ id: "stl-model", name: "Modelo STL", positions, sourceUnit: "unidade não declarada", unitScale: 1 });
}

function parseAsciiStl(buffer) {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (!/^\s*solid(?:\s|$)/i.test(text) || !/\bfacet\s+normal\b/i.test(text)) throw new Error("O STL não parece ser binário nem ASCII válido.");
  const positions = [];
  const vertexPattern = /\bvertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/gi;
  let match;
  while ((match = vertexPattern.exec(text))) {
    if (positions.length >= MAX_TRIANGLES * 9) throw new Error("O modelo excede o limite de triângulos desta versão.");
    positions.push(...finiteVertex(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  if (!positions.length || positions.length % 9 !== 0) throw new Error("O STL ASCII contém uma face incompleta ou sem vértices.");
  return finalizeObject({ id: "stl-model", name: "Modelo STL", positions, sourceUnit: "unidade não declarada", unitScale: 1 });
}

function matrixFromAttribute(value) {
  if (!value) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 12 || !parts.every(Number.isFinite)) throw new Error("Uma transformação do 3MF está inválida.");
  // 3MF serializes a row-major matrix with translation in the final row.
  // Convert it to the column-vector 3×4 layout used by the mesh transforms below.
  return [parts[0], parts[3], parts[6], parts[9], parts[1], parts[4], parts[7], parts[10], parts[2], parts[5], parts[8], parts[11]];
}

function multiply3mfMatrix(parent, child) {
  const result = new Array(12).fill(0);
  for (let row = 0; row < 3; row++) {
    const r = row * 4;
    for (let column = 0; column < 3; column++) {
      result[r + column] = parent[r] * child[column] + parent[r + 1] * child[4 + column] + parent[r + 2] * child[8 + column];
    }
    result[r + 3] = parent[r] * child[3] + parent[r + 1] * child[7] + parent[r + 2] * child[11] + parent[r + 3];
  }
  return result;
}

function transform3mfPoint(matrix, point, unitScale) {
  const [x, y, z] = point;
  return finiteVertex(
    (matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3]) * unitScale,
    (matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7]) * unitScale,
    (matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11]) * unitScale,
  );
}

function parse3mfXml(text) {
  const documentNode = new DOMParser().parseFromString(text, "application/xml");
  if (documentNode.querySelector("parsererror")) throw new Error("O XML geométrico do 3MF não é válido.");
  const model = documentNode.documentElement;
  const sourceUnit = model.getAttribute("unit") || "millimeter";
  const unitScale = UNIT_TO_MM[sourceUnit];
  if (!unitScale) throw new Error(`A unidade '${sourceUnit}' do 3MF não é suportada.`);
  const objects = new Map();
  for (const node of model.querySelectorAll("resources > object")) {
    const id = node.getAttribute("id");
    if (typeof id !== "string" || !/^[a-z0-9._-]{1,128}$/i.test(id)) throw new Error("O 3MF contém um identificador de objeto ausente ou inválido.");
    const meshNode = node.querySelector(":scope > mesh");
    const vertices = meshNode ? [...meshNode.querySelectorAll(":scope > vertices > vertex")].map(vertex => finiteVertex(Number(vertex.getAttribute("x")), Number(vertex.getAttribute("y")), Number(vertex.getAttribute("z")))) : [];
    const triangles = meshNode ? [...meshNode.querySelectorAll(":scope > triangles > triangle")].map(triangle => ["v1", "v2", "v3"].map(attribute => Number(triangle.getAttribute(attribute)))) : [];
    const components = [...node.querySelectorAll(":scope > components > component")].map(component => ({ objectId: component.getAttribute("objectid"), transform: matrixFromAttribute(component.getAttribute("transform")) }));
    if (!vertices.length && !components.length) continue;
    if (triangles.length > MAX_TRIANGLES) throw new Error("Um objeto 3MF excede o limite de triângulos desta versão.");
    for (const tri of triangles) if (tri.some(index => !Number.isInteger(index) || index < 0 || index >= vertices.length)) throw new Error("Uma face do 3MF aponta para um vértice inexistente.");
    objects.set(id, { id, name: node.getAttribute("name") || node.querySelector(':scope > metadata[name="name"]')?.textContent?.trim() || `Objeto ${id}`, vertices, triangles, components });
  }
  if (!objects.size) throw new Error("O 3MF não contém uma malha que esta versão consiga exibir.");
  const buildItems = [...model.querySelectorAll("build > item")].map(item => ({ objectId: item.getAttribute("objectid"), transform: matrixFromAttribute(item.getAttribute("transform")) }));
  const roots = buildItems.length ? buildItems : [...objects.values()].filter(object => ![...objects.values()].some(parent => parent.components.some(component => component.objectId === object.id))).map(object => ({ objectId: object.id, transform: matrixFromAttribute(null) }));
  if (roots.length > MAX_BUILD_OBJECTS) throw new Error(`O projeto contém mais de ${MAX_BUILD_OBJECTS} objetos na mesa, acima do limite desta versão.`);
  const flattened = [];
  let totalTriangles = 0;
  const appendObject = (objectId, transform, stack, output, label) => {
    if (stack.includes(objectId)) throw new Error("O 3MF contém uma referência circular entre objetos.");
    const object = objects.get(objectId);
    if (!object) throw new Error("O 3MF referencia um objeto ausente.");
    if (object.triangles.length) {
      totalTriangles += object.triangles.length;
      if (totalTriangles > MAX_TRIANGLES) throw new Error("O conjunto de objetos 3MF excede o limite de triângulos desta versão.");
      for (const triangle of object.triangles) {
        for (const index of triangle) output.push(...transform3mfPoint(transform, object.vertices[index], unitScale));
      }
    }
    for (const component of object.components) appendObject(component.objectId, multiply3mfMatrix(transform, component.transform), [...stack, objectId], output, label);
  };
  for (const [index, root] of roots.entries()) {
    const object = objects.get(root.objectId);
    if (!object) throw new Error("O projeto referencia um objeto principal ausente.");
    const positions = [];
    appendObject(root.objectId, root.transform, [], positions, object.name);
    if (positions.length) {
      const item = finalizeObject({ id: `3mf-${index}`, name: object.name, positions, sourceUnit, unitScale });
      item.sourceObjectId = root.objectId;
      item.buildItemIndex = index;
      flattened.push(item);
    }
  }
  if (!flattened.length) throw new Error("O 3MF não contém uma malha imprimível para exibição.");
  return { objects: flattened, sourceUnit, unitScale };
}

async function parse3mf(buffer) {
  const entries = readZipDirectory(buffer, { maxEntryBytes: MAX_MODEL_XML_BYTES, label: "3MF" });
  let modelEntry = entries.get("3d/3dmodel.model");
  const relationships = entries.get("_rels/.rels");
  if (relationships) {
    const relationText = new TextDecoder().decode(await readZipEntry(buffer, relationships));
    const relationDoc = new DOMParser().parseFromString(relationText, "application/xml");
    const modelRelation = [...relationDoc.querySelectorAll("Relationship")].find(item => /3dmodel/i.test(item.getAttribute("Type") || ""));
    const target = modelRelation?.getAttribute("Target");
    if (target) modelEntry = entries.get(normalizeZipPath(target).toLowerCase()) || entries.get(normalizeZipPath(target.replace(/^\//, "")).toLowerCase());
  }
  if (!modelEntry || modelEntry.uncompressedSize > MAX_MODEL_XML_BYTES) throw new Error("Não encontrei o modelo principal dentro do 3MF.");
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(await readZipEntry(buffer, modelEntry));
  return parse3mfXml(xml);
}

function combineBounds(objects) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const object of objects) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], object.bounds.min[axis]);
    max[axis] = Math.max(max[axis], object.bounds.max[axis]);
  }
  return { min, max, dimensions: min.map((value, axis) => max[axis] - value) };
}

function parseSourceBuffer(buffer, name, size, originalFile) {
  const extension = name.split(".").pop().toLowerCase();
  let objects, sourceUnit;
  if (extension === "stl") {
    const object = parseBinaryStl(buffer) || parseAsciiStl(buffer);
    objects = [object]; sourceUnit = object.sourceUnit;
    object.name = name.replace(/\.stl$/i, "");
    object.sourceObjectId = object.id;
    object.buildItemIndex = 0;
  } else if (extension === "3mf") {
    return parse3mf(buffer).then(parsed => makeModel(name, extension, size, parsed.objects, parsed.sourceUnit, originalFile));
  } else throw new Error("Formato não suportado. Abra um arquivo .STL, .3MF ou projeto .ORDAX3D.");
  return makeModel(name, extension, size, objects, sourceUnit, originalFile);
}

function makeModel(name, extension, size, objects, sourceUnit, originalFile) {
  const triangleCount = objects.reduce((sum, object) => sum + object.triangleCount, 0);
  return { name, sourceFileName: name, format: extension.toUpperCase(), size, objects, sourceUnit, triangleCount, bounds: combineBounds(objects), originalFile };
}

function namedSourceBlob(bytes, name) {
  const blob = new Blob([bytes], { type: name.toLowerCase().endsWith(".3mf") ? "model/3mf" : "model/stl" });
  Object.defineProperty(blob, "name", { value: name, enumerable: true });
  return blob;
}

export async function parseMeshFile(file) {
  if (!(file instanceof Blob)) throw new TypeError("Selecione um arquivo STL, 3MF ou projeto OrdaX.");
  const name = String(file.name || "modelo");
  const extension = name.split(".").pop().toLowerCase();
  const maxBytes = extension === "ordax3d" ? projectBundleLimits.maxArchiveBytes : MAX_FILE_BYTES;
  if (file.size <= 0 || file.size > maxBytes) throw new Error(extension === "ordax3d" ? "O pacote do projeto deve ter até 51 MB." : "O arquivo deve ter até 50 MB.");
  const buffer = await file.arrayBuffer();
  if (extension === "ordax3d") {
    const bundled = await readProjectBundle(buffer);
    const sourceFile = namedSourceBlob(bundled.sourceBytes, bundled.sourceName);
    const imported = await parseSourceBuffer(bundled.sourceBytes, bundled.sourceName, bundled.sourceBytes.byteLength, sourceFile);
    imported.sourceFingerprint = await fingerprintSourceBytes(bundled.sourceBytes);
    return {
      ...imported,
      name: bundled.projectName,
      sourceFileName: bundled.sourceName,
      projectDraft: bundled.draft,
      projectArchiveSize: file.size,
      portableProject: true,
    };
  }
  if (file.size > MAX_FILE_BYTES) throw new Error("O arquivo deve ter até 50 MB.");
  const imported = await parseSourceBuffer(buffer, name, file.size, file);
  imported.sourceFingerprint = await fingerprintSourceBytes(buffer);
  return imported;
}

export const meshImportLimits = Object.freeze({ maxFileBytes: MAX_FILE_BYTES, maxProjectBytes: projectBundleLimits.maxArchiveBytes, maxTriangles: MAX_TRIANGLES });
