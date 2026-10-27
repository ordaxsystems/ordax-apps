import assert from "node:assert/strict";
import test from "node:test";
import { kitchenStepClock, renderKitchenPage } from "../src/ui/views/kitchen.mjs";
import { renderKitchenItemLine } from "../src/ui/views/kitchen-item.mjs";
import {
  DEFAULT_KITCHEN_TASKS,
  DEFAULT_KITCHEN_WORKFLOW,
  KITCHEN_QUEUE_MODES,
  KITCHEN_WORKFLOW_PRESETS,
  applyKitchenTaskAction,
  createKitchenWorkflowPreset,
  distributeKitchenSteps,
  reconcileKitchenTasks,
  validateKitchenWorkflow,
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
    items: [{ quantity, size: "large", sizeLabel: "Grande", sliceCount: 8, flavors: flavors ?? [{ name: "Margherita" }] }],
  };
}

const orders = [
  order({ id: "order-1001", status: "received", channel: "counter", startedAt: "2026-10-26T12:40:00.000Z", quantity: 2, flavors: ["Calabresa", "Margherita", "Quatro queijos", "Frango"].map((name) => ({ name })) }),
  order({ id: "order-1002", status: "preparing", channel: "dine-in", startedAt: "2026-10-26T12:10:00.000Z", tableCommandId: "command-3" }),
  order({ id: "order-1003", status: "ready", channel: "pickup", startedAt: "2026-10-26T12:55:00.000Z", flavors: [{ name: "Quatro queijos" }] }),
  order({ id: "order-1004", status: "out-for-delivery", channel: "delivery", startedAt: "2026-10-26T12:30:00.000Z" }),
];
const workflow = distributeKitchenSteps(DEFAULT_KITCHEN_WORKFLOW, 4);

test("KDS apresenta produto adicional sem interpretar como pizza ou receita", () => {
  assert.deepEqual(presentPizzeriaKitchenItem({
    type: "catalog-product",
    name: "Refrigerante 2L",
    category: "Bebidas",
  }), {
    title: "Refrigerante 2L",
    detail: "Bebidas",
    modifierLabel: "Produto",
    modifiers: [],
  });
  assert.equal(PIZZERIA_KITCHEN_ITEM_LABEL.metricLabel, "Itens na cozinha");
});

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

test("ticket clock follows the active step or its latest queue entry", () => {
  const queuedTasks = makeTasks();
  const queuedTicket = queuedTasks.tickets.find(({ orderId }) => orderId === "order-1001");
  assert.deepEqual(kitchenStepClock(queuedTicket), {
    label: "Na fila da etapa há",
    startedAt: "2026-10-26T12:43:00.000Z",
  });

  const activeTasks = applyKitchenTaskAction(queuedTasks, {
    action: "start", orderId: "order-1001", stepId: "assembly", screenNumber: 2,
    at: "2026-10-26T12:44:00.000Z", commandId: "start-assembly-1001", digest: "e".repeat(64),
  });
  assert.deepEqual(kitchenStepClock(activeTasks.tickets.find(({ orderId }) => orderId === "order-1001")), {
    label: "Etapa em andamento há",
    startedAt: "2026-10-26T12:44:00.000Z",
  });
});

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
    kitchenItemPresentation: (item) => presentPizzeriaKitchenItem(item),
    kitchenItemLabel: PIZZERIA_KITCHEN_ITEM_LABEL,
    kitchenStageGuidance: PIZZERIA_KITCHEN_STAGE_GUIDANCE,
    ORDER_STAGE_ALERT_MINUTES: { received: 15, preparing: 35, ready: 15, "out-for-delivery": 45 },
    stageStartedAt: (record) => record.statusHistory.at(-1)?.changedAt ?? record.createdAt,
    elapsedMinutes: (startedAt) => Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000)),
    orderNumber: (record) => `#${record.id.slice(-4)}`,
    orderChannelLabel: (record) => record.tableCommandId ? "Mesa 03" : ({ delivery: "Entrega", pickup: "Retirada", counter: "Balcão", "dine-in": "Salão" })[record.channel],
    escapeHtml: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    renderKitchenOrderCard: (record, { deliveryDetails = false, task = null, screenNumber = null } = {}) => `<article data-order="${record.id}"><header><strong>#${record.id.slice(-4)}</strong></header><span class="status-badge status-${record.status}"></span>${task ? `<span>${task.steps.filter(({ status }) => status === "completed").length}/${task.steps.length}</span>` : ""}${screenNumber ? `<button data-screen="${screenNumber}">Concluir ${task?.steps.find(({ status }) => status !== "completed")?.label ?? "etapa"}</button><button>Próximo</button>` : ""}<ul class="kitchen-item-lines">${record.items.map((item) => renderKitchenItemLine(item, viewModel.kitchenItemPresentation(item), viewModel.escapeHtml)).join("")}</ul>${deliveryDetails ? record.address : ""}</article>`,
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

test("station focuses a single ticket, exposes start/complete/next and lists five upcoming orders", () => {
  const page = render({
    kitchenWorkflow: workflow,
    kitchenTasks: makeTasks(),
    activeKitchenScreen: 2,
    kitchenScreenCount: 4,
    renderKitchenOrderCard: (record, { task = null, screenNumber = null } = {}) => `<article data-order="${record.id}"><strong>#${record.id.slice(-4)}</strong>${task ? `<b>${task.steps.filter(({ status }) => status === "completed").length + 1}/${task.steps.length} ${task.steps.find(({ status }) => status !== "completed").label}</b>` : ""}${screenNumber ? `<button data-task-action="complete">Concluir montagem</button><button data-task-action="pass-next">Próximo</button>` : ""}</article>`,
  });
  assert.match(page, /TELA 2 DE 4/);
  assert.match(page, /data-kitchen-station-screen="2"/);
  assert.match(page, /data-action="fullscreen-kitchen"/);
  assert.match(page, /data-kitchen-current-order="order-1001"/);
  assert.match(page, /Concluir montagem/);
  assert.match(page, /Próximo/);
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
  assert.match(page, /Próximo/);
  assert.equal((page.match(/#1002/g) ?? []).length, 1);
  assert.match(page, /<h1>Abrir massa<\/h1>/);
  assert.doesNotMatch(page, /<h1>Abrir massa · Montagem · Forno/);
});

test("solo pizzaiolo setup explains both per-order and batch preparation modes", () => {
  const soloWorkflow = createKitchenWorkflowPreset(DEFAULT_KITCHEN_WORKFLOW, KITCHEN_WORKFLOW_PRESETS.SINGLE_PIZZAIOLO);
  const page = render({
    kitchenWorkflow: soloWorkflow,
    kitchenTasks: reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, orders, soloWorkflow),
    activeKitchenScreen: 1,
    kitchenScreenCount: 1,
  });
  assert.match(page, /<h1>Preparar pedido<\/h1>/);
  assert.match(page, /Uma pessoa · um pedido por vez · enviar ao forno ao concluir o preparo/);
  assert.match(page, /data-kitchen-stage="1"/);
  assert.match(page, /<h2>Pedido atual<\/h2>/);
  assert.match(page, /<h1>Preparar pedido<\/h1>/);
  const setupPage = render({ kitchenWorkflow: soloWorkflow });
  assert.match(setupPage, /data-action="apply-kitchen-preset" data-preset="single-pizzaiolo"/);
  assert.match(setupPage, /data-action="apply-kitchen-preset" data-preset="pizzeria-line"/);

  const soloBatchWorkflow = validateKitchenWorkflow({ ...soloWorkflow, queueMode: KITCHEN_QUEUE_MODES.BY_STAGE });
  const batchPage = render({
    kitchenWorkflow: soloBatchWorkflow,
    kitchenTasks: reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, orders, soloBatchWorkflow),
    activeKitchenScreen: 1,
    kitchenScreenCount: 1,
  });
  assert.match(batchPage, /faça o preparo de todos os pedidos antes de avançar ao forno/);
  assert.doesNotMatch(batchPage, /um pedido por vez/);
});

test("started kitchen work stays reachable after the new layout removes its former screen", () => {
  const inProgressOrder = { ...orders[0], status: "preparing" };
  const legacyTicket = {
    orderId: inProgressOrder.id,
    workflowRevision: workflow.revision,
    cycleQueuedAt: inProgressOrder.createdAt,
    steps: workflow.steps.map((step, index) => ({
      ...step,
      status: index < 3 ? "completed" : "active",
      queuedAt: "2026-10-26T12:40:00.000Z",
      startedAt: "2026-10-26T12:41:00.000Z",
      completedAt: index < 3 ? "2026-10-26T12:42:00.000Z" : null,
      deferCount: 0,
      queuePosition: index < 3 ? null : 1,
    })),
  };
  const taskSnapshot = {
    ...DEFAULT_KITCHEN_TASKS,
    revision: 3,
    tickets: [legacyTicket],
  };
  const newWorkflow = validateKitchenWorkflow({
    ...workflow,
    revision: workflow.revision + 1,
    screenCount: 1,
    steps: workflow.steps.map((step) => ({ ...step, screen: 1 })),
  });
  const snapshot = { tableCommands: [], orders: [inProgressOrder] };
  const setupPage = render({
    snapshot,
    kitchenWorkflow: newWorkflow,
    kitchenTasks: taskSnapshot,
  });
  assert.match(setupPage, /data-kitchen-preserved-screen="4"/);
  assert.match(setupPage, /href="\/?\?station=4&amp;stationStage=finish-pack&amp;screenCount=4"/);
  assert.match(setupPage, /1 pedido em andamento neste fluxo anterior/);

  const legacyStation = render({
    snapshot,
    kitchenWorkflow: newWorkflow,
    kitchenTasks: taskSnapshot,
    activeKitchenScreen: 4,
    kitchenScreenCount: 4,
  });
  assert.match(legacyStation, /TELA 4 DE 4/);
  assert.match(legacyStation, /<h1>Finalização e embalagem<\/h1>/);
  assert.match(legacyStation, /data-kitchen-current-order="order-1001"/);
});

test("each of the four production screens renders only its own assigned stage", () => {
  const stationOrders = Array.from({ length: 4 }, (_, index) => order({
    id: `station-order-${index + 1}`,
    status: "received",
    channel: "counter",
    startedAt: new Date(Date.parse("2026-10-26T12:00:00.000Z") + index * 60_000).toISOString(),
  }));
  let tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, stationOrders, workflow);
  const stageOrder = workflow.steps.map(({ id }) => id);
  for (let targetScreen = 2; targetScreen <= 4; targetScreen += 1) {
    const orderId = `station-order-${targetScreen}`;
    for (let stageIndex = 0; stageIndex < targetScreen - 1; stageIndex += 1) {
      const stepId = stageOrder[stageIndex];
      const actionMinute = String(6 + stageIndex * 2).padStart(2, "0");
      const completeMinute = String(Number(actionMinute) + 1).padStart(2, "0");
      tasks = applyKitchenTaskAction(tasks, {
        action: "start", orderId, stepId, screenNumber: stageIndex + 1,
        at: `2026-10-26T12:${actionMinute}:00Z`, commandId: `screen-${targetScreen}-start-${stageIndex}`, digest,
      });
      tasks = applyKitchenTaskAction(tasks, {
        action: "complete", orderId, stepId, screenNumber: stageIndex + 1,
        at: `2026-10-26T12:${completeMinute}:00Z`, commandId: `screen-${targetScreen}-complete-${stageIndex}`, digest,
      });
    }
  }

  const labels = ["Abrir massa", "Montagem", "Forno", "Finalização e embalagem"];
  for (let screenNumber = 1; screenNumber <= 4; screenNumber += 1) {
    const page = render({
      snapshot: { tableCommands: [], orders: stationOrders },
      kitchenWorkflow: workflow,
      kitchenTasks: tasks,
      activeKitchenScreen: screenNumber,
      kitchenScreenCount: 4,
    });
    assert.match(page, new RegExp(`TELA ${screenNumber} DE 4`));
    assert.match(page, new RegExp(`<h1>${labels[screenNumber - 1]}<\\/h1>`));
    assert.match(page, new RegExp(`data-kitchen-stage="${screenNumber}"`));
    assert.equal((page.match(/data-kitchen-stage=/g) ?? []).length, 1);
    assert.match(page, /data-kitchen-current-order=/);
    assert.doesNotMatch(page, /data-action="cancel-order"|Cancelar pedido/);
  }
});

test("station heading names only the functions assigned to a shared two-function screen", () => {
  const sharedStationWorkflow = validateKitchenWorkflow({
    ...DEFAULT_KITCHEN_WORKFLOW,
    screenCount: 2,
    steps: DEFAULT_KITCHEN_WORKFLOW.steps.map((step, index) => ({ ...step, screen: index < 2 ? 1 : 2 })),
  });
  const page = render({
    kitchenWorkflow: sharedStationWorkflow,
    kitchenTasks: reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, orders, sharedStationWorkflow),
    activeKitchenScreen: 1,
    kitchenScreenCount: 2,
  });
  assert.match(page, /<h1>Abrir massa<\/h1>/);
  assert.match(page, /2 etapas nesta tela/);
  assert.doesNotMatch(page, /<h1>[^<]*(?:Forno|Finalização e embalagem)/);
});

test("kitchen setup explains and exposes both per-order and batch-by-stage work modes", () => {
  const page = render();
  assert.match(page, /name="queueMode"/);
  assert.match(page, /Pedido a pedido/);
  assert.match(page, /Por função em lote/);
  assert.match(page, /faça a mesma etapa nos pedidos da fila/);
});

test("a batch-by-stage station explains that grouped functions run across the queue", () => {
  const batchWorkflow = validateKitchenWorkflow({
    ...DEFAULT_KITCHEN_WORKFLOW,
    screenCount: 2,
    queueMode: "by-stage",
    steps: DEFAULT_KITCHEN_WORKFLOW.steps.map((step, index) => ({
      ...step,
      screen: index < 2 ? 1 : 2,
    })),
  });
  const page = render({
    kitchenWorkflow: batchWorkflow,
    kitchenTasks: reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, orders, batchWorkflow),
    activeKitchenScreen: 1,
    kitchenScreenCount: 2,
  });
  assert.match(page, /faça cada função em lote/);
  assert.match(page, /Abrir massa · Montagem/);
});

test("shared stations name all three functions assigned to them", () => {
  const sharedStationWorkflow = validateKitchenWorkflow({
    ...DEFAULT_KITCHEN_WORKFLOW,
    screenCount: 2,
    steps: DEFAULT_KITCHEN_WORKFLOW.steps.map((step, index) => ({ ...step, screen: index < 3 ? 1 : 2 })),
  });
  const page = render({
    kitchenWorkflow: sharedStationWorkflow,
    kitchenTasks: reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, orders, sharedStationWorkflow),
    activeKitchenScreen: 1,
    kitchenScreenCount: 2,
  });
  assert.match(page, /<h1>Abrir massa<\/h1>/);
  assert.match(page, /3 etapas nesta tela/);
  assert.doesNotMatch(page, /<h1>[^<]*Finalização e embalagem/);
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
    sliceCount: 8,
    flavors: ["Calabresa", "Margherita", "Quatro queijos", "Frango"].map((name) => ({ name })),
  });
  assert.equal(presentation.modifiers.length, 4);
  assert.deepEqual(presentation.modifiers, ["Calabresa", "Margherita", "Quatro queijos", "Frango"]);
  assert.equal(presentation.detail, "8 fatias");
});

test("Pizzeria item presenter never infers historical slices from current size settings", () => {
  const presentation = presentPizzeriaKitchenItem({
    quantity: 1,
    size: "large",
    sizeLabel: "Grande",
    sliceCount: null,
    flavors: [{ name: "Calabresa" }],
  });

  assert.equal(presentation.title, "Grande");
  assert.equal(presentation.detail, "Fatias não registradas");
});
