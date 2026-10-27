import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KITCHEN_TASKS,
  DEFAULT_KITCHEN_WORKFLOW,
  KITCHEN_WORKFLOW_PRESETS,
  applyKitchenTaskAction,
  currentKitchenStep,
  createKitchenWorkflowPreset,
  distributeKitchenSteps,
  reconcileKitchenTasks,
  saveKitchenWorkflow,
  sortKitchenTickets,
  validateKitchenTasks,
  validateKitchenWorkflow,
} from "../src/application/kitchen-workflow-preview.mjs";

const digest = "a".repeat(64);
const workflow = validateKitchenWorkflow({
  ...DEFAULT_KITCHEN_WORKFLOW,
  screenCount: 4,
  steps: DEFAULT_KITCHEN_WORKFLOW.steps.map((step, index) => ({ ...step, screen: index + 1 })),
});

function order(id, createdAt, status = "received") {
  return { id, status, createdAt, updatedAt: createdAt };
}

function action(tasks, actionName, orderId, stepId, screenNumber, commandId, at) {
  return applyKitchenTaskAction(tasks, {
    action: actionName,
    orderId,
    stepId,
    screenNumber,
    commandId,
    digest,
    at,
  });
}

test("production presets cover a solo pizzaiolo and a four-station pizza line", () => {
  const solo = createKitchenWorkflowPreset(DEFAULT_KITCHEN_WORKFLOW, KITCHEN_WORKFLOW_PRESETS.SINGLE_PIZZAIOLO);
  assert.equal(solo.screenCount, 1);
  assert.deepEqual(solo.steps.map(({ id, label, screen }) => [id, label, screen]), [
    ["prepare-order", "Preparar pedido", 1], ["oven", "Forno", 1],
  ]);

  const line = createKitchenWorkflowPreset(solo, KITCHEN_WORKFLOW_PRESETS.PIZZERIA_LINE);
  assert.equal(line.revision, solo.revision);
  assert.equal(line.screenCount, 4);
  assert.deepEqual(line.steps.map(({ label, screen }) => [label, screen]), [
    ["Abrir massa", 1], ["Montagem", 2], ["Forno", 3], ["Finalização e embalagem", 4],
  ]);
  assert.throws(() => createKitchenWorkflowPreset(line, "toString"), /Modelo de produção desconhecido/);
});

test("pizza workflow distributes four sequential stations across four screens", () => {
  const distributed = distributeKitchenSteps(DEFAULT_KITCHEN_WORKFLOW, 4);
  assert.equal(distributed.screenCount, 4);
  assert.deepEqual(distributed.steps.map(({ label, screen }) => [label, screen]), [
    ["Abrir massa", 1], ["Montagem", 2], ["Forno", 3], ["Finalização e embalagem", 4],
  ]);
  assert.throws(() => distributeKitchenSteps(DEFAULT_KITCHEN_WORKFLOW, 5), /1 a 4 telas/);
});

test("every configured screen has a stage and each stage has a unique readable name", () => {
  assert.throws(() => validateKitchenWorkflow({ ...workflow, steps: workflow.steps.map((step) => ({ ...step, screen: 1 })) }), /Cada tela precisa ter/);
  assert.throws(() => validateKitchenWorkflow({ ...workflow, steps: workflow.steps.map((step) => ({ ...step, label: "Montagem" })) }), /nome diferente/);
});

test("a screen can run two consecutive stages before routing the same order to the next screen", () => {
  const sharedScreenWorkflow = validateKitchenWorkflow({
    ...DEFAULT_KITCHEN_WORKFLOW,
    screenCount: 2,
    steps: DEFAULT_KITCHEN_WORKFLOW.steps.map((step, index) => ({
      ...step,
      screen: index < 2 ? 1 : 2,
    })),
  });
  let tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [
    order("shared-screen-order", "2026-10-27T10:00:00.000Z"),
  ], sharedScreenWorkflow);

  tasks = action(tasks, "start", "shared-screen-order", "open-dough", 1,
    "shared-screen-start-dough", "2026-10-27T10:01:00.000Z");
  tasks = action(tasks, "complete", "shared-screen-order", "open-dough", 1,
    "shared-screen-complete-dough", "2026-10-27T10:02:00.000Z");
  assert.deepEqual(
    [currentKitchenStep(tasks.tickets[0]).id, currentKitchenStep(tasks.tickets[0]).screen],
    ["assembly", 1],
  );

  tasks = action(tasks, "start", "shared-screen-order", "assembly", 1,
    "shared-screen-start-assembly", "2026-10-27T10:03:00.000Z");
  tasks = action(tasks, "complete", "shared-screen-order", "assembly", 1,
    "shared-screen-complete-assembly", "2026-10-27T10:04:00.000Z");
  assert.deepEqual(
    [currentKitchenStep(tasks.tickets[0]).id, currentKitchenStep(tasks.tickets[0]).screen],
    ["oven", 2],
  );
});

test("starting a stage claims one ticket and blocks a second ticket on that station", () => {
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [
    order("order-1", "2026-10-27T10:00:00.000Z"),
    order("order-2", "2026-10-27T10:01:00.000Z"),
  ], workflow);
  const started = action(tasks, "start", "order-1", "open-dough", 1, "command-start-1", "2026-10-27T10:02:00.000Z");
  assert.equal(currentKitchenStep(started.tickets[0]).status, "active");
  assert.throws(() => action(started, "start", "order-2", "open-dough", 1, "command-start-2", "2026-10-27T10:03:00.000Z"), /Conclua esta etapa ou passe/);
});

test("next focuses the following ticket and moves the current ticket to third place, never to the queue tail", () => {
  const oneScreen = { ...DEFAULT_KITCHEN_WORKFLOW, screenCount: 1 };
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [
    order("order-1", "2026-10-27T10:00:00.000Z"),
    order("order-2", "2026-10-27T10:00:00.000Z"),
    order("order-3", "2026-10-27T10:00:00.000Z"),
    order("order-4", "2026-10-27T10:00:00.000Z"),
  ], oneScreen);
  const deferred = action(tasks, "pass-next", "order-1", "open-dough", 1, "command-defer-1", "2026-10-27T10:02:00.000Z");
  const queue = sortKitchenTickets(deferred.tickets, oneScreen, 1);
  assert.deepEqual(queue.map(({ orderId }) => orderId), ["order-2", "order-3", "order-1", "order-4"]);
  assert.deepEqual(queue.map((ticket) => currentKitchenStep(ticket).queuePosition), [1, 2, 3, 4]);
  assert.equal(currentKitchenStep(deferred.tickets.find(({ orderId }) => orderId === "order-1")).id, "open-dough");
  assert.equal(currentKitchenStep(deferred.tickets.find(({ orderId }) => orderId === "order-1")).deferCount, 1);
  assert.equal(deferred.tickets.find(({ orderId }) => orderId === "order-1").cycleQueuedAt, "2026-10-27T10:00:00.000Z");
});

test("passing next pauses an active step so the next order can take focus", () => {
  const oneScreen = { ...DEFAULT_KITCHEN_WORKFLOW, screenCount: 1 };
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [
    order("order-1", "2026-10-27T10:00:00.000Z"),
    order("order-2", "2026-10-27T10:01:00.000Z"),
    order("order-3", "2026-10-27T10:02:00.000Z"),
    order("order-4", "2026-10-27T10:03:00.000Z"),
  ], oneScreen);
  const started = action(tasks, "start", "order-1", "open-dough", 1, "command-start-pass-1", "2026-10-27T10:04:00.000Z");
  const passed = action(started, "pass-next", "order-1", "open-dough", 1, "command-pass-active-1", "2026-10-27T10:05:00.000Z");
  const queue = sortKitchenTickets(passed.tickets, oneScreen, 1);
  const returnedTicket = passed.tickets.find(({ orderId }) => orderId === "order-1");
  assert.deepEqual(queue.map(({ orderId }) => orderId), ["order-2", "order-3", "order-1", "order-4"]);
  assert.equal(currentKitchenStep(returnedTicket).status, "queued");
  assert.equal(currentKitchenStep(returnedTicket).startedAt, null);
  assert.equal(currentKitchenStep(returnedTicket).queuePosition, 3);
});

test("passing next is unavailable when no other ticket is waiting at the station", () => {
  const oneScreen = { ...DEFAULT_KITCHEN_WORKFLOW, screenCount: 1 };
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [order("order-1", "2026-10-27T10:00:00.000Z")], oneScreen);
  assert.throws(
    () => action(tasks, "pass-next", "order-1", "open-dough", 1, "command-defer-alone", "2026-10-27T10:02:00.000Z"),
    /Não há outro pedido/,
  );
});

test("legacy local task schema migrates to queue positions without losing completed steps or command receipts", () => {
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [
    order("order-1", "2026-10-27T10:00:00.000Z"),
    order("order-2", "2026-10-27T10:01:00.000Z"),
  ], DEFAULT_KITCHEN_WORKFLOW);
  const legacy = {
    ...tasks,
    schema: "ordax.food-kitchen-tasks-preview/1",
    commands: [{ id: "command-old-1", digest }],
    tickets: tasks.tickets.map((ticket) => ({
      ...ticket,
      steps: ticket.steps.map(({ queuePosition, ...step }) => step),
    })),
  };
  const migrated = validateKitchenTasks(legacy);
  assert.equal(migrated.schema, "ordax.food-kitchen-tasks-preview/2");
  assert.deepEqual(sortKitchenTickets(migrated.tickets, DEFAULT_KITCHEN_WORKFLOW, 1).map(({ orderId }) => orderId), ["order-1", "order-2"]);
  assert.deepEqual(migrated.commands, legacy.commands);
  assert.deepEqual(migrated.tickets.map((ticket) => currentKitchenStep(ticket).queuePosition), [1, 2]);
});

test("concluding a stage transfers the same ticket to the next configured screen", () => {
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [
    order("order-1", "2026-10-27T10:00:00.000Z"),
    order("order-2", "2026-10-27T10:01:00.000Z"),
  ], workflow);
  const started = action(tasks, "start", "order-1", "open-dough", 1, "command-start-1", "2026-10-27T10:02:00.000Z");
  const advanced = action(started, "complete", "order-1", "open-dough", 1, "command-complete-1", "2026-10-27T10:03:00.000Z");
  const transferred = advanced.tickets.find(({ orderId }) => orderId === "order-1");
  assert.deepEqual(transferred.steps.slice(0, 2).map(({ status }) => status), ["completed", "queued"]);
  assert.equal(currentKitchenStep(transferred).label, "Montagem");
  assert.deepEqual(sortKitchenTickets(advanced.tickets, workflow, 2).map(({ orderId }) => orderId), ["order-1"]);
  assert.deepEqual(sortKitchenTickets(advanced.tickets, workflow, 1).map(({ orderId }) => orderId), ["order-2"]);
});

test("a single operator keeps the same ticket in focus while consecutive steps belong to the same screen", () => {
  const oneScreen = { ...DEFAULT_KITCHEN_WORKFLOW, screenCount: 1 };
  let tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [
    order("order-1", "2026-10-27T10:00:00.000Z"),
    order("order-2", "2026-10-27T10:01:00.000Z"),
  ], oneScreen);
  tasks = action(tasks, "start", "order-1", "open-dough", 1, "single-start-1", "2026-10-27T10:02:00.000Z");
  tasks = action(tasks, "complete", "order-1", "open-dough", 1, "single-complete-1", "2026-10-27T10:03:00.000Z");
  assert.deepEqual(sortKitchenTickets(tasks.tickets, oneScreen, 1).map(({ orderId }) => orderId), ["order-1", "order-2"]);
  assert.equal(currentKitchenStep(tasks.tickets.find(({ orderId }) => orderId === "order-1")).label, "Montagem");
});

test("task commands are idempotent and one action id cannot be reused with new content", () => {
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [order("order-1", "2026-10-27T10:00:00.000Z")], workflow);
  const input = {
    action: "start", orderId: "order-1", stepId: "open-dough", screenNumber: 1,
    commandId: "command-replay-1", digest, at: "2026-10-27T10:02:00.000Z",
  };
  const first = applyKitchenTaskAction(tasks, input);
  const replay = applyKitchenTaskAction(first, input);
  assert.equal(replay.revision, first.revision);
  assert.throws(() => applyKitchenTaskAction(first, { ...input, action: "pass-next", digest: "b".repeat(64) }), /reutilizado/);
});

test("cancelling in the Food owner removes a ticket from production without adding KDS cancellation", () => {
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [order("order-1", "2026-10-27T10:00:00.000Z")], workflow);
  const cancelled = reconcileKitchenTasks(tasks, [order("order-1", "2026-10-27T10:00:00.000Z", "cancelled")], workflow);
  assert.equal(currentKitchenStep(cancelled.tickets[0]), null);
  assert.equal(sortKitchenTickets(cancelled.tickets, workflow, 1).length, 0);
});

test("workflow revisions preserve a ticket after work has started and use the new flow for new tickets", () => {
  const oldTasks = action(
    reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [order("order-1", "2026-10-27T10:00:00.000Z")], DEFAULT_KITCHEN_WORKFLOW),
    "start", "order-1", "open-dough", 1, "revision-start-order-1", "2026-10-27T10:00:30.000Z",
  );
  const saved = saveKitchenWorkflow(DEFAULT_KITCHEN_WORKFLOW, {
    ...DEFAULT_KITCHEN_WORKFLOW,
    steps: DEFAULT_KITCHEN_WORKFLOW.steps.map((step, index) => ({
      ...step,
      label: index === 1 ? "Cobertura" : step.label,
    })),
  });
  const nextTasks = reconcileKitchenTasks(oldTasks, [
    order("order-1", "2026-10-27T10:00:00.000Z"),
    order("order-2", "2026-10-27T10:01:00.000Z"),
  ], saved);
  assert.equal(saved.revision, 2);
  assert.equal(nextTasks.tickets.find(({ orderId }) => orderId === "order-1").workflowRevision, 1);
  assert.equal(nextTasks.tickets.find(({ orderId }) => orderId === "order-1").steps[1].label, "Montagem");
  assert.equal(currentKitchenStep(nextTasks.tickets.find(({ orderId }) => orderId === "order-1")).status, "active");
  assert.equal(nextTasks.tickets.find(({ orderId }) => orderId === "order-2").workflowRevision, 2);
  assert.equal(nextTasks.tickets.find(({ orderId }) => orderId === "order-2").steps[1].label, "Cobertura");
});

test("changing configuration moves untouched queued tickets onto the selected screens", () => {
  const orderSet = [
    order("order-1", "2026-10-27T10:00:00.000Z"),
    order("order-2", "2026-10-27T10:01:00.000Z"),
    order("order-3", "2026-10-27T10:02:00.000Z"),
  ];
  const queued = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, orderSet, DEFAULT_KITCHEN_WORKFLOW);
  const soloDraft = createKitchenWorkflowPreset(DEFAULT_KITCHEN_WORKFLOW, KITCHEN_WORKFLOW_PRESETS.SINGLE_PIZZAIOLO);
  const soloWorkflow = saveKitchenWorkflow(DEFAULT_KITCHEN_WORKFLOW, soloDraft);
  const reassigned = reconcileKitchenTasks(queued, orderSet, soloWorkflow);
  assert.deepEqual(reassigned.tickets.map(({ orderId, workflowRevision, steps }) => ({
    orderId,
    workflowRevision,
    stages: steps.map(({ id, screen, status }) => [id, screen, status]),
  })), [
    { orderId: "order-1", workflowRevision: 2, stages: [["prepare-order", 1, "queued"], ["oven", 1, "pending"]] },
    { orderId: "order-2", workflowRevision: 2, stages: [["prepare-order", 1, "queued"], ["oven", 1, "pending"]] },
    { orderId: "order-3", workflowRevision: 2, stages: [["prepare-order", 1, "queued"], ["oven", 1, "pending"]] },
  ]);
  assert.deepEqual(sortKitchenTickets(reassigned.tickets, soloWorkflow, 1).map(({ orderId }) => orderId), ["order-1", "order-2", "order-3"]);
});
