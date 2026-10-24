import assert from "node:assert/strict";
import test from "node:test";
import { createProjectBundle, projectBundleLimits, readProjectBundle } from "../features/fatiamento-3d/project-bundle.mjs";
import { readZipDirectory, createStoredZipBlob } from "../features/fatiamento-3d/zip-container.mjs";
import { hasCompleteProcessAssignment } from "../features/fatiamento-3d/slicer-port.mjs";

function namedBlob(bytes, name) {
  const blob = new Blob([bytes]);
  Object.defineProperty(blob, "name", { value: name, enumerable: true });
  return blob;
}

function validDraft() {
  return {
    printer: "FDM",
    filament: "PLA",
    quality: "standard",
    layerHeight: 0.2,
    walls: 3,
    infill: 15,
    selectedTab: "preview",
    processes: [{
      id: "process-1",
      name: "Processo fino",
      objectIds: ["object-1"],
      settings: { quality: "fine", layerHeight: 0.12, walls: 4, infill: 20, supports: false, fanMin: 25, fanMax: 80, privateValue: "must-not-be-saved" },
    }],
    objectTransforms: { "object-1": { x: 1, y: 2, z: 0, rotationX: 0, rotationY: 0, rotationZ: 90, scale: 1.2 } },
    privateValue: "must-not-be-saved",
  };
}

for (const extension of ["stl", "3mf"]) {
  test(`projeto portátil preserva a malha original ${extension.toUpperCase()} e as configurações permitidas`, async () => {
    const sourceBytes = Uint8Array.from([0, 1, 2, 3, 13, 10, 255]);
    const result = await createProjectBundle({
      sourceFile: namedBlob(sourceBytes, `modelo.${extension}`),
      draft: validDraft(),
      projectName: "Peça de teste",
    });
    const restored = await readProjectBundle(await result.blob.arrayBuffer());

    assert.equal(result.filename, "Peça de teste.ordax3d");
    assert.equal(restored.projectName, "Peça de teste");
    assert.equal(restored.sourceName, `modelo.${extension}`);
    assert.equal(restored.sourceFormat, extension.toUpperCase());
    assert.deepEqual([...restored.sourceBytes], [...sourceBytes]);
    assert.equal(restored.draft.privateValue, undefined);
    assert.equal(restored.draft.processes[0].settings.privateValue, undefined);
    assert.equal(restored.draft.processes[0].settings.layerHeight, 0.12);
  });
}

test("projeto portátil rejeita extensão e nome de projeto inválidos", async () => {
  await assert.rejects(createProjectBundle({ sourceFile: namedBlob([1], "modelo.obj"), draft: validDraft() }), /só pode incluir/);
  await assert.rejects(createProjectBundle({ sourceFile: namedBlob([1], "modelo.stl"), draft: validDraft(), projectName: "\u0001" }), /nome do projeto é inválido/);
});

test("leitor recusa pacote acima do limite antes de interpretar o ZIP", async () => {
  const oversized = new ArrayBuffer(projectBundleLimits.maxArchiveBytes + 1);
  await assert.rejects(readProjectBundle(oversized), /até 51 MB/);
});

test("leitor valida CRC32 da malha incluída", async () => {
  const result = await createProjectBundle({ sourceFile: namedBlob([1, 2, 3, 4], "modelo.stl"), draft: validDraft() });
  const buffer = await result.blob.arrayBuffer();
  const entry = readZipDirectory(buffer).get("models/source.stl");
  const dataOffset = entry.localOffset + 30 + new TextEncoder().encode(entry.rawName).length;
  new Uint8Array(buffer)[dataOffset] ^= 0xff;
  await assert.rejects(readProjectBundle(buffer), /CRC32/);
});

test("leitor recusa recursos ZIP adicionais", async () => {
  const source = new Blob([1, 2, 3]);
  const manifest = {
    schema: "ordax.3d-printing-project/1",
    projectName: "Teste",
    source: { path: "models/source.stl", name: "modelo.stl", format: "STL", size: source.size },
    draft: validDraft(),
  };
  const archive = await createStoredZipBlob([
    { name: "project.json", data: new Blob([JSON.stringify(manifest)]) },
    { name: "models/source.stl", data: source },
    { name: "extra.bin", data: new Blob([0]) },
  ]);
  await assert.rejects(readProjectBundle(await archive.arrayBuffer()), /formato ZIP|apenas as configurações/);
});

test("atribuições portáteis exigem exatamente um processo por peça conhecida", () => {
  const objects = [{ id: "object-1" }, { id: "object-2" }];
  assert.equal(hasCompleteProcessAssignment([
    { objectIds: ["object-1"] },
    { objectIds: ["object-2"] },
  ], objects), true);
  assert.equal(hasCompleteProcessAssignment([{ objectIds: ["object-1", "object-2"] }], objects), true);
  assert.equal(hasCompleteProcessAssignment([{ objectIds: ["object-1"] }], objects), false);
  assert.equal(hasCompleteProcessAssignment([
    { objectIds: ["object-1"] },
    { objectIds: ["object-1", "object-2"] },
  ], objects), false);
  assert.equal(hasCompleteProcessAssignment([{ objectIds: ["object-1", "foreign-object"] }], objects), false);
  assert.equal(hasCompleteProcessAssignment([{ objectIds: "object-1" }], objects), false);
  assert.equal(hasCompleteProcessAssignment([{ objectIds: ["object-1"] }], [{ id: "object-1" }, { id: "object-1" }]), false);
});
