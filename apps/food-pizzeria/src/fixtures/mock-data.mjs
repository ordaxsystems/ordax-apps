import {
  configureFoodPizzeria,
  createPizzeriaTableCommand,
  createEmptyFoodPizzeriaState,
  createPizzeriaOrder,
  savePizzeriaFlavor,
  savePizzeriaRecipe,
  transitionPizzeriaOrder,
} from "../domain/domain.mjs";
import { createFoodRecipeSeed } from "./food-recipes.mjs";

const flavors = [
  ["calabresa", "Calabresa", "Molho, muçarela, calabresa, cebola e orégano", 3990, 4990, 6490],
  ["portuguesa", "Portuguesa", "Molho, muçarela, presunto, ovos, cebola e azeitona", 4290, 5290, 6890],
  ["marguerita", "Marguerita", "Muçarela, tomate, manjericão fresco e azeite", 3990, 4690, 6290],
  ["frango-catupiry", "Frango com Catupiry", "Frango desfiado e Catupiry original", 4590, 5490, 7290],
  ["quatro-queijos", "Quatro Queijos", "Muçarela, provolone, parmesão e gorgonzola", 4890, 5990, 7890],
  ["pepperoni", "Pepperoni", "Muçarela, pepperoni e molho da casa", 4690, 5690, 7490],
];

export const PREVIEW_SEED_ORDER_AGES_MINUTES = Object.freeze([18, 15, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
export const PREVIEW_SEED_TABLE_OPENING_AGES_MINUTES = Object.freeze({
  "ng-command-01": 16,
  "ng-command-04": 20,
});

export function createSeedFoodState(nowValue = Date.now(), { includeFourFlavorSample = false } = {}) {
  const now = nowValue instanceof Date ? nowValue.getTime() : Number(nowValue);
  if (!Number.isFinite(now)) throw new TypeError("O horário da prévia Food precisa ser válido.");
  let state = configureFoodPizzeria(createEmptyFoodPizzeriaState(), {
    storeName: "Na Garagem",
    halfPricePolicy: "highest",
  });
  for (const [id, name, description, small, medium, large] of flavors) {
    state = savePizzeriaFlavor(state, {
      id: `ng-${id}`,
      name,
      description,
      pricesCents: { small, medium, large },
      at: new Date(now - 86400000).toISOString(),
    });
  }
  for (const recipe of createFoodRecipeSeed()) {
    state = savePizzeriaRecipe(state, { ...recipe, at: new Date(now - 2 * 86400000).toISOString() });
  }

  state = createPizzeriaTableCommand(state, {
    id: "ng-command-01",
    tableId: 1,
    customerName: "Fernanda Lima",
    guestCount: 2,
    openedAt: new Date(now - 30 * 60000).toISOString(),
  });
  state = createPizzeriaTableCommand(state, {
    id: "ng-command-04",
    tableId: 4,
    customerName: "Mesa 04",
    guestCount: 3,
    openedAt: new Date(now - 58 * 60000).toISOString(),
  });

  const people = [
    ["Ana Paula", "delivery", "(11) 98765-1042", "Rua das Flores, 123 — Vila Mariana"],
    ["João Marcos", "pickup", "(11) 97654-2018", null],
    ["Carla Souza", "delivery", "(11) 99812-7731", "Av. Central, 456 — Aclimação"],
    ["Mesa 04", "dine-in", "", null],
    ["Pedro Lima", "delivery", "(11) 96543-2180", "Rua do Sol, 789 — Cambuci"],
    ["Marcos Oliveira", "pickup", "(11) 99123-7780", null],
    ["Juliana Alves", "delivery", "(11) 98456-1029", "Rua Vergueiro, 622 — Liberdade"],
    ["Rafael Costa", "delivery", "(11) 97770-4491", "Rua da Mooca, 88 — Mooca"],
    ["Fernanda Lima", "dine-in", "", null],
    ["Lucas Ferreira", "delivery", "(11) 98811-3020", "Rua dos Pinheiros, 31 — Vila Mariana"],
    ["Camila Santos", "delivery", "(11) 98110-7622", "Rua Domingos de Morais, 1180 — Vila Mariana"],
    ["Bruno Almeida", "delivery", "(11) 97001-8834", "Rua do Oratório, 740 — Ipiranga"],
  ];
  const stages = ["received", "received", "received", "preparing", "preparing", "preparing", "preparing", "preparing", "ready", "ready", "out-for-delivery", "out-for-delivery"];
  const flavorIds = ["ng-calabresa", "ng-portuguesa", "ng-marguerita", "ng-portuguesa", "ng-frango-catupiry", "ng-calabresa", "ng-quatro-queijos", "ng-pepperoni", "ng-marguerita", "ng-frango-catupiry", "ng-calabresa", "ng-portuguesa"];
  for (let index = 0; index < people.length; index += 1) {
    const [customerName, channel, phone, address] = people[index];
    const number = 1047 + index;
    const createdAt = new Date(now - PREVIEW_SEED_ORDER_AGES_MINUTES[index] * 60000).toISOString();
    const fee = channel === "delivery" ? 500 : 0;
    const orderFlavorIds = index === 2 && includeFourFlavorSample
      ? ["ng-marguerita", "ng-calabresa", "ng-quatro-queijos", "ng-frango-catupiry"]
      : [flavorIds[index]];
    state = createPizzeriaOrder(state, {
      id: `ng-order-${number}`,
      historyId: `ng-history-${number}-received`,
      createdAt,
      customerName,
      phone,
      channel,
      tableCommandId: index === 3 ? "ng-command-04" : index === 8 ? "ng-command-01" : null,
      address,
      deliveryFeeCents: fee,
      notes: index === 0 ? "Borda de Catupiry" : index === 4 ? "Deixar na portaria" : "",
      items: [{ id: `ng-item-${number}`, size: index % 4 === 0 ? "large" : "medium", flavorIds: orderFlavorIds, quantity: index === 1 || index === 7 ? 2 : 1 }],
    });
    const desired = stages[index];
    const transitions = desired === "preparing" ? ["preparing"]
      : desired === "ready" ? ["preparing", "ready"]
        : desired === "out-for-delivery" ? ["preparing", "ready", "out-for-delivery"]
          : desired === "completed" ? ["preparing", "ready", channel === "delivery" ? "out-for-delivery" : "completed", ...(channel === "delivery" ? ["completed"] : [])]
            : [];
    const transitionIntervalMs = (PREVIEW_SEED_ORDER_AGES_MINUTES[index] * 60000) / (transitions.length + 1);
    for (const [transitionIndex, nextStatus] of transitions.entries()) {
      state = transitionPizzeriaOrder(state, {
        orderId: `ng-order-${number}`,
        nextStatus,
        historyId: `ng-history-${number}-${nextStatus}`,
        changedAt: new Date(Date.parse(createdAt) + Math.round(transitionIntervalMs * (transitionIndex + 1))).toISOString(),
      });
    }
  }
  return state;
}

export const PREVIEW_CATALOG_PRODUCTS = Object.freeze([
  { id: "b-cola", name: "Refrigerante 2L", category: "Bebidas", priceCents: 1200 },
  { id: "b-agua", name: "Água com gás", category: "Bebidas", priceCents: 500 },
  { id: "c-familia", name: "Combo Família", category: "Combos", priceCents: 6990 },
  { id: "e-bread", name: "Pão de alho", category: "Entradas", priceCents: 1890 },
  { id: "s-brownie", name: "Brownie da casa", category: "Sobremesas", priceCents: 1400 },
].map((product) => Object.freeze(product)));
