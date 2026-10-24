import {
  closePizzeriaTableCommand,
  configureFoodPizzeria,
  createPizzeriaOrder,
  createPizzeriaTableCommand,
  savePizzeriaFlavor,
  savePizzeriaRecipe,
  setPizzeriaFlavorAvailability,
  transitionPizzeriaOrder,
  updateFoodPizzeriaSettings,
} from "../domain/domain.mjs";

export const FOOD_COMMAND_SCHEMA = "ordax.food-pizzeria-command/1";
const COMMAND_TYPES = new Set([
  "food.setup.configure",
  "food.settings.update",
  "menu.flavor.save",
  "menu.flavor.availability",
  "menu.recipe.save",
  "order.create",
  "order.transition",
  "table.command.open",
  "table.command.close",
]);
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MAX_COMMAND_BYTES = 256 * 1024;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function createFoodCommand({ type, payload, expectedRevision, commandId, issuedAt } = {}) {
  if (!COMMAND_TYPES.has(type)) throw new TypeError("Operação da pizzaria desconhecida.");
  if (!isRecord(payload)) throw new TypeError("Os dados da operação estão inválidos.");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new TypeError("A revisão esperada da pizzaria está inválida.");
  }
  const stableCommandId = commandId ?? globalThis.crypto?.randomUUID?.();
  if (typeof stableCommandId !== "string" || !ID_RE.test(stableCommandId)) {
    throw new TypeError("A operação precisa de um identificador estável.");
  }
  const timestamp = issuedAt ?? new Date().toISOString();
  if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) {
    throw new TypeError("A data da operação está inválida.");
  }
  const command = {
    schema: FOOD_COMMAND_SCHEMA,
    commandId: stableCommandId,
    expectedRevision,
    issuedAt: timestamp,
    type,
    payload,
  };
  let serialized;
  try {
    serialized = JSON.stringify(command);
  } catch (error) {
    throw new TypeError("A operação precisa conter apenas dados serializáveis.", { cause: error });
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_COMMAND_BYTES) {
    throw new RangeError("A operação da pizzaria excede o limite permitido.");
  }
  return deepFreeze(JSON.parse(serialized));
}

export function applyFoodCommand(state, commandValue) {
  const command = createFoodCommand(commandValue);
  const payload = command.payload;
  switch (command.type) {
    case "food.setup.configure":
      return configureFoodPizzeria(state, payload);
    case "food.settings.update":
      return updateFoodPizzeriaSettings(state, payload);
    case "menu.flavor.save":
      return savePizzeriaFlavor(state, payload);
    case "menu.flavor.availability":
      return setPizzeriaFlavorAvailability(state, payload);
    case "menu.recipe.save":
      return savePizzeriaRecipe(state, payload);
    case "order.create":
      return createPizzeriaOrder(state, payload);
    case "order.transition":
      return transitionPizzeriaOrder(state, payload);
    case "table.command.open":
      return createPizzeriaTableCommand(state, payload);
    case "table.command.close":
      return closePizzeriaTableCommand(state, payload);
    default:
      throw new TypeError("Operação da pizzaria não suportada.");
  }
}
