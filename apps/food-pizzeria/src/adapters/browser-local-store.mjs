import { applyFoodCommand, createFoodCommand } from "../application/commands.mjs";
import {
  DEFAULT_DELIVERY_FEE_CENTS,
  migrateFoodPizzeriaState,
  validateFoodPizzeriaState,
} from "../domain/domain.mjs";
import {
  createSeedFoodState,
  PREVIEW_SEED_ORDER_AGES_MINUTES,
  PREVIEW_SEED_TABLE_OPENING_AGES_MINUTES,
} from "../fixtures/mock-data.mjs";
import { FOOD_DATA_PORT_SCHEMA } from "../ports/food-data-port.mjs";
import {
  DEFAULT_KITCHEN_DISPLAY_CONFIGURATION,
  validateKitchenDisplayConfiguration,
} from "../application/kitchen-display-configuration.mjs";
import { fingerprintFoodCommand } from "../application/command-fingerprint.mjs";
import {
  DEFAULT_KITCHEN_TASKS,
  DEFAULT_KITCHEN_WORKFLOW,
  applyKitchenTaskAction,
  currentKitchenStep,
  reconcileKitchenTasks,
  validateKitchenTasks,
  validateKitchenWorkflow,
} from "../application/kitchen-workflow-preview.mjs";

const STORAGE_SCHEMA = "ordax.food-pizzeria.browser-state/5";
const PREVIOUS_STORAGE_SCHEMA = "ordax.food-pizzeria.browser-state/4";
const PREVIOUS_PREVIEW_STORAGE_SCHEMA = "ordax.food-pizzeria.browser-state/3";
const LEGACY_ENVELOPE_SCHEMA = "ordax.food-pizzeria.browser-state/2";
const LEGACY_STORAGE_SCHEMA = "ordax.food-pizzeria.browser-state/1";
const COMMAND_DIGEST_RE = /^[a-f0-9]{64}$/;
const LEGACY_INVENTORY_ARCHIVE_SCHEMA = "ordax.food-pizzeria.preview-legacy-inventory/1";
const LEGACY_FOOD_STATE_V3 = "ordax.food-pizzeria-state/3";
const LEGACY_PREVIEW_FOOD_STATE_V7 = "ordax.food-pizzeria-state/7";
const BUSINESS_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const COMMAND_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MAX_STATE_BYTES = 5 * 1024 * 1024;
const MAX_RECORDED_COMMANDS = 1000;
const PREVIEW_ACTIVITY_REFRESH_AFTER_MS = 2 * 60 * 60 * 1000;
const DEFAULT_PREVIEW_PREFERENCES = Object.freeze({
  deliveryFeeCents: DEFAULT_DELIVERY_FEE_CENTS,
  kitchenDisplays: DEFAULT_KITCHEN_DISPLAY_CONFIGURATION,
  kitchenWorkflow: DEFAULT_KITCHEN_WORKFLOW,
  kitchenTasks: DEFAULT_KITCHEN_TASKS,
});
const LEGACY_KEY = [
  "ordax.food-pizzeria.development.v2",
  encodeURIComponent("local-demo-owner"),
  encodeURIComponent("local-demo-pizzeria"),
].join(".");

function serializedBytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function validateCommandHistory(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_RECORDED_COMMANDS) {
    throw new TypeError("O registro de operações locais da pizzaria está inválido.");
  }
  const seen = new Set();
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).sort().join(",") !== "digest,id"
      || typeof entry.id !== "string" || !COMMAND_ID_RE.test(entry.id)
      || (entry.digest !== null && (typeof entry.digest !== "string" || !COMMAND_DIGEST_RE.test(entry.digest)))
      || seen.has(entry.id)) {
      throw new TypeError("O registro de operações locais da pizzaria está inválido.");
    }
    seen.add(entry.id);
    return { id: entry.id, digest: entry.digest };
  });
}

function validatePreviewPreferences(value) {
  const keys = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort().join(",")
    : "";
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["deliveryFeeCents", "deliveryFeeCents,kitchenDisplays", "deliveryFeeCents,kitchenDisplays,kitchenTasks,kitchenWorkflow"].includes(keys)
    || !Number.isSafeInteger(value.deliveryFeeCents)
    || value.deliveryFeeCents < 0 || value.deliveryFeeCents > 1_000_000_000) {
    throw new TypeError("As preferências locais da prévia estão inválidas.");
  }
  return Object.freeze({
    deliveryFeeCents: value.deliveryFeeCents,
    kitchenDisplays: validateKitchenDisplayConfiguration(value.kitchenDisplays
      ?? DEFAULT_KITCHEN_DISPLAY_CONFIGURATION),
    kitchenWorkflow: validateKitchenWorkflow(value.kitchenWorkflow ?? DEFAULT_KITCHEN_WORKFLOW),
    kitchenTasks: validateKitchenTasks(value.kitchenTasks ?? DEFAULT_KITCHEN_TASKS),
  });
}

function legacyInventoryArchive(state, businessId) {
  if (state?.schema !== LEGACY_FOOD_STATE_V3) return null;
  return {
    schema: LEGACY_INVENTORY_ARCHIVE_SCHEMA,
    businessId,
    sourceRevision: state.revision,
    archivedAt: new Date().toISOString(),
    ingredients: state.ingredients,
    movements: state.inventoryMovements,
  };
}

function migrateLocalFoodSnapshot(value) {
  if (value?.schema === LEGACY_PREVIEW_FOOD_STATE_V7) {
    const legacySettings = value.settings;
    const previewPreferences = legacySettings === null
      ? DEFAULT_PREVIEW_PREFERENCES
      : validatePreviewPreferences({ deliveryFeeCents: legacySettings?.deliveryFeeCents });
    const settings = legacySettings === null
      ? null
      : Object.fromEntries(Object.entries(legacySettings).filter(([key]) => key !== "deliveryFeeCents"));
    const state = validateFoodPizzeriaState(migrateFoodPizzeriaState({
      ...value,
      schema: "ordax.food-pizzeria-state/6",
      settings,
    }));
    return { state, previewPreferences };
  }
  return {
    state: validateFoodPizzeriaState(migrateFoodPizzeriaState(value)),
    previewPreferences: DEFAULT_PREVIEW_PREFERENCES,
  };
}

function decodeStoredValue(raw, businessId) {
  if (serializedBytes(raw) > MAX_STATE_BYTES) throw new RangeError("Os dados locais da pizzaria excedem o limite seguro.");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Os dados locais da pizzaria estão corrompidos e foram preservados.", { cause: error });
  }

  if (parsed?.schema === STORAGE_SCHEMA) {
    const migrated = migrateLocalFoodSnapshot(parsed.state);
    return {
      state: migrated.state,
      processedCommands: validateCommandHistory(parsed.processedCommands),
      previewPreferences: parsed.previewPreferences === undefined
        ? migrated.previewPreferences
        : validatePreviewPreferences(parsed.previewPreferences),
      legacyInventoryArchive: legacyInventoryArchive(parsed.state, businessId),
    };
  }

  if ([PREVIOUS_STORAGE_SCHEMA, PREVIOUS_PREVIEW_STORAGE_SCHEMA].includes(parsed?.schema)) {
    const migrated = migrateLocalFoodSnapshot(parsed.state);
    return {
      state: migrated.state,
      processedCommands: validateCommandHistory(parsed.processedCommands),
      previewPreferences: parsed.previewPreferences === undefined
        ? migrated.previewPreferences
        : validatePreviewPreferences(parsed.previewPreferences),
      legacyInventoryArchive: legacyInventoryArchive(parsed.state, businessId),
    };
  }

  if (parsed?.schema === LEGACY_ENVELOPE_SCHEMA) {
    const migrated = migrateLocalFoodSnapshot(parsed.state);
    return {
      state: migrated.state,
      processedCommands: validateCommandHistory(parsed.processedCommands),
      previewPreferences: migrated.previewPreferences,
      legacyInventoryArchive: legacyInventoryArchive(parsed.state, businessId),
    };
  }

  if (parsed?.schema === LEGACY_STORAGE_SCHEMA) {
    if (!Array.isArray(parsed.processedCommandIds)
      || parsed.processedCommandIds.length > MAX_RECORDED_COMMANDS
      || parsed.processedCommandIds.some((id) => typeof id !== "string" || !COMMAND_ID_RE.test(id))) {
      throw new TypeError("O registro legado de operações da pizzaria está inválido.");
    }
    const migrated = migrateLocalFoodSnapshot(parsed.state);
    return {
      state: migrated.state,
      // Legacy ids have no command fingerprints; refuse ambiguous replay rather than assume equivalence.
      processedCommands: validateCommandHistory([...new Set(parsed.processedCommandIds)]
        .map((id) => ({ id, digest: null }))),
      previewPreferences: migrated.previewPreferences,
      legacyInventoryArchive: legacyInventoryArchive(parsed.state, businessId),
    };
  }

  // Accept the previous raw local-state shape once, then write the versioned envelope.
  const migrated = migrateLocalFoodSnapshot(parsed);
  return {
    state: migrated.state,
    processedCommands: [],
    previewPreferences: migrated.previewPreferences,
    legacyInventoryArchive: legacyInventoryArchive(parsed, businessId),
  };
}

function refreshExpiredUntouchedPreviewActivity(state, nowValue) {
  const now = nowValue instanceof Date ? nowValue.getTime() : Number(nowValue);
  if (!Number.isFinite(now)) throw new TypeError("O relógio local da prévia Food está inválido.");

  const candidates = new Map();
  for (const order of state.orders) {
    const match = /^ng-order-(10(?:4[7-9]|5[0-8]))$/.exec(order.id);
    if (!match) continue;
    const orderNumber = Number(match[1]);
    const ageMinutes = PREVIEW_SEED_ORDER_AGES_MINUTES[orderNumber - 1047];
    const latestAt = Date.parse(order.updatedAt);
    const seedHistoryPrefix = `ng-history-${orderNumber}-`;
    if (!Number.isFinite(ageMinutes) || !Number.isFinite(latestAt)
      || order.statusHistory.some(({ id }) => !id.startsWith(seedHistoryPrefix))) continue;

    const targetCreatedAt = now - ageMinutes * 60000;
    candidates.set(order.id, {
      delta: targetCreatedAt - Date.parse(order.createdAt),
      latestAt,
      targetCreatedAt,
      tableCommandId: order.tableCommandId,
    });
  }

  if (candidates.size === 0) return state;
  const oldestUntouchedActivityAt = Math.min(...[...candidates.values()].map(({ latestAt }) => latestAt));
  if (now - oldestUntouchedActivityAt <= PREVIEW_ACTIVITY_REFRESH_AFTER_MS) return state;

  const eligibleOrderIds = new Set(candidates.keys());
  const tableCommandTargets = new Map();
  for (const order of state.orders) {
    const candidate = candidates.get(order.id);
    if (!candidate?.tableCommandId) continue;

    const command = state.tableCommands.find(({ id }) => id === candidate.tableCommandId);
    const linkedOrders = state.orders.filter(({ tableCommandId }) => tableCommandId === candidate.tableCommandId);
    const openingAge = PREVIEW_SEED_TABLE_OPENING_AGES_MINUTES[candidate.tableCommandId];
    if (!command || command.closedAt !== null || !Number.isFinite(openingAge)
      || linkedOrders.length !== 1 || !eligibleOrderIds.has(order.id)) {
      eligibleOrderIds.delete(order.id);
      continue;
    }
    tableCommandTargets.set(command.id, now - openingAge * 60000);
  }

  if (eligibleOrderIds.size === 0) return state;
  const orders = state.orders.map((order) => {
    if (!eligibleOrderIds.has(order.id)) return order;
    const candidate = candidates.get(order.id);
    const shift = (value) => new Date(Date.parse(value) + candidate.delta).toISOString();
    return {
      ...order,
      createdAt: new Date(candidate.targetCreatedAt).toISOString(),
      updatedAt: shift(order.updatedAt),
      statusHistory: order.statusHistory.map((entry) => ({ ...entry, changedAt: shift(entry.changedAt) })),
    };
  });
  const tableCommands = state.tableCommands.map((command) => {
    const openedAt = tableCommandTargets.get(command.id);
    return openedAt === undefined ? command : { ...command, openedAt: new Date(openedAt).toISOString() };
  });
  return validateFoodPizzeriaState({ ...state, revision: state.revision + 1, orders, tableCommands });
}

function conflictError(expectedRevision, actualRevision) {
  const error = new Error("A pizzaria foi atualizada em outra aba. Confira os dados e tente novamente.");
  error.name = "FoodRevisionConflictError";
  error.expectedRevision = expectedRevision;
  error.actualRevision = actualRevision;
  return error;
}

export function createBrowserLocalFoodStore({
  businessId = "preview-na-garagem",
  storage = globalThis.localStorage,
  locks = globalThis.navigator?.locks,
  eventTarget = globalThis,
  clock = () => new Date(),
} = {}) {
  if (typeof businessId !== "string" || !BUSINESS_ID_RE.test(businessId)) {
    throw new TypeError("Identificador local do negócio inválido.");
  }
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new Error("Armazenamento local durável indisponível neste navegador.");
  }
  if (!locks || typeof locks.request !== "function") {
    throw new Error("Este navegador não oferece bloqueio de gravação local. Atualize o navegador para continuar.");
  }

  const key = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  const legacyArchiveKey = `${key}.legacy-inventory-v3`;
  const lock = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  const context = Object.freeze({ businessId, adapter: "browser-local-preview" });
  let snapshot = null;
  let processedCommands = [];
  let previewPreferences = DEFAULT_PREVIEW_PREFERENCES;
  let initialized = false;
  let destroyed = false;
  let initializing = null;
  const listeners = new Set();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  function readPersisted() {
    const raw = storage.getItem(key);
    if (raw !== null) return decodeStoredValue(raw, businessId);
    if (businessId === "preview-na-garagem") {
      const legacy = storage.getItem(LEGACY_KEY);
      if (legacy !== null) return decodeStoredValue(legacy, businessId);
    }
    return null;
  }

  function archiveLegacyInventory(archive) {
    if (!archive || storage.getItem(legacyArchiveKey) !== null) return;
    const serialized = JSON.stringify(archive);
    if (serializedBytes(serialized) > MAX_STATE_BYTES) {
      throw new RangeError("O arquivo local do estoque antigo excede o limite seguro; os dados originais foram preservados.");
    }
    storage.setItem(legacyArchiveKey, serialized);
  }

  function writePersisted(state, commands, preferences) {
    if (commands.length > MAX_RECORDED_COMMANDS) {
      throw new RangeError("O histórico local de operações atingiu o limite seguro. Preserve os dados antes de continuar.");
    }
    const serialized = JSON.stringify({
      schema: STORAGE_SCHEMA,
      state,
      processedCommands: commands,
      previewPreferences: preferences,
    });
    if (serializedBytes(serialized) > MAX_STATE_BYTES) throw new RangeError("Os dados locais da pizzaria excedem o limite seguro.");
    storage.setItem(key, serialized);
  }

  function reconcilePreviewPreferences(preferences, state) {
    const kitchenTasks = reconcileKitchenTasks(
      preferences.kitchenTasks ?? DEFAULT_KITCHEN_TASKS,
      state.orders,
      preferences.kitchenWorkflow ?? DEFAULT_KITCHEN_WORKFLOW,
    );
    if (JSON.stringify(kitchenTasks) === JSON.stringify(preferences.kitchenTasks)) return preferences;
    return validatePreviewPreferences({ ...preferences, kitchenTasks });
  }

  const onStorage = (event) => {
    if (!initialized || destroyed || event.key !== key || event.newValue === null) return;
    try {
      // A queued storage event can carry stale bytes after newer commits.
      // Always read the currently persisted envelope, including no-op command history.
      const next = readPersisted();
      if (!next || next.state.revision < snapshot.revision) return;
      if (next.state.revision === snapshot.revision && JSON.stringify(next.state) !== JSON.stringify(snapshot)) {
        throw new Error("A mesma revisão local apresenta dados diferentes.");
      }
      snapshot = next.state;
      processedCommands = next.processedCommands;
      previewPreferences = next.previewPreferences;
      emit();
    } catch {
      // Keep the last verified state visible; never replace corrupt bytes.
    }
  };
  eventTarget?.addEventListener?.("storage", onStorage);

  return Object.freeze({
    schema: FOOD_DATA_PORT_SCHEMA,
    context,
    async initialize() {
      if (destroyed) throw new Error("A sessão da pizzaria foi encerrada.");
      if (initialized) return snapshot;
      if (initializing) return initializing;
      initializing = locks.request(lock, { mode: "exclusive" }, async () => {
        if (destroyed) throw new Error("A sessão da pizzaria foi encerrada.");
        const now = clock();
        const persisted = readPersisted();
        if (persisted) {
          archiveLegacyInventory(persisted.legacyInventoryArchive);
          snapshot = refreshExpiredUntouchedPreviewActivity(persisted.state, now);
          processedCommands = persisted.processedCommands;
          previewPreferences = reconcilePreviewPreferences(persisted.previewPreferences, snapshot);
        } else {
          snapshot = validateFoodPizzeriaState(createSeedFoodState(now));
          processedCommands = [];
          previewPreferences = reconcilePreviewPreferences(DEFAULT_PREVIEW_PREFERENCES, snapshot);
        }
        // Persist the seed or migrated value under the same lock so every tab starts from one revision.
        writePersisted(snapshot, processedCommands, previewPreferences);
        initialized = true;
        return snapshot;
      }).finally(() => {
        initializing = null;
      });
      return initializing;
    },
    getSnapshot() {
      if (destroyed) throw new Error("A sessão da pizzaria foi encerrada.");
      if (!initialized) throw new Error("A interface de dados da pizzaria ainda não foi inicializada.");
      return snapshot;
    },
    getPreviewPreferences() {
      if (destroyed) throw new Error("A sessão da pizzaria foi encerrada.");
      if (!initialized) throw new Error("As preferências locais ainda não foram inicializadas.");
      return previewPreferences;
    },
    async updatePreviewPreferences(value) {
      if (destroyed || !initialized) throw new Error("A interface de dados da pizzaria não está pronta.");
      return locks.request(lock, { mode: "exclusive" }, async () => {
        if (destroyed) throw new Error("A sessão da pizzaria foi encerrada.");
        const persisted = readPersisted();
        if (!persisted) throw new Error("O estado local da pizzaria desapareceu durante a operação.");
        const nextPreferences = reconcilePreviewPreferences(validatePreviewPreferences(value), persisted.state);
        if (JSON.stringify(persisted.previewPreferences) === JSON.stringify(nextPreferences)) {
          snapshot = persisted.state;
          processedCommands = persisted.processedCommands;
          previewPreferences = persisted.previewPreferences;
          emit();
          return previewPreferences;
        }
        writePersisted(persisted.state, persisted.processedCommands, nextPreferences);
        snapshot = persisted.state;
        processedCommands = persisted.processedCommands;
        previewPreferences = nextPreferences;
        emit();
        return previewPreferences;
      });
    },
    subscribe(listener) {
      if (destroyed || !initialized || typeof listener !== "function") {
        throw new TypeError("Inscrição de atualização inválida.");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async execute(commandValue) {
      if (destroyed || !initialized) throw new Error("A interface de dados da pizzaria não está pronta.");
      const command = createFoodCommand(commandValue);
      const commandDigest = await fingerprintFoodCommand(command);
      return locks.request(lock, { mode: "exclusive" }, async () => {
        if (destroyed) throw new Error("A sessão da pizzaria foi encerrada.");
        const persisted = readPersisted();
        if (!persisted) throw new Error("O estado local da pizzaria desapareceu durante a operação.");
        const previous = persisted.processedCommands.find(({ id }) => id === command.commandId);
        if (previous) {
          if (previous.digest !== commandDigest) {
            throw new Error("Identificador de operação reutilizado com conteúdo diferente ou legado não verificável.");
          }
          snapshot = persisted.state;
          processedCommands = persisted.processedCommands;
          previewPreferences = persisted.previewPreferences;
          emit();
          return snapshot;
        }
        if (command.expectedRevision !== persisted.state.revision) {
          snapshot = persisted.state;
          processedCommands = persisted.processedCommands;
          previewPreferences = persisted.previewPreferences;
          emit();
          throw conflictError(command.expectedRevision, persisted.state.revision);
        }
        // Never discard an idempotency key: an evicted no-op at the current
        // revision could otherwise be replayed with a different payload.
        if (persisted.processedCommands.length >= MAX_RECORDED_COMMANDS) {
          throw new RangeError("O histórico local de operações atingiu o limite seguro. Preserve os dados antes de continuar.");
        }
        const next = validateFoodPizzeriaState(applyFoodCommand(persisted.state, command));
        const noChange = next.revision === persisted.state.revision;
        if (noChange
          ? JSON.stringify(next) !== JSON.stringify(persisted.state)
          : next.revision !== persisted.state.revision + 1) {
          throw new Error("A operação produziu dados sem revisão válida da pizzaria.");
        }
        const nextCommands = [...persisted.processedCommands, { id: command.commandId, digest: commandDigest }];
        const nextPreferences = reconcilePreviewPreferences(persisted.previewPreferences, next);
        writePersisted(next, nextCommands, nextPreferences);
        snapshot = next;
        processedCommands = nextCommands;
        previewPreferences = nextPreferences;
        emit();
        return snapshot;
      });
    },
    async recordKitchenTaskAction(inputValue = {}) {
      if (destroyed || !initialized) throw new Error("A interface de dados da pizzaria não está pronta.");
      const { action, orderId, stepId, screenNumber, at, commandId } = inputValue;
      if (typeof globalThis.crypto?.subtle?.digest !== "function") {
        throw new Error("WebCrypto SHA-256 é obrigatório para registrar uma ação da cozinha.");
      }
      const actionPayload = { action, orderId, stepId, screenNumber, at, commandId };
      const digestBytes = await globalThis.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(actionPayload)),
      );
      const digest = [...new Uint8Array(digestBytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      return locks.request(lock, { mode: "exclusive" }, async () => {
        if (destroyed) throw new Error("A sessão da pizzaria foi encerrada.");
        const persisted = readPersisted();
        if (!persisted) throw new Error("O estado local da pizzaria desapareceu durante a operação.");
        const previous = persisted.previewPreferences.kitchenTasks.commands.find(({ id }) => id === commandId);
        if (previous) {
          if (previous.digest !== digest) throw new Error("Identificador de ação reutilizado com outro conteúdo.");
          snapshot = persisted.state;
          processedCommands = persisted.processedCommands;
          previewPreferences = persisted.previewPreferences;
          emit();
          return snapshot;
        }

        const currentPreferences = reconcilePreviewPreferences(persisted.previewPreferences, persisted.state);
        const currentTasks = currentPreferences.kitchenTasks;
        const ticket = currentTasks.tickets.find(({ orderId: id }) => id === orderId);
        if (!ticket) throw new Error("O pedido não possui uma sequência de produção.");
        const currentStep = currentKitchenStep(ticket);
        if (!currentStep || currentStep.id !== stepId) throw new Error("A etapa deste pedido já mudou. Atualize a fila.");
        let nextTasks = applyKitchenTaskAction(currentTasks, {
          action, orderId, stepId, screenNumber, at, commandId, digest,
          queueMode: currentPreferences.kitchenWorkflow.queueMode,
        });
        let nextState = persisted.state;
        let nextCommands = persisted.processedCommands;
        const order = nextState.orders.find(({ id }) => id === orderId);
        const isFirstStep = ticket.steps[0].id === currentStep.id;
        const isLastStep = ticket.steps.at(-1).id === currentStep.id;
        const nextStatus = action === "start" && isFirstStep && order.status === "received"
          ? "preparing"
          : action === "complete" && isLastStep && order.status === "preparing"
            ? "ready"
            : null;
        if (nextStatus) {
          if (nextCommands.length >= MAX_RECORDED_COMMANDS) {
            throw new RangeError("O histórico local de operações atingiu o limite seguro. Preserve os dados antes de continuar.");
          }
          const transition = createFoodCommand({
            type: "order.transition",
            payload: {
              orderId,
              nextStatus,
              historyId: `${commandId}-history`,
              changedAt: at,
            },
            expectedRevision: nextState.revision,
            commandId: `${commandId}-food`,
            issuedAt: at,
          });
          const transitionDigest = await fingerprintFoodCommand(transition);
          nextState = validateFoodPizzeriaState(applyFoodCommand(nextState, transition));
          nextCommands = [...nextCommands, { id: transition.commandId, digest: transitionDigest }];
          nextTasks = reconcileKitchenTasks(nextTasks, nextState.orders, currentPreferences.kitchenWorkflow);
        }
        const nextPreferences = validatePreviewPreferences({ ...currentPreferences, kitchenTasks: nextTasks });
        writePersisted(nextState, nextCommands, nextPreferences);
        snapshot = nextState;
        processedCommands = nextCommands;
        previewPreferences = nextPreferences;
        emit();
        return snapshot;
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      eventTarget?.removeEventListener?.("storage", onStorage);
    },
  });
}
