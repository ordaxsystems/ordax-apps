import assert from "node:assert/strict";
import test from "node:test";
import { renderKitchenPage } from "../src/ui/views/kitchen.mjs";
import { renderKitchenItemLine } from "../src/ui/views/kitchen-item.mjs";
import {
  DEFAULT_KITCHEN_TASKS,
  DEFAULT_KITCHEN_WORKFLOW,
  applyKitchenTaskAction,
  distributeKitchenSteps,
  reconcileKitchenTasks,
} from "../src/application/kitchen-workflow-preview.mjs";
import {
  PIZZERIA_KITCHEN_ITEM_LABEL,
  PIZZERIA_KITCHEN_STAGE_GUIDANCE,
  presentPizzeriaKitchenItem,
} from "../src/ui/pizzeria-kitchen-presentation.mjs";

const now = Date.parse("2026-10-26T13:00:00.000Z");
const digest = "c".repeat(64);

function order({ id, status, channel, startedAt, quantity = 1, flavors = null, tableCommandId = null }) {
  return {
    id,
    status,
    channel,
    tableCommandId,
    createdAt: startedAt,
    updatedAt: startedAt,
    statusHistory: [{ changedAt: startedAt }],
    customerName: "Cliente reservado",
    phone: "11999990000",
    address: "Rua confidencial, 123",
    notes: "Sem cebola",
    items: [{ quantity, size: "large", sizeLabel: "Grande", flavors: flavors ?? [{ name: "Margherita" }] }],
  };
}

const orders = [
  order({ id: "order-1001", status: "received", channel: "counter", startedAt: "2026-10-26T12:40:00.000Z", quantity: 2, flavors: ["Calabresa", "Margherita", "Quatro queijos", "Frango"].map((name) => ({ name })) }),
  order({ id: "order-1002", status: "preparing", channel: "dine-in", startedAt: "2026-10-26T12:10:00.000Z", tableCommandId: "command-3" }),
  order({ id: "order-1003", status: "ready", channel: "pickup", startedAt: "2026-10-26T12:55:00.000Z", flavors: [{ name: "Quatro queijos" }] }),
  order({ id: "order-1004", status: "out-for-delivery", channel: "delivery", startedAt: "2026-10-26T12:30:00.000Z" }),
];
const workflow = distributeKitchenSteps(DEFAULT_KITCHEN_WORKFLOW, 4);

function makeTasks() {
  let tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, orders, workflow);
  tasks = applyKitchenTaskAction(tasks, {
    action: "start", orderId: "order-1001", stepId: "open-dough", screenNumber: 1,
    at: "2026-10-26T12:41:00.000Z", commandId: "open-start-1001", digest,
  });
  return applyKitchenTaskAction(tasks, {
    action: "complete", orderId: "order-1001", stepId: "open-dough", screenNumber: 1,
    at: "2026-10-26T12:43:00.000Z", commandId: "open-complete-1001", digest: "d".repeat(64),
  });
}

function render(overrides = {}) {
  const snapshot = {
    tableCommands: [{ id: "command-3", tableId: 3 }],
    orders,
  };
  const viewModel = {
    KITCHEN_CHANNEL_FILTERS: [
      { id: "all", label: "Todos" },
      { id: "counter", label: "Balcão" },
      { id: "dine-in", label: "Salão" },
      { id: "delivery", label: "Entrega" },
    ],
    kitchenChannelFilter: "all",
    kitchenOrderQuery: "",
    kitchenLateOnly: false,
    snapshot,
    kitchenWorkflow: DEFAULT_KITCHEN_WORKFLOW,
    kitchenTasks: reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, orders, DEFAULT_KITCHEN_WORKFLOW),
    kitchenItemPresentation: (item) => presentPizzeriaKitchenItem(item, [{ id: "large", label: "Grande", slices: 8 }]),
    kitchenItemLabel: PIZZERIA_KITCHEN_ITEM_LABEL,
    kitchenStageGuidance: PIZZERIA_KITCHEN_STAGE_GUIDANCE,
    ORDER_STAGE_ALERT_MINUTES: { received: 15, preparing: 35, ready: 15, "out-for-delivery": 45 },
    stageStartedAt: (record) => record.statusHistory.at(-1)?.changedAt ?? record.createdAt,
    elapsedMinutes: (startedAt) => Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000)),
    orderNumber: (record) => `#${record.id.slice(-4)}`,
    orderChannelLabel: (record) => record.tableCommandId ? "Mesa 03" : ({ delivery: "Entrega", pickup: "Retirada", counter: "Balcão", "dine-in": "Salão" })[record.channel],
    escapeHtml: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    renderKitchenOrderCard: (record, { deliveryDetails = false, task = null, screenNumber = null } = {}) => `<article data-order="${record.id}"><header><strong>#${record.id.slice(-4)}</strong></header><span class="status-badge status-${record.status}"></span>${task ? `<span>${task.steps.filter(({ status }) => status === "completed").length}/${task.steps.length}</span>` : ""}${screenNumber ? `<button data-screen="${screenNumber}">Concluir ${task?.steps.find(({ status }) => status !== "completed")?.label ?? "etapa"}</button><button>Adiar para o fim da fila</button>` : ""}<ul class="kitchen-item-lines">${record.items.map((item) => renderKitchenItemLine(item, viewModel.kitchenItemPresentation(item), viewModel.escapeHtml)).join("")}</ul>${deliveryDetails ? record.address : ""}</article>`,
    kitchenChannelButton: (filter) => `<button data-channel="${filter.id}">${filter.label}</button>`,
    kitchenScreenHref: (screenNumber, stage, screenCount) => `/?station=${screenNumber}&stationStage=${stage}&screenCount=${screenCount}`,
    kitchenOverviewHref: () => "/?view=kitchen",
    ...overrides,
  };
  return renderKitchenPage(viewModel);
}

test("production board reflects each configured step and hands completed kitchen work to pickup or dispatch", () => {
  const page = render({ kitchenWorkflow: workflow, kitchenTasks: makeTasks() });
  assert.match(page, /data-kitchen-stage="open-dough"/);
  assert.match(page, /data-kitchen-stage="assembly"/);
  assert.match(page, /data-kitchen-stage="oven"/);
  assert.match(page, /data-kitchen-stage="finish-pack"/);
  assert.match(page, /Prontos para retirada ou entrega/);
  assert.match(page, /Em entrega/);
  assert.doesNotMatch(page, /data-action="cancel-order"|Cancelar pedido|Pular etapa/);
});

test("search filters by order, table and pizza flavor without searching private address data", () => {
  const byTable = render({ kitchenOrderQuery: "mesa 03" });
  assert.match(byTable, /order-1002/);
  assert.doesNotMatch(byTable, /order-1001|order-1003|order-1004/);
  const byFlavor = render({ kitchenOrderQuery: "Calabresa" });
  assert.match(byFlavor, /order-1001/);
  assert.doesNotMatch(byFlavor, /order-1002|order-1003|order-1004/);
  const byAddress = render({ kitchenOrderQuery: "Rua confidencial" });
  assert.match(byAddress, /Nenhum pedido corresponde/);
  assert.doesNotMatch(byAddress, /data-order="order-1004"/);
});

test("overdue filter keeps the existing order SLA while tickets move independently by station", () => {
  const page = render({ kitchenLateOnly: true, kitchenWorkflow: workflow, kitchenTasks: makeTasks() });
  assert.match(page, /data-kitchen-overdue-count>2<\/strong>/);
  assert.match(page, /aria-pressed="true"/);
});

test("workflow settings edit business steps and create a direct link for every screen", () => {
  const page = render({ kitchenWorkflow: workflow, kitchenTasks: makeTasks() });
  assert.match(page, /id="kitchen-layout-form"/);
  assert.match(page, /name="step-label-1"/);
  assert.match(page, /name="step-screen-4"/);
  assert.match(page, /<strong>Tela 1<\/strong><span>Abrir massa<\/span>/);
  assert.match(page, /<strong>Tela 4<\/strong><span>Finalização e embalagem<\/span>/);
  assert.match(page, /data-action="copy-kitchen-link"/);
  assert.match(page, /integração Food de produção em tempo real/);
  assert.match(page, /data-action="move-kitchen-step"/);
  assert.match(page, /O KDS não cancela pedidos/);
});

test("station focuses a single ticket, exposes start/complete/defer and lists five upcoming orders", () => {
  const page = render({
    kitchenWorkflow: workflow,
    kitchenTasks: makeTasks(),
    activeKitchenScreen: 2,
    kitchenScreenCount: 4,
    renderKitchenOrderCard: (record, { task = null, screenNumber = null } = {}) => `<article data-order="${record.id}"><strong>#${record.id.slice(-4)}</strong>${task ? `<b>${task.steps.filter(({ status }) => status === "completed").length + 1}/${task.steps.length} ${task.steps.find(({ status }) => status !== "completed").label}</b>` : ""}${screenNumber ? `<button data-task-action="complete">Concluir montagem</button><button data-task-action="defer">Adiar para o fim da fila</button>` : ""}</article>`,
  });
  assert.match(page, /TELA 2 DE 4/);
  assert.match(page, /data-kitchen-station-screen="2"/);
  assert.match(page, /data-action="fullscreen-kitchen"/);
  assert.match(page, /data-kitchen-current-order="order-1001"/);
  assert.match(page, /Concluir montagem/);
  assert.match(page, /Adiar para o fim da fila/);
  assert.match(page, /Sem outros pedidos aguardando/);
  assert.equal((page.match(/#1001/g) ?? []).length, 1);
  assert.doesNotMatch(page, /Cancelar|data-action="cancel-order"|data-action="advance-order"/);
  assert.doesNotMatch(page, /kitchen-summary|kitchen-toolbar|kitchen-display-setup/);
});

test("single-screen flow keeps every step in sequence on one focused ticket", () => {
  const page = render({
    kitchenTasks: reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, orders, DEFAULT_KITCHEN_WORKFLOW),
    activeKitchenScreen: 1,
    kitchenScreenCount: 1,
  });
  assert.match(page, /Abrir massa/);
  assert.match(page, /data-kitchen-current-order="order-1002"/);
  assert.match(page, /Próximos pedidos/);
  assert.match(page, /Concluir Abrir massa/);
  assert.match(page, /Adiar para o fim da fila/);
  assert.equal((page.match(/#1002/g) ?? []).length, 1);
});

test("one pizza order keeps every selected flavor visible on its station ticket", () => {
  const page = render({
    kitchenWorkflow: workflow,
    kitchenTasks: makeTasks(),
    activeKitchenScreen: 2,
    kitchenScreenCount: 4,
  });
  for (const flavor of ["Calabresa", "Margherita", "Quatro queijos", "Frango"]) assert.match(page, new RegExp(flavor));
  assert.doesNotMatch(page, /Fatias exibidas conforme o cadastro atual do tamanho/);
});

test("generic Food production board uses neutral item labels and supports direct station routes", () => {
  const page = render({
    kitchenItemLabel: { singular: "item", plural: "itens", metricLabel: "Itens em produção" },
    kitchenItemPresentation: (item) => ({ title: "Sanduíche", detail: "Sem picles", modifierLabel: "Adicionais", modifiers: ["Queijo"] }),
    activeKitchenScreen: 1,
    kitchenScreenHref: (screenNumber, stage, screenCount) => `/?station=${screenNumber}&stationStage=${stage}&screenCount=${screenCount}`,
  });
  assert.match(page, /TELA 1 DE 1/);
  assert.match(page, /Sanduíche/);
  assert.doesNotMatch(page, /pizza na cozinha|sabores da pizza/i);
});

test("Pizzeria item presenter keeps four flavor chips distinct without inventing proportions", () => {
  const presentation = presentPizzeriaKitchenItem({
    quantity: 1,
    size: "large",
    sizeLabel: "Grande",
    flavors: ["Calabresa", "Margherita", "Quatro queijos", "Frango"].map((name) => ({ name })),
  }, [{ id: "large", label: "Grande", slices: 8 }]);
  assert.equal(presentation.modifiers.length, 4);
  assert.deepEqual(presentation.modifiers, ["Calabresa", "Margherita", "Quatro queijos", "Frango"]);
  assert.equal(presentation.detail, "8 fatias");
});
