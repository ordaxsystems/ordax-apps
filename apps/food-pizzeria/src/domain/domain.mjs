import { createFoodRecipeSeed } from "../fixtures/food-recipes.mjs";

export const FOOD_PIZZERIA_STATE_SCHEMA = "ordax.food-pizzeria-state/4";
const FOOD_PIZZERIA_STATE_SCHEMA_V3 = "ordax.food-pizzeria-state/3";
const FOOD_PIZZERIA_STATE_SCHEMA_V2 = "ordax.food-pizzeria-state/2";
const FOOD_PIZZERIA_STATE_SCHEMA_V1 = "ordax.food-pizzeria-state/1";
export const PIZZERIA_TABLES = Object.freeze([
  Object.freeze({ id: 1, seats: 2 }),
  Object.freeze({ id: 2, seats: 4 }),
  Object.freeze({ id: 3, seats: 4 }),
  Object.freeze({ id: 4, seats: 4 }),
  Object.freeze({ id: 5, seats: 2 }),
  Object.freeze({ id: 6, seats: 6 }),
  Object.freeze({ id: 7, seats: 4 }),
  Object.freeze({ id: 8, seats: 2 }),
]);
export const PIZZA_SIZES = Object.freeze([
  Object.freeze({ id: "small", label: "Pequena", slices: 4 }),
  Object.freeze({ id: "medium", label: "Média", slices: 6 }),
  Object.freeze({ id: "large", label: "Grande", slices: 8 }),
]);
export const ORDER_CHANNELS = Object.freeze(["delivery", "pickup", "counter"]);
export const ORDER_STATUSES = Object.freeze([
  "received", "preparing", "ready", "out-for-delivery", "completed", "cancelled",
]);

const MAX_FLAVORS = 1000;
const MAX_ORDERS = 5000;
const MAX_TABLE_COMMANDS = 5000;
const MAX_RECIPES = MAX_FLAVORS;
const MAX_RECIPE_LINES = 1000;
const MAX_ITEMS_PER_ORDER = 50;
const MAX_HISTORY_PER_ORDER = 16;
const MAX_CENTS = 1_000_000_000;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SIZE_IDS = new Set(PIZZA_SIZES.map(({ id }) => id));
const CHANNELS = new Set(ORDER_CHANNELS);
const TABLE_IDS = new Set(PIZZERIA_TABLES.map(({ id }) => id));
const STATUSES = new Set(ORDER_STATUSES);
const POLICIES = new Set(["highest", "average"]);
const STATUS_TRANSITIONS = Object.freeze({
  received: new Set(["preparing", "cancelled"]),
  preparing: new Set(["ready", "cancelled"]),
  ready: new Set(["out-for-delivery", "completed", "cancelled"]),
  "out-for-delivery": new Set(["completed"]),
  completed: new Set(),
  cancelled: new Set(),
});

function exactObject(value, keys, label) {
  if (
    !value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
  ) {
    throw new TypeError(`${label} tem campos incompatíveis.`);
  }
  return value;
}

function boundedText(value, label, max, { optional = false } = {}) {
  if (optional && value === "") return "";
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} inválido.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new TypeError(`${label} inválido.`);
  return normalized;
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID_RE.test(value)) throw new TypeError(`${label} inválido.`);
  return value;
}

function cents(value, label, { allowZero = false } = {}) {
  if (
    !Number.isSafeInteger(value)
    || value < (allowZero ? 0 : 1)
    || value > MAX_CENTS
  ) {
    throw new TypeError(`${label} deve ser um valor válido em centavos.`);
  }
  return value;
}

function utc(value, label) {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
  ) {
    throw new TypeError(`${label} deve ser uma data UTC válida.`);
  }
  const time = Date.parse(value);
  if (
    !Number.isFinite(time)
    || ![new Date(time).toISOString(), new Date(time).toISOString().replace(".000Z", "Z")].includes(value)
  ) {
    throw new TypeError(`${label} deve ser uma data UTC válida.`);
  }
  return value;
}

function validateSettings(value) {
  if (value === null) return null;
  const settings = exactObject(value, ["storeName", "halfPricePolicy"], "Ajustes da pizzaria");
  const storeName = boundedText(settings.storeName, "Nome da pizzaria", 80);
  if (!POLICIES.has(settings.halfPricePolicy)) throw new TypeError("Regra de preço meio a meio inválida.");
  return Object.freeze({ storeName, halfPricePolicy: settings.halfPricePolicy });
}

function validatePrices(value) {
  const prices = exactObject(value, [...SIZE_IDS], "Preços do sabor");
  return Object.freeze(Object.fromEntries(
    PIZZA_SIZES.map(({ id }) => [id, cents(prices[id], `Preço da pizza ${id}`)]),
  ));
}

function validateFlavor(value) {
  const raw = exactObject(value,
    ["id", "name", "description", "pricesCents", "active", "createdAt", "updatedAt"],
    "Sabor do cardápio");
  if (typeof raw.active !== "boolean") throw new TypeError("Disponibilidade do sabor inválida.");
  const createdAt = utc(raw.createdAt, "Criação do sabor");
  const updatedAt = utc(raw.updatedAt, "Atualização do sabor");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new TypeError("Atualização do sabor antecede sua criação.");
  return Object.freeze({
    id: identifier(raw.id, "Identificador do sabor"),
    name: boundedText(raw.name, "Nome do sabor", 60),
    description: raw.description === "" ? "" : boundedText(raw.description, "Descrição do sabor", 240),
    pricesCents: validatePrices(raw.pricesCents),
    active: raw.active,
    createdAt,
    updatedAt,
  });
}

function validateHistoryEntry(value) {
  const raw = exactObject(value, ["id", "status", "changedAt", "reason"], "Histórico do pedido");
  if (!STATUSES.has(raw.status)) throw new TypeError("Estado do histórico inválido.");
  const reason = raw.reason === null ? null : boundedText(raw.reason, "Motivo do histórico", 240);
  if ((raw.status === "cancelled") !== (reason !== null)) {
    throw new TypeError("Cancelamento exige motivo; outros estados não aceitam motivo.");
  }
  return Object.freeze({
    id: identifier(raw.id, "Identificador do histórico"),
    status: raw.status,
    changedAt: utc(raw.changedAt, "Data do histórico"),
    reason,
  });
}

function validateOrderItem(value, pricingPolicy) {
  const raw = exactObject(value,
    ["id", "size", "flavors", "quantity", "unitPriceCents", "lineTotalCents"],
    "Item do pedido");
  if (!SIZE_IDS.has(raw.size)) throw new TypeError("Tamanho da pizza inválido.");
  if (!Array.isArray(raw.flavors) || raw.flavors.length < 1 || raw.flavors.length > 2) {
    throw new TypeError("Cada pizza deve ter um ou dois sabores.");
  }
  const flavors = raw.flavors.map((value) => {
    const flavor = exactObject(value, ["id", "name", "priceCents"], "Sabor congelado no pedido");
    return Object.freeze({
      id: identifier(flavor.id, "Identificador do sabor"),
      name: boundedText(flavor.name, "Nome do sabor no pedido", 60),
      priceCents: cents(flavor.priceCents, "Preço do sabor"),
    });
  });
  if (new Set(flavors.map(({ id }) => id)).size !== flavors.length) {
    throw new TypeError("Os sabores de uma pizza devem ser diferentes.");
  }
  if (!Number.isSafeInteger(raw.quantity) || raw.quantity < 1 || raw.quantity > 50) {
    throw new TypeError("Quantidade de pizzas inválida.");
  }
  const unitPriceCents = cents(raw.unitPriceCents, "Preço unitário");
  const lineTotalCents = cents(raw.lineTotalCents, "Total do item");
  const flavorPrices = flavors.map(({ priceCents }) => priceCents);
  const expectedPrice = flavorPrices.length === 1
    ? flavorPrices[0]
    : pricingPolicy === "highest"
      ? Math.max(...flavorPrices)
      : Math.ceil((flavorPrices[0] + flavorPrices[1]) / 2);
  if (unitPriceCents !== expectedPrice) throw new TypeError("O preço do item diverge da regra registrada no pedido.");
  if (BigInt(unitPriceCents) * BigInt(raw.quantity) !== BigInt(lineTotalCents)) {
    throw new TypeError("O total do item não corresponde ao preço e à quantidade.");
  }
  return Object.freeze({
    id: identifier(raw.id, "Identificador do item"),
    size: raw.size,
    flavors: Object.freeze(flavors),
    quantity: raw.quantity,
    unitPriceCents,
    lineTotalCents,
  });
}

function expectedTransition(order, status) {
  if (!STATUS_TRANSITIONS[order.status]?.has(status)) return false;
  if (status === "out-for-delivery" && order.channel !== "delivery") return false;
  if (status === "completed" && order.channel === "delivery" && order.status === "ready") return false;
  return true;
}

function validateTableCommand(value) {
  const raw = exactObject(value,
    ["id", "tableId", "customerName", "guestCount", "openedAt", "closedAt"],
    "Comanda da mesa");
  const table = PIZZERIA_TABLES.find(({ id }) => id === raw.tableId);
  if (!table) throw new TypeError("Mesa da comanda inválida.");
  if (!Number.isSafeInteger(raw.guestCount) || raw.guestCount < 1 || raw.guestCount > table.seats) {
    throw new TypeError("Quantidade de pessoas incompatível com a mesa.");
  }
  const openedAt = utc(raw.openedAt, "Abertura da comanda");
  const closedAt = raw.closedAt === null ? null : utc(raw.closedAt, "Fechamento da comanda");
  if (closedAt !== null && Date.parse(closedAt) < Date.parse(openedAt)) {
    throw new TypeError("Fechamento da comanda antecede sua abertura.");
  }
  return Object.freeze({
    id: identifier(raw.id, "Identificador da comanda"),
    tableId: raw.tableId,
    customerName: boundedText(raw.customerName, "Nome do grupo na comanda", 80),
    guestCount: raw.guestCount,
    openedAt,
    closedAt,
  });
}

function validateOrder(value) {
  const raw = exactObject(value, [
    "id", "createdAt", "updatedAt", "customerName", "phone", "channel", "tableCommandId", "address",
    "deliveryFeeCents", "notes", "pricingPolicy", "items", "subtotalCents", "totalCents",
    "status", "statusHistory",
  ], "Pedido");
  if (!CHANNELS.has(raw.channel)) throw new TypeError("Canal do pedido inválido.");
  if (raw.tableCommandId !== null) identifier(raw.tableCommandId, "Identificador da comanda no pedido");
  if (raw.tableCommandId !== null && raw.channel !== "counter") {
    throw new TypeError("Pedido de mesa deve usar o canal de balcão.");
  }
  if (!POLICIES.has(raw.pricingPolicy)) throw new TypeError("Regra de preço do pedido inválida.");
  if (!STATUSES.has(raw.status)) throw new TypeError("Estado do pedido inválido.");
  const address = raw.address === null ? null : boundedText(raw.address, "Endereço de entrega", 240);
  if (raw.channel === "delivery" && address === null) throw new TypeError("Pedido de entrega exige endereço.");
  if (raw.channel !== "delivery" && address !== null) throw new TypeError("Endereço só pode existir em pedido de entrega.");
  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > MAX_ITEMS_PER_ORDER) {
    throw new TypeError("Pedido deve ter de 1 a 50 itens.");
  }
  const items = raw.items.map((item) => validateOrderItem(item, raw.pricingPolicy));
  if (new Set(items.map(({ id }) => id)).size !== items.length) throw new TypeError("Itens do pedido duplicados.");
  const subtotal = items.reduce((sum, item) => sum + BigInt(item.lineTotalCents), 0n);
  if (subtotal > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Subtotal ultrapassa o limite seguro.");
  const subtotalCents = cents(raw.subtotalCents, "Subtotal");
  const deliveryFeeCents = cents(raw.deliveryFeeCents, "Taxa de entrega", { allowZero: true });
  const totalCents = cents(raw.totalCents, "Total do pedido");
  if (Number(subtotal) !== subtotalCents || subtotalCents + deliveryFeeCents !== totalCents) {
    throw new TypeError("O total do pedido não corresponde aos itens e à taxa.");
  }
  if (raw.channel !== "delivery" && deliveryFeeCents !== 0) {
    throw new TypeError("Taxa de entrega só pode existir em pedidos de entrega.");
  }
  if (!Array.isArray(raw.statusHistory) || raw.statusHistory.length < 1 || raw.statusHistory.length > MAX_HISTORY_PER_ORDER) {
    throw new TypeError("Histórico do pedido inválido.");
  }
  const statusHistory = raw.statusHistory.map(validateHistoryEntry);
  if (new Set(statusHistory.map(({ id }) => id)).size !== statusHistory.length) {
    throw new TypeError("Histórico do pedido contém identificadores duplicados.");
  }
  if (statusHistory[0].status !== "received" || statusHistory[0].reason !== null) {
    throw new TypeError("O histórico do pedido precisa começar como recebido.");
  }
  for (let index = 1; index < statusHistory.length; index += 1) {
    const previous = { ...raw, status: statusHistory[index - 1].status };
    const current = statusHistory[index];
    if (!expectedTransition(previous, current.status)) throw new TypeError("Histórico de estados do pedido inválido.");
    if (Date.parse(current.changedAt) < Date.parse(statusHistory[index - 1].changedAt)) {
      throw new TypeError("Histórico do pedido está fora de ordem.");
    }
  }
  if (statusHistory.at(-1).status !== raw.status) throw new TypeError("Estado atual diverge do histórico.");
  if (statusHistory[0].changedAt !== raw.createdAt || statusHistory.at(-1).changedAt !== raw.updatedAt) {
    throw new TypeError("Datas do pedido divergem do histórico.");
  }

  return Object.freeze({
    id: identifier(raw.id, "Identificador do pedido"),
    createdAt: utc(raw.createdAt, "Criação do pedido"),
    updatedAt: utc(raw.updatedAt, "Atualização do pedido"),
    customerName: boundedText(raw.customerName, "Nome do cliente", 80),
    phone: raw.phone === "" ? "" : boundedText(raw.phone, "Telefone", 32),
    channel: raw.channel,
    tableCommandId: raw.tableCommandId,
    address,
    deliveryFeeCents,
    notes: raw.notes === "" ? "" : boundedText(raw.notes, "Observações", 240),
    pricingPolicy: raw.pricingPolicy,
    items: Object.freeze(items),
    subtotalCents,
    totalCents,
    status: raw.status,
    statusHistory: Object.freeze(statusHistory),
  });
}

function validateRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Revisão local inválida.");
  return value;
}

function validateFoodPizzeriaStateV2(value) {
  const raw = exactObject(value, ["schema", "revision", "settings", "flavors", "orders", "tableCommands"], "Dados da pizzaria");
  if (raw.schema !== FOOD_PIZZERIA_STATE_SCHEMA_V2) throw new TypeError("Versão dos dados da pizzaria incompatível.");
  if (!Array.isArray(raw.flavors) || raw.flavors.length > MAX_FLAVORS) throw new TypeError("Cardápio ultrapassa o limite permitido.");
  if (!Array.isArray(raw.orders) || raw.orders.length > MAX_ORDERS) throw new TypeError("Histórico ultrapassa o limite permitido.");
  if (!Array.isArray(raw.tableCommands) || raw.tableCommands.length > MAX_TABLE_COMMANDS) throw new TypeError("Histórico de comandas ultrapassa o limite permitido.");
  const flavors = raw.flavors.map(validateFlavor);
  const orders = raw.orders.map(validateOrder);
  const tableCommands = raw.tableCommands.map(validateTableCommand);
  if (new Set(flavors.map(({ id }) => id)).size !== flavors.length) throw new TypeError("Cardápio contém identificadores duplicados.");
  if (new Set(flavors.map(({ name }) => name.normalize("NFKC").toLocaleLowerCase("pt-BR"))).size !== flavors.length) {
    throw new TypeError("Cardápio contém sabores com o mesmo nome.");
  }
  if (new Set(orders.map(({ id }) => id)).size !== orders.length) throw new TypeError("Pedidos contêm identificadores duplicados.");
  const itemIds = orders.flatMap((order) => order.items.map(({ id }) => id));
  if (new Set(itemIds).size !== itemIds.length) throw new TypeError("Pedidos contêm identificadores de itens duplicados.");
  if (new Set(tableCommands.map(({ id }) => id)).size !== tableCommands.length) throw new TypeError("Comandas contêm identificadores duplicados.");
  const openTableIds = tableCommands.filter(({ closedAt }) => closedAt === null).map(({ tableId }) => tableId);
  if (new Set(openTableIds).size !== openTableIds.length) throw new TypeError("Uma mesa não pode ter duas comandas abertas.");
  const commandsById = new Map(tableCommands.map((command) => [command.id, command]));
  for (const order of orders) {
    if (order.tableCommandId === null) continue;
    const command = commandsById.get(order.tableCommandId);
    if (!command || order.channel !== "counter" || order.customerName !== command.customerName) {
      throw new TypeError("Pedido referencia uma comanda incompatível.");
    }
    if (command.closedAt !== null && !["completed", "cancelled"].includes(order.status)) {
      throw new TypeError("Comanda encerrada ainda contém pedido em andamento.");
    }
  }
  return Object.freeze({
    schema: FOOD_PIZZERIA_STATE_SCHEMA_V2,
    revision: validateRevision(raw.revision),
    settings: validateSettings(raw.settings),
    flavors: Object.freeze(flavors),
    orders: Object.freeze(orders),
    tableCommands: Object.freeze(tableCommands),
  });
}

function validateRecipe(value) {
  const raw = exactObject(value, ["flavorId", "lines", "updatedAt"], "Ficha técnica");
  if (!Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > MAX_RECIPE_LINES) {
    throw new TypeError("A ficha técnica precisa de ao menos um insumo.");
  }
  const lines = raw.lines.map((line) => {
    const item = exactObject(line, ["ingredientId", "quantityBaseBySize"], "Insumo da ficha técnica");
    const quantities = exactObject(item.quantityBaseBySize, [...SIZE_IDS], "Quantidade por tamanho");
    const quantityBaseBySize = Object.fromEntries(PIZZA_SIZES.map(({ id }) => {
      const quantity = quantities[id];
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
        throw new TypeError("Use quantidades inteiras e positivas por tamanho.");
      }
      return [id, quantity];
    }));
    return Object.freeze({
      ingredientId: identifier(item.ingredientId, "Identificador do insumo da receita"),
      quantityBaseBySize: Object.freeze(quantityBaseBySize),
    });
  });
  if (new Set(lines.map(({ ingredientId }) => ingredientId)).size !== lines.length) {
    throw new TypeError("A ficha técnica não pode repetir o mesmo insumo.");
  }
  return Object.freeze({
    flavorId: identifier(raw.flavorId, "Identificador do sabor da receita"),
    lines: Object.freeze(lines),
    updatedAt: utc(raw.updatedAt, "Atualização da ficha técnica"),
  });
}

export function createEmptyFoodPizzeriaState() {
  return Object.freeze({
    schema: FOOD_PIZZERIA_STATE_SCHEMA,
    revision: 0,
    settings: null,
    flavors: Object.freeze([]),
    orders: Object.freeze([]),
    tableCommands: Object.freeze([]),
    recipes: Object.freeze([]),
  });
}

function migrateV1ToV2(value) {
  const legacy = exactObject(value, ["schema", "revision", "settings", "flavors", "orders"], "Dados antigos da pizzaria");
  if (!Array.isArray(legacy.orders)) throw new TypeError("Histórico antigo de pedidos inválido.");
  const legacyTableFixtures = new Map([
    ["ng-order-1050", { commandId: "ng-command-04", tableId: 4, customerName: "Mesa 04", guestCount: 3 }],
    ["ng-order-1055", { commandId: "ng-command-01", tableId: 1, customerName: "Fernanda Lima", guestCount: 2 }],
  ]);
  const tableCommands = [];
  const orders = legacy.orders.map((order) => {
    const fixture = legacyTableFixtures.get(order?.id);
    if (!fixture || order.channel !== "counter" || order.customerName !== fixture.customerName) {
      return { ...order, tableCommandId: null };
    }
    const openedAt = new Date(Date.parse(order.createdAt) - 60000).toISOString();
    const closedAt = ["completed", "cancelled"].includes(order.status) ? order.updatedAt : null;
    const { commandId, ...commandFields } = fixture;
    tableCommands.push({ ...commandFields, id: commandId, openedAt, closedAt });
    return { ...order, tableCommandId: fixture.commandId };
  });
  return validateFoodPizzeriaStateV2({ ...legacy, schema: FOOD_PIZZERIA_STATE_SCHEMA_V2, orders, tableCommands });
}

function migrateV2ToV4(value) {
  const legacy = validateFoodPizzeriaStateV2(value);
  const timestamp = "1970-01-01T00:00:00.000Z";
  return validateFoodPizzeriaState({
    ...legacy,
    schema: FOOD_PIZZERIA_STATE_SCHEMA,
    recipes: createFoodRecipeSeed().map((recipe) => ({ ...recipe, updatedAt: timestamp })),
  });
}

function migrateV3ToV4(value) {
  const raw = exactObject(value,
    ["schema", "revision", "settings", "flavors", "orders", "tableCommands", "ingredients", "recipes", "inventoryMovements"],
    "Dados antigos da pizzaria");
  if (raw.schema !== FOOD_PIZZERIA_STATE_SCHEMA_V3 || !Array.isArray(raw.recipes)) {
    throw new TypeError("Versão antiga dos dados da pizzaria inválida.");
  }
  const legacy = validateFoodPizzeriaStateV2({
    schema: FOOD_PIZZERIA_STATE_SCHEMA_V2,
    revision: raw.revision,
    settings: raw.settings,
    flavors: raw.flavors,
    orders: raw.orders,
    tableCommands: raw.tableCommands,
  });
  return validateFoodPizzeriaState({
    ...legacy,
    schema: FOOD_PIZZERIA_STATE_SCHEMA,
    recipes: raw.recipes,
  });
}

export function migrateFoodPizzeriaState(value) {
  if (value?.schema === FOOD_PIZZERIA_STATE_SCHEMA) return validateFoodPizzeriaState(value);
  if (value?.schema === FOOD_PIZZERIA_STATE_SCHEMA_V3) return migrateV3ToV4(value);
  if (value?.schema === FOOD_PIZZERIA_STATE_SCHEMA_V2) return migrateV2ToV4(value);
  if (value?.schema === FOOD_PIZZERIA_STATE_SCHEMA_V1) return migrateV2ToV4(migrateV1ToV2(value));
  return validateFoodPizzeriaState(value);
}

export function validateFoodPizzeriaState(value) {
  const raw = exactObject(value,
    ["schema", "revision", "settings", "flavors", "orders", "tableCommands", "recipes"],
    "Dados da pizzaria");
  if (raw.schema !== FOOD_PIZZERIA_STATE_SCHEMA) throw new TypeError("Versão dos dados da pizzaria incompatível.");
  const legacy = validateFoodPizzeriaStateV2({
    schema: FOOD_PIZZERIA_STATE_SCHEMA_V2,
    revision: raw.revision,
    settings: raw.settings,
    flavors: raw.flavors,
    orders: raw.orders,
    tableCommands: raw.tableCommands,
  });
  if (!Array.isArray(raw.recipes) || raw.recipes.length > MAX_RECIPES) throw new TypeError("Quantidade de fichas técnicas inválida.");
  const recipes = raw.recipes.map(validateRecipe);
  if (new Set(recipes.map(({ flavorId }) => flavorId)).size !== recipes.length) throw new TypeError("Há mais de uma ficha técnica para o mesmo sabor.");
  const flavorIds = new Set(legacy.flavors.map(({ id }) => id));
  for (const recipe of recipes) {
    if (!flavorIds.has(recipe.flavorId)) throw new TypeError("Ficha técnica referencia um sabor inexistente.");
  }
  return Object.freeze({
    schema: FOOD_PIZZERIA_STATE_SCHEMA,
    revision: legacy.revision,
    settings: legacy.settings,
    flavors: legacy.flavors,
    orders: legacy.orders,
    tableCommands: legacy.tableCommands,
    recipes: Object.freeze(recipes),
  });
}

export function savePizzeriaRecipe(stateValue, { flavorId, lines, at } = {}) {
  const state = validateFoodPizzeriaState(stateValue);
  if (!state.flavors.some(({ id }) => id === flavorId)) throw new Error("Esse sabor não está no cardápio.");
  const recipe = validateRecipe({ flavorId, lines, updatedAt: at });
  const recipes = state.recipes.some((item) => item.flavorId === flavorId)
    ? state.recipes.map((item) => item.flavorId === flavorId ? recipe : item)
    : [...state.recipes, recipe];
  return nextState(state, { recipes });
}

function nextState(current, patch) {
  if (current.revision >= Number.MAX_SAFE_INTEGER) throw new RangeError("Revisão local esgotada.");
  return validateFoodPizzeriaState({ ...current, ...patch, revision: current.revision + 1 });
}

export function configureFoodPizzeria(stateValue, { storeName, halfPricePolicy = "highest" } = {}) {
  const state = validateFoodPizzeriaState(stateValue);
  if (state.settings !== null) throw new Error("A pizzaria já foi configurada.");
  const settings = validateSettings({ storeName, halfPricePolicy });
  return nextState(state, { settings });
}

export function updateFoodPizzeriaSettings(stateValue, { storeName, halfPricePolicy } = {}) {
  const state = validateFoodPizzeriaState(stateValue);
  if (state.settings === null) throw new Error("Configure a pizzaria antes de alterar os ajustes.");
  return nextState(state, { settings: validateSettings({ storeName, halfPricePolicy }) });
}

export function savePizzeriaFlavor(stateValue, { id = null, name, description = "", pricesCents, at } = {}) {
  const state = validateFoodPizzeriaState(stateValue);
  if (state.settings === null) throw new Error("Configure a pizzaria antes de cadastrar sabores.");
  const cleanName = boundedText(name, "Nome do sabor", 60);
  const duplicate = state.flavors.find((flavor) =>
    flavor.id !== id && flavor.name.normalize("NFKC").toLocaleLowerCase("pt-BR")
      === cleanName.normalize("NFKC").toLocaleLowerCase("pt-BR"));
  if (duplicate) throw new Error("Já existe um sabor com esse nome.");
  const existing = id === null ? null : state.flavors.find((flavor) => flavor.id === id);
  if (!existing && state.flavors.length >= MAX_FLAVORS) throw new RangeError("Limite de sabores atingido.");
  const timestamp = utc(at, "Data de alteração do sabor");
  const flavor = validateFlavor({
    id: existing?.id ?? identifier(id, "Identificador do sabor"),
    name: cleanName,
    description: description.trim(),
    pricesCents,
    active: existing?.active ?? true,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  });
  const flavors = existing
    ? state.flavors.map((item) => item.id === flavor.id ? flavor : item)
    : [...state.flavors, flavor];
  return nextState(state, { flavors });
}

export function setPizzeriaFlavorAvailability(stateValue, { flavorId, active, at } = {}) {
  const state = validateFoodPizzeriaState(stateValue);
  if (typeof active !== "boolean") throw new TypeError("Disponibilidade do sabor inválida.");
  const flavor = state.flavors.find((item) => item.id === flavorId);
  if (!flavor) throw new Error("Esse sabor não está mais no cardápio.");
  if (flavor.active === active) return state;
  const updatedAt = utc(at, "Atualização do sabor");
  return nextState(state, {
    flavors: state.flavors.map((item) => item.id === flavor.id
      ? { ...item, active, updatedAt }
      : item),
  });
}

export function calculatePizzaPriceCents({ size, flavorIds, flavors, halfPricePolicy } = {}) {
  if (!SIZE_IDS.has(size)) throw new TypeError("Tamanho de pizza inválido.");
  if (!Array.isArray(flavorIds) || flavorIds.length < 1 || flavorIds.length > 2) {
    throw new TypeError("Escolha um sabor ou monte uma pizza meio a meio.");
  }
  if (new Set(flavorIds).size !== flavorIds.length) throw new TypeError("Escolha dois sabores diferentes.");
  if (!POLICIES.has(halfPricePolicy)) throw new TypeError("Regra de preço meio a meio inválida.");
  const selected = flavorIds.map((id) => {
    const flavor = flavors.find((item) => item.id === id && item.active);
    if (!flavor) throw new Error("Um dos sabores escolhidos não está disponível.");
    return validateFlavor(flavor);
  });
  const prices = selected.map(({ pricesCents }) => cents(pricesCents[size], "Preço do sabor"));
  if (prices.length === 1) return prices[0];
  return halfPricePolicy === "highest"
    ? Math.max(...prices)
    : Math.ceil((prices[0] + prices[1]) / 2);
}

export function createPizzeriaTableCommand(stateValue, {
  id, tableId, customerName, guestCount, openedAt,
} = {}) {
  const state = validateFoodPizzeriaState(stateValue);
  if (state.settings === null) throw new Error("Configure a pizzaria antes de abrir uma comanda.");
  if (!TABLE_IDS.has(tableId)) throw new TypeError("Escolha uma mesa válida.");
  if (state.tableCommands.some((command) => command.tableId === tableId && command.closedAt === null)) {
    throw new Error(`A mesa ${String(tableId).padStart(2, "0")} já possui uma comanda aberta.`);
  }
  const command = validateTableCommand({
    id,
    tableId,
    customerName,
    guestCount,
    openedAt,
    closedAt: null,
  });
  return nextState(state, { tableCommands: [command, ...state.tableCommands] });
}

export function closePizzeriaTableCommand(stateValue, { commandId, closedAt } = {}) {
  const state = validateFoodPizzeriaState(stateValue);
  const command = state.tableCommands.find(({ id }) => id === commandId);
  if (!command || command.closedAt !== null) throw new Error("Essa comanda não está aberta.");
  const unfinishedOrders = state.orders.filter((order) => order.tableCommandId === command.id
    && !["completed", "cancelled"].includes(order.status));
  if (unfinishedOrders.length) throw new Error("Conclua ou cancele os pedidos da mesa antes de encerrar a comanda.");
  const timestamp = utc(closedAt, "Fechamento da comanda");
  if (Date.parse(timestamp) < Date.parse(command.openedAt)) throw new TypeError("O fechamento não pode anteceder a abertura da comanda.");
  const updated = validateTableCommand({ ...command, closedAt: timestamp });
  return nextState(state, {
    tableCommands: state.tableCommands.map((item) => item.id === updated.id ? updated : item),
  });
}

function calculateOrderConsumption(state, order, { requireRecipe = true } = {}) {
  const recipesByFlavor = new Map(state.recipes.map((recipe) => [recipe.flavorId, recipe]));
  const ingredientNumerators = new Map();
  for (const item of order.items) {
    for (const flavor of item.flavors) {
      const recipe = recipesByFlavor.get(flavor.id);
      if (!recipe) {
        if (requireRecipe) throw new Error(`Cadastre a ficha técnica de ${flavor.name} antes de iniciar o preparo.`);
        return [];
      }
      const portionNumerator = item.flavors.length === 1 ? 2 : 1;
      for (const line of recipe.lines) {
        const amount = line.quantityBaseBySize[item.size] * item.quantity * portionNumerator;
        ingredientNumerators.set(line.ingredientId, (ingredientNumerators.get(line.ingredientId) ?? 0) + amount);
      }
    }
  }
  return [...ingredientNumerators.entries()]
    .map(([ingredientId, numerator]) => ({ ingredientId, quantityBase: Math.ceil(numerator / 2) }))
    .filter(({ quantityBase }) => quantityBase > 0)
    .sort((left, right) => left.ingredientId.localeCompare(right.ingredientId));
}

export function calculatePizzeriaOrderConsumption(stateValue, orderId) {
  const state = validateFoodPizzeriaState(stateValue);
  const order = state.orders.find(({ id }) => id === orderId);
  if (!order) throw new Error("Esse pedido não existe mais.");
  return Object.freeze(calculateOrderConsumption(state, order).map((line) => Object.freeze(line)));
}

export function createPizzeriaOrder(stateValue, {
  id, createdAt, historyId, customerName, phone = "", channel,
  tableCommandId = null, address = null, deliveryFeeCents = 0, notes = "", items,
} = {}) {
  const state = validateFoodPizzeriaState(stateValue);
  if (state.settings === null) throw new Error("Configure a pizzaria antes de receber pedidos.");
  if (!CHANNELS.has(channel)) throw new TypeError("Escolha entrega, retirada ou balcão.");
  if (channel === "delivery" && !state.flavors.some(({ active }) => active)) {
    throw new Error("Cadastre ao menos um sabor disponível antes de receber pedidos.");
  }
  if (tableCommandId !== null) {
    const command = state.tableCommands.find(({ id: currentId }) => currentId === tableCommandId);
    if (channel !== "counter" || !command || command.closedAt !== null) {
      throw new Error("A comanda selecionada não está aberta para receber pedidos.");
    }
    if (boundedText(customerName, "Nome do cliente", 80) !== command.customerName) {
      throw new Error("O cliente do pedido precisa corresponder ao grupo da comanda.");
    }
  }
  if (channel === "delivery" && !phone.trim()) throw new TypeError("Informe o telefone do cliente para pedido de entrega.");
  if (channel === "delivery") {
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < 10 || phoneDigits.length > 13) {
      throw new TypeError("Confira o telefone de entrega; informe DDD e número.");
    }
  }
  if (channel === "delivery" && !address) throw new TypeError("Informe o endereço para pedido de entrega.");
  if (channel !== "delivery" && (address !== null || deliveryFeeCents !== 0)) {
    throw new TypeError("Endereço e taxa só podem ser informados para entrega.");
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS_PER_ORDER) {
    throw new TypeError("Adicione ao menos uma pizza ao pedido.");
  }
  const normalizedItems = items.map((item) => {
    const input = exactObject(item, ["id", "size", "flavorIds", "quantity"], "Pizza do pedido");
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 50) {
      throw new TypeError("Quantidade de pizzas inválida.");
    }
    const unitPriceCents = calculatePizzaPriceCents({
      size: input.size,
      flavorIds: input.flavorIds,
      flavors: state.flavors,
      halfPricePolicy: state.settings.halfPricePolicy,
    });
    for (const flavorId of input.flavorIds) {
      if (!state.recipes.some(({ flavorId: recipeFlavorId }) => recipeFlavorId === flavorId)) {
        const flavor = state.flavors.find(({ id }) => id === flavorId);
        throw new Error(`Cadastre a ficha técnica de ${flavor?.name ?? "cada sabor"} antes de registrar pedidos.`);
      }
    }
    const selectedFlavors = input.flavorIds.map((flavorId) => {
      const flavor = state.flavors.find((item) => item.id === flavorId && item.active);
      return { id: flavor.id, name: flavor.name, priceCents: flavor.pricesCents[input.size] };
    });
    const lineTotalCents = Number(BigInt(unitPriceCents) * BigInt(input.quantity));
    cents(lineTotalCents, "Total do item");
    return {
      id: identifier(input.id, "Identificador do item"),
      size: input.size,
      flavors: selectedFlavors,
      quantity: input.quantity,
      unitPriceCents,
      lineTotalCents,
    };
  });
  const subtotal = normalizedItems.reduce((sum, item) => sum + BigInt(item.lineTotalCents), 0n);
  if (subtotal > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Subtotal ultrapassa o limite seguro.");
  const subtotalCents = Number(subtotal);
  const totalCents = subtotalCents + cents(deliveryFeeCents, "Taxa de entrega", { allowZero: true });
  if (!Number.isSafeInteger(totalCents)) throw new RangeError("Total do pedido ultrapassa o limite seguro.");
  const timestamp = utc(createdAt, "Criação do pedido");
  const order = validateOrder({
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    customerName,
    phone: phone.trim(),
    channel,
    tableCommandId,
    address: channel === "delivery" ? address : null,
    deliveryFeeCents: channel === "delivery" ? deliveryFeeCents : 0,
    notes: notes.trim(),
    pricingPolicy: state.settings.halfPricePolicy,
    items: normalizedItems,
    subtotalCents,
    totalCents,
    status: "received",
    statusHistory: [{ id: historyId, status: "received", changedAt: timestamp, reason: null }],
  });
  if (state.orders.length >= MAX_ORDERS) throw new RangeError("Limite de pedidos locais atingido.");
  return nextState(state, { orders: [order, ...state.orders] });
}

export function transitionPizzeriaOrder(stateValue, {
  orderId, nextStatus, changedAt, historyId, reason = null,
} = {}) {
  const state = validateFoodPizzeriaState(stateValue);
  const order = state.orders.find(({ id }) => id === orderId);
  if (!order) throw new Error("Esse pedido não existe mais.");
  if (!STATUSES.has(nextStatus) || !expectedTransition(order, nextStatus)) {
    throw new Error("Essa mudança de status não é permitida para o pedido.");
  }
  const cancellationReason = nextStatus === "cancelled"
    ? boundedText(reason, "Motivo do cancelamento", 240)
    : null;
  const timestamp = utc(changedAt, "Data da alteração do pedido");
  if (Date.parse(timestamp) < Date.parse(order.updatedAt)) {
    throw new TypeError("A alteração do pedido não pode anteceder a última mudança.");
  }
  if (order.statusHistory.length >= MAX_HISTORY_PER_ORDER) {
    throw new RangeError("Limite de mudanças de status atingido para este pedido.");
  }
  const updated = validateOrder({
    ...order,
    status: nextStatus,
    updatedAt: timestamp,
    statusHistory: [
      ...order.statusHistory,
      { id: historyId, status: nextStatus, changedAt: timestamp, reason: cancellationReason },
    ],
  });
  return nextState(state, {
    orders: state.orders.map((item) => item.id === updated.id ? updated : item),
  });
}
