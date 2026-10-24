import { applyFoodCommand, createFoodCommand } from "../application/commands.mjs";
import {
  migrateFoodPizzeriaState,
  validateFoodPizzeriaState,
} from "../domain/domain.mjs";
import { createSeedFoodState } from "../fixtures/mock-data.mjs";
import { FOOD_DATA_PORT_SCHEMA } from "../ports/food-data-port.mjs";

const STORAGE_SCHEMA = "ordax.food-pizzeria.browser-state/2";
const LEGACY_STORAGE_SCHEMA = "ordax.food-pizzeria.browser-state/1";
const COMMAND_DIGEST_RE = /^[a-f0-9]{64}$/;
const LEGACY_INVENTORY_ARCHIVE_SCHEMA = "ordax.food-pizzeria.preview-legacy-inventory/1";
const LEGACY_FOOD_STATE_V3 = "ordax.food-pizzeria-state/3";
const BUSINESS_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const COMMAND_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
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

async function fingerprintCommand(command) {
  const digest = globalThis.crypto?.subtle?.digest;
  if (typeof digest !== "function") {
    throw new Error("WebCrypto seguro é obrigatório para gravar operações locais da prévia.");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(command));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, "0")).join("");
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

function decodeStoredValue(raw, businessId) {
  if (serializedBytes(raw) > MAX_STATE_BYTES) throw new RangeError("Os dados locais da pizzaria excedem o limite seguro.");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Os dados locais da pizzaria estão corrompidos e foram preservados.", { cause: error });
  }

  if (parsed?.schema === STORAGE_SCHEMA) {
    return {
      state: validateFoodPizzeriaState(migrateFoodPizzeriaState(parsed.state)),
      processedCommands: validateCommandHistory(parsed.processedCommands),
      legacyInventoryArchive: legacyInventoryArchive(parsed.state, businessId),
    };
  }

  if (parsed?.schema === LEGACY_STORAGE_SCHEMA) {
    if (!Array.isArray(parsed.processedCommandIds)
      || parsed.processedCommandIds.length > MAX_RECORDED_COMMANDS
      || parsed.processedCommandIds.some((id) => typeof id !== "string" || !COMMAND_ID_RE.test(id))) {
      throw new TypeError("O registro legado de operações da pizzaria está inválido.");
    }
    return {
      state: validateFoodPizzeriaState(migrateFoodPizzeriaState(parsed.state)),
      // Legacy ids have no command fingerprints; refuse ambiguous replay rather than assume equivalence.
      processedCommands: validateCommandHistory([...new Set(parsed.processedCommandIds)]
        .map((id) => ({ id, digest: null }))),
      legacyInventoryArchive: legacyInventoryArchive(parsed.state, businessId),
    };
  }

  // Accept the previous raw local-state shape once, then write the versioned envelope.
  return {
    state: validateFoodPizzeriaState(migrateFoodPizzeriaState(parsed)),
    processedCommands: [],
    legacyInventoryArchive: legacyInventoryArchive(parsed, businessId),
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
  const legacyArchiveKey = `${key}.legacy-inventory-v3`;
  const lock = `ordax.food-pizzeria.browser-state.v1.${encodeURIComponent(businessId)}`;
  const context = Object.freeze({ businessId, adapter: "browser-local-preview" });
  let snapshot = null;
  let processedCommands = [];
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

  function writePersisted(state, commands) {
    const serialized = JSON.stringify({
      schema: STORAGE_SCHEMA,
      state,
      processedCommands: commands.slice(-MAX_RECORDED_COMMANDS),
    });
    if (serializedBytes(serialized) > MAX_STATE_BYTES) throw new RangeError("Os dados locais da pizzaria excedem o limite seguro.");
    storage.setItem(key, serialized);
  }

  const onStorage = (event) => {
    if (!initialized || destroyed || event.key !== key || event.newValue === null) return;
    try {
      const next = decodeStoredValue(event.newValue, businessId);
      if (next.state.revision < snapshot.revision) return;
      if (next.state.revision === snapshot.revision && JSON.stringify(next.state) !== JSON.stringify(snapshot)) {
        throw new Error("A mesma revisão local apresenta dados diferentes.");
      }
      snapshot = next.state;
      processedCommands = next.processedCommands;
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
          archiveLegacyInventory(persisted.legacyInventoryArchive);
          snapshot = persisted.state;
          processedCommands = persisted.processedCommands;
        } else {
          snapshot = validateFoodPizzeriaState(createSeedFoodState());
          processedCommands = [];
        }
        // Persist the seed or migrated value under the same lock so every tab starts from one revision.
        writePersisted(snapshot, processedCommands);
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
      const commandDigest = await fingerprintCommand(command);
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
          emit();
          return snapshot;
        }
        if (command.expectedRevision !== persisted.state.revision) {
          snapshot = persisted.state;
          processedCommands = persisted.processedCommands;
          emit();
          throw conflictError(command.expectedRevision, persisted.state.revision);
        }
        const next = validateFoodPizzeriaState(applyFoodCommand(persisted.state, command));
        if (next.revision !== persisted.state.revision + 1) {
          throw new Error("A operação não produziu uma revisão consecutiva da pizzaria.");
        }
        const nextCommands = [...persisted.processedCommands, { id: command.commandId, digest: commandDigest }]
          .slice(-MAX_RECORDED_COMMANDS);
        writePersisted(next, nextCommands);
        snapshot = next;
        processedCommands = nextCommands;
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
