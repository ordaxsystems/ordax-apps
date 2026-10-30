import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KITCHEN_TASKS,
  DEFAULT_KITCHEN_WORKFLOW,
  KITCHEN_QUEUE_MODES,
  KITCHEN_WORKFLOW_PRESETS,
  applyKitchenTaskAction,
  currentKitchenStep,
  createKitchenWorkflowPreset,
  createKitchenWorkflowDraft,
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

function action(tasks, actionName, orderId, stepId, screenNumber, commandId, at, queueMode) {
  return applyKitchenTaskAction(tasks, {
    action: actionName,
    orderId,
    stepId,
    screenNumber,
    commandId,
    digest,
    at,
    ...(queueMode ? { queueMode } : {}),
  });
}

test("workflow editor draft preserves manual stations and supports even redistribution", () => {
  const input = {
    stepCount: 4,
    screenCount: 2,
    queueMode: KITCHEN_QUEUE_MODES.BY_STAGE,
    steps: DEFAULT_KITCHEN_WORKFLOW.steps.map((step, index) => ({
      ...step,
      screen: [2, 1, 2, 1][index],
    })),
  };
  const manual = createKitchenWorkflowDraft(DEFAULT_KITCHEN_WORKFLOW, input);
  assert.equal(manual.queueMode, KITCHEN_QUEUE_MODES.BY_STAGE);
  assert.deepEqual(manual.steps.map(({ screen }) => screen), [2, 1, 2, 1]);

  const distributed = createKitchenWorkflowDraft(DEFAULT_KITCHEN_WORKFLOW, input, { autoDistribute: true });
  assert.deepEqual(distributed.steps.map(({ screen }) => screen), [1, 1, 2, 2]);
  assert.throws(() => createKitchenWorkflowDraft(DEFAULT_KITCHEN_WORKFLOW, {
    ...input,
    screenCount: 5,
  }), /número de telas precisa ser menor ou igual/);
  assert.throws(() => createKitchenWorkflowDraft(DEFAULT_KITCHEN_WORKFLOW, null), /etapas da cozinha precisam ser uma lista/);
});

test("workflow editor generates an ID for each newly added step", () => {
  const steps = [
    ...DEFAULT_KITCHEN_WORKFLOW.steps,
    { label: "Conferência final", screen: 1 },
  ];
  const draft = createKitchenWorkflowDraft(DEFAULT_KITCHEN_WORKFLOW, {
    stepCount: 5,
    screenCount: 1,
    queueMode: KITCHEN_QUEUE_MODES.BY_ORDER,
    steps,
  }, { createStepId: (index) => `new-step-${index + 1}` });

  assert.equal(draft.steps[4].id, "new-step-5");
  assert.equal(draft.steps[4].label, "Conferência final");
});

test("production presets cover a solo pizzaiolo and a four-station pizza line", () => {
  const solo = createKitchenWorkflowPreset(DEFAULT_KITCHEN_WORKFLOW, KITCHEN_WORKFLOW_PRESETS.SINGLE_PIZZAIOLO);
  assert.equal(solo.screenCount, 1);
  assert.equal(solo.queueMode, KITCHEN_QUEUE_MODES.BY_ORDER);
  assert.deepEqual(solo.steps.map(({ id, label, screen }) => [id, label, screen]), [
    ["prepare-order", "Preparar pedido", 1], ["oven", "Forno", 1],
  ]);

  const line = createKitchenWorkflowPreset(solo, KITCHEN_WORKFLOW_PRESETS.PIZZERIA_LINE);
  assert.equal(line.revision, solo.revision);
  assert.equal(line.screenCount, 4);
  assert.equal(line.queueMode, KITCHEN_QUEUE_MODES.BY_STAGE);
  assert.deepEqual(line.steps.map(({ label, screen }) => [label, screen]), [
    ["Abrir massa", 1], ["Montagem", 2], ["Forno", 3], ["Finalização e embalagem", 4],
  ]);
  assert.throws(() => createKitchenWorkflowPreset(line, "toString"), /Modelo de produção desconhecido/);
});

test("legacy workflow preferences migrate to the per-order queue mode without losing their settings", () => {
  const legacy = validateKitchenWorkflow({
    schema: "ordax.food-kitchen-workflow-preview/1",
    revision: 7,
    screenCount: 2,
    steps: DEFAULT_KITCHEN_WORKFLOW.steps.map((step, index) => ({
      id: step.id,
      label: step.label,
      screen: index < 2 ? 1 : 2,
    })),
  });
  assert.equal(legacy.schema, "ordax.food-kitchen-workflow-preview/3");
  assert.equal(legacy.revision, 7);
  assert.equal(legacy.screenCount, 2);
  assert.equal(legacy.queueMode, KITCHEN_QUEUE_MODES.BY_ORDER);
  assert.deepEqual(legacy.steps.map(({ screen }) => screen), [1, 1, 2, 2]);
  assert.deepEqual(legacy.steps.map(({ targetMinutes }) => targetMinutes), [null, null, null, null]);
});

test("workflow v2 migrates to per-step targets without changing screens or queue mode", () => {
  const previous = validateKitchenWorkflow({
    schema: "ordax.food-kitchen-workflow-preview/2",
    revision: 4,
    screenCount: 2,
    queueMode: KITCHEN_QUEUE_MODES.BY_STAGE,
    steps: DEFAULT_KITCHEN_WORKFLOW.steps.map((step, index) => ({
      id: step.id,
      label: step.label,
      screen: index < 2 ? 1 : 2,
    })),
  });
  assert.equal(previous.schema, "ordax.food-kitchen-workflow-preview/3");
  assert.equal(previous.queueMode, KITCHEN_QUEUE_MODES.BY_STAGE);
  assert.deepEqual(previous.steps.map(({ targetMinutes }) => targetMinutes), [null, null, null, null]);
});

test("workflow targets are optional, validated, clearable, and snapshotted on tickets", () => {
  const draft = createKitchenWorkflowDraft(DEFAULT_KITCHEN_WORKFLOW, {
    stepCount: 4,
    screenCount: 1,
    queueMode: KITCHEN_QUEUE_MODES.BY_ORDER,
    steps: DEFAULT_KITCHEN_WORKFLOW.steps.map((step, index) => ({
      ...step,
      targetMinutes: index === 0 ? "3" : "",
    })),
  });
  assert.deepEqual(draft.steps.map(({ targetMinutes }) => targetMinutes), [3, null, null, null]);
  assert.throws(() => validateKitchenWorkflow({
    ...draft,
    steps: draft.steps.map((step, index) => index === 0 ? { ...step, targetMinutes: 0 } : step),
  }), /Revise os nomes, a ordem e a tela/);
  assert.throws(() => validateKitchenWorkflow({
    ...draft,
    steps: draft.steps.map((step, index) => index === 0 ? { ...step, targetMinutes: 481 } : step),
  }), /Revise os nomes, a ordem e a tela/);

  const configured = saveKitchenWorkflow(DEFAULT_KITCHEN_WORKFLOW, draft);
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [order("target-order", "2026-10-27T10:00:00.000Z")], configured);
  const started = action(tasks, "start", "target-order", "open-dough", 1,
    "target-order-start", "2026-10-27T10:01:00.000Z");
  assert.equal(currentKitchenStep(started.tickets[0]).targetMinutes, 3);

  const changed = saveKitchenWorkflow(configured, createKitchenWorkflowDraft(configured, {
    stepCount: 4,
    screenCount: 1,
    queueMode: KITCHEN_QUEUE_MODES.BY_ORDER,
    steps: configured.steps.map((step) => ({ ...step, targetMinutes: "" })),
  }));
  const reconciled = reconcileKitchenTasks(started, [order("target-order", "2026-10-27T10:00:00.000Z")], changed);
  assert.equal(currentKitchenStep(reconciled.tickets[0]).targetMinutes, 3);
  const pending = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS,
    [order("pending-target-order", "2026-10-27T10:00:00.000Z")], configured);
  assert.equal(currentKitchenStep(pending.tickets[0]).targetMinutes, 3);
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

test("batch mode finishes a function across the queue before moving to the next function", () => {
  const batchWorkflow = validateKitchenWorkflow({
    ...DEFAULT_KITCHEN_WORKFLOW,
    screenCount: 1,
    queueMode: KITCHEN_QUEUE_MODES.BY_STAGE,
  });
  let tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [
    order("batch-order-1", "2026-10-27T10:00:00.000Z"),
    order("batch-order-2", "2026-10-27T10:01:00.000Z"),
    order("batch-order-3", "2026-10-27T10:02:00.000Z"),
  ], batchWorkflow);

  tasks = action(tasks, "start", "batch-order-1", "open-dough", 1,
    "batch-start-dough-1", "2026-10-27T10:03:00.000Z", KITCHEN_QUEUE_MODES.BY_STAGE);
  tasks = action(tasks, "complete", "batch-order-1", "open-dough", 1,
    "batch-complete-dough-1", "2026-10-27T10:04:00.000Z", KITCHEN_QUEUE_MODES.BY_STAGE);
  assert.deepEqual(sortKitchenTickets(tasks.tickets, batchWorkflow, 1).map((ticket) => [
    ticket.orderId,
    currentKitchenStep(ticket).id,
  ]), [
    ["batch-order-2", "open-dough"],
    ["batch-order-3", "open-dough"],
    ["batch-order-1", "assembly"],
  ]);

  tasks = action(tasks, "pass-next", "batch-order-2", "open-dough", 1,
    "batch-pass-dough-2", "2026-10-27T10:05:00.000Z", KITCHEN_QUEUE_MODES.BY_STAGE);
  assert.deepEqual(sortKitchenTickets(tasks.tickets, batchWorkflow, 1).map(({ orderId }) => orderId), [
    "batch-order-3", "batch-order-2", "batch-order-1",
  ]);
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

test("next keeps a 100-ticket queue ordered and puts the skipped order in third place", () => {
  const oneScreen = distributeKitchenSteps(DEFAULT_KITCHEN_WORKFLOW, 1);
  const orders = Array.from({ length: 100 }, (_, index) => order(
    `order-${String(index + 1).padStart(4, "0")}`,
    "2026-10-27T10:00:00.000Z",
  ));
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, orders, oneScreen);

  const deferred = action(tasks, "pass-next", "order-0001", "open-dough", 1, "command-pass-100", "2026-10-27T10:02:00.000Z");
  const queue = sortKitchenTickets(deferred.tickets, oneScreen, 1);

  assert.equal(queue.length, 100);
  assert.deepEqual(queue.slice(0, 5).map(({ orderId }) => orderId), [
    "order-0002", "order-0003", "order-0001", "order-0004", "order-0005",
  ]);
  assert.equal(currentKitchenStep(queue[2]).queuePosition, 3);
  assert.equal(queue.at(-1).orderId, "order-0100");
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
      steps: ticket.steps.map(({ queuePosition, targetMinutes, ...step }) => step),
    })),
  };
  const migrated = validateKitchenTasks(legacy);
  assert.equal(migrated.schema, "ordax.food-kitchen-tasks-preview/3");
  assert.deepEqual(sortKitchenTickets(migrated.tickets, DEFAULT_KITCHEN_WORKFLOW, 1).map(({ orderId }) => orderId), ["order-1", "order-2"]);
  assert.deepEqual(migrated.commands, legacy.commands);
  assert.deepEqual(migrated.tickets.map((ticket) => currentKitchenStep(ticket).queuePosition), [1, 2]);
});

test("task v2 migration adds an unset target and preserves current queue position and activity", () => {
  const tasks = reconcileKitchenTasks(DEFAULT_KITCHEN_TASKS, [
    order("order-v2", "2026-10-27T10:00:00.000Z"),
  ], DEFAULT_KITCHEN_WORKFLOW);
  const started = action(tasks, "start", "order-v2", "open-dough", 1,
    "command-start-v2", "2026-10-27T10:01:00.000Z");
  const v2 = {
    ...started,
    schema: "ordax.food-kitchen-tasks-preview/2",
    tickets: started.tickets.map((ticket) => ({
      ...ticket,
      steps: ticket.steps.map(({ targetMinutes, ...step }) => step),
    })),
  };
  const migrated = validateKitchenTasks(v2);
  const current = currentKitchenStep(migrated.tickets[0]);
  assert.equal(migrated.schema, "ordax.food-kitchen-tasks-preview/3");
  assert.equal(current.status, "active");
  assert.equal(current.startedAt, "2026-10-27T10:01:00.000Z");
  assert.equal(current.targetMinutes, null);
  assert.equal(current.queuePosition, 1);
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
  const nextStep = currentKitchenStep(tasks.tickets.find(({ orderId }) => orderId === "order-1"));
  assert.equal(nextStep.label, "Montagem");
  assert.equal(nextStep.queuedAt, "2026-10-27T10:03:00.000Z");
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
