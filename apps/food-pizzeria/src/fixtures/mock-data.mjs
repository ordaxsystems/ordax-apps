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

const customers = [
  { id: "c-ana", name: "Ana Paula Martins", phone: "(11) 98765-1042", neighborhood: "Vila Mariana" },
  { id: "c-joao", name: "João Marcos Ribeiro", phone: "(11) 97654-2018", neighborhood: "Ipiranga" },
  { id: "c-carla", name: "Carla Souza", phone: "(11) 99812-7731", neighborhood: "Aclimação" },
  { id: "c-pedro", name: "Pedro Lima", phone: "(11) 96543-2180", neighborhood: "Cambuci" },
  { id: "c-marcos", name: "Marcos Oliveira", phone: "(11) 99123-7780", neighborhood: "Vila Monumento" },
  { id: "c-juliana", name: "Juliana Alves", phone: "(11) 98456-1029", neighborhood: "Liberdade" },
  { id: "c-rafael", name: "Rafael Costa", phone: "(11) 97770-4491", neighborhood: "Mooca" },
  { id: "c-fernanda", name: "Fernanda Lima", phone: "(11) 99333-1020", neighborhood: "Saúde" },
];

export function createSeedFoodState() {
  const now = Date.now();
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
    ["Mesa 04", "counter", "", null],
    ["Pedro Lima", "delivery", "(11) 96543-2180", "Rua do Sol, 789 — Cambuci"],
    ["Marcos Oliveira", "pickup", "(11) 99123-7780", null],
    ["Juliana Alves", "delivery", "(11) 98456-1029", "Rua Vergueiro, 622 — Liberdade"],
    ["Rafael Costa", "delivery", "(11) 97770-4491", "Rua da Mooca, 88 — Mooca"],
    ["Fernanda Lima", "counter", "", null],
    ["Lucas Ferreira", "delivery", "(11) 98811-3020", "Rua dos Pinheiros, 31 — Vila Mariana"],
    ["Camila Santos", "delivery", "(11) 98110-7622", "Rua Domingos de Morais, 1180 — Vila Mariana"],
    ["Bruno Almeida", "delivery", "(11) 97001-8834", "Rua do Oratório, 740 — Ipiranga"],
  ];
  const stages = ["received", "received", "received", "preparing", "preparing", "preparing", "preparing", "preparing", "ready", "ready", "out-for-delivery", "out-for-delivery"];
  const ageMinutes = [70, 18, 8, 52, 34, 24, 17, 12, 25, 15, 30, 20];
  const flavorIds = ["ng-calabresa", "ng-portuguesa", "ng-marguerita", "ng-portuguesa", "ng-frango-catupiry", "ng-calabresa", "ng-quatro-queijos", "ng-pepperoni", "ng-marguerita", "ng-frango-catupiry", "ng-calabresa", "ng-portuguesa"];
  for (let index = 0; index < people.length; index += 1) {
    const [customerName, channel, phone, address] = people[index];
    const number = 1047 + index;
    const createdAt = new Date(now - ageMinutes[index] * 60000).toISOString();
    const fee = channel === "delivery" ? 500 : 0;
    const flavorId = flavorIds[index];
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
      items: [{ id: `ng-item-${number}`, size: index % 4 === 0 ? "large" : "medium", flavorIds: [flavorId], quantity: index === 1 || index === 7 ? 2 : 1 }],
    });
    const desired = stages[index];
    const transitions = desired === "preparing" ? ["preparing"]
      : desired === "ready" ? ["preparing", "ready"]
        : desired === "out-for-delivery" ? ["preparing", "ready", "out-for-delivery"]
          : desired === "completed" ? ["preparing", "ready", channel === "delivery" ? "out-for-delivery" : "completed", ...(channel === "delivery" ? ["completed"] : [])]
            : [];
    let minute = 4;
    for (const nextStatus of transitions) {
      state = transitionPizzeriaOrder(state, {
        orderId: `ng-order-${number}`,
        nextStatus,
        historyId: `ng-history-${number}-${nextStatus}`,
        changedAt: new Date(Date.parse(createdAt) + minute * 60000).toISOString(),
      });
      minute += 5;
    }
  }
  return state;
}

export function createMockWorkspace() {
  const openedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  return {
    customers: customers.map((customer) => ({ ...customer })),
    products: [
      { id: "b-cola", name: "Refrigerante 2L", category: "Bebidas", price: 1200 },
      { id: "b-agua", name: "Água com gás", category: "Bebidas", price: 500 },
      { id: "c-familia", name: "Combo Família", category: "Combos", price: 6990 },
      { id: "e-bread", name: "Pão de alho", category: "Entradas", price: 1890 },
      { id: "s-brownie", name: "Brownie da casa", category: "Sobremesas", price: 1400 },
    ],
    team: [
      { id: "t-carlos", name: "Carlos Silva", role: "Administrador", shift: "Gestão", status: "Online", initials: "CS" },
      { id: "t-fernanda", name: "Fernanda Lima", role: "Atendente", shift: "16h–23h", status: "Online", initials: "FL" },
      { id: "t-rafael", name: "Rafael Costa", role: "Pizzaiolo", shift: "17h–00h", status: "Em serviço", initials: "RC" },
      { id: "t-juliana", name: "Juliana Alves", role: "Caixa", shift: "17h–00h", status: "Online", initials: "JA" },
    ],
    sales: [],
    cashRegister: {
      sessionId: "shift-na-garagem-initial",
      status: "open",
      openedAt,
      openingCashCents: 20000,
      closedAt: null,
      closure: null,
      history: [],
    },
    cart: [],
    productCategory: "Pizzas",
    customerQuery: "",
    selectedCustomer: "c-ana",
    reportRange: "Hoje",
    paymentMethod: "PIX",
    showProductForm: false,
    showCustomerForm: false,
    showTeamForm: false,
    showStockMovementForm: false,
    showNewIngredientForm: false,
    recipeDraftLines: [],
    showHoursForm: false,
    inventoryCategory: "Todas as categorias",
    openingTime: "18:00",
    closingTime: "23:30",
    deliveryFee: 500,
  };
}
