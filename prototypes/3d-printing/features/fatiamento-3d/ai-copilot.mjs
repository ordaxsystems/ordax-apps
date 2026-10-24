const PORT_SCHEMA = "ordax.intelligence/1";
const RESPONSE_SCHEMA = "ordax.intelligence-response/1";
const SUGGESTION_SCHEMA = "ordax.slicer-assistant-suggestion/2";
const ASSISTANT_RESPONSE_SCHEMA = "ordax.slicer-assistant-response/1";
const MAX_CONTEXT_ITEMS = 16;
const MAX_CONTEXT_ITEM_CHARS = 8192;
const MAX_CONTEXT_TOTAL_CHARS = 65536;

const nullable = schema => ({ anyOf: [schema, { type: "null" }] });
const nullableInteger = (minimum, maximum) => nullable({ type: "integer", minimum, maximum });

export const assistantStructuredOutput = Object.freeze({
  name: "ordax_slicer_assistant_response",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      schema: { type: "string", enum: [ASSISTANT_RESPONSE_SCHEMA] },
      answer: { type: "string" },
      suggestion: nullable({
        type: "object",
        additionalProperties: false,
        properties: {
          schema: { type: "string", enum: [SUGGESTION_SCHEMA] },
          summary: { type: "string" },
          settings: nullable({
            type: "object",
            additionalProperties: false,
            properties: {
              quality: nullable({ type: "string", enum: ["standard", "fine", "draft"] }),
              layerHeight: nullable({ type: "number", minimum: 0.08, maximum: 0.4 }),
              walls: nullableInteger(1, 8),
              infill: nullableInteger(0, 100),
              supports: nullable({ type: "boolean" }),
              fanSpeedPercent: nullableInteger(0, 100),
            },
            required: ["quality", "layerHeight", "walls", "infill", "supports", "fanSpeedPercent"],
          }),
          transform: nullable({
            type: "object",
            additionalProperties: false,
            properties: {
              x: nullableInteger(-500, 500),
              y: nullableInteger(-500, 500),
              z: nullableInteger(-500, 500),
              rotationX: nullableInteger(0, 359),
              rotationY: nullableInteger(0, 359),
              rotationZ: nullableInteger(0, 359),
              scalePercent: nullableInteger(10, 300),
            },
            required: ["x", "y", "z", "rotationX", "rotationY", "rotationZ", "scalePercent"],
          }),
        },
        required: ["schema", "summary", "settings", "transform"],
      }),
    },
    required: ["schema", "answer", "suggestion"],
  },
});

function setupHint(port) {
  try {
    const hint = port?.getSetupHint?.();
    return typeof hint === "string" && hint.trim() ? hint.trim().slice(0, 500) : "";
  } catch { return ""; }
}

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) throw new TypeError(`${label} precisa ser texto válido.`);
  const text = value.trim();
  if (!text || text.length > max) throw new TypeError(`${label} excede o limite permitido.`);
  return text;
}

export function intelligenceState(port) {
  if (!port || port.schema !== PORT_SCHEMA || typeof port.getSnapshot !== "function" || typeof port.subscribe !== "function" || typeof port.respond !== "function") {
    return { available: false, label: "Não conectado", reason: "Este host ainda não forneceu a porta pública OrdaX Intelligence." };
  }
  try {
    const snapshot = port.getSnapshot();
    if (!snapshot || snapshot.schema !== PORT_SCHEMA || snapshot.authority !== "none" || snapshot.toolExecution !== false) {
      return { available: false, label: "Contrato incompatível", reason: "A porta não corresponde ao contrato consultivo do OrdaX Intelligence." };
    }
    if (!["degraded", "ready", "busy", "error"].includes(snapshot.state)) {
      return { available: false, label: "Contrato incompatível", reason: "O Intelligence informou um estado que este app não reconhece." };
    }
    if (snapshot.state !== "ready" || snapshot.inferenceAvailable !== true) {
      const state = snapshot.state === "busy" ? "ocupado" : snapshot.state === "error" ? "com erro" : snapshot.state === "degraded" ? "indisponível no momento" : "sem inferência disponível";
      return { available: false, label: snapshot.state === "busy" ? "Ocupado" : "Indisponível", reason: setupHint(port) || `OrdaX Intelligence está ${state}.` };
    }
    if (typeof snapshot.engineId !== "string" || typeof snapshot.modelId !== "string") {
      return { available: false, label: "Contrato incompleto", reason: "A porta não informou o provedor e o modelo ativos." };
    }
    return { available: true, label: `${snapshot.engineId} · ${snapshot.modelId}`, reason: "" };
  } catch (error) {
    return { available: false, label: "Falha de conexão", reason: error?.message || "Não foi possível consultar o serviço de IA." };
  }
}

function validateContext(context) {
  if (!Array.isArray(context) || context.length > MAX_CONTEXT_ITEMS) throw new TypeError("O contexto da IA excede os limites do contrato.");
  let total = 0;
  return context.map(item => {
    if (!item || !["user", "workspace", "system", "document"].includes(item.scope)) throw new TypeError("O escopo de contexto da IA é inválido.");
    const id = boundedText(item.id, "Identificador de contexto", 160);
    const text = boundedText(item.text, "Contexto da IA", MAX_CONTEXT_ITEM_CHARS);
    const provenance = boundedText(item.provenance, "Origem do contexto", 512);
    total += text.length;
    if (total > MAX_CONTEXT_TOTAL_CHARS) throw new TypeError("O contexto total da IA excede o limite do contrato.");
    return Object.freeze({ id, scope: item.scope, text, provenance });
  });
}

export async function askSliceIntelligence(port, { prompt, context, signal }) {
  const state = intelligenceState(port);
  if (!state.available) throw new Error(state.reason);
  const request = {
    intent: "diagnose",
    prompt: boundedText(prompt, "Pergunta", 12000),
    context: validateContext(context),
    maxTokens: 768,
  };
  const response = await port.respond(request, { signal });
  if (!response || response.schema !== RESPONSE_SCHEMA || response.authority !== "none") {
    throw new Error("A resposta não corresponde ao contrato consultivo do OrdaX Intelligence.");
  }
  return Object.freeze({
    text: boundedText(response.text, "Resposta da IA", 16000),
    engineId: boundedText(response.engineId, "Provedor da IA", 80),
    modelId: boundedText(response.modelId, "Modelo de IA", 160),
  });
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!source || source === text && !text.includes("{")) return null;
  try { return JSON.parse(source); } catch { return null; }
}

function validateSuggestion(value) {
  if (!value || value.schema !== SUGGESTION_SCHEMA || typeof value.summary !== "string" || !value.summary.trim()) return null;
  const source = value.settings ?? {};
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const settings = {};
  const validators = {
    quality: item => ["standard", "fine", "draft"].includes(item),
    layerHeight: item => Number.isFinite(item) && item >= 0.08 && item <= 0.4,
    walls: item => Number.isInteger(item) && item >= 1 && item <= 8,
    infill: item => Number.isInteger(item) && item >= 0 && item <= 100,
    supports: item => typeof item === "boolean",
    fanSpeedPercent: item => Number.isInteger(item) && item >= 0 && item <= 100,
  };
  for (const [key, item] of Object.entries(source)) {
    if (!Object.hasOwn(validators, key)) return null;
    if (item === null) continue;
    if (!validators[key] || !validators[key](item)) return null;
    settings[key === "fanSpeedPercent" ? "fan" : key] = item;
  }
  const transformSource = value.transform ?? null;
  if (transformSource !== null && (!transformSource || typeof transformSource !== "object" || Array.isArray(transformSource))) return null;
  const transform = {};
  const transformValidators = {
    x: item => Number.isInteger(item) && item >= -500 && item <= 500,
    y: item => Number.isInteger(item) && item >= -500 && item <= 500,
    z: item => Number.isInteger(item) && item >= -500 && item <= 500,
    rotationX: item => Number.isInteger(item) && item >= 0 && item <= 359,
    rotationY: item => Number.isInteger(item) && item >= 0 && item <= 359,
    rotationZ: item => Number.isInteger(item) && item >= 0 && item <= 359,
    scalePercent: item => Number.isInteger(item) && item >= 10 && item <= 300,
  };
  for (const [key, item] of Object.entries(transformSource || {})) {
    if (!Object.hasOwn(transformValidators, key)) return null;
    if (item === null) continue;
    if (!transformValidators[key] || !transformValidators[key](item)) return null;
    transform[key] = item;
  }
  if (!Object.keys(settings).length && !Object.keys(transform).length) return null;
  return Object.freeze({
    summary: value.summary.trim().slice(0, 1200),
    settings: Object.freeze(settings),
    transform: Object.freeze(transform),
  });
}

export function parseAssistantSuggestion(text) {
  return validateSuggestion(extractJson(text));
}

export function parseAssistantReply(text) {
  const value = extractJson(text);
  if (!value || Object.keys(value).some(key => !["schema", "answer", "suggestion"].includes(key)) || value.schema !== ASSISTANT_RESPONSE_SCHEMA || typeof value.answer !== "string" || value.answer.length > 16000) {
    throw new Error("A IA retornou uma resposta fora do formato estruturado do Copiloto. Tente novamente.");
  }
  const answer = value.answer.trim();
  const suggestion = value.suggestion === null ? null : validateSuggestion(value.suggestion);
  if (value.suggestion !== null && !suggestion) {
    throw new Error("A sugestão da IA não passou pela validação do app. Nenhuma configuração foi aplicada.");
  }
  if (!answer && !suggestion) throw new Error("A IA retornou uma resposta vazia. Tente novamente.");
  return Object.freeze({ text: answer || suggestion.summary, suggestion });
}

export const assistantSuggestionSchema = SUGGESTION_SCHEMA;
