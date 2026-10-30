export function renderKitchenItemLine(item, presentation, escapeHtml, { compact = false } = {}) {
  const modifiers = presentation.modifiers?.length
    ? `<div class="kitchen-item-modifiers"><span class="kitchen-item-modifier-label">${escapeHtml(presentation.modifierLabel ?? "Detalhes")}</span><ul>${presentation.modifiers.map((modifier) => `<li>${escapeHtml(modifier)}</li>`).join("")}</ul></div>`
    : "";
  return `<li class="kitchen-item-line ${compact ? "kitchen-item-line-compact" : ""}"><span class="kitchen-item-quantity">${escapeHtml(item.quantity)}×</span><div class="kitchen-item-content"><strong>${escapeHtml(presentation.title ?? "Item")}</strong>${presentation.detail ? `<span class="kitchen-item-detail">${escapeHtml(presentation.detail)}</span>` : ""}${modifiers}</div></li>`;
}

export function defaultKitchenItemPresentation(item) {
  const title = item.productName ?? item.name ?? item.title ?? "Item";
  const rawModifiers = item.modifiers ?? item.options ?? [];
  const modifiers = Array.isArray(rawModifiers)
    ? rawModifiers.map((modifier) => typeof modifier === "string" ? modifier : modifier?.name).filter(Boolean)
    : [];
  return {
    title,
    detail: item.variantLabel ?? item.variant ?? "",
    modifierLabel: modifiers.length === 1 ? "Detalhe" : "Detalhes",
    modifiers,
  };
}
