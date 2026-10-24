import { applyFoodCommand, createFoodCommand } from "../application/commands.mjs";
import {
  migrateFoodPizzeriaState,
  validateFoodPizzeriaState,
} from "../domain/domain.mjs";
import { createSeedFoodState } from "../fixtures/mock-data.mjs";
import { FOOD_DATA_PORT_SCHEMA } from "../ports/food-data-port.mjs";

const STORAGE_SCHEMA = "ordax.food-pizzeria.browser-state/1";
const BUSINESS_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const MAX_STATE_BYTES = 5 * 1024 * 1024;
const MAX_RECORDED_COMMANDS = 1000;
const LEGACY_KEY = [
  "ordax.food-pizzeria.development.v2",
  encodeURIComponent("local-demo-owner"),
  encodeURIComponent("local-demo-pizzeria"),
].join(".");

function serializedBytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function decodeStoredValue(raw) {
  if (serializedBytes(raw) > MAX_STATE_BYTES) throw new RangeError("Os dados locais da pizzaria excedem o limite seguro.");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Os dados locais da pizzaria estão corrompidos e foram preservados.", { cause: error });
  }

  if (parsed?.schema === STORAGE_SCHEMA) {
    if (!Array.isArray(parsed.processedCommandIds)
      || parsed.processedCommandIds.length > MAX_RECORDED_COMMANDS
      || parsed.processedCommandIds.some((id) => typeof id !== "string")) {
      throw new TypeError("O registro de operações locais da pizzaria está inválido.");
    }
    return {
      state: validateFoodPizzeriaState(migrateFoodPizzeriaState(parsed.state)),
      processedCommandIds: [...new Set(parsed.processedCommandIds)],
    };
  }

  // Accept the previous local-state shape once, then write the versioned envelope.
  return {
    state: validateFoodPizzeriaState(migrateFoodPizzeriaState(parsed)),
    processedCommandIds: [],
  };
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
  const lock = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  const context = Object.freeze({ businessId, adapter: "browser-local-preview" });
  let snapshot = null;
  let processedCommandIds = [];
  let initialized = false;
  let destroyed = false;
  let initializing = null;
  const listeners = new Set();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  function readPersisted() {
    const raw = storage.getItem(key);
    if (raw !== null) return decodeStoredValue(raw);
    if (businessId === "preview-na-garagem") {
      const legacy = storage.getItem(LEGACY_KEY);
      if (legacy !== null) return decodeStoredValue(legacy);
    }
    return null;
  }

  function writePersisted(state, commandIds) {
    const serialized = JSON.stringify({
      schema: STORAGE_SCHEMA,
      state,
      processedCommandIds: commandIds.slice(-MAX_RECORDED_COMMANDS),
    });
    if (serializedBytes(serialized) > MAX_STATE_BYTES) throw new RangeError("Os dados locais da pizzaria excedem o limite seguro.");
    storage.setItem(key, serialized);
  }

  const onStorage = (event) => {
    if (!initialized || destroyed || event.key !== key || event.newValue === null) return;
    try {
      const next = decodeStoredValue(event.newValue);
      if (next.state.revision < snapshot.revision) return;
      if (next.state.revision === snapshot.revision && JSON.stringify(next.state) !== JSON.stringify(snapshot)) {
        throw new Error("A mesma revisão local apresenta dados diferentes.");
      }
      snapshot = next.state;
      processedCommandIds = next.processedCommandIds;
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
        const persisted = readPersisted();
        if (persisted) {
          snapshot = persisted.state;
          processedCommandIds = persisted.processedCommandIds;
        } else {
          snapshot = validateFoodPizzeriaState(createSeedFoodState());
          processedCommandIds = [];
        }
        // Persist the seed or migrated value under the same lock so every tab starts from one revision.
        writePersisted(snapshot, processedCommandIds);
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
      return locks.request(lock, { mode: "exclusive" }, async () => {
        if (destroyed) throw new Error("A sessão da pizzaria foi encerrada.");
        const persisted = readPersisted();
        if (!persisted) throw new Error("O estado local da pizzaria desapareceu durante a operação.");
        if (persisted.processedCommandIds.includes(command.commandId)) {
          snapshot = persisted.state;
          processedCommandIds = persisted.processedCommandIds;
          emit();
          return snapshot;
        }
        if (command.expectedRevision !== persisted.state.revision) {
          snapshot = persisted.state;
          processedCommandIds = persisted.processedCommandIds;
          emit();
          throw conflictError(command.expectedRevision, persisted.state.revision);
        }
        const next = validateFoodPizzeriaState(applyFoodCommand(persisted.state, command));
        if (next.revision !== persisted.state.revision + 1) {
          throw new Error("A operação não produziu uma revisão consecutiva da pizzaria.");
        }
        const nextCommandIds = [...persisted.processedCommandIds, command.commandId].slice(-MAX_RECORDED_COMMANDS);
        writePersisted(next, nextCommandIds);
        snapshot = next;
        processedCommandIds = nextCommandIds;
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
