// Internal preview presentation only. The Space host keeps ownership of navigation,
// context, capabilities, grants, and readiness; this file does not implement their port.
export const FOOD_PREVIEW_PRESENTATIONS = Object.freeze(["standalone-preview", "embedded-preview"]);
export const FOOD_MODULE_VIEWS = Object.freeze([
  "orders", "pos", "kitchen", "menu", "tables", "delivery", "settings",
]);

export function assertFoodPreviewPresentation(presentation, dataPort) {
  if (!FOOD_PREVIEW_PRESENTATIONS.includes(presentation)) {
    throw new TypeError("Apresentação Food desconhecida.");
  }
  // Both preview shells are sandbox-only. A future Space provider must enter
  // through its own authorized host lifecycle, not by swapping this data port.
  if (dataPort?.context?.adapter !== "browser-local-preview") {
    throw new Error("O Food incorporado exige seu adapter local; o host Space ainda não está autorizado.");
  }
  return presentation;
}

export function assertFoodModuleView(view) {
  if (!FOOD_MODULE_VIEWS.includes(view)) {
    throw new TypeError("A navegação incorporada aceita somente módulos operacionais do Food.");
  }
  return view;
}

export function renderEmbeddedFoodPreview(content, noticeHtml = "", { kitchenStation = false } = {}) {
  if (typeof content !== "string" || typeof noticeHtml !== "string"
    || typeof kitchenStation !== "boolean") {
    throw new TypeError("Conteúdo Food inválido.");
  }
  return `<div class="food-embedded-preview${kitchenStation ? " food-embedded-preview-kitchen" : ""}" data-preview-only="true">
    <main id="main-content" class="content" tabindex="-1">${noticeHtml}${content}</main>
  </div>`;
}
