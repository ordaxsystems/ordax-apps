import assert from "node:assert/strict";
import test from "node:test";
import { assistantStructuredOutput, buildAssistantProfileContext, parseAssistantReply, assistantSuggestionSchema, assistantProfileOptionLimit } from "../features/fatiamento-3d/ai-copilot.mjs";

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
  return JSON.stringify({
    schema: "ordax.slicer-assistant-response/1",
    answer: "Sugestão baseada nos catálogos locais.",
    suggestion: {
      schema: assistantSuggestionSchema,
      summary: "A combinação ainda precisa ser validada pelo OrcaSlicer.",
      confidence: "medium",
      evidence,
      settings,
      transform: null,
      profiles,
    },
  });
}

test("aceita perfis somente quando IDs e evidência pertencem ao catálogo da solicitação", () => {
  const parsed = parseAssistantReply(reply({ profiles: { machine: machineId, process: processId, filament: filamentId } }), { allowedEvidence, allowedProfiles });
  assert.deepEqual(parsed.suggestion.profiles, { machine: machineId, process: processId, filament: filamentId });
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
    settings: { quality: "fine", layerHeight: null, walls: null, infill: null, supports: null, fanSpeedPercent: null },
  }), { allowedEvidence: ["settings"], allowedProfiles });
  assert.deepEqual(parsed.suggestion.settings, { quality: "fine" });
  assert.deepEqual(parsed.suggestion.profiles, {});
});

test("schema estrito exige os três campos de perfil na proposta", () => {
  const suggestionSchema = assistantStructuredOutput.schema.properties.suggestion.anyOf[0];
  assert.ok(suggestionSchema.required.includes("profiles"));
  assert.deepEqual(suggestionSchema.properties.profiles.anyOf[0].required, ["machine", "process", "filament"]);
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
  assert.equal(result.allowedProfiles.filament.length, assistantProfileOptionLimit);
});
