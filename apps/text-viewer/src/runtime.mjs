const COMPONENT_RUNTIME_SCHEMA = "ordax.component-runtime/1";
const SURFACE_SCHEMA = "ordax.surface-render-lifecycle/5";
const FILE_SPACE_SCHEMA = "ordax.file-space/11";
const APP_ACTIVATION_SCHEMA = "ordax.app-activation/1";
const VERSION = "0.2.0";
const STYLE_URL = new URL("../assets/text-viewer.css", import.meta.url).href;

function validPath(path) {
  return typeof path === "string"
    && path.startsWith("/")
    && !path.includes("\0")
    && !path.split("/").includes("..");
}

async function styles(root) {
  const documentObject = root.ownerDocument;
  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL;
  link.dataset.ordaxComponentStyle = "text-viewer";
  documentObject.head.append(link);
  return () => link.remove();
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "text-viewer",
  version: VERSION,
  async mount({ root, surfaceLifecycle, fileSpace, appActivation } = {}) {
    if (
      !root?.ownerDocument
      || surfaceLifecycle?.schema !== SURFACE_SCHEMA
      || typeof surfaceLifecycle.localization?.getLocale !== "function"
      || typeof surfaceLifecycle.localization?.subscribe !== "function"
      || fileSpace?.schema !== FILE_SPACE_SCHEMA
      || typeof fileSpace.readTextFile !== "function"
      || appActivation?.schema !== APP_ACTIVATION_SCHEMA
      || typeof appActivation.subscribe !== "function"
    ) {
      throw new TypeError("Text Viewer requires compatible public ports");
    }

    const releaseStyles = await styles(root);
    const documentObject = root.ownerDocument;
    const section = documentObject.createElement("section");
    section.className = "ordax-text-viewer";
    section.innerHTML = '<header><strong data-title>Visualizador de Texto</strong><span data-path>Nenhum arquivo aberto</span></header><pre data-content>Abra um arquivo de texto pelo app Arquivos.</pre>';

    let destroyed = false;
    let requestSequence = 0;
    let viewState = "idle";
    let unsubscribeActivation = null;
    let unsubscribeLocale = null;

    const title = section.querySelector("[data-title]");
    const pathNode = section.querySelector("[data-path]");
    const content = section.querySelector("[data-content]");

    const isPortuguese = () =>
      String(surfaceLifecycle.localization.getLocale()).toLowerCase().startsWith("pt");

    const applyLocale = () => {
      if (destroyed) return;
      const pt = isPortuguese();
      title.textContent = pt ? "Visualizador de Texto" : "Text Viewer";
      if (viewState === "idle") {
        pathNode.textContent = pt ? "Nenhum arquivo aberto" : "No file open";
        content.textContent = pt
          ? "Abra um arquivo de texto pelo app Arquivos."
          : "Open a text file from the Files app.";
      } else if (viewState === "loading") {
        content.textContent = pt ? "Carregando…" : "Loading…";
      } else if (viewState === "error") {
        content.textContent = pt
          ? "Não foi possível abrir este arquivo de texto."
          : "This text file could not be opened.";
      }
    };

    const open = async (activation) => {
      if (
        destroyed
        || activation?.appId !== "text-viewer"
        || !validPath(activation.target)
      ) return;

      // Only the newest activation may render. Older File Space reads are
      // not cancellable by this app, but their results must never become UI.
      const sequence = ++requestSequence;
      const requestedPath = activation.target;
      pathNode.textContent = requestedPath;
      viewState = "loading";
      applyLocale();

      try {
        const file = await fileSpace.readTextFile(requestedPath);
        if (destroyed || sequence !== requestSequence) return;
        if (
          !file
          || file.path !== requestedPath
          || typeof file.text !== "string"
        ) {
          throw new TypeError("File Space response does not match activation");
        }
        pathNode.textContent = file.path;
        content.textContent = file.text;
        viewState = "loaded";
      } catch {
        if (destroyed || sequence !== requestSequence) return;
        viewState = "error";
        applyLocale();
      }
    };

    const cleanup = () => {
      if (destroyed) return;
      destroyed = true;
      requestSequence += 1;
      try {
        unsubscribeActivation?.();
      } finally {
        try {
          unsubscribeLocale?.();
        } finally {
          root.replaceChildren();
          releaseStyles();
        }
      }
    };

    try {
      root.replaceChildren(section);
      applyLocale();
      unsubscribeActivation = appActivation.subscribe(open);
      unsubscribeLocale = surfaceLifecycle.localization.subscribe(applyLocale);
      return Object.freeze({ destroy: cleanup });
    } catch (error) {
      cleanup();
      throw error;
    }
  },
});
