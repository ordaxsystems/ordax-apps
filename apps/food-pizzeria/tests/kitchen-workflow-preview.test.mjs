import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KITCHEN_TASKS,
  DEFAULT_KITCHEN_WORKFLOW,
  applyKitchenTaskAction,
  currentKitchenStep,
  distributeKitchenSteps,
  reconcileKitchenTasks,
  saveKitchenWorkflow,
  sortKitchenTickets,
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

test("starting a stage claims one ticket and blocks a second ticket on that station", () => {
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [
    order("order-1", "2026-10-27T10:00:00.000Z"),
    order("order-2", "2026-10-27T10:01:00.000Z"),
  ], workflow);
  const started = action(tasks, "start", "order-1", "open-dough", 1, "command-start-1", "2026-10-27T10:02:00.000Z");
  assert.equal(currentKitchenStep(started.tickets[0]).status, "active");
  assert.throws(() => action(started, "start", "order-2", "open-dough", 1, "command-start-2", "2026-10-27T10:03:00.000Z"), /Conclua ou adie/);
});

test("deferring keeps the same required step and moves the ticket behind the next order", () => {
  const oneScreen = { ...DEFAULT_KITCHEN_WORKFLOW, screenCount: 1 };
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [
    order("order-1", "2026-10-27T10:00:00.000Z"),
    order("order-2", "2026-10-27T10:01:00.000Z"),
  ], oneScreen);
  const deferred = action(tasks, "defer", "order-1", "open-dough", 1, "command-defer-1", "2026-10-27T10:02:00.000Z");
  const queue = sortKitchenTickets(deferred.tickets, oneScreen, 1, "complete-cycle");
  assert.deepEqual(queue.map(({ orderId }) => orderId), ["order-2", "order-1"]);
  assert.equal(currentKitchenStep(deferred.tickets.find(({ orderId }) => orderId === "order-1")).id, "open-dough");
  assert.equal(currentKitchenStep(deferred.tickets.find(({ orderId }) => orderId === "order-1")).deferCount, 1);
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
  assert.throws(() => applyKitchenTaskAction(first, { ...input, action: "defer", digest: "b".repeat(64) }), /reutilizado/);
});

test("cancelling in the Food owner removes a ticket from production without adding KDS cancellation", () => {
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [order("order-1", "2026-10-27T10:00:00.000Z")], workflow);
  const cancelled = reconcileKitchenTasks(tasks, [order("order-1", "2026-10-27T10:00:00.000Z", "cancelled")], workflow);
  assert.equal(currentKitchenStep(cancelled.tickets[0]), null);
  assert.equal(sortKitchenTickets(cancelled.tickets, workflow, 1).length, 0);
});

test("workflow revisions change future tickets while existing tickets retain their original steps", () => {
  const oldTasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [order("order-1", "2026-10-27T10:00:00.000Z")], DEFAULT_KITCHEN_WORKFLOW);
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
  assert.equal(nextTasks.tickets.find(({ orderId }) => orderId === "order-2").workflowRevision, 2);
  assert.equal(nextTasks.tickets.find(({ orderId }) => orderId === "order-2").steps[1].label, "Cobertura");
});
