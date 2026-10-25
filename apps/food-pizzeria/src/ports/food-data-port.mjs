import { validateFoodPizzeriaState } from "../domain/domain.mjs";

export const FOOD_DATA_PORT_SCHEMA = "ordax.food-pizzeria-data-port/1";

const REQUIRED_METHODS = Object.freeze(["initialize", "getSnapshot", "subscribe", "execute", "destroy"]);

export function assertFoodDataPort(value) {
  if (!value || typeof value !== "object" || value.schema !== FOOD_DATA_PORT_SCHEMA) {
    throw new TypeError(`A interface ${FOOD_DATA_PORT_SCHEMA} é obrigatória.`);
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`A interface de dados da pizzaria não implementa ${method}().`);
    }
  }
  if (!value.context || typeof value.context.businessId !== "string" || !value.context.businessId.trim()) {
    throw new TypeError("A interface de dados precisa identificar o negócio ativo.");
  }
  return value;
}

export function readFoodSnapshot(dataPort) {
  return validateFoodPizzeriaState(dataPort.getSnapshot());
}
