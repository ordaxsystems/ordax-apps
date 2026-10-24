import assert from "node:assert/strict";
import test from "node:test";
import { formatSliceProgress, readSlicerStatus, requestRealSlice } from "../features/fatiamento-3d/slicer-port.mjs";

const ids = {
  machine: `orca-machine-${"a".repeat(24)}`,
  process: `orca-process-${"b".repeat(24)}`,
  filament: `orca-filament-${"c".repeat(24)}`,
};

function profileCompatibility({ printers = [], prints = [], parentName = null, isSystem = null, printerCondition = "", printCondition = "" } = {}) {
  return {
    schema: "ordax.slicer-profile-compatibility/1",
    parentName,
    isSystem,
    compatiblePrinters: { present: true, names: printers },
    compatiblePrintersCondition: { present: true, value: printerCondition },
    compatiblePrints: { present: true, names: prints },
    compatiblePrintsCondition: { present: true, value: printCondition },
    compatibleMachineExpressionGroup: { present: false, values: null },
    compatibleProcessExpressionGroup: { present: false, values: null },
  };
}

function status(executionTarget = "device") {
  const machine = { id: ids.machine, name: "Máquina de teste", compatibility: profileCompatibility({ isSystem: true }) };
  const process = { id: ids.process, name: "Processo de teste", compatibility: profileCompatibility({ printers: [machine.name] }) };
  const filament = { id: ids.filament, name: "Filamento de teste", compatibility: profileCompatibility({ printers: [machine.name], prints: [process.name] }) };
  return {
    available: true,
    engine: "OrcaSlicer",
    version: "2.3.1",
    executionTarget,
    executionTargetLabel: executionTarget === "server" ? "https://slice.example.test" : undefined,
    reason: "",
    profiles: { machine: { catalog: [machine] }, process: { catalog: [process] }, filament: { catalog: [filament] } },
  };
}

function request() {
  return {
    file: new Blob(["original 3MF"], { type: "model/3mf" }),
    filename: "Projeto confidencial.3mf",
    format: "3MF",
    preparedModel: { file: new Blob(["prepared STL"], { type: "model/stl" }), triangleCount: 1, internalFilename: "private-source-path.stl" },
    settings: { quality: "standard", layerHeight: 0.2, walls: 3, topShellLayers: 3, bottomShellLayers: 3, topShellThickness: 0.8, bottomShellThickness: 1.2, infill: 15, infillPattern: "gyroid", supports: false, supportType: "normal(auto)", supportThresholdAngle: 0, supportOnBuildPlateOnly: false, fanMinSpeedPercent: 0, fanMaxSpeedPercent: 100, internalNote: "private-settings-note" },
    processesSchema: "ordax.slicer-processes/6",
    objects: [{ id: "model-object-private-79", name: "Peça cliente confidencial", sourceObjectId: "3mf-resource-private-82", buildItemIndex: 7, triangleCount: 1 }],
    objectTransformsSchema: "ordax.object-transforms/1",
    objectTransforms: [{ objectId: "model-object-private-79", offsetMm: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 1, internalNote: "private-transform-note" }],
    processes: [{
      id: "process-private-34",
      name: "Perfil de produção confidencial",
      objectIds: ["model-object-private-79"],
      settings: {
        quality: "standard", layerHeight: 0.2, walls: 3, topShellLayers: 3, bottomShellLayers: 3, topShellThickness: 0.8, bottomShellThickness: 1.2, infill: 15, infillPattern: "gyroid", supports: false,
        supportType: "normal(auto)", supportThresholdAngle: 0, supportOnBuildPlateOnly: false,
        fanMinSpeedPercent: 0, fanMaxSpeedPercent: 100, internalNote: "private-process-note",
      },
    }],
    profileSelectionSchema: "ordax.slicer-profile-selection/1",
    profileIds: { ...ids },
  };
}

test("status bloqueia fatiamento quando o host não declara o destino do motor", async () => {
  const result = await readSlicerStatus({ getStatus: async () => status("unknown"), slice: async () => null });
  assert.equal(result.available, false);
  assert.equal(result.executionTarget, "unknown");
  assert.match(result.reason, /informar se o motor executará/);
});

test("status remoto exige um destino identificável para explicar o envio", async () => {
  const result = await readSlicerStatus({ getStatus: async () => ({ ...status("server"), executionTargetLabel: "   " }), slice: async () => null });
  assert.equal(result.available, false);
  assert.equal(result.executionTarget, "server");
  assert.match(result.reason, /identificar o servidor/);
});

test("progresso indeterminado não é apresentado como zero por cento", () => {
  assert.equal(formatSliceProgress({ stage: "OrcaSlicer processando o modelo" }), "Fatiamento em andamento · OrcaSlicer processando o modelo");
  assert.equal(formatSliceProgress({}), "Fatiamento em andamento");
});

test("progresso numérico é limitado e o texto de fase fica sanitizado", () => {
  assert.equal(formatSliceProgress({ percent: 42.6, stage: "Camada\n 4" }), "Fatiamento em andamento · 43% · Camada  4");
  assert.equal(formatSliceProgress({ percent: 140, stage: "" }), "Fatiamento em andamento · 100%");
  assert.equal(formatSliceProgress({ percent: "sem medição", stage: "Preparando" }), "Fatiamento em andamento · Preparando");
});

test("destino remoto exige consentimento explícito antes de chamar o motor", async () => {
  let sliceCalled = false;
  const port = { getStatus: async () => status("server"), slice: async () => { sliceCalled = true; } };
  await assert.rejects(requestRealSlice(port, request()), /Confirme o envio da malha preparada/);
  assert.equal(sliceCalled, false);
});

test("aprovação remota precisa corresponder ao destino que o host informa no envio", async () => {
  let sliceCalled = false;
  const job = request();
  job.remoteExecutionApproved = "https://old-slicer.example.test";
  const port = {
    getStatus: async () => ({ ...status("server"), executionTargetLabel: "https://current-slicer.example.test" }),
    slice: async () => { sliceCalled = true; },
  };
  await assert.rejects(requestRealSlice(port, job), /servidor web identificado pelo host/);
  assert.equal(sliceCalled, false);
});

test("a porta bloqueia perfis que declaram outra máquina antes de chamar o host", async () => {
  const snapshot = status();
  snapshot.profiles.process.catalog[0].compatibility.compatiblePrinters.names = ["Outra máquina"];
  let sliceCalled = false;
  const port = {
    getStatus: async () => snapshot,
    slice: async () => { sliceCalled = true; },
  };
  await assert.rejects(requestRealSlice(port, request()), /perfil de processo não declara compatibilidade/);
  assert.equal(sliceCalled, false);
});

test("a porta bloqueia expressões de perfil que ainda não consegue avaliar", async () => {
  const snapshot = status();
  const processCompatibility = snapshot.profiles.process.catalog[0].compatibility;
  processCompatibility.compatiblePrinters.names = [];
  processCompatibility.compatiblePrintersCondition.value = 'printer_model == "Máquina de teste"';
  const port = { getStatus: async () => snapshot, slice: async () => { throw new Error("não deveria iniciar"); } };
  await assert.rejects(requestRealSlice(port, request()), /expressão de compatibilidade com a máquina/);
});

test("a porta rejeita um padrão de preenchimento fora da lista antes de chamar o host", async () => {
  let sliceCalled = false;
  const job = request();
  job.processes[0].settings.infillPattern = "invented-pattern";
  const port = { getStatus: async () => status("device"), slice: async () => { sliceCalled = true; } };
  await assert.rejects(requestRealSlice(port, job), /configurações do Perfil de produção confidencial estão fora dos limites/);
  assert.equal(sliceCalled, false);
});

test("envio web reduz metadados e encaminha cancelamento e progresso pela porta do host", async () => {
  const submitted = {};
  const controller = new AbortController();
  const progressEvents = [];
  const onProgress = progress => progressEvents.push(progress);
  const job = request();
  job.remoteExecutionApproved = "https://slice.example.test";
  const port = {
    getStatus: async () => status("server"),
    slice: async (sliceRequest, options) => {
      submitted.request = sliceRequest;
      submitted.options = options;
      options.onProgress({ stage: "Motor processando" });
      return { gcode: new Blob(["G1 X0 Y0\n"], { type: "application/gcode" }), engine: "OrcaSlicer", engineVersion: "2.3.1", filename: "server-side-name.gcode" };
    },
  };

  const result = await requestRealSlice(port, job, { signal: controller.signal, onProgress });
  assert.equal(submitted.options.signal, controller.signal);
  assert.equal(typeof submitted.options.onProgress, "function");
  assert.equal("file" in submitted.request, false);
  assert.equal("remoteExecutionApproved" in submitted.request, false);
  assert.equal(submitted.request.filename, "ordax-print.stl");
  assert.deepEqual(submitted.request.objects, [{ id: "object-1", sourceObjectId: "source-1", buildItemIndex: 0, triangleCount: 1 }]);
  assert.equal(submitted.request.processes[0].id, "process-1");
  assert.deepEqual(submitted.request.processes[0].objectIds, ["object-1"]);
  assert.equal(submitted.request.processes[0].settings.infillPattern, "gyroid");
  assert.equal(submitted.request.processes[0].settings.topShellLayers, 3);
  assert.equal(submitted.request.processes[0].settings.bottomShellLayers, 3);
  assert.equal(submitted.request.processes[0].settings.topShellThickness, 0.8);
  assert.equal(submitted.request.processes[0].settings.bottomShellThickness, 1.2);
  const serialized = JSON.stringify(submitted.request);
  for (const privateValue of ["Projeto confidencial", "Peça cliente confidencial", "3mf-resource-private-82", "process-private-34", "Perfil de produção confidencial", "private-source-path", "private-settings-note", "private-transform-note", "private-process-note"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
  assert.equal(result.filename, "Projeto confidencial.gcode");
  assert.equal(result.executionTarget, "server");
  assert.match(await result.gcode.text(), /^G1 X0 Y0/);
  assert.deepEqual(progressEvents.map(event => event.stage), [
    "Enviando ao servidor identificado",
    "Motor processando",
    "Validando o G-code do motor",
    "G-code validado",
  ]);
  assert.equal(progressEvents.at(-1).percent, 100);
});
