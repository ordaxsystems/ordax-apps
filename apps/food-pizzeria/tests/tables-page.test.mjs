import assert from "node:assert/strict";
import test from "node:test";
import { renderTablesPage } from "../src/ui/views/tables.mjs";

test("salão distingue encerramento operacional da confirmação de pagamento", () => {
  const html = renderTablesPage({
    PIZZERIA_TABLES: [{ id: 1, seats: 2 }],
    snapshot: { tableCommands: [], orders: [] },
    activeCommandForTable: () => null,
    tableCard: () => `<article class="table-card table-free">Mesa livre</article>`,
    sectionHeader: (_eyebrow, title, description, action) => `<header><h1>${title}</h1><p>${description}</p>${action}</header>`,
    statCard: (label) => `<div>${label}</div>`,
    button: (label) => `<button>${label}</button>`,
  });

  assert.match(html, /consumo é calculado pelos pedidos não cancelados/);
  assert.match(html, /Encerrar libera a mesa/);
  assert.match(html, /não registra nem confirma pagamento/);
});
