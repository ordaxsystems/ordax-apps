const COMPONENT_RUNTIME_SCHEMA = "ordax.component-runtime/1";
const SURFACE_SCHEMA = "ordax.surface-render-lifecycle/5";
const FILE_SPACE_SCHEMA = "ordax.file-space/11";
const APP_ACTIVATION_SCHEMA = "ordax.app-activation/1";
const VERSION = "0.2.0";
const STYLE_URL = new URL("../assets/pdf-viewer.css", import.meta.url).href;

function validPath(path) {
  return typeof path === "string"
    && path.startsWith("/")
    && !path.includes("\0")
    && !path.split("/").includes("..")
    && /\.pdf$/i.test(path);
}

async function styles(root) {
  const documentObject = root.ownerDocument;
  const selector = 'link[data-ordax-component-style="pdf-viewer"]';
  let link = documentObject.querySelector(selector);
  if (link) return () => {};
  link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL;
  link.dataset.ordaxComponentStyle = "pdf-viewer";
  documentObject.head.append(link);
  return () => link.remove();
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "pdf-viewer",
  version: VERSION,
  async mount({root, surfaceLifecycle, fileSpace, appActivation} = {}) {
    if (!root?.ownerDocument
      || surfaceLifecycle?.schema !== SURFACE_SCHEMA
      || typeof surfaceLifecycle.localization?.getLocale !== "function"
      || typeof surfaceLifecycle.localization?.subscribe !== "function"
      || fileSpace?.schema !== FILE_SPACE_SCHEMA
      || typeof fileSpace.readDocumentPreview !== "function"
      || appActivation?.schema !== APP_ACTIVATION_SCHEMA
      || typeof appActivation.subscribe !== "function") {
      throw new TypeError("PDF Viewer requires compatible public preview and activation ports");
    }
    const releaseStyles = await styles(root);
    const documentObject = root.ownerDocument;
    const section = documentObject.createElement("section");
    section.className = "ordax-pdf-viewer";
    section.innerHTML = '<header><strong data-title>PDF</strong><span data-path>Nenhum documento aberto</span></header><main data-stage><p data-empty>Abra um PDF pelo app Arquivos.</p></main>';
    const title = section.querySelector("[data-title]");
    const pathNode = section.querySelector("[data-path]");
    const stage = section.querySelector("[data-stage]");
    const empty = section.querySelector("[data-empty]");

    let url = "", embed = null, sequence = 0, destroyed = false;
    let viewState = "idle", unsubscribeActivation = null, unsubscribeLocale = null;
    const pt = () => String(surfaceLifecycle.localization.getLocale()).toLowerCase().startsWith("pt");
    const locale = () => {
      if (destroyed) return;
      title.textContent = "PDF";
      if (viewState === "idle") {
        pathNode.textContent = pt() ? "Nenhum documento aberto" : "No document open";
        empty.textContent = pt() ? "Abra um PDF pelo app Arquivos." : "Open a PDF from the Files app.";
      } else if (viewState === "loading") {
        empty.textContent = pt() ? "Carregando…" : "Loading…";
      } else if (viewState === "error") {
        empty.textContent = pt() ? "Não foi possível abrir este PDF." : "This PDF could not be opened.";
      }
    };
    const revoke = () => {
      if (!url) return;
      const oldUrl = url;
      url = "";
      globalThis.URL?.revokeObjectURL?.(oldUrl);
    };
    const releasePreview = () => {
      if (embed) {
        embed.remove();
        embed = null;
      }
      revoke();
    };
    const openPath = async path => {
      if (destroyed || !validPath(path)) return;
      const request = ++sequence;
      pathNode.textContent = path;
      pathNode.dataset.loaded = "true";
      viewState = "loading";
      empty.hidden = false;
      locale();
      releasePreview();
      try {
        const preview = await fileSpace.readDocumentPreview(path);
        if (destroyed || request !== sequence) return;
        if (!(preview?.bytes instanceof Uint8Array)
          || preview.bytes.byteLength === 0
          || preview.mime !== "application/pdf"
          || preview.path !== path) {
          throw new TypeError("Invalid or mismatched PDF preview");
        }
        const BlobCtor = globalThis.Blob;
        const create = globalThis.URL?.createObjectURL?.bind(globalThis.URL);
        if (typeof BlobCtor !== "function" || typeof create !== "function") {
          throw new TypeError("PDF URL primitives unavailable");
        }
        url = create(new BlobCtor([preview.bytes], {type:"application/pdf"}));
        embed = documentObject.createElement("embed");
        embed.className = "ordax-pdf-viewer__document";
        embed.type = "application/pdf";
        embed.src = url;
        stage.append(embed);
        viewState = "loaded";
        empty.hidden = true;
      } catch {
        if (destroyed || request !== sequence) return;
        releasePreview();
        viewState = "error";
        empty.hidden = false;
        locale();
      }
    };
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      sequence += 1;
      try {
        unsubscribeActivation?.();
      } finally {
        try {
          unsubscribeLocale?.();
        } finally {
          try {
            releasePreview();
          } finally {
            root.replaceChildren();
            releaseStyles();
          }
        }
      }
    };
    try {
      root.replaceChildren(section);
      locale();
      unsubscribeActivation = appActivation.subscribe(activation => {
        if (activation?.appId === "pdf-viewer" && validPath(activation.target)) {
          void openPath(activation.target);
        }
      });
      unsubscribeLocale = surfaceLifecycle.localization.subscribe(locale);
      return Object.freeze({destroy});
    } catch (error) {
      destroy();
      throw error;
    }
  },
});
