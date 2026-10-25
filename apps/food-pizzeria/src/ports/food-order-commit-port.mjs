import { createFoodCommand } from "../application/commands.mjs";
import { ORDER_STATUSES } from "../domain/domain.mjs";

// Consumer-side boundary for a FUTURE Food-owned, host-authorized transaction port.
// It deliberately contains no persistence, no locally minted grant and no fallback
// to the preview store or the generic Sales order book.
export const FOOD_ORDER_COMMIT_PORT_SCHEMA = "ordax.food-order-commit-port/1";
export const FOOD_ORDER_COMMIT_RECEIPT_SCHEMA = "ordax.food-order-commit-receipt/1";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ALLOWED_COMMANDS = new Set(["order.create", "order.transition"]);
const STATUSES = new Set(ORDER_STATUSES);

function id(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new TypeError(`${label} deve ser um identificador válido.`);
  }
  return value;
}

function object(value, label, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new TypeError(`${label} contém campos ausentes ou não previstos.`);
  }
  return value;
}

function binding(value) {
  const raw = object(value, "Vínculo do Food ao host", ["spaceId", "subjectId", "epoch"]);
  return Object.freeze({
    spaceId: id(raw.spaceId, "Space do vínculo"),
    subjectId: id(raw.subjectId, "Identidade do vínculo"),
    epoch: id(raw.epoch, "Época do vínculo"),
  });
}

function sameBinding(left, right) {
  return left.spaceId === right.spaceId
    && left.subjectId === right.subjectId
    && left.epoch === right.epoch;
}

function expectedOrder(command) {
  if (command.type === "order.create") {
    return { orderId: id(command.payload.id, "Pedido"), status: "received" };
  }
  return {
    orderId: id(command.payload.orderId, "Pedido"),
    status: command.payload.nextStatus,
  };
}

export function assertFoodOrderCommitPort(port) {
  if (!port || typeof port !== "object" || port.schema !== FOOD_ORDER_COMMIT_PORT_SCHEMA
    || typeof port.getBinding !== "function"
    || typeof port.commitOrderCommand !== "function") {
    throw new TypeError("O port transacional Food autorizado pelo host ainda não está disponível.");
  }
  return port;
}

export class FoodOrderOutcomeUnknownError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "FoodOrderOutcomeUnknownError";
  }
}

export function validateFoodOrderCommitReceipt(value) {
  const raw = object(value, "Receipt do Food", [
    "schema", "spaceId", "commandId", "orderId", "status", "revision", "commitId",
  ]);
  if (raw.schema !== FOOD_ORDER_COMMIT_RECEIPT_SCHEMA
    || !STATUSES.has(raw.status)
    || !Number.isSafeInteger(raw.revision) || raw.revision < 1) {
    throw new TypeError("Receipt do Food contém schema, estado ou revisão inválidos.");
  }
  return Object.freeze({
    schema: FOOD_ORDER_COMMIT_RECEIPT_SCHEMA,
    spaceId: id(raw.spaceId, "Space do receipt"),
    commandId: id(raw.commandId, "Comando do receipt"),
    orderId: id(raw.orderId, "Pedido do receipt"),
    status: raw.status,
    revision: raw.revision,
    commitId: id(raw.commitId, "Confirmação durável do receipt"),
  });
}

// Only a backend Food owner may implement commitOrderCommand(). It must
// reauthorize membership/grants PER REQUEST, atomically commit with CAS and a
// durable idempotency journal, and return a genuine persisted receipt. This
// client-side comparison is a safety check, NEVER a substitute for that owner.
export async function submitFoodOrderCommand(portValue, commandValue) {
  const port = assertFoodOrderCommitPort(portValue);
  const command = createFoodCommand(commandValue);
  if (!ALLOWED_COMMANDS.has(command.type)) {
    throw new TypeError("Este port somente aceita criação/transição do pedido Food.");
  }
  const expected = expectedOrder(command);
  if (!STATUSES.has(expected.status)) {
    throw new TypeError("Estado de pedido Food desconhecido.");
  }
  const before = binding(port.getBinding());
  let rawReceipt;
  try {
    rawReceipt = await port.commitOrderCommand(command);
  } catch (error) {
    let stillBound = false;
    try {
      stillBound = sameBinding(before, binding(port.getBinding()));
    } catch { /* Binding was revoked or disappeared. */ }
    if (!stillBound) {
      throw new FoodOrderOutcomeUnknownError(
        "O vínculo de Space mudou durante o pedido; consulte o owner antes de tentar novamente.",
        { cause: error },
      );
    }
    throw error;
  }
  let after;
  try {
    after = binding(port.getBinding());
  } catch {
    throw new FoodOrderOutcomeUnknownError(
      "O vínculo de Space expirou antes da confirmação. Não repita a operação sem conciliação.",
    );
  }
  if (!sameBinding(before, after)) {
    throw new FoodOrderOutcomeUnknownError(
      "O vínculo de Space mudou durante a gravação. Confirme o pedido no owner antes de repetir.",
    );
  }
  let receipt;
  try {
    receipt = validateFoodOrderCommitReceipt(rawReceipt);
  } catch (error) {
    throw new FoodOrderOutcomeUnknownError(
      "O owner Food não devolveu uma confirmação durável verificável.", { cause: error },
    );
  }
  if (receipt.spaceId !== before.spaceId
    || receipt.commandId !== command.commandId
    || receipt.orderId !== expected.orderId
    || receipt.status !== expected.status
    || receipt.revision !== command.expectedRevision + 1) {
    throw new FoodOrderOutcomeUnknownError(
      "A confirmação retornada não corresponde ao pedido e à revisão enviados.",
    );
  }
  return receipt;
}
