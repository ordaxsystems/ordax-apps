import assert from "node:assert/strict";
import test from "node:test";
import { assistantStructuredOutput, assistantEvidenceIds, buildAssistantMeshSummary, buildAssistantProfileContext, parseAssistantReply, assistantSuggestionSchema, assistantProfileOptionLimit, assistantMeshObjectLimit } from "../features/fatiamento-3d/ai-copilot.mjs";
import { readProfileCompatibility } from "../features/fatiamento-3d/profile-compatibility.mjs";

const machineId = `orca-machine-${"a".repeat(24)}`;
const processId = `orca-process-${"b".repeat(24)}`;
const filamentId = `orca-filament-${"c".repeat(24)}`;
const allowedEvidence = ["slicer.configuredProfiles"];
const allowedProfiles = {
  machine: [machineId],
  process: [processId],
  filament: [filamentId],
};

function reply({ evidence = allowedEvidence, profiles = { machine: machineId, process: null, filament: null }, settings = null } = {}) {
  const completeSettings = settings === null ? null : {
    quality: null, layerHeight: null, walls: null, topShellLayers: null, bottomShellLayers: null, topShellThickness: null, bottomShellThickness: null, brimType: null, brimWidth: null,
    infill: null, infillPattern: null, supports: null, supportType: null, supportThresholdAngle: null,
    supportOnBuildPlateOnly: null, fanMinSpeedPercent: null, fanMaxSpeedPercent: null,
    ...settings,
  };
  return JSON.stringify({
    schema: "ordax.slicer-assistant-response/1",
    answer: "Sugestão baseada nos catálogos locais.",
    suggestion: {
      schema: assistantSuggestionSchema,
      summary: "A combinação ainda precisa ser validada pelo OrcaSlicer.",
      confidence: "medium",
      evidence,
      settings: completeSettings,
      transform: null,
      profiles,
    },
  });
}

function profile(id, name, { printers = [], prints = [], printerCondition = "", printCondition = "", from = "system" } = {}) {
  return {
    id,
    name,
    compatibility: readProfileCompatibility({
      from,
      compatible_printers: printers,
      compatible_printers_condition: printerCondition,
      compatible_prints: prints,
      compatible_prints_condition: printCondition,
    }),
  };
}

test("aceita perfis somente quando IDs e evidência pertencem ao catálogo da solicitação", () => {
  const parsed = parseAssistantReply(reply({ profiles: { machine: machineId, process: processId, filament: filamentId } }), { allowedEvidence, allowedProfiles });
  assert.deepEqual(parsed.suggestion.profiles, { machine: machineId, process: processId, filament: filamentId });
});

test("aceita sugestão de perfil somente quando a combinação final é compatível", () => {
  const machineB = `orca-machine-${"d".repeat(24)}`;
  const processB = `orca-process-${"e".repeat(24)}`;
  const filamentB = `orca-filament-${"f".repeat(24)}`;
  const profileCatalogs = {
    machine: [profile(machineId, "Printer A"), profile(machineB, "Printer B")],
    process: [profile(processId, "Process A", { printers: ["Printer A"] }), profile(processB, "Process B", { printers: ["Printer B"] })],
    filament: [profile(filamentId, "PLA A", { printers: ["Printer A"], prints: ["Process A"] }), profile(filamentB, "PLA B", { printers: ["Printer B"], prints: ["Process B"] })],
  };
  const parsed = parseAssistantReply(reply({ profiles: { machine: machineB, process: processB, filament: filamentB } }), {
    allowedEvidence,
    allowedProfiles: { machine: [machineId, machineB], process: [processId, processB], filament: [filamentId, filamentB] },
    profileCatalogs,
    selectedProfileIds: { machine: machineId, process: processId, filament: filamentId },
  });
  assert.deepEqual(parsed.suggestion.profiles, { machine: machineB, process: processB, filament: filamentB });
});

test("rejeita sugestão válida por ID quando a combinação final é incompatível", () => {
  const machineB = `orca-machine-${"d".repeat(24)}`;
  const profileCatalogs = {
    machine: [profile(machineId, "Printer A"), profile(machineB, "Printer B")],
    process: [profile(processId, "Process A", { printers: ["Printer A"] })],
    filament: [profile(filamentId, "PLA A", { printers: ["Printer A"], prints: ["Process A"] })],
  };
  assert.throws(() => parseAssistantReply(reply({ profiles: { machine: machineB, process: null, filament: null } }), {
    allowedEvidence,
    allowedProfiles: { machine: [machineId, machineB], process: [processId], filament: [filamentId] },
    profileCatalogs,
    selectedProfileIds: { machine: machineId, process: processId, filament: filamentId },
  }), /combinação de perfis proposta pela IA não passou pela validação/);
});

test("rejeita sugestão de perfil que depende de expressão não avaliada", () => {
  const profileCatalogs = {
    machine: [profile(machineId, "Printer A")],
    process: [profile(processId, "Process A", { printerCondition: 'printer_model == "Printer A"' })],
    filament: [profile(filamentId, "PLA A", { printers: ["Printer A"], prints: ["Process A"] })],
  };
  assert.throws(() => parseAssistantReply(reply({ profiles: { machine: null, process: processId, filament: null } }), {
    allowedEvidence,
    allowedProfiles,
    profileCatalogs,
    selectedProfileIds: { machine: machineId, process: processId, filament: filamentId },
  }), /expressão de compatibilidade com a máquina/);
});

test("rejeita ID de perfil que não está na lista permitida", () => {
  const fabricated = `orca-machine-${"d".repeat(24)}`;
  assert.throws(
    () => parseAssistantReply(reply({ profiles: { machine: fabricated, process: null, filament: null } }), { allowedEvidence, allowedProfiles }),
    /não passou pela validação/,
  );
});

test("rejeita sugestão de perfil sem citar o catálogo como evidência", () => {
  assert.throws(
    () => parseAssistantReply(reply({ evidence: ["settings"] }), { allowedEvidence: ["settings"], allowedProfiles }),
    /não passou pela validação/,
  );
});

test("mantém válidas recomendações de parâmetros sem mudança de perfil", () => {
  const parsed = parseAssistantReply(reply({
    evidence: ["settings"],
    profiles: null,
    settings: { quality: "fine", layerHeight: null, walls: null, infill: null, infillPattern: null, supports: null, supportType: null, supportThresholdAngle: null, supportOnBuildPlateOnly: null, fanMinSpeedPercent: null, fanMaxSpeedPercent: null },
  }), { allowedEvidence: ["settings"], allowedProfiles });
  assert.deepEqual(parsed.suggestion.settings, { quality: "fine" });
  assert.deepEqual(parsed.suggestion.profiles, {});
});

test("aceita apenas um padrão de preenchimento presente no catálogo do OrcaSlicer", () => {
  const parsed = parseAssistantReply(reply({
    evidence: ["settings"],
    profiles: null,
    settings: { quality: null, layerHeight: null, walls: null, infill: null, infillPattern: "gyroid", supports: null, supportType: null, supportThresholdAngle: null, supportOnBuildPlateOnly: null, fanMinSpeedPercent: null, fanMaxSpeedPercent: null },
  }), { allowedEvidence: ["settings"], allowedProfiles });
  assert.deepEqual(parsed.suggestion.settings, { infillPattern: "gyroid" });
  assert.throws(() => parseAssistantReply(reply({
    evidence: ["settings"],
    profiles: null,
    settings: { quality: null, layerHeight: null, walls: null, infill: null, infillPattern: "invented-pattern", supports: null, supportType: null, supportThresholdAngle: null, supportOnBuildPlateOnly: null, fanMinSpeedPercent: null, fanMaxSpeedPercent: null },
  }), { allowedEvidence: ["settings"], allowedProfiles }), /não passou pela validação/);
});

test("valida e mapeia os limites mínimo e máximo da ventoinha de peça", () => {
  const parsed = parseAssistantReply(reply({
    evidence: ["settings"],
    profiles: null,
    settings: { quality: null, layerHeight: null, walls: null, infill: null, infillPattern: null, supports: null, fanMinSpeedPercent: 35, fanMaxSpeedPercent: 80 },
  }), { allowedEvidence: ["settings"], allowedProfiles });
  assert.deepEqual(parsed.suggestion.settings, { fanMin: 35, fanMax: 80 });
});

test("rejeita sugestão com limite mínimo de ventoinha maior que o máximo", () => {
  assert.throws(() => parseAssistantReply(reply({
    evidence: ["settings"],
    profiles: null,
    settings: { quality: null, layerHeight: null, walls: null, infill: null, infillPattern: null, supports: null, fanMinSpeedPercent: 85, fanMaxSpeedPercent: 70 },
  }), { allowedEvidence: ["settings"], allowedProfiles }), /não passou pela validação/);
});

test("valida recomendações de tipo e largura de brim", () => {
  const parsed = parseAssistantReply(reply({
    evidence: ["settings"], profiles: null,
    settings: { quality: null, layerHeight: null, walls: null, brimType: "outer_only", brimWidth: 5, infill: null, infillPattern: null, supports: null, supportType: null, supportThresholdAngle: null, supportOnBuildPlateOnly: null, fanMinSpeedPercent: null, fanMaxSpeedPercent: null },
  }), { allowedEvidence: ["settings"], allowedProfiles });
  assert.deepEqual(parsed.suggestion.settings, { brimType: "outer_only", brimWidth: 5 });
  for (const [brimType, brimWidth] of [["painted", 5], ["outer_only", 20.1]]) {
    assert.throws(() => parseAssistantReply(reply({
      evidence: ["settings"], profiles: null,
      settings: { quality: null, layerHeight: null, walls: null, brimType, brimWidth, infill: null, infillPattern: null, supports: null, supportType: null, supportThresholdAngle: null, supportOnBuildPlateOnly: null, fanMinSpeedPercent: null, fanMaxSpeedPercent: null },
    }), { allowedEvidence: ["settings"], allowedProfiles }), /não passou pela validação/);
  }
});

test("valida recomendações de espessura mínima superior e inferior", () => {
  const parsed = parseAssistantReply(reply({
    evidence: ["settings"],
    profiles: null,
    settings: { quality: null, layerHeight: null, walls: null, topShellThickness: 0.8, bottomShellThickness: 1.2, infill: null, infillPattern: null, supports: null, supportType: null, supportThresholdAngle: null, supportOnBuildPlateOnly: null, fanMinSpeedPercent: null, fanMaxSpeedPercent: null },
  }), { allowedEvidence: ["settings"], allowedProfiles });
  assert.deepEqual(parsed.suggestion.settings, { topShellThickness: 0.8, bottomShellThickness: 1.2 });
  for (const thickness of [-0.1, 10.1]) {
    assert.throws(() => parseAssistantReply(reply({
      evidence: ["settings"],
      profiles: null,
      settings: { quality: null, layerHeight: null, walls: null, topShellThickness: thickness, bottomShellThickness: null, infill: null, infillPattern: null, supports: null, supportType: null, supportThresholdAngle: null, supportOnBuildPlateOnly: null, fanMinSpeedPercent: null, fanMaxSpeedPercent: null },
    }), { allowedEvidence: ["settings"], allowedProfiles }), /não passou pela validação/);
  }
});

test("valida e mapeia tipo, ângulo e alcance dos suportes", () => {
  const parsed = parseAssistantReply(reply({
    evidence: ["settings"],
    profiles: null,
    settings: { quality: null, layerHeight: null, walls: null, infill: null, infillPattern: null, supports: true, supportType: "tree(auto)", supportThresholdAngle: 45, supportOnBuildPlateOnly: true, fanMinSpeedPercent: null, fanMaxSpeedPercent: null },
  }), { allowedEvidence: ["settings"], allowedProfiles });
  assert.deepEqual(parsed.suggestion.settings, { supports: true, supportType: "tree(auto)", supportThresholdAngle: 45, supportOnBuildPlateOnly: true });
});

test("rejeita tipo de suporte manual e ângulo fora do limite", () => {
  for (const support of [
    { supportType: "tree(manual)", supportThresholdAngle: 45 },
    { supportType: "tree(auto)", supportThresholdAngle: 91 },
  ]) {
    assert.throws(() => parseAssistantReply(reply({
      evidence: ["settings"],
      profiles: null,
      settings: { quality: null, layerHeight: null, walls: null, infill: null, infillPattern: null, supports: true, ...support, supportOnBuildPlateOnly: null, fanMinSpeedPercent: null, fanMaxSpeedPercent: null },
    }), { allowedEvidence: ["settings"], allowedProfiles }), /não passou pela validação/);
  }
});

test("schema estrito exige os três campos de perfil na proposta", () => {
  const suggestionSchema = assistantStructuredOutput.schema.properties.suggestion.anyOf[0];
  assert.ok(suggestionSchema.required.includes("profiles"));
  assert.equal(suggestionSchema.properties.settings.anyOf[0].properties.fanMinSpeedPercent.anyOf[0].minimum, 0);
  assert.equal(suggestionSchema.properties.settings.anyOf[0].properties.fanMaxSpeedPercent.anyOf[0].maximum, 100);
  assert.equal(suggestionSchema.properties.settings.anyOf[0].properties.topShellLayers.anyOf[0].maximum, 20);
  assert.equal(suggestionSchema.properties.settings.anyOf[0].properties.bottomShellLayers.anyOf[0].minimum, 0);
  assert.equal(suggestionSchema.properties.settings.anyOf[0].properties.topShellThickness.anyOf[0].maximum, 10);
  assert.equal(suggestionSchema.properties.settings.anyOf[0].properties.bottomShellThickness.anyOf[0].minimum, 0);
  assert.deepEqual(suggestionSchema.properties.settings.anyOf[0].properties.brimType.anyOf[0].enum, ["outer_only", "inner_only", "outer_and_inner", "no_brim"]);
  assert.equal(suggestionSchema.properties.settings.anyOf[0].properties.brimWidth.anyOf[0].maximum, 20);
  assert.ok(suggestionSchema.properties.settings.anyOf[0].properties.infillPattern.anyOf[0].enum.includes("gyroid"));
  assert.deepEqual(suggestionSchema.properties.settings.anyOf[0].properties.supportType.anyOf[0].enum, ["normal(auto)", "tree(auto)"]);
  assert.deepEqual(suggestionSchema.properties.profiles.anyOf[0].required, ["machine", "process", "filament"]);
});

test("schema de evidências permite citar links de vértices e resumo geométrico por peça", () => {
  for (const evidenceId of ["geometryDiagnostics.nonManifoldVertexCount", "geometryDiagnostics.objectSummary"]) {
    assert.ok(assistantEvidenceIds.includes(evidenceId));
    assert.ok(assistantStructuredOutput.schema.properties.suggestion.anyOf[0].properties.evidence.items.enum.includes(evidenceId));
  }
});

test("schema da IA aceita a evidência determinística do envelope da mesa", () => {
  const evidenceId = "model.printableSpaceFit";
  assert.ok(assistantEvidenceIds.includes(evidenceId));
  assert.ok(assistantStructuredOutput.schema.properties.suggestion.anyOf[0].properties.evidence.items.enum.includes(evidenceId));
  const parsed = parseAssistantReply(reply({
    evidence: [evidenceId],
    profiles: null,
    settings: { quality: "fine", layerHeight: null, walls: null, infill: null, infillPattern: null, supports: null, supportType: null, supportThresholdAngle: null, supportOnBuildPlateOnly: null, fanMinSpeedPercent: null, fanMaxSpeedPercent: null },
  }), { allowedEvidence: [evidenceId], allowedProfiles });
  assert.deepEqual(parsed.suggestion.evidence, [evidenceId]);
});

test("resumo geométrico limita peças, prioriza a selecionada e preserva a ordem como referência", () => {
  const objects = Array.from({ length: 15 }, (_, index) => ({ id: `id-${index}`, name: `nome privado ${index}`, positions: new Float32Array(9) }));
  const diagnostics = {
    surfaceAreaByObject: objects.map((object, index) => ({ objectId: object.id, triangleCount: 1, degenerateTriangleCount: index === 2 ? 3 : 0 })),
    edgeIncidenceByObject: objects.map((object, index) => ({ objectId: object.id, checked: true, boundaryEdgeCount: 3, nonManifoldEdgeCount: index === 4 ? 1 : 0, inconsistentWindingEdgeCount: 0 })),
    vertexLinksByObject: objects.map((object, index) => ({ objectId: object.id, checked: true, checkedVertexCount: 3, boundaryVertexCount: 3, interiorVertexCount: 0, nonManifoldVertexCount: index === 7 ? 1 : 0 })),
  };
  const result = buildAssistantMeshSummary({ objects, geometryDiagnostics: diagnostics, selectedObjectId: "id-14", getSurfaceAreaMm2: id => Number(id.slice(3)) + 0.5 });
  assert.equal(result.totalObjectCount, 15);
  assert.equal(result.includedObjectCount, assistantMeshObjectLimit);
  assert.equal(result.omittedObjectCount, 3);
  assert.equal(result.itemOrder, "selected-then-review-signals; item-is-original-index");
  assert.deepEqual(result.items.slice(0, 4).map(item => item.item), [15, 3, 5, 8]);
  assert.equal(result.items[0].selected, true);
  assert.equal(result.items[0].surfaceAreaMm2, 14.5);
  assert.equal(result.items.some(item => "name" in item || "objectId" in item), false);
});

test("contexto da IA prioriza o perfil ativo e limita candidatos ao que foi enviado", () => {
  const catalog = Array.from({ length: 32 }, (_, index) => ({
    id: `orca-machine-${index.toString(16).padStart(24, "0")}`,
    name: `Máquina ${index}`,
    bedSizeMm: [256, 256],
    heightMm: 256,
    nozzleDiameterMm: 0.4,
    printerModel: "metadata fora do necessário para recomendar",
  }));
  const selectedId = catalog.at(-1).id;
  const result = buildAssistantProfileContext({ machine: { catalog } }, { machine: selectedId });
  const visible = JSON.parse(result.context[0].text).slicer.configuredProfiles.catalogs.machines;
  assert.equal(visible.length, assistantProfileOptionLimit);
  assert.equal(visible[0].id, selectedId);
  assert.deepEqual(result.allowedProfiles.machine, visible.map(profile => profile.id));
  assert.equal(visible.some(profile => profile.id === catalog[0].id), true);
  assert.equal(visible.some(profile => profile.id === catalog[assistantProfileOptionLimit].id), false);
});

test("cada catálogo compacto respeita o limite de contexto mesmo com nomes longos", () => {
  const profiles = Array.from({ length: 32 }, (_, index) => ({
    id: `orca-filament-${index.toString(16).padStart(24, "0")}`,
    name: `\"\\${"PLA personalizado ".repeat(12)} ${index}`,
    type: "PETG personalizado ".repeat(8),
    nozzleTemperatureC: [225, 250],
    bedTemperatureC: [70, 85],
  }));
  const result = buildAssistantProfileContext({ filament: { catalog: profiles } });
  assert.equal(result.context.length, 1);
  assert.ok(result.context[0].text.length < 8192);
  assert.ok(result.allowedProfiles.filament.length > 0);
  assert.ok(result.allowedProfiles.filament.length <= assistantProfileOptionLimit);
  assert.equal(result.allowedProfiles.filament.length, result.visibleProfiles.filament.length);
});
