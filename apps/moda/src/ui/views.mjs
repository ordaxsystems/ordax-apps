import {
  MODA_CATEGORIES, dateLabel, deriveOverview, deriveReport, money, number, productForSku, searchMatches,
  returnableQuantity, saleCustomerId, stockForSku, customerMetrics,
} from "../domain/derived.mjs";
import { defaultEaseForKind, estimateStretchToleranceCm, evaluateGarmentFit, fitDimensionsForKind, FIT_ESTIMATE_POLICY } from "../domain/fit-engine.mjs";
import { buildTryOnBrief } from "../domain/fit-brief.mjs";

const ART = Object.freeze({
  shirt: '<path d="M32 29 46 19l10 6 10-6 14 10-8 11-7-5v38H39V35l-7 5-7-11Z"/><path d="m46 19 4 11 6 6 6-6 4-11M50 30v11"/>',
  dress: '<path d="M45 20h14l4 13-7 8 16 31H32l16-31-7-8 4-13Z"/><path d="M45 20c0 9 14 9 14 0M48 41h8"/>',
  trousers: '<path d="M36 20h36l-4 52H53l-2-27-2 27H35l-4-52Z"/><path d="M31 32h40M51 31v14"/>',
  bag: '<path d="M30 38h40l-4 34H34l-4-34Z"/><path d="M40 39c0-18 20-18 20 0M38 47h24"/>',
  shoe: '<path d="M29 58c9-1 15-9 19-26l9 3c3 12 9 18 17 21l2 12H29v-10Z"/><path d="m49 39 7 2M46 47l10 3M38 58h35"/>',
  flat: '<path d="M29 56c10 0 16-8 22-25l9 3c2 10 8 16 16 19l4 9c-17 6-37 7-52 1l1-7Z"/><path d="m49 40 7 3M43 48l11 4"/>',
  jewelry: '<circle cx="52" cy="52" r="20"/><path d="M39 24 52 18l13 6-13 8-13-8ZM43 52l9 10 9-10-9-10-9 10Z"/><circle cx="52" cy="52" r="5"/>',
});
const SWATCH_CLASSES = Object.freeze({
  "#cfbda2": "swatch-sand", "#69705a": "swatch-olive", "#813f4d": "swatch-wine",
  "#bd8e91": "swatch-rose", "#343334": "swatch-black", "#d8cbb5": "swatch-oat",
  "#aa7049": "swatch-caramel", "#373333": "swatch-black", "#e9e3d7": "swatch-ivory",
  "#85917d": "swatch-sage", "#803d4b": "swatch-wine", "#a8a9a7": "swatch-silver",
  "#bd9862": "swatch-gold", "#b78572": "swatch-clay",
});
const PRODUCT_TONES = new Set(["rose", "linen", "sand", "leather", "canvas", "wine", "gold"]);

function countLabel(value, singular, plural) {
  const count = Number(value) || 0;
  return number(count) + " " + (count === 1 ? singular : plural);
}

function swatchClass(hex) {
  return SWATCH_CLASSES[String(hex ?? "").toLowerCase()] ?? "swatch-clay";
}

function barHeightClass(value) {
  const height = Math.max(5, Math.min(100, Math.round(value / 5) * 5));
  return "bar-height-" + height;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

export function icon(name) {
  const paths = {
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    bag: '<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
    hanger: '<path d="M12 4a2 2 0 0 1 2 2c0 1.5-2 2-2 3v1M4 14l8-5 8 5v2H4v-2ZM7 16v4h10v-4"/>',
    box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v9"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1.2a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5V20M16 5a3.5 3.5 0 0 1 0 6.8M18 14h.5a4 4 0 0 1 4 4V20"/>',
    return: '<path d="M4 7h11a5 5 0 0 1 0 10H8"/><path d="m8 13-4 4 4 4M20 7h-5"/>',
    chart: '<path d="M4 19V5M4 19h17M8 15l4-5 4 3 5-7"/>',
    team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1.2a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5V20M16 5a3.5 3.5 0 0 1 0 6.8M18 14h.5a4 4 0 0 1 4 4V20"/>',
    settings: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 0 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 0 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    sparkle: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12.5 4.2 4.2L19.5 6.5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  };
  return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] ?? "") + "</svg>";
}

function pageHeading(kicker, title, description, action = "") {
  return '<div class="page-heading"><div><p class="eyebrow">' + escapeHtml(kicker) + '</p><h1>' + escapeHtml(title) + '</h1><p>' + escapeHtml(description) + '</p></div>' + action + "</div>";
}

function button(label, action, kind = "quiet", extra = "") {
  return '<button class="button button-' + kind + '" type="button" data-action="' + escapeHtml(action) + '" ' + extra + ">" + label + "</button>";
}

function productArt(product, compact = false, showSource = false) {
  const shape = ART[product.kind] ?? ART.bag;
  const colorClass = "tone-" + (PRODUCT_TONES.has(product.tone) ? product.tone : "rose");
  const art = product.imageSrc
    ? '<img class="product-art-photo" src="' + escapeHtml(product.imageSrc) + '" alt="" loading="lazy">'
    : '<span class="art-orbit"></span><svg viewBox="0 0 104 104" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' + shape + "</svg>";
  const source = product.imageSrc && showSource ? '<span class="product-art-source">Referência · Wearly</span>' : "";
  return '<div class="product-art ' + colorClass + (compact ? " is-compact" : "") + (product.imageSrc ? " has-photo" : "") + '" role="img" aria-label="Referência visual do mock: ' + escapeHtml(product.name) + '">' + art + source + "</div>";
}

function variantName(state, sku) {
  const found = productForSku(state, sku);
  return found ? found.product.name + " · " + found.variant.size + " · " + found.variant.color : sku;
}

function saleItems(state, sale) {
  return sale.lines.map((line) => {
    const found = productForSku(state, line.sku);
    return (found ? found.product.name + " · " + found.variant.size + " · " + found.variant.color : line.sku) + " × " + line.quantity;
  }).join(", ");
}

function customerName(state, saleId) {
  const customerId = saleCustomerId(state, saleId);
  return state.customers.records.find((item) => item.id === customerId)?.name ?? "Venda sem cliente";
}

function sparkline(values, tone = "plum") {
  const points = values.map((value) => Number(value) || 0);
  if (points.length < 2) return "";
  const low = Math.min(...points);
  const range = Math.max(1, Math.max(...points) - low);
  const coords = points.map((value, index) => {
    const x = Math.round(index / (points.length - 1) * 112);
    const y = Math.round(34 - (value - low) / range * 27);
    return x + "," + y;
  }).join(" ");
  return '<svg class="metric-sparkline sparkline-' + tone + '" viewBox="0 0 112 40" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + coords + '"/></svg>';
}

function productEditorialArt(product, prioritize = false) {
  const shapes = {
    shirt: '<path d="m55 22 13-8 15 7 20 18-12 14-10-8 4 66H38l4-66-10 8-12-14 20-18 15-7 13 8-7 10-8 5-8-5-7-10Z"/><path d="m48 17 7 15 7 6 7-6 7-15" class="feature-detail"/>',
    dress: '<path d="M47 18h9v22l-9 9-17 65h64L77 49l-9-9V18h9l8 25 11 9-8 10-7-5 16 62H26l16-62-7 5-8-10 11-9 9-25Z"/><path d="M49 18c0 8 13 8 13 0" class="feature-detail"/>',
    trousers: '<path d="M35 18h44l-5 97H56l-3-48-4 48H29l-5-97h11Z"/><path d="M35 20h44M53 21v18" class="feature-detail"/>',
    bag: '<path d="M29 47h62l-6 69H35l-6-69Z"/><path d="M43 48c0-36 34-36 34 0" class="feature-handle"/><path d="M43 62h34" class="feature-detail"/>',
    shoe: '<path d="M22 92c17 1 27-16 34-46l15 5c5 19 15 30 32 35l5 17H22V92Z"/><path d="m55 57 12 4m-18 8 15 5m-29 18h61" class="feature-detail"/>',
    flat: '<path d="M22 88c18 0 30-14 37-43l14 5c4 16 15 27 31 32l7 14c-24 14-64 15-90 5l1-13Z"/><path d="m58 57 12 5m-18 8 15 5" class="feature-detail"/>',
    jewelry: '<path d="M34 32c0 38 14 59 31 59s31-21 31-59" class="feature-necklace"/><path d="m65 78 11 12-11 14-11-14 11-12Z"/><circle cx="65" cy="90" r="3" class="feature-gem"/>',
  };
  if (product.imageSrc) {
    return '<img class="feature-product-photo" src="' + escapeHtml(product.imageSrc) + '" alt="Referência visual do mock: ' + escapeHtml(product.name) + '" loading="' + (prioritize ? "eager" : "lazy") + '" decoding="async"' + (prioritize ? ' fetchpriority="high"' : "") + '><span class="feature-photo-note">REFERÊNCIA · WEARLY</span>';
  }
  const shape = shapes[product.kind] ?? shapes.bag;
  const colorClass = "tone-" + (PRODUCT_TONES.has(product.tone) ? product.tone : "rose");
  return '<div class="feature-art ' + colorClass + '" aria-hidden="true"><span class="feature-art-disc"></span><svg viewBox="0 0 130 130" fill="currentColor" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">' + shape + '</svg></div>';
}

function saleTime(value, now = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const label = isToday
    ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date)
    : dateLabel(date.toISOString(), true);
  return '<time datetime="' + escapeHtml(date.toISOString()) + '">' + escapeHtml(label) + "</time>";
}

function saleSummary(state, sale) {
  const first = sale.lines[0] ? productForSku(state, sale.lines[0].sku) : null;
  if (!first) return "Itens da venda";
  const extra = sale.lines.length - 1;
  return first.product.name + (extra > 0 ? " + " + extra + (extra === 1 ? " item" : " itens") : "");
}

function saleProductCell(state, sale) {
  const line = sale.lines[0];
  const found = line ? productForSku(state, line.sku) : null;
  const thumbnail = found ? productArt(found.product, true) : '<span class="sale-item-placeholder">' + icon("bag") + "</span>";
  const variant = found ? found.variant.size + " · " + found.variant.color + " · " + line.quantity + " un." : "Itens da venda";
  return '<div class="sale-item-cell">' + thumbnail + '<span class="sale-item-meta"><strong class="sale-product-summary">' + escapeHtml(saleSummary(state, sale)) + '</strong><small>' + escapeHtml(variant) + "</small></span></div>";
}

function saleStatus(state, sale) {
  const event = state.returns.items.find((item) => item.saleId === sale.id);
  if (!event) return '<span class="sale-status is-complete"><span></span>Concluída</span>';
  const label = event.type === "exchange" ? "Troca registrada" : "Devolução registrada";
  return '<span class="sale-status is-returned"><span></span>' + escapeHtml(label) + "</span>";
}

export function renderOverviewPage(state) {
  const overview = deriveOverview(state);
  const report = deriveReport(state, 7);
  const recent = overview.recentSales.slice(0, 4).map((sale) =>
    '<tr><td><strong class="order-number">#' + escapeHtml(sale.number) + '</strong></td><td>' + saleTime(sale.createdAt) + '</td><td>' + escapeHtml(customerName(state, sale.id)) + '</td><td>' + saleProductCell(state, sale) + '</td><td><strong>' + escapeHtml(money(sale.totalCents)) + '</strong></td><td>' + saleStatus(state, sale) + '</td></tr>').join("");
  const lowStock = overview.lowStock.slice(0, 3).map(({ product, variant, stock }) =>
    '<div class="attention-item">' + productArt(product, true) + '<div class="attention-product"><strong>' + escapeHtml(product.name) + '</strong><small>' + escapeHtml(variant.color) + " / " + escapeHtml(variant.size) + " · " + escapeHtml(variant.sku) + '</small></div><div class="attention-quantity"><strong class="' + (stock === 0 ? "text-danger" : "text-warning") + '">' + number(stock) + ' un.</strong><small>Estoque baixo</small></div></div>').join("");
  const photoBest = overview.best.filter((item) => item.product.active && item.product.imageSrc);
  const photoBestIds = new Set(photoBest.map((item) => item.product.id));
  const photoCatalog = state.catalog.products
    .filter((product) => product.active && product.imageSrc && !photoBestIds.has(product.id))
    .map((product) => ({ product, variant: product.variants.find((variant) => variant.active), quantity: 0 }));
  const photoFeatured = [...photoBest, ...photoCatalog].filter((item) => item.variant);
  const featured = (photoFeatured.length ? photoFeatured : overview.best.length ? overview.best : state.catalog.products
    .filter((product) => product.active)
    .map((product) => ({ product, variant: product.variants.find((variant) => variant.active), quantity: 0 })))
    .filter((item) => item.variant).slice(0, 4);
  const featuredCard = (item) => {
    if (!item.product || !item.variant) return "";
    const colors = [...new Map(item.product.variants.filter((variant) => variant.active).map((variant) => [variant.color, variant])).values()];
    const swatches = colors.slice(0, 3).map((variant) => '<span class="swatch ' + swatchClass(variant.colorHex) + '" title="' + escapeHtml(variant.color) + '"></span>').join("");
    const additionalColors = colors.length > 3 ? '<span class="swatch-more">+' + (colors.length - 3) + '</span>' : "";
    return '<article class="featured-product"><div class="featured-media' + (item.product.imageSrc ? " has-wearly-photo" : "") + '">' + productEditorialArt(item.product) + '<span class="feature-badge">' + (item.quantity > 0 ? "Destaque de vendas" : item.product.imageSrc ? "Peça do catálogo" : "Prévia do catálogo") + '</span></div><div class="featured-product-info"><strong>' + escapeHtml(item.product.name) + '</strong><span>' + escapeHtml(money(item.variant.priceCents)) + '</span><div class="feature-swatches" aria-label="Cores disponíveis">' + swatches + additionalColors + '</div></div></article>';
  };
  const heroFeatured = featured[0];
  const supportingFeatured = featured.slice(1).map(featuredCard).join("");
  const featuredShowcase = heroFeatured?.product && heroFeatured?.variant
     ? '<div class="featured-showcase"><article class="featured-hero"><div class="featured-hero-media">' + productEditorialArt(heroFeatured.product, true) + '<span class="feature-badge">' + (heroFeatured.quantity > 0 ? "Mais vendida" : "Referência do catálogo") + '</span></div><div class="featured-hero-copy"><p class="eyebrow">' + escapeHtml(heroFeatured.product.category.toUpperCase()) + ' · CURADORIA DA LOJA</p><h3>' + escapeHtml(heroFeatured.product.name) + '</h3><p>' + escapeHtml(heroFeatured.product.description) + '</p><strong class="featured-hero-price">' + escapeHtml(money(heroFeatured.variant.priceCents)) + '</strong><div class="feature-swatches" aria-label="Cores disponíveis">' + [...new Map(heroFeatured.product.variants.filter((variant) => variant.active).map((variant) => [variant.color, variant])).values()].slice(0, 4).map((variant) => '<span class="swatch ' + swatchClass(variant.colorHex) + '" title="' + escapeHtml(variant.color) + '"></span>').join("") + '</div><button class="text-button featured-hero-link" type="button" data-view="products">Ver peça no catálogo ' + icon("arrow") + '</button></div></article><div class="featured-supporting">' + (supportingFeatured || '<div class="empty-inline">Adicione outras peças para completar a curadoria.</div>') + '</div></div>'
    : '<div class="empty-inline">Cadastre produtos para montar seu catálogo.</div>';
  const matrixProducts = state.catalog.products.filter((product) => product.active).slice(0, 3);
  const matrix = matrixProducts.map((product) => {
    const shade = product.variants.find((variant) => variant.active)?.color;
    const variants = product.variants.filter((variant) => variant.active && variant.color === shade);
    const baseSku = product.variants.find((variant) => variant.active)?.sku.split("-").slice(0, 3).join("-") ?? "";
    const sizes = variants.map((variant) => {
      const stock = stockForSku(state, variant.sku);
      return '<div class="variant-stock-cell ' + (stock <= state.settings.lowStockAt ? "is-low" : "") + '"><small>' + escapeHtml(variant.size) + '</small><strong>' + number(stock) + '</strong></div>';
    }).join("");
    return '<div class="variant-stock-row"><div class="variant-stock-product">' + productArt(product, true) + '<div><strong>' + escapeHtml(product.name) + '</strong><small>' + escapeHtml(baseSku) + ' · ' + escapeHtml(shade ?? "") + '</small></div></div><div class="variant-stock-cells">' + sizes + '</div></div>';
  }).join("");
  const unitsTrend = report.buckets.map((item) => item.units);
  const ticketTrend = report.buckets.map((item) => item.tickets ? item.grossCents / item.tickets : 0);
  const unitActivity = [
    overview.today.unitsSold ? number(overview.today.unitsSold) + (overview.today.unitsSold === 1 ? " peça vendida" : " peças vendidas") : "",
    overview.today.unitsReturned ? number(overview.today.unitsReturned) + (overview.today.unitsReturned === 1 ? " devolvida" : " devolvidas") : "",
    overview.today.unitsExchanged ? number(overview.today.unitsExchanged) + (overview.today.unitsExchanged === 1 ? " substituída em troca" : " substituídas em trocas") : "",
  ].filter(Boolean).join(" · ") || "sem movimentação";
  const stockBars = overview.lowStock.slice(0, 7).map(({ stock }) => '<span class="mini-bar ' + barHeightClass((stock + 1) / (state.settings.lowStockAt + 1) * 100) + '"></span>').join("");
  const manager = state.team.members.find((member) => member.status === "Ativa") ?? state.team.members[0];
  const greetingName = manager?.name.split(/\s+/)[0] ?? "Marina";
  return '<section class="page-section">' +
    pageHeading("ATELIÊ AURORA", "Bom dia, " + greetingName, "Acompanhe as vendas e a operação da loja.", '<div class="overview-heading-actions"><button class="button button-quiet" type="button" data-view="studio">' + icon("sparkle") + ' Estúdio de produto</button>' + button(icon("plus") + " Nova venda", "goto-pos", "primary") + '</div>') +
    '<div class="metrics-grid">' +
      '<article class="metric-card"><div class="metric-top"><span>Vendas hoje</span><span class="metric-icon icon-clay">' + icon("chart") + '</span></div><strong class="metric-value">' + escapeHtml(money(overview.today.grossCents)) + '</strong><small>' + overview.today.ticketCount + " venda" + (overview.today.ticketCount === 1 ? "" : "s") + " registrada" + (overview.today.ticketCount === 1 ? "" : "s") + " hoje</small>" + sparkline(report.buckets.map((item) => item.netCents), "plum") + '</article>' +
      '<article class="metric-card"><div class="metric-top"><span>Peças líquidas</span><span class="metric-icon icon-cyan">' + icon("hanger") + '</span></div><strong class="metric-value">' + number(overview.today.units) + '</strong><small>' + escapeHtml(unitActivity) + ' hoje</small>' + sparkline(unitsTrend, "green") + '</article>' +
      '<article class="metric-card"><div class="metric-top"><span>Estoque baixo</span><span class="metric-icon icon-danger">' + icon("box") + '</span></div><strong class="metric-value">' + number(overview.lowStock.length) + ' <span>' + (overview.lowStock.length === 1 ? 'variante' : 'variantes') + '</span></strong><small>no limite de ' + number(state.settings.lowStockAt) + ' un.</small><div class="mini-bars" aria-hidden="true">' + stockBars + '</div></article>' +
      '<article class="metric-card"><div class="metric-top"><span>Ticket médio</span><span class="metric-icon icon-plum">' + icon("bag") + '</span></div><strong class="metric-value">' + escapeHtml(money(overview.today.averageCents)) + '</strong><small>por venda registrada hoje</small>' + sparkline(ticketTrend, "rose") + '</article>' +
    '</div>' +
    '<div class="overview-feature-grid"><article class="panel best-panel"><div class="panel-heading"><div>' + (photoFeatured.length ? '<p class="eyebrow">REFERÊNCIAS VISUAIS · WEARLY</p>' : "") + '<h2>Peças em destaque</h2></div><button class="text-button" type="button" data-view="products">Ver catálogo ' + icon("arrow") + '</button></div>' + featuredShowcase + '</article></div>' +
    '<div class="overview-work-grid"><article class="panel table-panel recent-panel"><div class="panel-heading"><div><h2>Vendas recentes</h2></div><button class="text-button" type="button" data-view="pos">Ir para o PDV ' + icon("arrow") + '</button></div><div class="table-scroll"><table class="overview-sales-table"><thead><tr><th>Pedido</th><th>Data e hora</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Status</th></tr></thead><tbody>' + (recent || '<tr><td colspan="6" class="table-empty">As vendas registradas aparecerão aqui.</td></tr>') + '</tbody></table></div></article>' +
      '<div class="overview-stock-stack"><article class="panel stock-panel"><div class="panel-heading"><div><h2>Atenção no estoque</h2></div><button class="text-button" type="button" data-view="inventory">Ver todos</button></div>' + (lowStock || '<div class="empty-inline">Nenhuma variante abaixo do mínimo.</div>') + '</article>' +
      '<article class="panel variant-matrix-panel"><div class="panel-heading"><div><h2>Estoque por variante</h2></div><button class="text-button" type="button" data-view="inventory">Ver todos</button></div><div class="variant-stock-list">' + (matrix || '<div class="empty-inline">As variantes cadastradas aparecerão aqui.</div>') + '</div></article></div></div>' +
  "</section>";
}

export function renderPosPage(state, { query = "", category = "Todas", cart = [], selectedVariants = {}, scanSku = "" } = {}) {
  const categories = ["Todas", "Roupas", "Calçados", "Bolsas", "Acessórios"];
  const categoryChips = categories.map((item) =>
    '<button type="button" class="filter-chip ' + (category === item ? "is-active" : "") + '" data-pos-category="' + escapeHtml(item) + '">' + escapeHtml(item) + "</button>").join("");
  const products = state.catalog.products.filter((product) =>
    product.active && (category === "Todas" || product.category === category)
    && searchMatches(query, product.name + " " + product.category + " " + product.variants.map((item) => item.sku + " " + item.color + " " + item.size).join(" ")));
  const cards = products.map((product) => {
    const activeVariants = product.variants.filter((variant) => variant.active);
    const preferredVariant = activeVariants.find((variant) => variant.sku === selectedVariants[product.id] && stockForSku(state, variant.sku) > 0);
    const defaultVariant = preferredVariant ?? activeVariants.find((variant) => stockForSku(state, variant.sku) > 0) ?? activeVariants[0];
    const selectedStock = defaultVariant ? stockForSku(state, defaultVariant.sku) : 0;
    const inCart = defaultVariant ? cart.find((line) => line.sku === defaultVariant.sku)?.quantity ?? 0 : 0;
    const availableForSale = Math.max(0, selectedStock - inCart);
    const options = activeVariants.map((variant) => {
      const stock = stockForSku(state, variant.sku);
      return '<option value="' + escapeHtml(variant.sku) + '" ' + (variant.sku === defaultVariant?.sku ? "selected " : "") + (stock < 1 ? "disabled" : "") + ">" +
        escapeHtml(variant.size + " · " + variant.color + " · " + stock + " un.") + "</option>";
    }).join("");
    return '<article class="pos-product-card">' + productArt(product, false, true) +
      '<div class="pos-product-info"><span class="category-label">' + escapeHtml(product.category) + '</span><h3>' + escapeHtml(product.name) + '</h3><p>' + escapeHtml(product.description) + '</p>' +
      '<div class="pos-product-bottom"><strong data-product-price="' + escapeHtml(product.id) + '">' + escapeHtml(money(defaultVariant?.priceCents ?? 0)) + '</strong><label class="variant-select-label"><span>Variante</span><select data-pos-sku="' + escapeHtml(product.id) + '" aria-label="Variante de ' + escapeHtml(product.name) + '">' + options + '</select><small data-variant-summary="' + escapeHtml(product.id) + '" aria-live="polite">SKU ' + escapeHtml(defaultVariant?.sku ?? "—") + ' · saldo para este pedido: ' + availableForSale + ' un.</small></label></div>' +
      '<button class="button button-quiet add-to-cart" type="button" data-action="cart-add" data-product-id="' + escapeHtml(product.id) + '" ' + (availableForSale < 1 ? "disabled" : "") + ">" + icon("plus") + " Adicionar ao carrinho</button></div></article>";
  }).join("");
  const cartLines = cart.map((line) => {
    const found = productForSku(state, line.sku);
    return { ...line, found, unitPriceCents: found?.variant.priceCents ?? 0 };
  });
  const cartRows = cartLines.map((line) => {
    const found = line.found;
    const label = found ? found.product.name + " · " + found.variant.size + " · " + found.variant.color : line.sku;
    return '<li class="cart-line"><div class="cart-line-main"><strong>' + escapeHtml(label) + '</strong><small>' + escapeHtml(line.sku) + " · " + escapeHtml(money(line.unitPriceCents)) + '</small><div class="quantity-control"><button type="button" data-action="cart-dec" data-sku="' + escapeHtml(line.sku) + '" aria-label="Diminuir quantidade">−</button><span>' + line.quantity + '</span><button type="button" data-action="cart-inc" data-sku="' + escapeHtml(line.sku) + '" aria-label="Aumentar quantidade">+</button></div></div><strong>' + escapeHtml(money(line.unitPriceCents * line.quantity)) + '</strong><button class="icon-button remove-line" type="button" data-action="cart-remove" data-sku="' + escapeHtml(line.sku) + '" aria-label="Remover item">×</button></li>';
  }).join("");
  const subtotal = cartLines.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const itemCount = cartLines.reduce((sum, item) => sum + item.quantity, 0);
  const checkoutItems = cartLines.map((line) => {
    const found = line.found;
    const label = found ? found.product.name + " · " + found.variant.size + " · " + found.variant.color : line.sku;
    return '<li class="checkout-item-row"><span><strong>' + escapeHtml(label) + '</strong><small>' + number(line.quantity) + ' × ' + escapeHtml(money(line.unitPriceCents)) + ' · ' + escapeHtml(line.sku) + '</small></span><strong>' + escapeHtml(money(line.unitPriceCents * line.quantity)) + '</strong></li>';
  }).join("");
  const customerOptions = state.customers.records.map((customer) => '<option value="' + escapeHtml(customer.id) + '">' + escapeHtml(customer.name) + "</option>").join("");
  return '<section class="page-section pos-page' + (cart.length ? ' has-cart' : '') + '">' +
    pageHeading("PONTO DE VENDA", "Nova venda", "Monte o pedido por variante e confira o saldo por SKU antes de concluir.", '<span class="heading-counter">' + countLabel(state.sales.orders.length, "venda registrada", "vendas registradas") + "</span>") +
    '<div class="pos-layout"><div class="pos-catalog"><div class="pos-toolbar"><div class="pos-toolbar-fields"><label class="search-field"><span>' + icon("search") + '</span><input type="search" data-pos-search placeholder="Buscar peça, cor, tamanho ou SKU" value="' + escapeHtml(query) + '"></label><label class="pos-sku-scan"><span class="pos-sku-scan-mark" aria-hidden="true">SKU</span><input type="text" data-pos-scan-sku aria-label="Escanear SKU da variante" aria-describedby="pos-scan-help" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Escanear variante" value="' + escapeHtml(scanSku) + '"><kbd>Enter</kbd></label></div><small class="pos-scan-help" id="pos-scan-help">Escaneie ou digite o SKU e pressione Enter para adicionar a variante ao carrinho.</small><div class="category-filters">' + categoryChips + "</div></div>" +
    '<div class="pos-product-grid">' + (cards || '<div class="empty-state"><span class="empty-icon">' + icon("hanger") + '</span><h3>Nenhuma peça encontrada</h3><p>Ajuste a busca ou escolha outra categoria.</p></div>') + "</div></div>" +
    '<aside class="panel cart-panel"><div class="cart-heading"><div><p class="eyebrow">VENDA ATUAL</p><h2>Carrinho</h2></div><span class="cart-count">' + itemCount + "</span></div>" +
    (cartRows ? '<ul class="cart-list">' + cartRows + "</ul>" : '<div class="cart-empty"><span>' + icon("bag") + '</span><strong>Seu carrinho está leve.</strong><small>Escolha uma peça para iniciar a venda.</small></div>') +
    '<div class="cart-summary"><div><span>Peças</span><strong>' + itemCount + '</strong></div><div class="cart-total"><span>Total</span><strong>' + escapeHtml(money(subtotal)) + "</strong></div>" +
    '<button class="button button-primary button-wide" type="button" data-action="show-checkout" ' + (!cart.length ? "disabled" : "") + ">Revisar venda " + icon("arrow") + "</button></div>" +
    '<div class="cart-footnote">' + icon("sparkle") + '<span>As variantes são conferidas antes de concluir.</span></div></aside></div>' +
    (cart.length ? '<div class="mobile-cart-dock" role="region" aria-label="Resumo da venda" aria-live="polite" aria-atomic="true"><div><small>' + number(itemCount) + (itemCount === 1 ? ' peça no carrinho' : ' peças no carrinho') + '</small><strong>' + escapeHtml(money(subtotal)) + '</strong></div><button class="button button-primary" type="button" data-action="show-checkout">Revisar venda ' + icon("arrow") + '</button></div>' : '') +
    '<dialog class="modal" id="checkout-dialog"><form data-form="checkout"><div class="modal-header"><div><p class="eyebrow">REVISÃO</p><h2>Concluir venda</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Fechar">×</button></div><p class="modal-copy">Confira cada variante e associe a cliente, se desejar.</p><div class="checkout-review"><div class="checkout-items-heading"><span class="eyebrow">ITENS DA VENDA</span><span>' + number(itemCount) + (itemCount === 1 ? ' peça' : ' peças') + '</span></div><ul class="checkout-items-list">' + checkoutItems + '</ul></div><label>Cliente <span class="optional-tag">opcional</span><select name="customerId"><option value="">Venda sem cliente</option>' + customerOptions + '</select></label><div class="checkout-total"><span>Total da venda</span><strong>' + escapeHtml(money(subtotal)) + '</strong></div><button class="button button-primary button-wide" type="submit">Confirmar venda</button></form></dialog>' +
  "</section>";
}

function fitProfileDialog(product) {
  if (!product) return "";
  const dimensions = fitDimensionsForKind(product.kind);
  if (!dimensions.length) return "";
  const sizes = [...new Set(product.variants.map((variant) => variant.size))];
  const profile = product.fitProfile ?? {};
  const ease = profile.easeByMeasurementCm ?? defaultEaseForKind(product.kind);
  const sizeTables = sizes.map((size) => {
    const measurements = profile.measurementsBySize?.[size] ?? {};
    const fields = dimensions.map(({ key, label }) =>
      '<label>' + label + ' (cm)<input name="measure__' + escapeHtml(size) + '__' + key + '" type="number" min="20" max="250" step="0.1" value="' + escapeHtml(measurements[key] ?? "") + '" required></label>').join("");
    return '<fieldset class="fit-size-card"><legend>Tamanho ' + escapeHtml(size) + '</legend><div class="form-grid fit-measure-grid">' + fields + '</div></fieldset>';
  }).join("");
  const easeFields = dimensions.map(({ key, label }) =>
    '<label>' + label + ' (cm)<input name="ease__' + key + '" type="number" min="-15" max="40" step="0.1" value="' + escapeHtml(ease[key] ?? 0) + '" required><small>Folga planejada entre corpo e peça.</small></label>').join("");
  return '<dialog class="modal modal-wide" id="fit-profile-dialog"><form data-form="fit-profile" data-product-id="' + escapeHtml(product.id) + '"><div class="modal-header"><div><p class="eyebrow">FICHA DE CAIMENTO</p><h2>' + escapeHtml(product.name) + '</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Fechar">×</button></div><p class="modal-copy">Preencha, em centímetros, os contornos do busto, da cintura, do quadril e da coxa quando exibidos; para ombros, use a largura entre as costuras. Depois, cadastre a folga planejada.</p><div class="form-grid"><label class="field-span">Tecido e composição<input name="fabric" maxlength="100" placeholder="Ex.: linho misto" value="' + escapeHtml(profile.fabric ?? "") + '" required><small>A composição fica como contexto para revisão; o sistema não infere propriedades pelo texto.</small></label><label>Modelagem<select name="cut"><option ' + ((profile.cut ?? "Regular") === "Ajustada" ? "selected" : "") + '>Ajustada</option><option ' + ((profile.cut ?? "Regular") === "Regular" ? "selected" : "") + '>Regular</option><option ' + ((profile.cut ?? "Regular") === "Ampla" ? "selected" : "") + '>Ampla</option></select></label><label>Elasticidade estimada (%)<input name="stretchPercent" type="number" min="0" max="50" step="0.1" value="' + escapeHtml(profile.stretchPercent ?? 0) + '" required><small>0 para sem elasticidade; o valor ajusta uma margem heurística do alerta, não mede o tecido.</small></label></div><div class="fit-profile-section"><div><p class="eyebrow">MEDIDAS DA PEÇA</p><h3>Tabela por tamanho</h3></div>' + sizeTables + '</div><div class="fit-profile-section"><div><p class="eyebrow">MODELAGEM</p><h3>Folga planejada</h3></div><div class="form-grid fit-measure-grid">' + easeFields + '</div></div><button class="button button-primary button-wide" type="submit">Salvar ficha de caimento</button></form></dialog>';
}

const FIT_REGION_ZONES = Object.freeze({
  shoulder: Object.freeze([[-23, 84, 46, 9]]),
  chest: Object.freeze([[-17, 107, 34, 10]]),
  waist: Object.freeze([[-15, 136, 30, 9]]),
  hip: Object.freeze([[-19, 164, 38, 10]]),
  thigh: Object.freeze([[-16, 195, 13, 27], [3, 195, 13, 27]]),
});

function fitRegionStatus(verdict) {
  return verdict === "small" ? "Justa" : verdict === "large" ? "Ampla" : "Dentro da faixa";
}

function studioFitMap(report) {
  if (report?.status !== "ready" || !report.rows?.length) return "";
  const regions = report.rows.map((row) =>
    '<span class="studio-fit-map-chip" data-verdict="' + escapeHtml(row.verdict) + '" aria-label="' + escapeHtml(row.label + ": " + fitRegionStatus(row.verdict)) + '"><i aria-hidden="true"></i><strong>' + escapeHtml(row.label) + '</strong><small>' + fitRegionStatus(row.verdict) + '</small></span>').join("");
  return '<div class="studio-fit-map"><p class="eyebrow">REGIÕES DO CÁLCULO</p><div class="studio-fit-map-list">' + regions + '</div><small class="studio-fit-map-note">Marcadores esquemáticos; não representam uma prova fotográfica.</small></div>';
}

function studioIllustrationScales(product, variant, model) {
  const clampScale = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const average = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 1;
  const measurementKeys = product.kind === "trousers"
    ? ["waist", "hip", "thigh"]
    : product.kind === "dress" ? ["chest", "waist", "hip"] : ["chest", "waist", "shoulder"];
  const referenceMeasurements = { chest: 90, waist: 72, hip: 98, shoulder: 38, thigh: 56 };
  const bodyMeasurements = model?.measurements ?? {};
  const bodyRatios = measurementKeys
    .map((key) => Number(bodyMeasurements[key]) / referenceMeasurements[key])
    .filter(Number.isFinite);
  const bodyScale = Number(clampScale(average(bodyRatios), 0.84, 1.2).toFixed(3));
  const measurementsBySize = product.fitProfile?.measurementsBySize ?? {};
  const selectedMeasurements = measurementsBySize[variant.size] ?? {};
  const garmentRatios = measurementKeys.flatMap((key) => {
    const sizeValues = Object.values(measurementsBySize)
      .map((measurements) => Number(measurements?.[key]))
      .filter((value) => Number.isFinite(value) && value > 0);
    const selectedValue = Number(selectedMeasurements[key]);
    return sizeValues.length && Number.isFinite(selectedValue) && selectedValue > 0
      ? [selectedValue / average(sizeValues)]
      : [];
  });
  const garmentScale = Number(clampScale(average(garmentRatios), 0.88, 1.12).toFixed(3));
  return { bodyScale, garmentScale };
}

function studioIllustration(product, variant, model, report, scales = studioIllustrationScales(product, variant, model)) {
  const garmentColor = /^#[\da-f]{6}$/i.test(String(variant.colorHex ?? "")) ? variant.colorHex : "#c7b7a4";
  const { bodyScale, garmentScale } = scales;
  const fitOverlays = (x) => (report?.status === "ready" ? report.rows : []).map((row) => {
    const zones = FIT_REGION_ZONES[row.key];
    if (!zones) return "";
    return '<g class="studio-fit-overlay" data-fit-measure="' + escapeHtml(row.key) + '" data-verdict="' + escapeHtml(row.verdict) + '" aria-label="' + escapeHtml(row.label + ": " + fitRegionStatus(row.verdict)) + '">' + zones.map(([offset, y, width, height]) => '<rect x="' + (x + offset) + '" y="' + y + '" width="' + width + '" height="' + height + '" rx="4"/>').join("") + '<title>' + escapeHtml(row.label + ": " + fitRegionStatus(row.verdict)) + '</title></g>';
  }).join("");
  const garment = (x, angle) => {
    const side = angle === "LATERAL";
    const back = angle === "COSTAS";
    if (product.kind === "trousers") {
      if (side) return '<path d="M' + (x - 9) + ' 142h19l-2 102h-17l-8-56z" fill="' + garmentColor + '" stroke="#8b756a" stroke-width="2"/><path d="M' + (x - 9) + ' 153h19m-21 2 12 4" fill="none" stroke="#f8f3ed" stroke-width="2"/>';
      const backDetails = back
        ? '<path d="M' + (x - 15) + ' 162l9 1-1 11h-10zm21 1 9-1 2 12h-10zM' + x + ' 158v22" fill="none" stroke="#f8f3ed" stroke-width="2"/>'
        : '<path d="M' + (x - 13) + ' 162h9m8 0h9" stroke="#f8f3ed" stroke-width="2"/>';
      return '<path d="M' + (x - 22) + ' 142h44l-4 105h-18l-3-58-3 58h-18z" fill="' + garmentColor + '" stroke="#8b756a" stroke-width="2"/><path d="M' + (x - 22) + ' 154h44M' + x + ' 146v12" stroke="#f8f3ed" stroke-width="2"/>' + backDetails;
    }
    if (product.kind === "dress") {
      if (side) return '<path d="M' + (x - 8) + ' 86l-8 13 5 45-12 74h46l-10-74 5-45-8-13-5 12h-7z" fill="' + garmentColor + '" stroke="#8b756a" stroke-width="2"/><path d="M' + x + ' 101v113" stroke="#f8f3ed" stroke-width="2"/>';
      const seams = back
        ? 'M' + (x - 8) + ' 97q8 8 16 0M' + x + ' 106v104M' + (x - 28) + ' 150q28 8 56 0'
        : 'M' + (x - 8) + ' 96q8 10 16 0M' + x + ' 110v29';
      return '<path d="M' + (x - 21) + ' 86l-18 14 7 47-20 71h104l-20-71 7-47-18-14-11 13h-20z" fill="' + garmentColor + '" stroke="#8b756a" stroke-width="2"/><path d="' + seams + '" fill="none" stroke="#f8f3ed" stroke-width="2"/>';
    }
    if (side) return '<path d="M' + (x - 8) + ' 86l-14 12 7 44 8-3v39h22v-39l8 3 7-44-14-12-5 9h-14z" fill="' + garmentColor + '" stroke="#8b756a" stroke-width="2"/><path d="M' + x + ' 98v78" stroke="#f8f3ed" stroke-width="2"/>';
    const seams = back
      ? 'M' + (x - 17) + ' 99q17 11 34 0M' + x + ' 101v78'
      : 'M' + x + ' 100v76M' + (x - 10) + ' 108h3M' + (x - 10) + ' 120h3M' + (x - 10) + ' 132h3';
    return '<path d="M' + (x - 22) + ' 86l-28 15 12 44 14-6v46h48v-46l14 6 12-44-28-15-11 13h-22z" fill="' + garmentColor + '" stroke="#8b756a" stroke-width="2"/><path d="' + seams + '" fill="none" stroke="#f8f3ed" stroke-width="2"/>';
  };
  const figure = (x, label) => {
    const side = label === "LATERAL";
    const back = label === "COSTAS";
    const body = side
      ? '<circle cx="' + x + '" cy="56" r="14" fill="#ddcdbd"/><path d="M' + (x + 10) + ' 52l6 4-6 4" fill="none" stroke="#ad9785" stroke-width="1.5"/><path d="M' + (x - 8) + ' 75q12-8 20 4l8 58-10 12-8-9-1 24h-22l4-43-7 12-8-5 14-46z" fill="#e9e1d8" stroke="#c5b7a8" stroke-width="2" stroke-linejoin="round"/><path d="M' + (x - 8) + ' 160l-4 88h14l4-88m4 0 2 88h14l-8-88" stroke="#c5b7a8" stroke-width="9" stroke-linecap="round"/>'
      : '<circle cx="' + x + '" cy="56" r="14" fill="#ddcdbd"/><path d="M' + (x - 6) + ' 70v14m12-14v14M' + (x - 24) + ' 85q24-15 48 0l14 54-16 7-7-22v36h-54v-36l-7 22-16-7 14-54z" fill="#e9e1d8" stroke="#c5b7a8" stroke-width="2" stroke-linejoin="round"/><path d="M' + (x - 16) + ' 159v89m32-89v89" stroke="#c5b7a8" stroke-width="13" stroke-linecap="round"/>' + (back ? '<path d="M' + x + ' 82v63" stroke="#c5b7a8" stroke-width="1.5"/><path d="M' + (x - 10) + ' 47q10-12 20 0" fill="#8f7767"/>' : "");
    const feet = side
      ? '<path d="M' + (x - 8) + ' 247l-7 15m31-15 5 15" stroke="#c5b7a8" stroke-width="8" stroke-linecap="round"/>'
      : '<path d="M' + (x - 24) + ' 249l-6 14m54-14 6 14" stroke="#c5b7a8" stroke-width="9" stroke-linecap="round"/>';
    const bodyTransform = 'translate(' + x + ' 0) scale(' + bodyScale + ' 1) translate(-' + x + ' 0)';
    const garmentTransform = 'translate(' + x + ' 0) scale(' + garmentScale + ' 1) translate(-' + x + ' 0)';
    const bodyMarkup = '<g class="studio-body-view" transform="' + bodyTransform + '">' + body + '</g>';
    const garmentMarkup = '<g class="studio-garment-view" data-garment-view="' + label + '" transform="' + garmentTransform + '">' + garment(x, label) + (label === "FRENTE" ? fitOverlays(x) : "") + '</g>';
    return '<g class="studio-angle-view" data-angle="' + label + '" data-model-profile="' + escapeHtml(model?.id ?? "synthetic-unspecified") + '" data-body-width-scale="' + bodyScale + '" data-garment-size="' + escapeHtml(variant.size) + '" data-garment-width-scale="' + garmentScale + '">' + bodyMarkup + garmentMarkup + feet + '<text x="' + x + '" y="320" text-anchor="middle" class="mock-angle">' + label + '</text></g>';
  };
  const fitSummary = report?.status === "ready" ? " Mapa esquemático local: " + report.rows.map((row) => row.label + " " + fitRegionStatus(row.verdict).toLowerCase()).join(", ") + "." : "";
  const modelSummary = model?.name ? " Proporções esquemáticas baseadas nas medidas numéricas do perfil " + model.name + "; a largura da peça acompanha o tamanho " + variant.size + "." : " Proporções esquemáticas de referência para o tamanho " + variant.size + ".";
  return '<svg class="studio-model-illustration" viewBox="0 0 720 350" role="img" aria-label="Ilustração esquemática baseada em medidas numéricas, não é prova virtual nem foi gerada por IA.' + escapeHtml(modelSummary + fitSummary) + '"><rect x="4" y="4" width="712" height="342" rx="20" fill="#f6f1eb"/><path d="M244 22v300M476 22v300" stroke="#e7ded4" stroke-dasharray="4 8"/>' + figure(130, "FRENTE") + figure(360, "LATERAL") + figure(590, "COSTAS") + '</svg>';
}

function studioFitReport(report) {
  if (!report || report.status !== "ready") {
    const title = report?.status === "incomplete" ? "Dados de caimento incompletos"
      : report?.status === "unavailable" ? "Análise indisponível"
        : "Escolha a peça, a variante e a silhueta";
    const message = report?.message ?? "A análise compara todas as medidas da tabela da peça com o perfil sintético selecionado.";
    return '<div class="studio-empty-result"><span>' + icon("chart") + '</span><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(message) + '</small></div>';
  }
  const usesCurrentPolicy = report.method?.id === FIT_ESTIMATE_POLICY.id;
  const hasNumber = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
  const rows = report.rows.map((row) => {
    const label = row.verdict === "small" ? "Justa" : row.verdict === "large" ? "Ampla" : "Dentro da faixa";
    const stretchToleranceCm = hasNumber(row.stretchToleranceCm)
      ? Number(row.stretchToleranceCm)
      : usesCurrentPolicy ? estimateStretchToleranceCm(row.bodyCm, report.stretchPercent) : null;
    const smallThresholdCm = hasNumber(row.smallThresholdCm)
      ? Number(row.smallThresholdCm)
      : usesCurrentPolicy ? -(FIT_ESTIMATE_POLICY.baseSmallToleranceCm + (stretchToleranceCm ?? 0)) : null;
    const largeThresholdCm = hasNumber(row.largeThresholdCm)
      ? Number(row.largeThresholdCm)
      : usesCurrentPolicy ? FIT_ESTIMATE_POLICY.largeDeviationToleranceCm : null;
    const differenceCm = Number.isFinite(Number(row.differenceCm))
      ? Number(row.differenceCm)
      : Number(row.easeCm) - Number(row.targetEaseCm);
    const policyDetails = [];
    if (Number.isFinite(differenceCm)) policyDetails.push('diferença para o alvo ' + (differenceCm > 0 ? "+" : "") + number(differenceCm) + ' cm');
    if (stretchToleranceCm !== null) policyDetails.push('margem estimada +' + number(stretchToleranceCm) + ' cm');
    if (smallThresholdCm !== null && largeThresholdCm !== null) {
      policyDetails.push('alertas: justo abaixo de ' + number(smallThresholdCm) + ' cm, amplo acima de +' + number(largeThresholdCm) + ' cm');
    }
    const targetEase = (row.targetEaseCm > 0 ? "+" : "") + number(row.targetEaseCm) + " cm";
    const fitDetail = "Alvo " + targetEase + (policyDetails.length ? " · " + policyDetails.join(" · ") : "");
    return '<article class="studio-fit-row" data-verdict="' + escapeHtml(row.verdict) + '"><div class="studio-fit-row-heading"><strong>' + escapeHtml(row.label) + '</strong><span class="studio-fit-tag fit-row-' + row.verdict + '">' + label + '</span></div><div class="studio-fit-measures"><span><small>Peça</small><strong>' + escapeHtml(number(row.garmentCm)) + ' cm</strong></span><span><small>Perfil</small><strong>' + escapeHtml(number(row.bodyCm)) + ' cm</strong></span><span><small>Folga</small><strong>' + (row.easeCm > 0 ? "+" : "") + escapeHtml(number(row.easeCm)) + ' cm</strong></span></div><details class="studio-fit-row-details"><summary>Ver critério e margem</summary><p>' + escapeHtml(fitDetail) + '</p></details></article>';
  }).join("");
  const policyNote = !usesCurrentPolicy
    ? '<p class="studio-fit-note studio-fit-policy-note">' + (report.method?.id
      ? 'Esta sessão usa a regra registrada ' + escapeHtml(report.method.id) + '; seus limites foram preservados.'
      : 'Sessão histórica sem versão de cálculo registrada. O veredito original foi preservado; reanalise para ver os limites da regra atual.') + '</p>'
    : '';
  return '<div class="studio-fit-result fit-verdict-' + report.verdict + '"><div class="studio-fit-heading"><div><p class="eyebrow">LEITURA DE CAIMENTO</p><h3>' + escapeHtml(report.title) + '</h3></div><span class="fit-verdict-mark">' + (report.verdict === "balanced" ? "✓" : report.verdict === "large" ? "↗" : "!") + '</span></div><div class="studio-fit-rows">' + rows + '</div><p class="studio-fit-note">' + escapeHtml(report.note) + '</p>' + policyNote + '</div>';
}

function studioProfilePlaceholder(view) {
  return '<svg class="studio-profile-silhouette" data-view="' + escapeHtml(view) + '" viewBox="0 0 64 68" fill="none" aria-hidden="true"><circle cx="32" cy="11" r="7"/><path d="M21 25c1-5 5-8 11-8s10 3 11 8l4 18-7 2-3-13v26H27V32l-3 13-7-2 4-18Z"/></svg>';
}

function studioPhotoCard(key, title, reference, photoType = "product") {
  const isProfilePhoto = photoType === "profile";
  const noun = isProfilePhoto ? "perfil" : "produto";
  const image = reference?.url
    ? '<img src="' + escapeHtml(reference.url) + '" alt="Referência local do ' + noun + ': ' + escapeHtml(title.toLowerCase()) + '">'
    : isProfilePhoto ? studioProfilePlaceholder(key) : '<span class="studio-photo-placeholder">＋</span>';
  const description = reference?.source === "wearly-mock" ? "Mock de catálogo · Wearly" : reference ? "Temporária nesta aba" : isProfilePhoto ? "Adicionar foto do perfil" : "Adicionar foto da peça";
  const action = reference ? "Trocar foto" : "Adicionar foto";
  const inputLabel = reference ? "Substituir foto de " : "Adicionar foto de ";
  const target = isProfilePhoto ? 'data-studio-model-photo="' + key + '"' : 'data-studio-photo="' + key + '"';
  return '<label class="studio-photo-card ' + (reference ? "has-image" : "") + '"><span class="studio-photo-frame">' + image + '</span><span class="studio-photo-meta"><strong>' + title + '</strong><small>' + description + '</small></span><span class="studio-photo-action">' + action + '</span><input class="studio-photo-input" type="file" accept="image/jpeg,image/png,image/webp" ' + target + ' aria-label="' + inputLabel + title.toLowerCase() + ' do ' + noun + '"></label>';
}

function studioReferenceGallery(product, references) {
  const front = references.front ?? (product.imageSrc ? { url: product.imageSrc, source: "wearly-mock" } : null);
  const source = front?.source === "wearly-mock" ? "MOCK DE CATÁLOGO · WEARLY" : front ? "FOTO LOCAL · FRENTE" : "REFERÊNCIA VISUAL LOCAL";
  const main = front?.url
    ? '<img src="' + escapeHtml(front.url) + '" alt="' + escapeHtml(front.source === "wearly-mock" ? "Imagem de referência do mock para " + product.name : "Foto temporária da frente de " + product.name) + '">'
    : productArt(product, true);
  const additional = [["detail", "Detalhe"], ["back", "Costas"]]
    .filter(([key]) => references[key]?.url)
    .map(([key, label]) => '<figure class="studio-reference-thumb"><img src="' + escapeHtml(references[key].url) + '" alt="Referência temporária: ' + label.toLowerCase() + ' de ' + escapeHtml(product.name) + '"><figcaption>' + label + '</figcaption></figure>')
    .join("");
  return '<div class="studio-reference-gallery"><div class="studio-reference-shot' + (front?.url ? "" : " is-placeholder") + '">' + main + '<span>' + source + '</span></div>' + (additional ? '<div class="studio-reference-strip">' + additional + '</div>' : "") + '</div>';
}

function studioModelReferenceGallery(model, references) {
  const views = [["front", "Frente"], ["side", "Lateral"], ["back", "Costas"]]
    .filter(([key]) => references?.[key]?.url);
  if (!views.length) return "";
  return '<div class="studio-model-reference-strip"><div><p class="eyebrow">REFERÊNCIAS DO PERFIL</p><strong>' + escapeHtml(model.name) + '</strong><small>Fotos locais de referência · não alteram as medidas</small></div><div class="studio-model-reference-photos">' + views.map(([key, label]) => '<figure><img src="' + escapeHtml(references[key].url) + '" alt="Foto temporária ' + label.toLowerCase() + ' do perfil ' + escapeHtml(model.name) + '"><figcaption>' + label + '</figcaption></figure>').join("") + '</div></div>';
}

function studioJobStatus(job) {
  const decision = job.reviews?.[0]?.decision;
  if (decision === "approved") return job.status === "local-brief" ? "Brief aprovado" : "Aprovada localmente";
  if (decision === "changes-requested") return "Ajustes solicitados";
  return job.status === "local-illustration" ? "Ilustração local" : job.status === "reviewed-local" ? "Revisada nesta prévia" : "Brief local";
}

export function renderProductStudioPage(state, session = {}) {
  const requestedJob = state.studio.jobs.find((item) => item.id === session.selectedJobId);
  const revisionParent = state.studio.jobs.find((item) => item.id === session.revisionOfJobId);
  const products = state.catalog.products.filter((item) => item.active && item.fitProfile && fitDimensionsForKind(item.kind).length);
  const models = state.studio.models.filter((item) => item.active);
  const historyProduct = requestedJob?.contextSnapshot?.product;
  const historyModel = requestedJob?.contextSnapshot?.model;
  if ((!products.length && !historyProduct) || (!models.length && !historyModel)) {
    return '<section class="page-section">' + pageHeading("CONTEÚDO DE PRODUTO", "Estúdio de produto", "Prepare referências e confira o caimento antes de produzir o conteúdo do catálogo.", "") + '<div class="empty-state"><span class="empty-icon">' + icon("sparkle") + '</span><h3>Faltam dados para iniciar</h3><p>Cadastre uma ficha de tecido e medidas em Produtos e catálogo e mantenha ao menos uma silhueta local ativa.</p></div></section>';
  }
  const firstJob = state.studio.jobs[0];
  const productId = session.productId ?? requestedJob?.productId ?? firstJob?.productId ?? products[0]?.id ?? historyProduct?.id;
  const product = products.find((item) => item.id === productId) ?? (historyProduct?.id === productId ? historyProduct : null) ?? products[0];
  const variants = product.variants.filter((item) => item.active || item.id === requestedJob?.variantId);
  const variantId = session.variantId ?? (product.id === firstJob?.productId ? firstJob.variantId : null) ?? variants[0]?.id;
  const variant = variants.find((item) => item.id === variantId) ?? variants[0];
  const modelId = session.modelId ?? requestedJob?.modelId ?? (product.id === firstJob?.productId ? firstJob.modelId : null) ?? models[0]?.id ?? historyModel?.id;
  const model = models.find((item) => item.id === modelId) ?? (historyModel?.id === modelId ? historyModel : null) ?? models[0];
  const selectedJob = requestedJob;
  const modelReferences = session.modelReferences ?? {};
  const context = selectedJob?.contextSnapshot;
  const displayProduct = context?.product ?? product;
  const displayVariant = context?.variant ?? variant;
  const displayModel = context?.model ?? model;
  const report = session.report ?? context?.fitReport ?? (selectedJob ? evaluateGarmentFit({ product, variant, bodyMeasurements: model.measurements }) : null);
  const brief = session.brief ?? context?.brief ?? (report?.status === "ready" ? buildTryOnBrief({ product, variant, model, report }) : null);
  const canCreatePreview = report?.status === "ready" && !selectedJob;
  const productChoices = revisionParent ? products.filter((item) => item.id === revisionParent.productId) : [...products];
  if (historyProduct && !productChoices.some((item) => item.id === historyProduct.id)) productChoices.push(historyProduct);
  const modelChoices = [...models];
  if (historyModel && !modelChoices.some((item) => item.id === historyModel.id)) modelChoices.push(historyModel);
  const productOptions = productChoices.map((item) => '<option value="' + escapeHtml(item.id) + '" ' + (item.id === product.id ? "selected" : "") + '>' + escapeHtml(item.name + (!item.active ? " · histórico" : "")) + '</option>').join("");
  const variantOptions = variants.map((item) => '<option value="' + escapeHtml(item.id) + '" ' + (item.id === variant.id ? "selected" : "") + '>' + escapeHtml(item.size + " · " + item.color + " · " + item.sku) + '</option>').join("");
  const modelOptions = modelChoices.map((item) => '<option value="' + escapeHtml(item.id) + '" ' + (item.id === model.id ? "selected" : "") + '>' + escapeHtml(item.name + (!item.active ? " · histórico" : "")) + '</option>').join("");
  const currentProfile = displayProduct.fitProfile ?? {};
  const history = state.studio.jobs.slice(0, 6).map((job) => {
    const jobProduct = state.catalog.products.find((item) => item.id === job.productId);
    const displayJobProduct = job.contextSnapshot?.product ?? jobProduct;
    const jobVariant = job.contextSnapshot?.variant ?? jobProduct?.variants.find((item) => item.id === job.variantId);
    const jobModel = state.studio.models.find((item) => item.id === job.modelId);
    const version = Number(job.revision?.version) || 1;
    return '<button class="studio-history-row" type="button" data-action="studio-job-open" data-job-id="' + escapeHtml(job.id) + '"><span class="studio-history-mark">' + (displayJobProduct ? productArt(displayJobProduct, true) : icon("hanger")) + '</span><span><strong>' + escapeHtml(job.contextSnapshot?.product?.name ?? jobProduct?.name ?? "Produto") + '</strong><small>Versão ' + version + ' · ' + escapeHtml([jobVariant?.size, jobVariant?.color, job.contextSnapshot?.model?.name ?? jobModel?.name].filter(Boolean).join(" · ")) + '</small></span><span class="studio-history-status">' + escapeHtml(studioJobStatus(job)) + '</span></button>';
  }).join("");
  const referencePhotos = session.references ?? {};
  const frontReference = referencePhotos.front ?? (displayProduct.imageSrc ? { url: displayProduct.imageSrc, source: "wearly-mock" } : null);
  const savedIllustration = selectedJob?.status === "local-illustration" || selectedJob?.status === "reviewed-local";
  const hasUploadedReference = Object.values(referencePhotos).some((reference) => reference?.url && reference.source !== "wearly-mock");
  const showVisualPreview = savedIllustration || report?.status === "ready" || hasUploadedReference || Boolean(frontReference?.url);
  const fitVisual = report?.status === "ready"
    ? studioFitMap(report)
    : '<p class="studio-fit-pending">' + escapeHtml(report?.message ?? "Analise o caimento para destacar as regiões nesta ilustração.") + '</p>';
  const illustrationScales = studioIllustrationScales(displayProduct, displayVariant, displayModel);
  const summary = brief ? '<div class="studio-brief"><div class="studio-section-title"><div><p class="eyebrow">BRIEF DE CAIMENTO</p><h3>Instruções estruturadas</h3></div><span class="studio-local-tag">LOCAL</span></div><p>' + escapeHtml(brief.fit.visualDirection) + '</p><div class="studio-brief-facts"><span><small>Tecido</small><strong>' + escapeHtml(brief.product.fabric) + '</strong></span><span><small>Modelagem</small><strong>' + escapeHtml(brief.product.cut) + '</strong></span><span><small>Elasticidade</small><strong>' + brief.product.stretchPercent + '%</strong></span><span><small>Grade e preferência</small><strong>' + escapeHtml(brief.referenceModel.sizeReference + ' · ' + brief.referenceModel.fitPreference) + '</strong></span></div><ul>' + brief.instructions.map((item) => '<li>' + escapeHtml(item) + '</li>').join("") + '</ul><small class="studio-privacy-line">' + escapeHtml(brief.delivery.message) + '</small></div>' : '';
  const preview = showVisualPreview
    ? '<div class="studio-preview-canvas">' +
      studioReferenceGallery(displayProduct, referencePhotos) +
      studioModelReferenceGallery(displayModel, modelReferences) +
      '<div class="studio-technical-preview"><div><p class="eyebrow">GUIA ESTRUTURAL</p><strong>' + escapeHtml(displayProduct.name) + '</strong></div>' + studioIllustration(displayProduct, displayVariant, displayModel, report, illustrationScales) + '<div class="studio-tech-facts"><span><small>VARIANTE</small><strong>' + escapeHtml(displayVariant.size + " · " + displayVariant.color) + '</strong></span><span><small>MODELAGEM</small><strong>' + escapeHtml(displayProduct.fitProfile?.cut ?? "Regular") + '</strong></span><span><small>ESCALA ESQUEMÁTICA</small><strong>perfil ' + illustrationScales.bodyScale.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '× · peça ' + illustrationScales.garmentScale.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×</strong></span></div>' + fitVisual + '</div>' +
      '<div class="studio-preview-caption"><span class="studio-local-tag">' + (selectedJob ? savedIllustration ? "SESSÃO SALVA" : "BRIEF LOCAL" : "RASCUNHO LOCAL") + '</span><span>A foto Wearly é referência do catálogo e não acompanha a cor da variante. O esquema usa proporções numéricas do perfil e da grade; não é prova virtual nem geração de IA.</span></div></div>'
    : '<div class="studio-preview-empty"><div class="preview-empty-figure">' + productArt(displayProduct, true) + '</div><p class="eyebrow">ÁREA DE PRÉVIA</p><h3>Prepare uma prévia do produto</h3><p>Analise o caimento e crie uma ilustração local para visualizar a estrutura desta etapa.</p></div>';
  const requestedChanges = selectedJob?.reviews?.[0]?.decision === "changes-requested";
  const nextVersion = requestedChanges
    ? state.studio.jobs.find((item) => item.revision?.basedOnJobId === selectedJob.id)
    : null;
  const reviewAction = selectedJob
    ? requestedChanges
      ? nextVersion
        ? '<button class="button button-quiet" type="button" data-action="studio-job-open" data-job-id="' + escapeHtml(nextVersion.id) + '">Abrir versão ' + (Number(nextVersion.revision?.version) || 2) + '</button>'
        : '<button class="button button-quiet" type="button" data-action="studio-revise" data-job-id="' + escapeHtml(selectedJob.id) + '">Preparar nova versão</button>'
      : '<button class="button button-quiet" type="button" data-action="studio-review-open" data-job-id="' + escapeHtml(selectedJob.id) + '">' + ((selectedJob.reviews?.length || selectedJob.status === "reviewed-local") ? "Revisar novamente" : "Revisar conteúdo") + '</button>'
    : '';
  const latestReview = selectedJob?.reviews?.[0];
  const reviewSummary = latestReview
    ? '<div class="studio-review-result" data-decision="' + escapeHtml(latestReview.decision) + '"><strong>' + escapeHtml(studioJobStatus(selectedJob)) + '</strong><span>' + escapeHtml(latestReview.note || "Sem comentário adicional.") + '</span><small>Registro local · ' + escapeHtml(new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(latestReview.createdAt))) + '</small></div>'
    : '';
  const historyNotice = selectedJob
    ? '<div class="studio-history-notice"><strong>Você está vendo a versão ' + (Number(selectedJob.revision?.version) || 1) + ' salva</strong><span>O caimento e o brief usam os dados desta sessão. Para trabalhar com a ficha atual, clique em “Analisar caimento”.</span></div>'
    : '';
  const revisionNotice = revisionParent
    ? '<div class="studio-revision-notice"><strong>Nova versão a partir da versão ' + (Number(revisionParent.revision?.version) || 1) + '</strong><span>Pedido de ajuste: ' + escapeHtml(session.revisionRequestNote || "Revise os detalhes indicados pelo responsável pelo conteúdo.") + '</span><small>O comentário orienta esta revisão, mas não altera a imagem esquemática. Atualize a peça ou as referências, reanalise o caimento e gere a nova versão.</small></div>'
    : '';
  const reviewJob = state.studio.jobs.find((item) => item.id === session.reviewJobId);
  const reviewProductName = reviewJob?.contextSnapshot?.product?.name
    ?? state.catalog.products.find((item) => item.id === reviewJob?.productId)?.name
    ?? "conteúdo do produto";
  const reviewDialog = reviewJob
    ? '<dialog class="modal" id="studio-review-dialog"><form data-form="studio-review" data-job-id="' + escapeHtml(reviewJob.id) + '"><div class="modal-header"><div><p class="eyebrow">REVISÃO LOCAL</p><h2>Revisar conteúdo</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Fechar">×</button></div><p class="modal-copy"><strong>' + escapeHtml(reviewProductName) + '</strong> · Esta decisão fica neste histórico local.</p><label>Decisão<select name="decision" data-review-decision required><option value="" selected disabled>Escolha uma decisão</option><option value="approved">Aprovar conteúdo</option><option value="changes-requested">Solicitar ajustes</option></select></label><label>Comentário <span class="optional-tag" data-review-note-hint>opcional para aprovação</span><textarea name="note" data-review-note maxlength="500" rows="4" placeholder="Ex.: conferir o tom da variante e revisar o detalhe da manga"></textarea></label><button class="button button-primary button-wide" type="submit">Salvar revisão local</button></form></dialog>'
    : '';

  return '<section class="page-section product-studio-page">' +
    pageHeading("CONTEÚDO DE PRODUTO", "Estúdio de produto", "Estime o caimento com medidas locais e prepare o conteúdo da peça antes de publicar.", '<button class="button button-quiet" type="button" data-action="studio-add-model">' + icon("plus") + ' Adicionar silhueta</button>') +
    '<div class="studio-metrics"><article><span>Peça selecionada</span><strong>' + escapeHtml(displayProduct.name) + '</strong><small>' + escapeHtml(displayVariant.size + " · " + displayVariant.color) + '</small></article><article><span>Perfis de referência</span><strong>' + number(models.length) + '</strong><small>silhuetas sintéticas locais</small></article><article><span>Ficha do produto</span><strong>' + escapeHtml(currentProfile.fabric ?? "Não informado") + '</strong><small>modelagem ' + escapeHtml(currentProfile.cut ?? "Regular").toLowerCase() + ' · elasticidade ' + number(currentProfile.stretchPercent) + '%</small></article><article class="studio-provider-metric"><span>Geração de imagem</span><strong>Aguardando provider</strong><small>Intelligence ainda não expõe esta capacidade</small></article></div>' +
    '<div class="studio-workspace"><div class="studio-controls-column">' +
      '<article class="panel studio-step-card"><div class="studio-section-title"><div><p class="eyebrow">01 · PRODUTO</p><h3>Escolha a variante</h3></div><span class="studio-step-number">01</span></div><label class="field-label">Produto<select data-studio-product>' + productOptions + '</select></label><label class="field-label">Tamanho e cor<select data-studio-variant>' + variantOptions + '</select></label><div class="studio-product-summary">' + productArt(displayProduct, true, true) + '<span><strong>' + escapeHtml(currentProfile.fabric ?? "Ficha histórica") + '</strong><small>' + escapeHtml(displayProduct.description) + '</small><small class="studio-product-variant">' + escapeHtml(displayVariant.size + " · " + displayVariant.color + " · " + displayVariant.sku) + '</small><small>Composição é contextual; só a elasticidade informada altera a margem heurística do alerta.</small></span></div>' + (product.active ? '<button class="text-button" type="button" data-action="fit-profile-open" data-product-id="' + escapeHtml(product.id) + '">Editar medidas do produto ' + icon("arrow") + '</button>' : '') + '</article>' +
      '<article class="panel studio-step-card"><div class="studio-section-title"><div><p class="eyebrow">02 · MODELO DE REFERÊNCIA</p><h3>Escolha a silhueta</h3></div><span class="studio-step-number">02</span></div><label class="field-label">Perfil sintético<select data-studio-model>' + modelOptions + '</select></label><div class="studio-model-facts"><span><small>Altura</small><strong>' + displayModel.heightCm + ' cm</strong></span><span><small>Grade usual</small><strong>' + escapeHtml(displayModel.sizeReference) + '</strong></span><span><small>Preferência</small><strong>' + escapeHtml(displayModel.fitPreference) + '</strong></span></div><p class="studio-note">O perfil usa medidas fictícias locais. Fotos opcionais ficam apenas nesta aba e não alteram o cálculo. A leitura numérica usa medidas e folga da peça.</p><div class="studio-profile-photo-block"><div class="studio-profile-photo-heading"><div><p class="eyebrow">FOTOS DE REFERÊNCIA</p><strong>Frente, lateral e costas</strong></div><span>OPCIONAL</span></div><div class="studio-photo-grid studio-model-photo-grid">' + studioPhotoCard("front", "Frente", modelReferences.front, "profile") + studioPhotoCard("side", "Lateral", modelReferences.side, "profile") + studioPhotoCard("back", "Costas", modelReferences.back, "profile") + '</div><p class="studio-photo-privacy">Imagens temporárias. Não são salvas no perfil, catálogo ou histórico. Não envie fotos de clientes sem autorização.</p></div></article>' +
      '<article class="panel studio-step-card"><div class="studio-section-title"><div><p class="eyebrow">03 · FOTOS DA PEÇA</p><h3>Referências do catálogo</h3></div><span class="studio-step-number">03</span></div><div class="studio-photo-grid">' + studioPhotoCard("front", "Frente", frontReference) + studioPhotoCard("detail", "Detalhe", referencePhotos.detail) + studioPhotoCard("back", "Costas", referencePhotos.back) + '</div><p class="studio-note">Fotos Wearly são referências do mock. Arquivos escolhidos aqui ficam em memória nesta aba e não são enviados ou salvos no catálogo.</p></article>' +
      '<button class="button button-primary button-wide" type="button" data-action="studio-analyze">' + icon("chart") + ' Analisar caimento</button>' +
    '</div><div class="studio-results-column">' +
      '<article class="panel studio-preview-panel"><div class="panel-heading"><div><p class="eyebrow">04 · PRÉVIA DE CONTEÚDO</p><h2>Prévia do produto</h2></div>' + (reviewAction || '<span class="studio-local-tag">' + (selectedJob ? "BRIEF LOCAL" : "RASCUNHO") + '</span>') + '</div>' + revisionNotice + preview + historyNotice + reviewSummary + '<div class="studio-preview-actions"><button class="button button-secondary" type="button" data-action="studio-preview-create" ' + (canCreatePreview ? "" : "disabled") + '>' + icon("sparkle") + ' Criar ilustração mock</button><button class="button button-quiet" type="button" disabled title="Depende de um provider de imagem autorizado">Gerar com Intelligence</button></div><p class="studio-note">A ilustração mock demonstra a etapa visual e usa a cor da variante. A geração fotográfica real só será habilitada por contrato oficial.</p></article>' +
      '<article class="panel studio-fit-panel"><div class="panel-heading"><div><p class="eyebrow">05 · CAIMENTO</p><h2>Resultado por medida</h2></div><span class="studio-local-tag">CÁLCULO LOCAL</span></div>' + studioFitReport(report) + '</article>' +
      (summary ? '<article class="panel studio-brief-panel">' + summary + '</article>' : '') +
    '</div></div>' +
    '<article class="panel studio-history-panel"><div class="panel-heading"><div><p class="eyebrow">SESSÕES DO ESTÚDIO</p><h2>Prévias e briefs recentes</h2></div><span class="heading-counter">' + countLabel(state.studio.jobs.length, "registro local", "registros locais") + '</span></div><div class="studio-history-list">' + (history || '<div class="empty-inline">As sessões deste estúdio aparecerão aqui.</div>') + '</div></article>' +
    '<dialog class="modal" id="studio-model-dialog"><form data-form="studio-model"><div class="modal-header"><div><p class="eyebrow">PERFIL SINTÉTICO</p><h2>Nova silhueta de referência</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Fechar">×</button></div><p class="modal-copy">Use medidas de manequim ou perfil fictício da marca. Este cadastro fica apenas no preview local.</p><div class="form-grid"><label class="field-span">Nome do perfil<input name="name" maxlength="60" placeholder="Ex.: Silhueta Aurora · Alta" required></label><label>Altura (cm)<input name="heightCm" type="number" min="120" max="220" value="168" required></label><label>Grade de referência<input name="sizeReference" maxlength="32" placeholder="M · 40" required></label><label class="field-span">Preferência de caimento<select name="fitPreference"><option>Justa</option><option selected>Regular</option><option>Confortável</option></select></label>' + [
      ["chest", "Busto"], ["waist", "Cintura"], ["hip", "Quadril"], ["shoulder", "Ombros"], ["thigh", "Coxa"],
    ].map(([key, label]) => '<label>' + label + ' (cm)<input name="model__' + key + '" type="number" min="20" max="250" step="0.1" required></label>').join("") + '</div><button class="button button-primary button-wide" type="submit">Salvar perfil local</button></form></dialog>' +
    fitProfileDialog(state.catalog.products.find((item) => item.id === session.editFitProfileId)) +
    reviewDialog +
    '</section>';
}

function productEditDialog(product) {
  if (!product) return "";
  const priceRows = product.variants.map((variant) =>
    '<label class="product-price-row"><span class="swatch ' + swatchClass(variant.colorHex) + '"></span><span class="product-price-variant"><strong>' + escapeHtml(variant.size + " · " + variant.color) + '</strong><small>' + escapeHtml(variant.sku) + '</small></span><input name="price__' + escapeHtml(variant.id) + '" inputmode="decimal" value="' + escapeHtml(money(variant.priceCents)) + '" aria-label="Preço de ' + escapeHtml(variant.size + " " + variant.color) + '" required></label>').join("");
  return '<dialog class="modal modal-wide" id="product-edit-dialog"><form data-form="product-edit" data-product-id="' + escapeHtml(product.id) + '"><div class="modal-header"><div><p class="eyebrow">EDITAR CATÁLOGO</p><h2>' + escapeHtml(product.name) + '</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Fechar">×</button></div><div class="form-grid"><label>Nome da peça<input name="name" maxlength="100" value="' + escapeHtml(product.name) + '" required></label><label>Categoria<input value="' + escapeHtml(product.category) + '" readonly><small>A categoria e o tipo preservam a ficha de caimento existente.</small></label><label class="field-span">Descrição<textarea name="description" maxlength="260" rows="3">' + escapeHtml(product.description) + '</textarea></label></div><div class="fit-profile-section product-price-section"><div><p class="eyebrow">PREÇO DE VENDA</p><h3>Valores por variante</h3></div><div class="product-price-list">' + priceRows + '</div></div><p class="product-edit-note">Os SKUs, os saldos e as vendas já registradas permanecem com seus valores originais.</p><button class="button button-primary button-wide" type="submit">Salvar alterações</button></form></dialog>';
}

export function renderProductsPage(state, query = "", ui = {}) {
  const category = MODA_CATEGORIES.includes(ui.catalogCategory) ? ui.catalogCategory : "Todas";
  const categoryOptions = ["Todas", ...MODA_CATEGORIES];
  const categoryFilters = categoryOptions.map((item) => {
    const count = item === "Todas"
      ? state.catalog.products.length
      : state.catalog.products.filter((product) => product.category === item).length;
    return '<button type="button" class="filter-chip ' + (category === item ? "is-active" : "") + '" data-catalog-category="' + escapeHtml(item) + '" aria-pressed="' + (category === item ? "true" : "false") + '">' + escapeHtml(item) + '<span class="filter-chip-count">' + number(count) + '</span></button>';
  }).join("");
  const products = state.catalog.products.filter((product) =>
    (category === "Todas" || product.category === category)
    && searchMatches(query, product.name + " " + product.category + " " + product.variants.map((item) => item.sku + " " + item.color + " " + item.size).join(" ")));
  const rows = products.map((product) => {
    const activeCount = product.variants.filter((item) => item.active).length;
    const lowestPrice = Math.min(...product.variants.map((item) => item.priceCents));
    const onHand = product.variants.reduce((sum, item) => sum + stockForSku(state, item.sku), 0);
    const variantRows = product.variants.map((variant) =>
      '<div class="variant-detail-row"><span class="swatch ' + swatchClass(variant.colorHex) + '"></span><span>' + escapeHtml(variant.size) + '</span><span>' + escapeHtml(variant.color) + '</span><code>' + escapeHtml(variant.sku) + '</code><strong>' + escapeHtml(money(variant.priceCents)) + "</strong></div>").join("");
    const supportsFit = fitDimensionsForKind(product.kind).length > 0;
    const fitBadge = supportsFit ? '<span class="fit-profile-badge ' + (product.fitProfile ? "is-ready" : "") + '">' + (product.fitProfile ? "Ficha de caimento pronta" : "Ficha de caimento pendente") + '</span>' : "";
    const fitAction = supportsFit
      ? '<button class="button button-quiet" type="button" data-action="' + (product.fitProfile ? "studio-open" : "fit-profile-open") + '" data-product-id="' + escapeHtml(product.id) + '">' + icon("sparkle") + (product.fitProfile ? " Abrir no estúdio" : " Cadastrar caimento") + '</button>'
      : "";
    return '<article class="catalog-row catalog-product-card"><div class="catalog-media">' + productArt(product, false, true) + '<div class="catalog-media-labels"><span class="category-label">' + escapeHtml(product.category) + '</span><span class="status-pill ' + (product.active ? "status-active" : "status-off") + '">' + (product.active ? "Ativo" : "Arquivado") + '</span></div></div><div class="catalog-main"><div class="catalog-title-row"><div><h3>' + escapeHtml(product.name) + '</h3><p>' + escapeHtml(product.description) + '</p>' + fitBadge + '</div></div>' +
      '<div class="catalog-meta"><span>' + countLabel(activeCount, "variante", "variantes") + "</span><span>" + number(onHand) + " un. disponíveis</span><strong>A partir de " + escapeHtml(money(lowestPrice)) + "</strong></div>" +
      '<details class="variant-details"><summary>Ver SKUs e variantes</summary><div class="variant-details-list">' + variantRows + "</div></details></div>" +
      '<div class="catalog-actions"><button class="button button-quiet" type="button" data-action="product-edit" data-product-id="' + escapeHtml(product.id) + '">Editar dados</button>' + fitAction + '<button class="button button-quiet catalog-toggle" type="button" data-action="product-toggle" data-product-id="' + escapeHtml(product.id) + '">' + (product.active ? "Arquivar" : "Reativar") + "</button></div></article>";
  }).join("");
  return '<section class="page-section">' +
    pageHeading("CATÁLOGO", "Produtos e variantes", "Organize suas peças por cor, tamanho, numeração e SKU.", button(icon("plus") + " Cadastrar produto", "show-product-dialog", "primary")) +
    '<div class="catalog-summary"><div><span>Produtos</span><strong>' + number(state.catalog.products.length) + '</strong></div><div><span>Variantes ativas</span><strong>' + number(state.catalog.products.filter((product) => product.active).flatMap((product) => product.variants).filter((variant) => variant.active).length) + '</strong></div><div><span>Fichas de caimento</span><strong>' + countLabel(state.catalog.products.filter((item) => item.active && item.fitProfile).length, "peça", "peças") + '</strong></div><label class="search-field"><span>' + icon("search") + '</span><input type="search" data-global-search placeholder="Buscar produto ou SKU" value="' + escapeHtml(query) + '"></label></div>' +
    '<div class="catalog-filter-row" role="group" aria-label="Filtrar catálogo por categoria">' + categoryFilters + '</div>' +
    '<div class="catalog-list">' + (rows || (state.catalog.products.length
      ? '<div class="empty-state"><span class="empty-icon">' + icon("search") + '</span><h3>Nenhum produto encontrado</h3><p>Ajuste a busca ou escolha outra categoria para ver mais peças.</p></div>'
      : '<div class="empty-state"><span class="empty-icon">' + icon("hanger") + '</span><h3>Seu catálogo começa aqui</h3><p>Cadastre sua primeira peça com tamanhos, cores e SKUs.</p></div>')) + "</div>" +
    '<dialog class="modal modal-wide" id="product-dialog"><form data-form="product"><div class="modal-header"><div><p class="eyebrow">NOVO PRODUTO</p><h2>Adicionar ao catálogo</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Fechar">×</button></div><div class="form-grid"><label>Nome da peça<input name="name" maxlength="100" placeholder="Ex.: Saia Midi Íris" required></label><label>Categoria<select name="category" data-product-category><option>Roupas</option><option>Calçados</option><option>Bolsas</option><option>Acessórios</option></select></label><label class="product-kind-field" data-product-kind-field>Tipo de roupa<select name="kind"><option value="shirt">Blusa ou camisa</option><option value="dress">Vestido</option><option value="trousers">Calça</option><option value="other">Outra peça</option></select><small>Usado para apresentar a ficha de caimento compatível.</small></label><label>Preço de venda<input name="price" inputmode="decimal" placeholder="R$ 189,90" required></label><label>Estoque inicial por variante<input name="initialStock" type="number" min="0" max="500" value="0"></label><label class="field-span">Tamanhos ou numerações<input name="sizes" placeholder="PP, P, M, G" required><small>Separe as opções por vírgula. Para peça única, use U.</small></label><label class="field-span">Cores<input name="colors" placeholder="Areia, Preto" required><small>Uma variante será criada para cada combinação de tamanho e cor.</small></label><label class="field-span">Descrição<textarea name="description" maxlength="260" rows="3" placeholder="Materiais, caimento ou cuidados da peça"></textarea></label></div><button class="button button-primary button-wide" type="submit">Salvar produto e variantes</button></form></dialog>' +
    productEditDialog(state.catalog.products.find((product) => product.id === ui.editProductId)) +
    fitProfileDialog(state.catalog.products.find((product) => product.id === ui.editFitProfileId)) +
  "</section>";
}

export function renderInventoryPage(state, query = "") {
  const variants = state.catalog.products.flatMap((product) => product.variants.map((variant) => ({ product, variant, stock: stockForSku(state, variant.sku) })));
  const activeVariants = variants.filter(({ product, variant }) => product.active && variant.active);
  const filtered = variants.filter(({ product, variant }) => searchMatches(query, product.name + " " + variant.sku + " " + variant.color + " " + variant.size));
  const low = activeVariants.filter(({ stock }) => stock <= state.settings.lowStockAt).length;
  const total = activeVariants.reduce((sum, item) => sum + item.stock, 0);
  const options = variants.filter(({ product, variant }) => product.active && variant.active).map(({ product, variant }) =>
    '<option value="' + escapeHtml(variant.sku) + '">' + escapeHtml(product.name + " · " + variant.size + " · " + variant.color + " · " + variant.sku) + "</option>").join("");
  const rows = filtered.map(({ product, variant, stock }) => {
    const inactiveLabel = !product.active ? "Produto arquivado" : !variant.active ? "Variante inativa" : null;
    const statusLabel = inactiveLabel ?? (stock === 0 ? "Esgotado" : stock <= state.settings.lowStockAt ? "Repor" : "Disponível");
    const statusClass = inactiveLabel ? "status-off" : stock <= state.settings.lowStockAt ? "status-low" : "status-active";
    return '<tr><td><div class="table-product">' + productArt(product, true) + '<div><strong>' + escapeHtml(product.name) + '</strong><small>' + escapeHtml(product.category) + ' · <span class="swatch ' + swatchClass(variant.colorHex) + '"></span></small></div></div></td><td>' + escapeHtml(variant.size) + '</td><td>' + escapeHtml(variant.color) + '</td><td><code>' + escapeHtml(variant.sku) + '</code></td><td><strong class="' + (stock <= state.settings.lowStockAt ? "text-warning" : "") + '">' + number(stock) + '</strong></td><td><span class="status-pill ' + statusClass + '">' + statusLabel + "</span></td></tr>";
  }).join("");
  const movements = [...state.inventory.movements].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 6).map((movement) => {
    const ref = state.inventory.references[movement.id];
    const incoming = movement.kind === "receive";
    return '<div class="movement-row"><span class="movement-icon ' + (incoming ? "movement-in" : "movement-out") + '">' + (incoming ? "↑" : "↓") + '</span><div><strong>' + escapeHtml(variantName(state, movement.sku)) + '</strong><small>' + escapeHtml(ref?.kind === "sale" ? "Venda #" + (ref.number ?? ref.sourceId.replace("sale-", "")) : ref?.kind === "customer-return" ? "Retorno de cliente" : ref?.kind === "stock-receipt" ? "Entrada de estoque" : ref?.kind === "exchange" ? "Troca" : "Movimento") + " · " + escapeHtml(dateLabel(movement.occurredAt, true)) + '</small></div><b class="' + (incoming ? "text-positive" : "") + '">' + (incoming ? "+" : "−") + number(movement.quantity) + "</b></div>";
  }).join("");
  return '<section class="page-section">' +
    pageHeading("OPERAÇÃO DA LOJA", "Estoque por variante", "Cada cor e tamanho possui seu próprio SKU e saldo disponível.", "") +
    '<div class="metrics-grid inventory-metrics">' +
      '<article class="metric-card"><div class="metric-top"><span>Unidades disponíveis</span><span class="metric-icon icon-olive">' + icon("box") + '</span></div><strong class="metric-value">' + number(total) + '</strong><small>somadas entre variantes ativas</small></article>' +
      '<article class="metric-card"><div class="metric-top"><span>Variantes cadastradas</span><span class="metric-icon icon-clay">' + icon("hanger") + '</span></div><strong class="metric-value">' + number(activeVariants.length) + '</strong><small>em ' + countLabel(state.catalog.products.filter((product) => product.active).length, "produto", "produtos") + '</small></article>' +
      '<article class="metric-card"><div class="metric-top"><span>Para repor</span><span class="metric-icon icon-gold">' + icon("clock") + '</span></div><strong class="metric-value">' + number(low) + '</strong><small>mínimo configurado: ' + state.settings.lowStockAt + ' un.</small></article></div>' +
    '<div class="panel receive-panel"><div><p class="eyebrow">ENTRADA DE MERCADORIA</p><h2>Registrar recebimento</h2></div><form data-form="inventory" class="receive-form"><label>Produto e variante<select name="sku">' + options + '</select></label><label>Quantidade recebida<input name="quantity" type="number" min="1" max="100000" value="1" required></label><button class="button button-primary" type="submit">' + icon("plus") + " Registrar entrada</button></form></div>" +
    '<div class="inventory-layout"><article class="panel table-panel"><div class="panel-heading"><div><p class="eyebrow">SALDO POR SKU</p><h2>Variantes da loja</h2></div><label class="search-field compact-search"><span>' + icon("search") + '</span><input type="search" data-global-search placeholder="Buscar produto ou SKU" value="' + escapeHtml(query) + '"></label></div><div class="table-scroll"><table><thead><tr><th>Produto</th><th>Tam.</th><th>Cor</th><th>SKU</th><th>Saldo</th><th>Status</th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="table-empty">Nenhuma variante encontrada.</td></tr>') + "</tbody></table></div></article>" +
    '<aside class="panel movement-panel"><div class="panel-heading"><div><p class="eyebrow">RASTREABILIDADE</p><h2>Movimentos recentes</h2></div></div>' + (movements || '<div class="empty-inline">Nenhum movimento registrado.</div>') + "</aside></div>" +
  "</section>";
}

export function renderCustomersPage(state, query = "", selectedId = null) {
  const customers = state.customers.records.filter((customer) => searchMatches(query, customer.name + " " + customer.phone + " " + customer.email));
  const selected = customers.find((item) => item.id === selectedId) ?? customers[0] ?? null;
  const rows = customers.map((customer) => {
    const metrics = customerMetrics(state, customer.id);
    return '<button class="customer-row ' + (selected?.id === customer.id ? "is-selected" : "") + '" type="button" data-customer-id="' + escapeHtml(customer.id) + '"><span class="customer-avatar">' + escapeHtml(customer.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()) + '</span><span class="customer-row-main"><strong>' + escapeHtml(customer.name) + '</strong><small>' + escapeHtml(customer.phone) + '</small></span><span class="customer-row-end"><strong>' + escapeHtml(money(metrics.spendCents)) + '</strong><small>' + countLabel(metrics.orders.length, "compra", "compras") + '</small></span></button>';
  }).join("");
  let detail = '<div class="empty-state"><span class="empty-icon">' + icon("people") + '</span><h3>Selecione uma cliente</h3><p>O histórico de compras aparecerá aqui.</p></div>';
  if (selected) {
    const metrics = customerMetrics(state, selected.id);
    const settlementNote = '<small class="customer-settlement-note">Valor de referência dos itens após devoluções e trocas; diferenças financeiras pendentes não representam pagamentos confirmados.</small>';
    const orders = metrics.orders.map((sale) =>
      '<div class="customer-order"><div><strong>Venda #' + escapeHtml(sale.number) + '</strong><small>' + escapeHtml(saleItems(state, sale)) + '</small></div><span>' + escapeHtml(money(sale.totalCents)) + '</span></div>').join("");
    detail = '<div class="customer-profile"><span class="profile-avatar">' + escapeHtml(selected.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()) + '</span><div><h2>' + escapeHtml(selected.name) + '</h2><p>' + escapeHtml(selected.email || "E-mail não informado") + " · " + escapeHtml(selected.phone) + '</p></div></div><div class="customer-stats"><div><small>Compras</small><strong>' + number(metrics.orders.length) + '</strong></div><div><small>Valor líquido de itens</small><strong>' + escapeHtml(money(metrics.spendCents)) + '</strong></div><div><small>Cliente desde</small><strong>' + escapeHtml(dateLabel(selected.joinedAt)) + '</strong></div></div>' + settlementNote + '<div class="panel-subheading"><h3>Histórico de vendas</h3></div>' + (orders || '<div class="empty-inline">Esta cliente ainda não tem vendas associadas.</div>');
  }
  return '<section class="page-section">' +
    pageHeading("RELACIONAMENTO", "Clientes", "Acompanhe o histórico de compras e preferências de quem escolhe a loja.", button(icon("plus") + " Nova cliente", "show-customer-dialog", "primary")) +
    '<div class="customer-layout"><article class="panel customer-list-panel"><div class="customer-list-toolbar"><label class="search-field"><span>' + icon("search") + '</span><input type="search" data-global-search placeholder="Buscar por nome, e-mail ou telefone" value="' + escapeHtml(query) + '"></label><span>' + countLabel(customers.length, "cadastro", "cadastros") + '</span></div>' + (rows || '<div class="empty-inline">Nenhuma cliente encontrada.</div>') + "</article><article class=\"panel customer-detail-panel\">" + detail + "</article></div>" +
    '<dialog class="modal" id="customer-dialog"><form data-form="customer"><div class="modal-header"><div><p class="eyebrow">RELACIONAMENTO</p><h2>Adicionar cliente</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Fechar">×</button></div><div class="form-stack"><label>Nome<input name="name" maxlength="100" required></label><label>Telefone<input name="phone" type="tel" maxlength="32" placeholder="(11) 99999-0000" required></label><label>E-mail <span class="optional-tag">opcional</span><input name="email" type="email" maxlength="160"></label></div><button class="button button-primary button-wide" type="submit">Salvar cliente</button></form></dialog>' +
  "</section>";
}

export function renderReturnsPage(state, selectedSaleId = null) {
  const sales = [...state.sales.orders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const selectedSale = sales.find((item) => item.id === selectedSaleId) ?? sales[0] ?? null;
  const saleOptions = sales.map((sale) => '<option value="' + escapeHtml(sale.id) + '" ' + (sale.id === selectedSale?.id ? "selected" : "") + ">#" + escapeHtml(sale.number) + " · " + escapeHtml(customerName(state, sale.id)) + " · " + escapeHtml(dateLabel(sale.createdAt)) + "</option>").join("");
  const returnableLines = selectedSale
    ? selectedSale.lines.map((line) => ({ line, quantity: returnableQuantity(state, selectedSale.id, line.sku) })).filter((item) => item.quantity > 0)
    : [];
  const itemOptions = returnableLines.map(({ line, quantity }) =>
    '<option value="' + escapeHtml(line.sku) + '" data-returnable="' + quantity + '">' + escapeHtml(variantName(state, line.sku)) + " · até " + quantity + " un. · " + escapeHtml(money(line.unitPriceCents)) + "</option>").join("");
  const replacementVariants = state.catalog.products.filter((product) => product.active)
    .flatMap((product) => product.variants.filter((variant) => variant.active).map((variant) => ({ product, variant, stock: stockForSku(state, variant.sku) })));
  const replacementOptions = replacementVariants.length
    ? '<option value="" disabled selected>Selecione a variante substituta</option>' + replacementVariants.map(({ product, variant, stock }) =>
      '<option value="' + escapeHtml(variant.sku) + '" data-stock="' + stock + '"' + (stock < 1 ? " disabled" : "") + '>' + escapeHtml(product.name + " · " + variant.size + " · " + variant.color + (stock > 0 ? " · " + stock + " un." : " · sem saldo")) + "</option>").join("")
    : '<option value="" disabled selected>Nenhuma variante ativa no catálogo</option>';
  const rows = state.returns.items.map((item) => {
    const found = productForSku(state, item.sku);
    const itemCell = found
      ? '<div class="return-item-cell">' + productArt(found.product, true) + '<span>' + escapeHtml(variantName(state, item.sku)) + "</span></div>"
      : escapeHtml(variantName(state, item.sku));
    const replacement = item.replacementSku ? productForSku(state, item.replacementSku) : null;
    const replacementLabel = replacement
      ? variantName(state, item.replacementSku)
      : item.replacementSku ? "Variante não localizada · " + item.replacementSku : "—";
    const difference = Number.isSafeInteger(item.differenceCents)
      ? item.differenceCents > 0 ? "Cliente paga " + money(item.differenceCents)
        : item.differenceCents < 0 ? "Crédito de " + money(Math.abs(item.differenceCents))
          : "Sem diferença de valor"
      : "Diferença não registrada";
    const exchangeSummary = item.type === "exchange"
      ? '<div class="return-exchange-summary"><strong>' + escapeHtml(replacementLabel) + '</strong><small>' + escapeHtml(difference) + "</small></div>"
      : '<span class="return-no-replacement">—</span>';
    return '<tr><td><strong>Venda #' + escapeHtml(item.saleId.replace("sale-", "")) + '</strong><small>' + escapeHtml(customerName(state, item.saleId)) + '</small></td><td>' + itemCell + '</td><td>' + (item.type === "exchange" ? "Troca" : "Devolução") + " · " + item.quantity + " un.</td><td>" + exchangeSummary + '</td><td>' + escapeHtml(item.reason) + '</td><td><strong>' + escapeHtml(money(item.valueCents)) + '</strong></td><td><span class="status-pill ' + (item.settlement === "pending" ? "status-pending" : "status-active") + '">' + (item.settlement === "pending" ? "Acerto pendente" : item.restocked ? "Estoque recebido" : "Sem reposição") + "</span></td></tr>";
  }).join("");
  return '<section class="page-section">' +
    pageHeading("PÓS-VENDA", "Trocas e devoluções", "Registre o retorno, confira a substituição e veja a diferença de valor antes de concluir.", "") +
    '<div class="returns-layout"><article class="panel return-form-panel"><div class="panel-heading"><div><p class="eyebrow">NOVO ATENDIMENTO</p><h2>Registrar troca ou devolução</h2></div><span class="metric-icon icon-clay">' + icon("return") + "</span></div>" +
      '<form data-form="return" class="form-stack"><label>Venda original<select name="saleId" data-return-sale>' + saleOptions + '</select></label><label>Peça devolvida<select name="sku" data-return-sku>' + (itemOptions || '<option value="" disabled selected>Nenhuma peça pendente nesta venda</option>') + '</select></label><div class="form-two"><label>Quantidade<input name="quantity" data-return-quantity type="number" min="1" max="' + Math.max(1, returnableLines[0]?.quantity ?? 0) + '" value="1"' + (returnableLines.length ? "" : " disabled") + ' required></label><label>Tipo<select name="type" data-return-type><option value="return">Devolução</option><option value="exchange">Troca por outra variante</option></select></label></div><label>Condição da peça<select name="condition"><option value="resalable">Em condição de revenda</option><option value="damaged">Com avaria · não retornar ao saldo</option></select></label><label class="replacement-field" hidden>Variante substituta<select name="replacementSku" data-return-replacement>' + replacementOptions + '</select><small class="form-hint" data-replacement-hint aria-live="polite">Escolha uma variante diferente com saldo suficiente para a quantidade devolvida.</small></label><div class="return-value-preview" data-return-value-preview role="status" aria-live="polite" hidden></div><label>Motivo<input name="reason" maxlength="180" placeholder="Ex.: tamanho não serviu" required></label>' +
      (selectedSale ? '<div class="return-sale-summary"><span>Venda #' + escapeHtml(selectedSale.number) + " · " + escapeHtml(customerName(state, selectedSale.id)) + '</span><strong>' + escapeHtml(money(selectedSale.totalCents)) + "</strong></div>" : "") +
      '<button class="button button-primary button-wide" type="submit" ' + (!selectedSale || !returnableLines.length ? "disabled" : "") + ">Registrar atendimento</button><p class=\"form-hint\">A diferença de valor é calculada, mas não é cobrada nem reembolsada sem o serviço de pagamentos.</p></form></article>" +
      '<aside class="panel return-guidance"><span class="guidance-icon">' + icon("sparkle") + '</span><h3>O estoque acompanha a peça.</h3><p>Itens em condição de revenda entram novamente no saldo. Peças com avaria ficam fora do disponível. Em uma troca, a variante substituta sai do estoque após a validação de saldo.</p><div class="guidance-rule"><span>Valor original</span><span>referência da venda</span></div><div class="guidance-rule"><span>Reposição</span><span>somente item vendável</span></div></aside></div>' +
    '<article class="panel table-panel return-history"><div class="panel-heading"><div><p class="eyebrow">HISTÓRICO</p><h2>Atendimentos recentes</h2></div><span class="heading-counter">' +
      countLabel(state.returns.items.length, "registro", "registros") + '</span></div><div class="table-scroll"><table><thead><tr><th>Venda / cliente</th><th>Peça</th><th>Tipo</th><th>Substituta / diferença</th><th>Motivo</th><th>Valor ref.</th><th>Estado</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7" class="table-empty">As trocas e devoluções aparecerão aqui.</td></tr>') +
      '</tbody></table></div></article>' +
  "</section>";
}

export function renderReportsPage(state, days = 7) {
  const report = deriveReport(state, days);
  const peak = Math.max(1, ...report.buckets.map((item) => Math.abs(item.netCents)));
  const bars = report.buckets.map((item) => {
    const amount = Math.abs(item.netCents);
    const direction = item.netCents < 0 ? "report-bar-negative" : "report-bar-positive";
    const bar = amount
      ? '<span class="report-bar ' + direction + " " + barHeightClass(amount / peak * 45) + '"></span>'
      : "";
    const label = item.label + ": " + money(item.netCents) + " líquido";
    return '<div class="report-bar-column"><strong>' + (item.netCents ? escapeHtml(money(item.netCents)) : "") + '</strong><div class="report-bar-track" role="img" aria-label="' + escapeHtml(label) + '">' + bar + '</div><small>' + escapeHtml(item.label) + "</small></div>";
  }).join("");
  const categories = report.categories.map(([name, cents], index) =>
    '<div class="category-report-row"><span class="category-dot category-dot-' + (index % 4) + '"></span><span>' + escapeHtml(name) + '</span><strong>' + escapeHtml(money(cents)) + '</strong><small>' + (report.totals.grossCents ? Math.round(cents / report.totals.grossCents * 100) : 0) + "%</small></div>").join("");
  const sales = [...state.sales.orders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 10).map((sale) =>
    '<tr><td><strong>Venda #' + escapeHtml(sale.number) + '</strong><small>' + escapeHtml(dateLabel(sale.createdAt, true)) + '</small></td><td>' + escapeHtml(customerName(state, sale.id)) + '</td><td>' + escapeHtml(saleItems(state, sale)) + '</td><td>' + escapeHtml(money(sale.totalCents)) + "</td></tr>").join("");
  return '<section class="page-section">' +
    pageHeading("INTELIGÊNCIA DA LOJA", "Relatórios", "Indicadores calculados a partir das vendas, devoluções e saldos atuais.", '<label class="period-select">Período<select data-report-days><option value="7" ' + (days === 7 ? "selected" : "") + '>Últimos 7 dias</option><option value="30" ' + (days === 30 ? "selected" : "") + ">Últimos 30 dias</option></select></label>") +
    '<div class="metrics-grid report-metrics"><article class="metric-card"><div class="metric-top"><span>Vendas brutas</span><span class="metric-icon icon-clay">' + icon("chart") + '</span></div><strong class="metric-value">' + escapeHtml(money(report.totals.grossCents)) + '</strong><small>no período selecionado</small></article><article class="metric-card"><div class="metric-top"><span>Itens devolvidos</span><span class="metric-icon icon-gold">' + icon("return") + '</span></div><strong class="metric-value">' + escapeHtml(money(report.totals.returnedCents)) + '</strong><small>inclui os itens que foram trocados</small></article><article class="metric-card"><div class="metric-top"><span>Mercadorias líquidas</span><span class="metric-icon icon-olive">' + icon("check") + '</span></div><strong class="metric-value">' + escapeHtml(money(report.totals.netCents)) + '</strong><small>bruto − devoluções + ' + escapeHtml(money(report.totals.replacementCents)) + ' em substituições; acertos não são pagamentos</small></article><article class="metric-card"><div class="metric-top"><span>Atendimentos</span><span class="metric-icon icon-lilac">' + icon("bag") + '</span></div><strong class="metric-value">' + number(report.totals.tickets) + '</strong><small>vendas concluídas</small></article></div>' +
    '<div class="reports-grid"><article class="panel report-chart-panel"><div class="panel-heading"><div><p class="eyebrow">TENDÊNCIA</p><h2>Mercadorias líquidas por dia</h2><p class="category-report-note">Inclui substituições; diferenças de troca não são pagamentos confirmados.</p></div></div><div class="report-chart">' + bars + "</div></article>" +
    '<article class="panel category-panel"><div class="panel-heading"><div><p class="eyebrow">MIX DE PRODUTOS</p><h2>Por categoria</h2><p class="category-report-note">Valores brutos do período; devoluções estão separadas no resumo acima.</p></div></div>' + (categories || '<div class="empty-inline">Sem vendas no período.</div>') + "</article></div>" +
    '<article class="panel table-panel report-sales-panel"><div class="panel-heading"><div><p class="eyebrow">DETALHAMENTO</p><h2>Vendas recentes</h2></div></div><div class="table-scroll"><table><thead><tr><th>Venda</th><th>Cliente</th><th>Itens</th><th>Total</th></tr></thead><tbody>' + (sales || '<tr><td colspan="4" class="table-empty">Sem vendas para exibir.</td></tr>') + "</tbody></table></div></article>" +
  "</section>";
}

export function renderTeamPage(state) {
  const rows = state.team.members.map((member) =>
    '<div class="team-row"><span class="team-avatar">' + escapeHtml(member.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()) + '</span><div class="team-main"><strong>' + escapeHtml(member.name) + '</strong><small>' + escapeHtml(member.email) + '</small></div><span class="role-pill">' + escapeHtml(member.role) + '</span><span class="status-pill ' + (member.status === "Ativa" ? "status-active" : "status-pending") + '">' + escapeHtml(member.status) + "</span></div>").join("");
  return '<section class="page-section">' +
    pageHeading("PESSOAS", "Equipe", "Veja quem está junto da operação da loja.", "") +
    '<div class="team-layout"><article class="panel team-list-panel"><div class="panel-heading"><div><p class="eyebrow">ATELIÊ AURORA</p><h2>Equipe da unidade</h2></div><span class="heading-counter">' + countLabel(state.team.members.length, "pessoa", "pessoas") + '</span></div>' + (rows || '<div class="empty-inline">Nenhuma pessoa cadastrada.</div>') + "</article>" +
    '<article class="panel invite-panel"><span class="invite-icon">' + icon("people") +
      '</span><p class="eyebrow">ACESSO À LOJA</p><h2>Adicionar pessoa</h2><p>Registre uma pessoa e sua função na operação da loja.</p>' +
      '<form data-form="team" class="form-stack"><label>Nome<input name="name" maxlength="100" required></label>' +
      '<label>E-mail<input name="email" type="email" maxlength="160" required></label>' +
      '<label>Função<select name="role"><option>Vendas</option><option>Estoque</option><option>Gerente</option></select></label>' +
      '<button class="button button-primary button-wide" type="submit">Adicionar à equipe</button></form></article></div>' +
    '<div class="notice-card"><span>' + icon("sparkle") + '</span><p>Permissões, vínculos ao Space e convites oficiais dependem do owner de Pessoas e Identity.</p></div>' +
  "</section>";
}

export function renderSettingsPage(state) {
  const s = state.settings;
  return [
    '<section class="page-section">',
    pageHeading("PREFERÊNCIAS", "Configurações", "Dados da unidade e parâmetros para a rotina da loja.", ""),
    '<div class="settings-layout"><article class="panel settings-form-panel"><div class="panel-heading"><div><p class="eyebrow">IDENTIDADE DA LOJA</p><h2>' + escapeHtml(s.storeName) + '</h2></div><span class="metric-icon icon-clay">' + icon("sparkle") + '</span></div>',
    '<form data-form="settings" class="settings-form"><div class="form-grid">',
    '<label>Nome da loja<input name="storeName" maxlength="80" value="' + escapeHtml(s.storeName) + '" required></label>',
    '<label>Unidade<input name="unitName" maxlength="80" value="' + escapeHtml(s.unitName) + '" required></label>',
    '<label>Telefone<input name="phone" maxlength="40" value="' + escapeHtml(s.phone) + '"></label>',
    '<label>Horário de atendimento<input name="openingHours" maxlength="100" value="' + escapeHtml(s.openingHours) + '"></label>',
    '<label class="field-span">Endereço<input name="address" maxlength="160" value="' + escapeHtml(s.address) + '"></label>',
    '<label>Alerta de estoque baixo<input name="lowStockAt" type="number" min="0" max="999" value="' + s.lowStockAt + '" required><small>Aplicado à leitura de todas as variantes.</small></label>',
    '</div><button class="button button-primary" type="submit">Salvar preferências</button></form></article>',
    '<aside class="panel settings-side"><div class="settings-brand"><span class="brand-seal">A</span><div><strong>' + escapeHtml(s.storeName) + '</strong><small>' + escapeHtml(s.unitName) + '</small></div></div>',
    '<div class="settings-divider"></div><div class="settings-line"><span>Telefone</span><strong>' + escapeHtml(s.phone) + '</strong></div>',
    '<div class="settings-line"><span>Endereço</span><strong>' + escapeHtml(s.address) + '</strong></div>',
    '<div class="settings-line"><span>Atendimento</span><strong>' + escapeHtml(s.openingHours) + '</strong></div>',
    '<div class="settings-divider"></div><button class="button button-quiet button-wide" type="button" data-action="reset-preview">Restaurar dados iniciais</button>',
    '<small class="settings-hint">A restauração afeta somente os dados locais deste navegador.</small></aside></div>',
    '</section>',
  ].join("");
}
