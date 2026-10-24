import assert from "node:assert/strict";
import test from "node:test";
import { assistantStructuredOutput, parseAssistantReply, assistantSuggestionSchema } from "../features/fatiamento-3d/ai-copilot.mjs";

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
