const CAPABILITY_OWNERS = Object.freeze({
  overview: Object.freeze({
    owner: "Space Experience Composition",
    text: "A Visão Geral agregada pertence ao Space Pizzaria. O Food não monta um segundo dashboard.",
  }),
  pos: Object.freeze({
    owner: "Sales + Payments",
    text: "Esta tela não registra vendas nem confirma pagamentos. Os contratos para conectar a experiência de caixa ainda não estão disponíveis aqui.",
  }),
  inventory: Object.freeze({
    owner: "Inventory",
    text: "O saldo e as movimentações pertencem ao app Inventory. O Food calcula consumo pela ficha técnica, mas não grava baixa de estoque.",
  }),
  customers: Object.freeze({
    owner: "Customers / CRM",
    text: "O Food não mantém cadastro mestre de clientes nem histórico de relacionamento.",
  }),
  reports: Object.freeze({
    owner: "Owners dos domínios reportados",
    text: "Relatórios integrados só podem combinar dados depois que os owners de pedidos, vendas, pagamentos e finanças publicarem seus contratos.",
  }),
  team: Object.freeze({
    owner: "People + Identity / Spaces",
    text: "Equipe, membros e permissões não são cadastrados pelo Food. A associação de pessoas e o acesso pertencem aos owners de People e da plataforma.",
  }),
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

export function renderSpaceCapabilityStatus(view, { labels, iconSvg } = {}) {
  const capability = CAPABILITY_OWNERS[view];
  if (!capability) return "";
  const label = labels?.[view] ?? "Área";
  return `<section class="page-section capability-pending-page">
    <div class="page-heading"><div><p class="eyebrow">SPACE PIZZARIA · ${escapeHtml(capability.owner.toLocaleUpperCase("pt-BR"))}</p><h1>${escapeHtml(label)}</h1><p>${escapeHtml(capability.text)}</p></div></div>
    <section class="panel capability-pending" role="status"><span class="capability-pending-mark" aria-hidden="true">${iconSvg?.("settings") ?? ""}</span><div><strong>Provider não conectado</strong><p>Este módulo não lê nem altera dados do serviço owner. A conexão depende de contrato público e provider autorizado.</p></div></section>
  </section>`;
}
