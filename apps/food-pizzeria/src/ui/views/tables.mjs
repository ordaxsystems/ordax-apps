// Pure Food page renderer. All business state and actions are supplied by the app view model.
export function renderTablesPage(viewModel) {
  const { PIZZERIA_TABLES, snapshot, activeCommandForTable, tableCard, sectionHeader, statCard } = viewModel;
  const openCommands = snapshot.tableCommands.filter(({ closedAt }) => closedAt === null);
  const occupiedTables = openCommands.length;
  const openOrders = snapshot.orders.filter((order) => order.tableCommandId
    && openCommands.some(({ id }) => id === order.tableCommandId)
    && !["completed", "cancelled"].includes(order.status));
  const freeTables = PIZZERIA_TABLES.length - occupiedTables;
  return `<section class="page-section">${sectionHeader("SALÃO", "Mesas e Comandas", "Abra comandas, vincule pedidos da cozinha e acompanhe o consumo por mesa.", button("Abrir comanda", "open-table-command", { kind: "primary", disabled: freeTables === 0 }))}
    <div class="metrics-grid three-metrics">${statCard("Mesas ocupadas", `${occupiedTables}/${PIZZERIA_TABLES.length}`, "Ocupação agora", "tables", "orange")}${statCard("Comandas abertas", openCommands.length, "Vinculadas às mesas ocupadas", "orders", "blue")}${statCard("Pedidos em andamento", openOrders.length, "Nas comandas do salão", "kitchen", "gold")}</div>
    <section class="panel tables-panel"><div class="panel-heading"><div><p class="eyebrow">MAPA DO SALÃO</p><h2>Unidade principal</h2></div><div class="table-legend"><span><i class="legend-free"></i>Livre</span><span><i class="legend-occupied"></i>Comanda aberta</span></div></div><div class="table-map">${PIZZERIA_TABLES.map(tableCard).join("")}</div><p class="table-helper">O valor e os pedidos da mesa são calculados a partir do histórico compartilhado. Para encerrar, todos os pedidos precisam estar concluídos ou cancelados.</p></section>
  </section>`;
}
