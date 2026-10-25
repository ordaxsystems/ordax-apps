// Internal preview presentation only. The Space host keeps ownership of navigation,
// context, capabilities, grants, and readiness; this file does not implement their port.
export const FOOD_PREVIEW_PRESENTATIONS = Object.freeze(["standalone-preview", "embedded-preview"]);
export const FOOD_MODULE_VIEWS = Object.freeze([
  "orders", "kitchen", "menu", "tables", "delivery", "settings",
]);

export function assertFoodPreviewPresentation(presentation, dataPort) {
  if (!FOOD_PREVIEW_PRESENTATIONS.includes(presentation)) {
    throw new TypeError("Apresentação Food desconhecida.");
  }
  // Both preview shells are sandbox-only. A future Space provider must enter
  // through its own authorized host lifecycle, not by swapping this data port.
  if (dataPort?.context?.adapter !== "browser-local-preview") {
    throw new Error("A prévia Food exige dados fictícios locais; o host Space ainda não está autorizado.");
  }
  return presentation;
}

export function assertFoodModuleView(view) {
  if (!FOOD_MODULE_VIEWS.includes(view)) {
    throw new TypeError("A navegação incorporada aceita somente módulos operacionais do Food.");
  }
  return view;
}

export function renderEmbeddedFoodPreview(content, noticeHtml = "") {
  if (typeof content !== "string" || typeof noticeHtml !== "string") {
    throw new TypeError("Conteúdo Food inválido.");
  }
  return `<div class="food-embedded-preview" data-preview-only="true">
    <p class="food-preview-disclaimer" role="status"><strong>Prévia local</strong> · dados fictícios, sem autenticação ou sincronização com Space</p>
    <main id="main-content" class="content" tabindex="-1">${noticeHtml}${content}</main>
  </div>`;
}
