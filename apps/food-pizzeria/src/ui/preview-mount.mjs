// Preview-host boundary only. A real Space host must use the published App SDK
// provider/lifecycle contracts, never this local document bootstrap.
const DIALOG_IDS = Object.freeze(["cancel-dialog", "table-open-dialog"]);

export function createFoodPreviewMount(document, presentation) {
  const host = document?.querySelector?.("#app");
  if (!host) throw new TypeError("O host local não encontrou a área de montagem do OrdaX Food.");
  if (presentation === "standalone-preview") return host;
  if (presentation !== "embedded-preview") throw new TypeError("Apresentação de prévia desconhecida.");

  const stylesheet = document.querySelector('link[data-food-preview-stylesheet]');
  const dialogs = DIALOG_IDS.map((id) => document.getElementById(id));
  if (!stylesheet || dialogs.some((dialog) => !dialog) || typeof host.attachShadow !== "function") {
    throw new Error("A prévia incorporável exige stylesheet, diálogos e Shadow DOM disponíveis.");
  }

  // Keep native dialogs, their forms and the *existing* Food stylesheet in one
  // isolated root. Never import Food's global selectors into the host Space.
  const shadowRoot = host.attachShadow({ mode: "open" });
  const localStylesheet = stylesheet.cloneNode(true);
  shadowRoot.append(localStylesheet);
  stylesheet.remove();

  const root = document.createElement("div");
  root.className = "food-preview-content-root";
  shadowRoot.append(root);
  for (const dialog of dialogs) shadowRoot.append(dialog);
  return root;
}
