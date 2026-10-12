export const operationLabels = { prepared: 'Preparando', submitting: 'Enviando', queued: 'Na fila', running: 'Executando', succeeded: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado', uncertain: 'Envio sem confirmação', 'not-sent': 'Não enviado', reviewed: 'Revisado' };
export const operationPending = operation => ['prepared','submitting','queued','running'].includes(operation.status);
export const operationBlocking = operation => operationPending(operation) || operation.status === 'uncertain';

// This is a view of host receipts, not another queue or an execution authority.
export function visibleOperations(operations, binding, all = false) {
  return [...operations].reverse().filter(operation => all || operationBlocking(operation) ||
    (operation.deviceId === binding.deviceId && ((operation.project ?? null) === (binding.project || null) ||
      (['projectCreate','projectImport'].includes(operation.kind) && operation.slug === binding.project))));
}
export function operationReceipt(operation) {
  return JSON.stringify({ schemaVersion: 1, source: 'ORDAX Studio / Product REST', localId: operation.id, requestId: operation.requestId ?? null,
    kind: operation.kind, deviceId: operation.deviceId, project: operation.project ?? null, status: operation.status,
    createdAt: operation.createdAt, finishedAt: operation.finishedAt ?? null }, null, 2);
}
