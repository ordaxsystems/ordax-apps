export const MAX_KITCHEN_DISPLAYS = 8;

export const KITCHEN_DISPLAY_STAGES = Object.freeze([
  Object.freeze({ id: "all", label: "Fluxo completo", description: "Todas as etapas do pedido" }),
  Object.freeze({ id: "received", label: "Pedidos recebidos", description: "Fila para iniciar" }),
  Object.freeze({ id: "preparing", label: "Em preparo", description: "Pedidos em produção" }),
  Object.freeze({ id: "ready", label: "Prontos para expedir", description: "Pedidos aguardando saída" }),
]);

export const DEFAULT_KITCHEN_DISPLAY_CONFIGURATION = Object.freeze({
  mode: "complete-cycle",
  screenCount: 1,
  assignments: Object.freeze(["all"]),
});

const STAGE_IDS = new Set(KITCHEN_DISPLAY_STAGES.map(({ id }) => id));
const MODES = new Set(["complete-cycle", "by-stage"]);
const CONFIG_KEYS = "assignments,mode,screenCount";

function freezeConfiguration(mode, screenCount, assignments) {
  return Object.freeze({
    mode,
    screenCount,
    assignments: Object.freeze([...assignments]),
  });
}

export function validateKitchenDisplayConfiguration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== CONFIG_KEYS
    || !MODES.has(value.mode)
    || !Number.isSafeInteger(value.screenCount)
    || value.screenCount < 1 || value.screenCount > MAX_KITCHEN_DISPLAYS
    || !Array.isArray(value.assignments)
    || value.assignments.length !== value.screenCount
    || value.assignments.some((stage) => !STAGE_IDS.has(stage))) {
    throw new TypeError("A configuração local das telas de produção está inválida.");
  }
  if (value.mode === "complete-cycle" && value.assignments.some((stage) => stage !== "all")) {
    throw new TypeError("No fluxo completo, cada tela precisa exibir todas as etapas.");
  }
  return freezeConfiguration(value.mode, value.screenCount, value.assignments);
}

export function resizeKitchenDisplayConfiguration(currentValue, screenCountValue, modeValue) {
  const current = validateKitchenDisplayConfiguration(currentValue ?? DEFAULT_KITCHEN_DISPLAY_CONFIGURATION);
  const screenCount = Number(screenCountValue);
  const mode = modeValue ?? current.mode;
  if (!Number.isSafeInteger(screenCount) || screenCount < 1 || screenCount > MAX_KITCHEN_DISPLAYS) {
    throw new TypeError("Escolha de 1 a 8 telas de produção.");
  }
  if (!MODES.has(mode)) throw new TypeError("Escolha um modo de produção disponível.");
  const assignments = Array.from({ length: screenCount }, (_, index) => {
    if (mode === "complete-cycle") return "all";
    return current.assignments[index] && current.assignments[index] !== "all"
      ? current.assignments[index]
      : ["received", "preparing", "ready"][index % 3];
  });
  return validateKitchenDisplayConfiguration({ mode, screenCount, assignments });
}

export function kitchenDisplayStage(configurationValue, screenNumber) {
  const configuration = validateKitchenDisplayConfiguration(configurationValue);
  if (!Number.isSafeInteger(screenNumber) || screenNumber < 1 || screenNumber > configuration.screenCount) {
    throw new RangeError("A tela escolhida não está configurada.");
  }
  return configuration.assignments[screenNumber - 1];
}

export function kitchenDisplayStageLabel(stageId) {
  return KITCHEN_DISPLAY_STAGES.find(({ id }) => id === stageId)?.label ?? null;
}
