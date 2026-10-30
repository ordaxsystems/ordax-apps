import { applyFoodCommand, createFoodCommand } from "./commands.mjs";
import { fingerprintFoodCommand } from "./command-fingerprint.mjs";
import { FOOD_PIZZERIA_STATE_SCHEMA_V6, validateFoodPizzeriaState } from "../domain/domain.mjs";
import {
  FoodOrderOutcomeUnknownError,
  FoodOrderRejectedError,
  validateFoodOrderCommitReceipt,
} from "../ports/food-order-commit-port.mjs";

// Owner-side application service: no own database, auth table, channel gateway,
// sales ledger, Inventory movement, localStorage or network client.
//
// A transaction adapter MUST supply real atomic persistence and authorize()
// using server-side Identity/membership/grants under the SAME transaction / RLS
// scope. An app-provided binding, spaceId or subjectId is never authorization.
const ORDER_ACTIONS = new Set(["order.create", "order.transition"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const HASH = /^[0-9a-f]{64}$/;

function validId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(`${label} Food inválido.`);
  }
  return value;
}

function authorizedScope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FoodOrderRejectedError("permission-denied", "Contexto de autorização Food indisponível.");
  }
  return Object.freeze({
    spaceId: validId(value.spaceId, "Space"),
    subjectId: validId(value.subjectId, "Sujeito"),
    epoch: validId(value.epoch, "Época de sessão"),
  });
}

function isSameScope(left, right) {
  return left.spaceId === right.spaceId
    && left.subjectId === right.subjectId
    && left.epoch === right.epoch;
}

function assertTransaction(value) {
  for (const method of ["authorize", "readState", "findCommand", "commit"]) {
    if (!value || typeof value[method] !== "function") {
      throw new TypeError(`O repositório transacional do Food exige ${method}().`);
    }
  }
  return value;
}

async function reauthorize(tx, prior, action) {
  const current = authorizedScope(await tx.authorize(action));
  if (!isSameScope(prior, current)) {
    throw new FoodOrderRejectedError("permission-denied",
      "O sujeito, Space ou vínculo autorizado mudou durante o pedido.");
  }
}

function validJournal(record, expectedId, spaceId) {
  if (!record || typeof record !== "object"
    || record.commandId !== expectedId || record.spaceId !== spaceId
    || typeof record.digest !== "string" || !HASH.test(record.digest)) {
    throw new FoodOrderOutcomeUnknownError("O histórico durável do pedido está inconsistente.");
  }
  let receipt;
  try {
    receipt = validateFoodOrderCommitReceipt(record.receipt);
  } catch (cause) {
    throw new FoodOrderOutcomeUnknownError(
      "O recibo persistido no journal Food está inválido.", { cause },
    );
  }
  if (receipt.commandId !== record.commandId || receipt.spaceId !== spaceId) {
    throw new FoodOrderOutcomeUnknownError("O recibo do histórico pertence a outro comando ou Space.");
  }
  return { digest: record.digest, receipt };
}

function expectedOrder(command, state) {
  const orderId = command.type === "order.create"
    ? validId(command.payload.id, "Identificador de pedido")
    : validId(command.payload.orderId, "Identificador de pedido");
  const order = state.orders.find((entry) => entry.id === orderId);
  if (!order) throw new Error("O domínio Food não produziu o pedido esperado.");
  return { orderId, status: order.status };
}

function receiptMatches(receipt, scope, command, outcome) {
  return receipt.spaceId === scope.spaceId
    && receipt.commandId === command.commandId
    && receipt.orderId === outcome.orderId
    && receipt.status === outcome.status
    && receipt.revision === command.expectedRevision + 1;
}

export function createFoodOrderCore({ transactions } = {}) {
  if (!transactions || typeof transactions.transact !== "function") {
    throw new TypeError("Food Order Core exige repositório com transação atômica autorizada.");
  }
  return Object.freeze({
    async commitOrderCommand(input) {
      const command = createFoodCommand(input);
      if (!ORDER_ACTIONS.has(command.type)) {
        throw new FoodOrderRejectedError("invalid-command",
          "O Food Order Core não executa operações de outros domínios.");
      }
      const digest = await fingerprintFoodCommand(command);
      let commitRequested = false;
      try {
        return await transactions.transact(async (unverifiedTx) => {
          const tx = assertTransaction(unverifiedTx);
          const scope = authorizedScope(await tx.authorize(command.type));
          const recorded = await tx.findCommand(scope.spaceId, command.commandId);
          if (recorded !== null) {
            const previous = validJournal(recorded, command.commandId, scope.spaceId);
            if (previous.digest !== digest) {
              throw new FoodOrderRejectedError("invalid-command",
                "Identificador do comando Food reutilizado com outro conteúdo.");
            }
            await reauthorize(tx, scope, command.type);
            return previous.receipt;
          }

          // The transaction holds the authoritative state lock/CAS scope;
          // applying the same domain rules does not create another order master.
          const state = validateFoodPizzeriaState(await tx.readState(scope.spaceId));
          if (state.schema !== FOOD_PIZZERIA_STATE_SCHEMA_V6) {
            throw new FoodOrderRejectedError("invalid-command",
              "O owner SQL Food suporta somente o estado v6; a prévia local mais recente não pode ser enviada.");
          }
          if (state.revision !== command.expectedRevision) {
            throw new FoodOrderRejectedError("revision-conflict",
              "O pedido Food mudou: é necessário reconciliar a revisão atual.");
          }
          const next = validateFoodPizzeriaState(applyFoodCommand(state, command));
          if (next.schema !== FOOD_PIZZERIA_STATE_SCHEMA_V6) {
            throw new FoodOrderRejectedError("invalid-command",
              "A operação produziu um formato fora do contrato v6 aceito pelo owner SQL.");
          }
          if (next.revision !== state.revision + 1) {
            throw new FoodOrderRejectedError("invalid-command",
              "O comando Food não produziu uma revisão única e válida.");
          }
          const outcome = expectedOrder(command, next);
          if (command.type === "order.create" && outcome.status !== "received") {
            throw new Error("Um pedido novo deve iniciar como recebido.");
          }
          if (command.type === "order.transition"
            && outcome.status !== command.payload.nextStatus) {
            throw new Error("A transição Food não produziu o estado solicitado.");
          }

          // The storage adapter MUST recheck grants inside the same DB
          // transaction at the actual write boundary as well as here.
          await reauthorize(tx, scope, command.type);
          commitRequested = true;
          const raw = await tx.commit({
            spaceId: scope.spaceId,
            commandId: command.commandId,
            digest,
            expectedRevision: state.revision,
            nextState: next,
            orderId: outcome.orderId,
            status: outcome.status,
          });
          let receipt;
          try {
            receipt = validateFoodOrderCommitReceipt(raw);
          } catch (cause) {
            throw new FoodOrderOutcomeUnknownError(
              "A transação Food retornou confirmação inválida; concilie antes de repetir.", { cause },
            );
          }
          if (!receiptMatches(receipt, scope, command, outcome)) {
            throw new FoodOrderOutcomeUnknownError(
              "A confirmação durável do Food não corresponde ao estado gravado.");
          }
          return receipt;
        });
      } catch (error) {
        if (commitRequested && !(error instanceof FoodOrderRejectedError)
          && !(error instanceof FoodOrderOutcomeUnknownError)) {
          throw new FoodOrderOutcomeUnknownError(
            "O resultado de gravação do Food é desconhecido; concilie pelo commandId, sem retry automático.",
            { cause: error },
          );
        }
        throw error;
      }
    },

    // Read-only reconciliation of a possibly committed command. The owner
    // authorizes again; null means not found in its durable journal, not that
    // an in-flight command is safe to resend.
    async findCommandReceipt(commandId) {
      const id = validId(commandId, "Identificador do comando");
      return transactions.transact(async (unverifiedTx) => {
        const tx = assertTransaction(unverifiedTx);
        const scope = authorizedScope(await tx.authorize("order.read"));
        const entry = await tx.findCommand(scope.spaceId, id);
        await reauthorize(tx, scope, "order.read");
        return entry === null ? null : validJournal(entry, id, scope.spaceId).receipt;
      });
    },
  });
}
