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
    bedType: "Textured PEI Plate",
    quality: "standard",
    layerHeight: 0.2,
    walls: 3,
    topShellLayers: 5,
    bottomShellLayers: 4,
    topShellThickness: 0.8,
    bottomShellThickness: 1.2,
    brimType: "outer_only",
    brimWidth: 5,
    brimGap: 0.2,
    infill: 15,
    infillPattern: "gyroid",
    seamPosition: "aligned_back",
    nozzleTemperatureC: 215,
    nozzleTemperatureInitialLayerC: 220,
    selectedTab: "preview",
    processes: [{
      id: "process-1",
      name: "Processo fino",
      objectIds: ["object-1"],
      settings: { quality: "fine", layerHeight: 0.12, walls: 4, topShellLayers: 6, bottomShellLayers: 2, topShellThickness: 0.6, bottomShellThickness: 0.4, brimType: "outer_and_inner", brimWidth: 3, brimGap: 0.15, infill: 20, infillPattern: "lightning", seamPosition: "random", supports: false, fanMin: 25, fanMax: 80, privateValue: "must-not-be-saved" },
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
    assert.equal(restored.draft.topShellLayers, 5);
    assert.equal(restored.draft.bottomShellLayers, 4);
    assert.equal(restored.draft.topShellThickness, 0.8);
    assert.equal(restored.draft.bottomShellThickness, 1.2);
    assert.equal(restored.draft.brimType, "outer_only");
    assert.equal(restored.draft.brimWidth, 5);
    assert.equal(restored.draft.brimGap, 0.2);
    assert.equal(restored.draft.processes[0].settings.topShellLayers, 6);
    assert.equal(restored.draft.processes[0].settings.bottomShellLayers, 2);
    assert.equal(restored.draft.processes[0].settings.topShellThickness, 0.6);
    assert.equal(restored.draft.processes[0].settings.bottomShellThickness, 0.4);
    assert.equal(restored.draft.processes[0].settings.brimType, "outer_and_inner");
    assert.equal(restored.draft.processes[0].settings.brimWidth, 3);
    assert.equal(restored.draft.processes[0].settings.brimGap, 0.15);
    assert.equal(restored.draft.infillPattern, "gyroid");
    assert.equal(restored.draft.processes[0].settings.infillPattern, "lightning");
    assert.equal(restored.draft.seamPosition, "aligned_back");
    assert.equal(restored.draft.nozzleTemperatureC, 215);
    assert.equal(restored.draft.nozzleTemperatureInitialLayerC, 220);
    assert.equal(restored.draft.bedType, "Textured PEI Plate");
    assert.equal(restored.draft.processes[0].settings.seamPosition, "random");
  });
}

test("abre projetos /2 preservando as configurações antigas de casca", async () => {
  const source = new Blob([1, 2, 3]);
  const draft = validDraft();
  const manifest = {
    schema: "ordax.3d-printing-project/2",
    projectName: "Projeto legado",
    source: { path: "models/source.stl", name: "modelo.stl", format: "STL", size: source.size },
    draft,
  };
  const archive = await createStoredZipBlob([
    { name: "project.json", data: new Blob([JSON.stringify(manifest)]) },
    { name: "models/source.stl", data: source },
  ]);
  const restored = await readProjectBundle(await archive.arrayBuffer());
  assert.equal(restored.projectName, "Projeto legado");
  assert.equal(restored.draft.topShellLayers, 5);
  assert.equal(restored.draft.processes[0].settings.bottomShellLayers, 2);
});

test("abre projetos /4 com campos de brim que vieram antes do gap editável", async () => {
  const source = new Blob([1, 2, 3]);
  const draft = validDraft();
  delete draft.brimGap;
  delete draft.processes[0].settings.brimGap;
  const manifest = { schema: "ordax.3d-printing-project/4", projectName: "Projeto quatro", source: { path: "models/source.stl", name: "modelo.stl", format: "STL", size: source.size }, draft };
  const archive = await createStoredZipBlob([{ name: "project.json", data: new Blob([JSON.stringify(manifest)]) }, { name: "models/source.stl", data: source }]);
  const restored = await readProjectBundle(await archive.arrayBuffer());
  assert.equal(restored.draft.brimWidth, 5);
  assert.equal(restored.draft.processes[0].settings.brimWidth, 3);
});

test("abre projetos /5 preservando configurações anteriores sem override de costura", async () => {
  const source = new Blob([1, 2, 3]);
  const draft = validDraft();
  delete draft.seamPosition;
  delete draft.processes[0].settings.seamPosition;
  const manifest = { schema: "ordax.3d-printing-project/5", projectName: "Projeto cinco", source: { path: "models/source.stl", name: "modelo.stl", format: "STL", size: source.size }, draft };
  const archive = await createStoredZipBlob([{ name: "project.json", data: new Blob([JSON.stringify(manifest)]) }, { name: "models/source.stl", data: source }]);
  const restored = await readProjectBundle(await archive.arrayBuffer());
  assert.equal(restored.draft.seamPosition, undefined);
  assert.equal(restored.draft.processes[0].settings.seamPosition, undefined);
});

test("abre projetos /6 preservando costura e sem exigir overrides térmicos novos", async () => {
  const source = new Blob([1, 2, 3]);
  const draft = validDraft();
  delete draft.nozzleTemperatureC;
  delete draft.nozzleTemperatureInitialLayerC;
  const manifest = { schema: "ordax.3d-printing-project/6", projectName: "Projeto seis", source: { path: "models/source.stl", name: "modelo.stl", format: "STL", size: source.size }, draft };
  const archive = await createStoredZipBlob([{ name: "project.json", data: new Blob([JSON.stringify(manifest)]) }, { name: "models/source.stl", data: source }]);
  const restored = await readProjectBundle(await archive.arrayBuffer());
  assert.equal(restored.draft.seamPosition, "aligned_back");
  assert.equal(restored.draft.nozzleTemperatureC, undefined);
  assert.equal(restored.draft.nozzleTemperatureInitialLayerC, undefined);
});

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
