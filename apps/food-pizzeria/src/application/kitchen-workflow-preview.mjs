export const KITCHEN_WORKFLOW_SCHEMA = "ordax.food-kitchen-workflow-preview/1";
export const KITCHEN_TASKS_SCHEMA = "ordax.food-kitchen-tasks-preview/2";
export const MAX_KITCHEN_WORKFLOW_STEPS = 8;
export const MAX_KITCHEN_DISPLAYS = 8;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const TIME_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;
const DIGEST_RE = /^[a-f0-9]{64}$/;
const LEGACY_KITCHEN_TASKS_SCHEMA = "ordax.food-kitchen-tasks-preview/1";
const TASK_STATUSES = new Set(["queued", "active", "pending", "completed"]);
const ACTIONS = new Set(["start", "pass-next", "complete"]);

export const DEFAULT_KITCHEN_WORKFLOW = Object.freeze({
  schema: KITCHEN_WORKFLOW_SCHEMA,
  revision: 1,
  screenCount: 1,
  steps: Object.freeze([
    Object.freeze({ id: "open-dough", label: "Abrir massa", screen: 1 }),
    Object.freeze({ id: "assembly", label: "Montagem", screen: 1 }),
    Object.freeze({ id: "oven", label: "Forno", screen: 1 }),
    Object.freeze({ id: "finish-pack", label: "Finalização e embalagem", screen: 1 }),
  ]),
});

export const KITCHEN_WORKFLOW_PRESETS = Object.freeze({
  SINGLE_PIZZAIOLO: "single-pizzaiolo",
  PIZZERIA_LINE: "pizzeria-line",
});

const PRESET_STEPS = Object.freeze({
  [KITCHEN_WORKFLOW_PRESETS.SINGLE_PIZZAIOLO]: Object.freeze({
    screenCount: 1,
    steps: Object.freeze([
      Object.freeze({ id: "prepare-order", label: "Preparar pedido", screen: 1 }),
      Object.freeze({ id: "oven", label: "Forno", screen: 1 }),
    ]),
  }),
  [KITCHEN_WORKFLOW_PRESETS.PIZZERIA_LINE]: Object.freeze({
    screenCount: 4,
    steps: Object.freeze([
      Object.freeze({ id: "open-dough", label: "Abrir massa", screen: 1 }),
      Object.freeze({ id: "assembly", label: "Montagem", screen: 2 }),
      Object.freeze({ id: "oven", label: "Forno", screen: 3 }),
      Object.freeze({ id: "finish-pack", label: "Finalização e embalagem", screen: 4 }),
    ]),
  }),
});

export const DEFAULT_KITCHEN_TASKS = Object.freeze({
  schema: KITCHEN_TASKS_SCHEMA,
  revision: 0,
  tickets: Object.freeze([]),
  commands: Object.freeze([]),
});

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    throw new TypeError(`${label} tem campos incompatíveis.`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !TIME_RE.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} inválido.`);
  }
  return new Date(Date.parse(value)).toISOString();
}

function freezeWorkflow(revision, screenCount, steps) {
  return Object.freeze({
    schema: KITCHEN_WORKFLOW_SCHEMA,
    revision,
    screenCount,
    steps: Object.freeze(steps.map((step) => Object.freeze({ ...step }))),
  });
}

export function validateKitchenWorkflow(value) {
  const raw = exactObject(value, ["schema", "revision", "screenCount", "steps"], "Fluxo da cozinha");
  if (raw.schema !== KITCHEN_WORKFLOW_SCHEMA
    || !Number.isSafeInteger(raw.revision) || raw.revision < 1
    || !Number.isSafeInteger(raw.screenCount) || raw.screenCount < 1 || raw.screenCount > MAX_KITCHEN_DISPLAYS
    || !Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > MAX_KITCHEN_WORKFLOW_STEPS
    || raw.screenCount > raw.steps.length) {
    throw new TypeError("O fluxo precisa ter de 1 a 8 etapas e uma tela para cada posto configurado.");
  }
  const ids = new Set();
  const labels = new Set();
  const steps = raw.steps.map((value) => {
    const step = exactObject(value, ["id", "label", "screen"], "Etapa da cozinha");
    if (typeof step.id !== "string" || !ID_RE.test(step.id) || ids.has(step.id)
      || typeof step.label !== "string" || step.label.trim().length < 2 || step.label.trim().length > 48
      || !Number.isSafeInteger(step.screen) || step.screen < 1 || step.screen > raw.screenCount) {
      throw new TypeError("Revise os nomes, a ordem e a tela atribuída a cada etapa.");
    }
    const normalizedLabel = step.label.normalize("NFKC").trim().toLocaleLowerCase("pt-BR");
    if (labels.has(normalizedLabel)) throw new TypeError("Cada etapa precisa ter um nome diferente.");
    ids.add(step.id);
    labels.add(normalizedLabel);
    return { id: step.id, label: step.label.trim(), screen: step.screen };
  });
  const assignedScreens = new Set(steps.map(({ screen }) => screen));
  if (assignedScreens.size !== raw.screenCount
    || Array.from({ length: raw.screenCount }, (_, index) => index + 1).some((screen) => !assignedScreens.has(screen))) {
    throw new TypeError("Cada tela precisa ter ao menos uma etapa atribuída.");
  }
  return freezeWorkflow(raw.revision, raw.screenCount, steps);
}

export function distributeKitchenSteps(workflowValue, screenCountValue) {
  const workflow = validateKitchenWorkflow(workflowValue);
  const screenCount = Number(screenCountValue);
  if (!Number.isSafeInteger(screenCount) || screenCount < 1
    || screenCount > Math.min(MAX_KITCHEN_DISPLAYS, workflow.steps.length)) {
    throw new RangeError(`Escolha de 1 a ${Math.min(MAX_KITCHEN_DISPLAYS, workflow.steps.length)} telas.`);
  }
  const steps = workflow.steps.map((step, index) => ({
    ...step,
    screen: Math.min(screenCount, Math.floor(index * screenCount / workflow.steps.length) + 1),
  }));
  return freezeWorkflow(workflow.revision, screenCount, steps);
}

export function saveKitchenWorkflow(currentValue, draftValue) {
  const current = validateKitchenWorkflow(currentValue ?? DEFAULT_KITCHEN_WORKFLOW);
  const draft = validateKitchenWorkflow({
    ...draftValue,
    schema: KITCHEN_WORKFLOW_SCHEMA,
    revision: current.revision,
  });
  if (current.revision >= Number.MAX_SAFE_INTEGER) throw new RangeError("Revisão do fluxo da cozinha esgotada.");
  return freezeWorkflow(current.revision + 1, draft.screenCount, draft.steps);
}

export function createKitchenWorkflowPreset(currentValue, presetId) {
  const current = validateKitchenWorkflow(currentValue ?? DEFAULT_KITCHEN_WORKFLOW);
  if (!Object.hasOwn(PRESET_STEPS, presetId)) throw new TypeError("Modelo de produção desconhecido.");
  const preset = PRESET_STEPS[presetId];
  return freezeWorkflow(current.revision, preset.screenCount, preset.steps);
}

function validateTaskStep(value) {
  const raw = exactObject(value,
    ["id", "label", "screen", "status", "queuedAt", "startedAt", "completedAt", "deferCount", "queuePosition"],
    "Tarefa da cozinha");
  if (typeof raw.id !== "string" || !ID_RE.test(raw.id)
    || typeof raw.label !== "string" || !raw.label.trim() || raw.label.length > 48
    || !Number.isSafeInteger(raw.screen) || raw.screen < 1 || raw.screen > MAX_KITCHEN_DISPLAYS
    || !TASK_STATUSES.has(raw.status)
    || !Number.isSafeInteger(raw.deferCount) || raw.deferCount < 0 || raw.deferCount > 1000
    || (raw.status === "pending" || raw.status === "completed"
      ? raw.queuePosition !== null
      : !Number.isSafeInteger(raw.queuePosition) || raw.queuePosition < 1)) {
    throw new TypeError("Tarefa da cozinha inválida.");
  }
  const queuedAt = raw.queuedAt === null ? null : timestamp(raw.queuedAt, "Entrada na fila");
  const startedAt = raw.startedAt === null ? null : timestamp(raw.startedAt, "Início da etapa");
  const completedAt = raw.completedAt === null ? null : timestamp(raw.completedAt, "Conclusão da etapa");
  if ((raw.status === "queued" && (queuedAt === null || startedAt !== null || completedAt !== null))
    || (raw.status === "active" && (queuedAt === null || startedAt === null || completedAt !== null))
    || (raw.status === "pending" && (queuedAt !== null || startedAt !== null || completedAt !== null))
    || (raw.status === "completed" && completedAt === null)) {
    throw new TypeError("A fila e o estado da etapa estão inconsistentes.");
  }
  return Object.freeze({
    id: raw.id,
    label: raw.label.trim(),
    screen: raw.screen,
    status: raw.status,
    queuedAt,
    startedAt,
    completedAt,
    deferCount: raw.deferCount,
    queuePosition: raw.queuePosition,
  });
}

function validateLegacyTaskStep(value) {
  const raw = exactObject(value,
    ["id", "label", "screen", "status", "queuedAt", "startedAt", "completedAt", "deferCount"],
    "Tarefa da cozinha legada");
  const queuedAt = raw.queuedAt === null ? null : timestamp(raw.queuedAt, "Entrada na fila");
  return validateTaskStep({
    ...raw,
    queuePosition: ["queued", "active"].includes(raw.status) && queuedAt !== null ? Date.parse(queuedAt) : null,
  });
}

function validateTicket(value, { legacy = false } = {}) {
  const raw = exactObject(value, ["orderId", "workflowRevision", "cycleQueuedAt", "steps"], "Ticket de produção");
  if (typeof raw.orderId !== "string" || !ID_RE.test(raw.orderId)
    || !Number.isSafeInteger(raw.workflowRevision) || raw.workflowRevision < 1
    || !Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > MAX_KITCHEN_WORKFLOW_STEPS) {
    throw new TypeError("Ticket de produção inválido.");
  }
  const steps = raw.steps.map(legacy ? validateLegacyTaskStep : validateTaskStep);
  if (new Set(steps.map(({ id }) => id)).size !== steps.length) throw new TypeError("O fluxo do pedido repete uma etapa.");
  let foundCurrent = false;
  let foundPending = false;
  for (const step of steps) {
    if (step.status === "completed") {
      if (foundCurrent || foundPending) throw new TypeError("As etapas concluídas precisam formar o início do fluxo.");
      continue;
    }
    if (step.status === "pending") {
      foundPending = true;
      continue;
    }
    if (foundCurrent || foundPending) throw new TypeError("Um ticket precisa ter uma única etapa atual e não pode pular etapas.");
    foundCurrent = true;
  }
  if (!foundCurrent && steps.at(-1).status !== "completed") {
    throw new TypeError("O ticket precisa ter uma etapa atual ou estar concluído.");
  }
  return Object.freeze({
    orderId: raw.orderId,
    workflowRevision: raw.workflowRevision,
    cycleQueuedAt: timestamp(raw.cycleQueuedAt, "Entrada do pedido na fila geral"),
    steps: Object.freeze(steps),
  });
}

function validateCommand(value) {
  const raw = exactObject(value, ["id", "digest"], "Ação local da cozinha");
  if (typeof raw.id !== "string" || !ID_RE.test(raw.id) || !DIGEST_RE.test(raw.digest)) {
    throw new TypeError("Registro de ação da cozinha inválido.");
  }
  return Object.freeze({ id: raw.id, digest: raw.digest });
}

export function validateKitchenTasks(value) {
  const raw = exactObject(value, ["schema", "revision", "tickets", "commands"], "Tarefas da cozinha");
  const legacy = raw.schema === LEGACY_KITCHEN_TASKS_SCHEMA;
  if ((!legacy && raw.schema !== KITCHEN_TASKS_SCHEMA) || !Number.isSafeInteger(raw.revision) || raw.revision < 0
    || !Array.isArray(raw.tickets) || raw.tickets.length > 5000
    || !Array.isArray(raw.commands) || raw.commands.length > 10000) {
    throw new TypeError("Estado local das tarefas da cozinha inválido.");
  }
  const tickets = raw.tickets.map((ticket) => validateTicket(ticket, { legacy }));
  const commands = raw.commands.map(validateCommand);
  if (new Set(tickets.map(({ orderId }) => orderId)).size !== tickets.length
    || new Set(commands.map(({ id }) => id)).size !== commands.length) {
    throw new TypeError("Tickets ou comandos locais estão duplicados.");
  }
  const migratedTickets = legacy ? reindexStationQueues(tickets) : tickets;
  assertUniqueQueuePositions(migratedTickets);
  return Object.freeze({
    schema: KITCHEN_TASKS_SCHEMA,
    revision: raw.revision,
    tickets: Object.freeze(migratedTickets),
    commands: Object.freeze(commands),
  });
}

function currentStepForTicket(ticket) {
  return ticket.steps.find((step) => step.status !== "completed") ?? null;
}

function compareStationTickets(first, second) {
  const firstStep = currentStepForTicket(first);
  const secondStep = currentStepForTicket(second);
  if (firstStep.status === "active" && secondStep.status !== "active") return -1;
  if (secondStep.status === "active" && firstStep.status !== "active") return 1;
  return firstStep.queuePosition - secondStep.queuePosition
    || Date.parse(first.cycleQueuedAt) - Date.parse(second.cycleQueuedAt)
    || first.orderId.localeCompare(second.orderId);
}

function reindexStationQueues(tickets, explicitOrderByScreen = new Map()) {
  const positions = new Map();
  const ticketsByOrder = new Map(tickets.map((ticket) => [ticket.orderId, ticket]));
  const screenNumbers = new Set(tickets.map((ticket) => currentStepForTicket(ticket)?.screen).filter(Boolean));
  for (const screenNumber of screenNumbers) {
    const explicitOrder = explicitOrderByScreen.get(screenNumber);
    const queue = explicitOrder
      ? explicitOrder.map((orderId) => ticketsByOrder.get(orderId)).filter((ticket) => currentStepForTicket(ticket)?.screen === screenNumber)
      : tickets.filter((ticket) => currentStepForTicket(ticket)?.screen === screenNumber).sort(compareStationTickets);
    queue.forEach((ticket, index) => positions.set(ticket.orderId, index + 1));
  }
  return tickets.map((ticket) => {
    const current = currentStepForTicket(ticket);
    if (!current) return ticket;
    const queuePosition = positions.get(ticket.orderId);
    if (current.queuePosition === queuePosition) return ticket;
    return {
      ...ticket,
      steps: ticket.steps.map((step) => step.id === current.id ? { ...step, queuePosition } : step),
    };
  });
}

function assertUniqueQueuePositions(tickets) {
  const positions = new Set();
  for (const ticket of tickets) {
    const current = currentStepForTicket(ticket);
    if (!current) continue;
    const key = `${current.screen}:${current.queuePosition}`;
    if (positions.has(key)) throw new TypeError("Dois pedidos ocupam a mesma posição na fila da tela.");
    positions.add(key);
  }
}

function nextQueuePosition(tickets, screenNumber) {
  return tickets.reduce((highest, ticket) => {
    const current = currentStepForTicket(ticket);
    return current?.screen === screenNumber ? Math.max(highest, current.queuePosition) : highest;
  }, 0) + 1;
}

function taskForOrder(workflow, order, queuePosition, terminal = false) {
  const queuedAt = timestamp(order.createdAt, "Criação do pedido");
  const completedAt = terminal ? timestamp(order.updatedAt, "Atualização do pedido") : null;
  return {
    orderId: order.id,
    workflowRevision: workflow.revision,
    cycleQueuedAt: queuedAt,
    steps: workflow.steps.map(({ id, label, screen }, index) => ({
      id,
      label,
      screen,
      status: terminal ? "completed" : index === 0 ? "queued" : "pending",
      queuedAt: terminal ? null : index === 0 ? queuedAt : null,
      startedAt: null,
      completedAt,
      deferCount: 0,
      queuePosition: terminal || index !== 0 ? null : queuePosition,
    })),
  };
}

export function reconcileKitchenTasks(tasksValue, orders, workflowValue) {
  const tasks = validateKitchenTasks(tasksValue ?? DEFAULT_KITCHEN_TASKS);
  const workflow = validateKitchenWorkflow(workflowValue ?? DEFAULT_KITCHEN_WORKFLOW);
  const knownOrders = new Set(orders.map(({ id }) => id));
  const byOrder = new Map(tasks.tickets.filter(({ orderId }) => knownOrders.has(orderId))
    .map((ticket) => [ticket.orderId, ticket]));
  let changed = byOrder.size !== tasks.tickets.length;
  const newOrders = orders.filter(({ id }) => !byOrder.has(id))
    .sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt) || first.id.localeCompare(second.id));
  for (const order of newOrders) {
    const existing = byOrder.get(order.id);
    const terminal = ["ready", "out-for-delivery", "completed", "cancelled"].includes(order.status);
    const firstScreen = workflow.steps[0].screen;
    const position = terminal ? null : nextQueuePosition([...byOrder.values()], firstScreen);
    byOrder.set(order.id, validateTicket(taskForOrder(workflow, order, position, terminal)));
    changed = true;
  }
  const queuedForReassignment = [...byOrder.values()]
    .filter((ticket) => ticket.workflowRevision !== workflow.revision
      && currentKitchenStep(ticket)?.status === "queued"
      && ticket.steps.every(({ status }) => status === "queued" || status === "pending"))
    .sort(compareStationTickets);
  if (queuedForReassignment.length) {
    const reassignedIds = new Set(queuedForReassignment.map(({ orderId }) => orderId));
    const firstScreen = workflow.steps[0].screen;
    let queuePosition = nextQueuePosition(
      [...byOrder.values()].filter(({ orderId }) => !reassignedIds.has(orderId)),
      firstScreen,
    );
    for (const ticket of queuedForReassignment) {
      const order = orders.find(({ id }) => id === ticket.orderId);
      if (!order) continue;
      const reassigned = taskForOrder(workflow, order, queuePosition++);
      byOrder.set(ticket.orderId, validateTicket({ ...reassigned, cycleQueuedAt: ticket.cycleQueuedAt }));
      changed = true;
    }
  }
  for (const order of orders) {
    const existing = byOrder.get(order.id);
    if (!existing) continue;
    const terminal = ["ready", "out-for-delivery", "completed", "cancelled"].includes(order.status);
    if (terminal && currentKitchenStep(existing)) {
      const completedAt = timestamp(order.updatedAt, "Atualização do pedido");
      byOrder.set(order.id, validateTicket({
        ...existing,
        steps: existing.steps.map((step) => ({
          ...step,
          status: "completed",
          queuedAt: step.status === "pending" ? null : step.queuedAt,
          startedAt: step.status === "pending" ? null : step.startedAt,
          completedAt: step.completedAt ?? completedAt,
          queuePosition: null,
        })),
      }));
      changed = true;
    }
  }
  if (!changed) return tasks;
  return validateKitchenTasks({ ...tasks, revision: tasks.revision + 1, tickets: [...byOrder.values()] });
}

export function currentKitchenStep(ticketValue) {
  const ticket = validateTicket(ticketValue);
  return currentStepForTicket(ticket);
}

export function sortKitchenTickets(ticketsValue, workflowValue, screenNumber, mode = "station") {
  validateKitchenWorkflow(workflowValue);
  if (!Number.isSafeInteger(screenNumber) || screenNumber < 1 || screenNumber > MAX_KITCHEN_DISPLAYS
    || !["station", "complete-cycle"].includes(mode)) throw new TypeError("Tela da cozinha inválida.");
  const tickets = ticketsValue.map(validateTicket);
  return tickets.filter((ticket) => {
    const current = currentKitchenStep(ticket);
    return current !== null && current.screen === screenNumber;
  }).sort(compareStationTickets);
}

export function applyKitchenTaskAction(tasksValue, {
  action, orderId, stepId, screenNumber, at, commandId, digest,
} = {}) {
  const tasks = validateKitchenTasks(tasksValue);
  if (!ACTIONS.has(action) || typeof orderId !== "string" || !ID_RE.test(orderId)
    || typeof stepId !== "string" || !ID_RE.test(stepId)
    || !Number.isSafeInteger(screenNumber) || screenNumber < 1 || screenNumber > MAX_KITCHEN_DISPLAYS
    || typeof commandId !== "string" || !ID_RE.test(commandId) || !DIGEST_RE.test(digest)) {
    throw new TypeError("Ação de produção inválida.");
  }
  const previous = tasks.commands.find(({ id }) => id === commandId);
  if (previous) {
    if (previous.digest !== digest) throw new Error("Identificador de ação reutilizado com outro conteúdo.");
    return tasks;
  }
  if (tasks.commands.length >= 10000) throw new RangeError("O histórico local da cozinha atingiu o limite seguro.");
  const changedAt = timestamp(at, "Data da ação da cozinha");
  const ticketIndex = tasks.tickets.findIndex(({ orderId: id }) => id === orderId);
  if (ticketIndex < 0) throw new Error("O pedido não possui uma sequência de produção.");
  const ticket = tasks.tickets[ticketIndex];
  const stepIndex = ticket.steps.findIndex(({ status }) => status !== "completed");
  if (stepIndex < 0 || ticket.steps[stepIndex].id !== stepId) throw new Error("A etapa deste pedido já mudou. Atualize a fila.");
  const currentStep = ticket.steps[stepIndex];
  if (currentStep.screen !== screenNumber) throw new Error("Este pedido pertence a outra tela.");
  if (action === "start") {
    if (currentStep.status !== "queued") throw new Error("A etapa já foi iniciada ou concluída.");
    const stationBusy = tasks.tickets.some((other) => other.orderId !== orderId
      && currentKitchenStep(other)?.status === "active"
      && currentKitchenStep(other)?.screen === screenNumber);
    if (stationBusy) throw new Error("Conclua esta etapa ou passe para o próximo pedido antes de iniciar outra.");
  } else if (action === "complete" && currentStep.status !== "active") {
    throw new Error("Inicie esta etapa antes de concluí-la.");
  } else if (action === "pass-next" && !["queued", "active"].includes(currentStep.status)) {
    throw new Error("Esta etapa não pode ser adiada agora.");
  }

  const stationQueue = action === "pass-next"
    ? tasks.tickets.filter((item) => currentStepForTicket(item)?.screen === screenNumber).sort(compareStationTickets)
    : [];
  if (action === "pass-next" && stationQueue[0]?.orderId !== orderId) {
    throw new Error("Só é possível passar o pedido que está em foco.");
  }
  if (action === "pass-next" && stationQueue.length < 2) {
    throw new Error("Não há outro pedido nesta etapa para passar.");
  }

  const steps = [...ticket.steps];
  if (action === "start") {
    steps[stepIndex] = { ...currentStep, status: "active", startedAt: changedAt };
  } else if (action === "pass-next") {
    steps[stepIndex] = {
      ...currentStep,
      status: "queued",
      queuedAt: changedAt,
      startedAt: null,
      deferCount: currentStep.deferCount + 1,
      queuePosition: currentStep.queuePosition,
    };
  } else {
    steps[stepIndex] = { ...currentStep, status: "completed", completedAt: changedAt };
    if (stepIndex + 1 < steps.length) {
      const nextStep = steps[stepIndex + 1];
      steps[stepIndex + 1] = {
        ...nextStep,
        status: "queued",
        queuedAt: nextStep.screen === currentStep.screen ? currentStep.queuedAt : changedAt,
        queuePosition: nextStep.screen === currentStep.screen
          ? currentStep.queuePosition
          : nextQueuePosition(tasks.tickets, nextStep.screen),
      };
    }
  }
  const updatedTicket = {
    ...ticket,
    steps,
  };
  let nextTickets = tasks.tickets.map((item, index) => index === ticketIndex ? updatedTicket : item);
  if (action === "complete") {
    const completedStep = steps[stepIndex];
    steps[stepIndex] = { ...completedStep, queuePosition: null };
    nextTickets = nextTickets.map((item) => item.orderId === orderId ? { ...item, steps } : item);
  }
  if (action === "pass-next") {
    const afterNext = stationQueue.length > 2 ? stationQueue[2] : null;
    const shortQueueOrder = afterNext
      ? [stationQueue[1].orderId, afterNext.orderId, stationQueue[0].orderId, ...stationQueue.slice(3).map(({ orderId: id }) => id)]
      : [stationQueue[1].orderId, stationQueue[0].orderId];
    nextTickets = reindexStationQueues(nextTickets, new Map([[screenNumber, shortQueueOrder]]));
  }
  return validateKitchenTasks({
    ...tasks,
    revision: tasks.revision + 1,
    tickets: nextTickets,
    commands: [...tasks.commands, { id: commandId, digest }],
  });
}

export function kitchenTicketByOrder(tasksValue, orderId) {
  return validateKitchenTasks(tasksValue).tickets.find(({ orderId: id }) => id === orderId) ?? null;
}
