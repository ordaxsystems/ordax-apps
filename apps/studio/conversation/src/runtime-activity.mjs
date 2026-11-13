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
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
  const result = operation?.result?.data ?? operation?.result;
  const expectedSha256 = digest(operation?.expectedSha256);
  const proposedSha256 = digest(operation?.proposedSha256);
  const resultSha256 = digest(result?.sha256);
  return JSON.stringify({ schemaVersion: 1, source: 'ORDAX Studio / Product REST', localId: operation.id, requestId: operation.requestId ?? null,
    kind: operation.kind, deviceId: operation.deviceId, project: operation.project ?? null, status: operation.status,
    createdAt: operation.createdAt, finishedAt: operation.finishedAt ?? null,
    ...(operation.kind === 'write' && (expectedSha256 || proposedSha256 || resultSha256) ? {
      contentDigests: {
        expectedSha256,
        proposedSha256,
        resultSha256,
      },
    } : {}),
  }, null, 2);
}
