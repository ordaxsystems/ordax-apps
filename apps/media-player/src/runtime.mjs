const COMPONENT_RUNTIME_SCHEMA = "ordax.component-runtime/1";
const SURFACE_SCHEMA = "ordax.surface-render-lifecycle/5";
const FILE_SPACE_SCHEMA = "ordax.file-space/11";
const APP_ACTIVATION_SCHEMA = "ordax.app-activation/1";
const VERSION = "0.2.0";
const STYLE_URL = new URL("../assets/media-player.css", import.meta.url).href;
const MEDIA_RE = /\.(?:aac|flac|m4a|mp3|oga|ogg|wav|m4v|mp4|ogv|webm)$/i;
const MEDIA_MIME = /^(?:audio|video)\/[a-z0-9][a-z0-9.+-]*$/;

function validPath(path) {
  return typeof path === "string"
    && path.startsWith("/")
    && !path.includes("\0")
    && !path.split("/").includes("..");
}
function parentPath(path) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? "/" + parts.join("/") : "/";
}
function joinPath(parent, name) {
  return parent === "/" ? "/" + name : parent + "/" + name;
}
function safeEntry(entry) {
  return entry?.kind === "file"
    && typeof entry.name === "string"
    && entry.name !== "." && entry.name !== ".."
    && !entry.name.includes("/")
    && !entry.name.includes("\\")
    && !entry.name.includes("\0")
    && MEDIA_RE.test(entry.name);
}
async function styles(root) {
  const documentObject = root.ownerDocument;
  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL;
  link.dataset.ordaxComponentStyle = "media-player";
  documentObject.head.append(link);
  return () => link.remove();
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "media-player",
  version: VERSION,
  async mount({root, surfaceLifecycle, fileSpace, appActivation} = {}) {
    if (!root?.ownerDocument
      || surfaceLifecycle?.schema !== SURFACE_SCHEMA
      || typeof surfaceLifecycle.localization?.getLocale !== "function"
      || typeof surfaceLifecycle.localization?.subscribe !== "function"
      || fileSpace?.schema !== FILE_SPACE_SCHEMA
      || typeof fileSpace.readMediaPreview !== "function"
      || typeof fileSpace.list !== "function"
      || appActivation?.schema !== APP_ACTIVATION_SCHEMA
      || typeof appActivation.subscribe !== "function") {
      throw new TypeError("Media Player requires compatible public preview and activation ports");
    }
    const releaseStyles = await styles(root);
    const documentObject = root.ownerDocument;
    const section = documentObject.createElement("section");
    section.className = "ordax-media-player";
    section.innerHTML = '<header><div><strong data-title>Mídia</strong><span data-path>Nenhum arquivo aberto</span></div><div><button type="button" data-prev aria-label="Anterior">‹</button><button type="button" data-next aria-label="Próximo">›</button></div></header><main data-stage><p data-empty>Abra um vídeo ou áudio pelo app Arquivos.</p></main>';
    const title = section.querySelector("[data-title]");
    const pathNode = section.querySelector("[data-path]");
    const stage = section.querySelector("[data-stage]");
    const empty = section.querySelector("[data-empty]");
    const prev = section.querySelector("[data-prev]");
    const next = section.querySelector("[data-next]");

    let url = "", element = null, currentPath = "", siblings = [], sequence = 0;
    let destroyed = false, viewState = "idle";
    let unsubscribeActivation = null, unsubscribeLocale = null;
    const current = request => !destroyed && request === sequence;
    const pt = () => String(surfaceLifecycle.localization.getLocale()).toLowerCase().startsWith("pt");
    const revoke = () => {
      if (!url) return;
      const oldUrl = url;
      url = "";
      globalThis.URL?.revokeObjectURL?.(oldUrl);
    };
    const releaseMedia = () => {
      try {
        if (element) {
          const old = element;
          element = null;
          try {
            old.pause?.();
          } finally {
            old.remove();
          }
        }
      } finally {
        // Revoke even if pausing or detaching the media element throws.
        revoke();
      }
    };
    const locale = () => {
      if (destroyed) return;
      title.textContent = pt() ? "Mídia" : "Media";
      prev.setAttribute("aria-label", pt() ? "Anterior" : "Previous");
      next.setAttribute("aria-label", pt() ? "Próximo" : "Next");
      if (viewState === "idle") {
        pathNode.textContent = pt() ? "Nenhum arquivo aberto" : "No file open";
        empty.textContent = pt()
          ? "Abra um vídeo ou áudio pelo app Arquivos."
          : "Open a video or audio file from the Files app.";
      } else if (viewState === "loading") {
        empty.textContent = pt() ? "Carregando…" : "Loading…";
      } else if (viewState === "error") {
        empty.textContent = pt()
          ? "Não foi possível reproduzir este arquivo."
          : "This media file could not be played.";
      }
    };
    const updateNavigation = () => {
      const index = siblings.indexOf(currentPath);
      prev.disabled = index <= 0;
      next.disabled = index < 0 || index >= siblings.length - 1;
    };
    const loadSiblings = async (path, request) => {
      let paths;
      try {
        const parent = parentPath(path);
        const listing = await fileSpace.list(parent);
        if (!Array.isArray(listing?.entries)) throw new TypeError("Invalid File Space listing");
        paths = listing.entries
          .filter(safeEntry)
          .map(entry => joinPath(parent, entry.name))
          .sort((a,b) => a.localeCompare(b));
      } catch {
        paths = [path];
      }
      if (!current(request)) return;
      if (!paths.includes(path)) paths.push(path);
      siblings = paths;
      updateNavigation();
    };
    const openPath = async path => {
      if (destroyed || !validPath(path)) return;
      const request = ++sequence;
      currentPath = path;
      siblings = [path];
      updateNavigation();
      pathNode.textContent = path;
      pathNode.dataset.loaded = "true";
      empty.hidden = false;
      viewState = "loading";
      locale();
      releaseMedia();
      try {
        await loadSiblings(path, request);
        if (!current(request)) return;
        const preview = await fileSpace.readMediaPreview(path);
        if (!current(request)) return;
        if (!(preview?.bytes instanceof Uint8Array)
          || preview.bytes.byteLength === 0
          || !MEDIA_MIME.test(preview.mime)
          || preview.path !== path) {
          throw new TypeError("Invalid or mismatched media preview");
        }
        const isVideo = preview.mime.startsWith("video/");
        const BlobCtor = globalThis.Blob;
        const create = globalThis.URL?.createObjectURL?.bind(globalThis.URL);
        if (typeof BlobCtor !== "function" || typeof create !== "function") {
          throw new TypeError("Media URL primitives unavailable");
        }
        url = create(new BlobCtor([preview.bytes], {type:preview.mime}));
        element = documentObject.createElement(isVideo ? "video" : "audio");
        element.controls = true;
        element.preload = "metadata";
        element.src = url;
        element.className = "ordax-media-player__element";
        stage.append(element);
        empty.hidden = true;
        viewState = "loaded";
      } catch {
        if (!current(request)) return;
        try {
          releaseMedia();
        } finally {
          viewState = "error";
          empty.hidden = false;
          locale();
        }
      }
      if (current(request)) updateNavigation();
    };
    const navigate = delta => {
      if (destroyed) return;
      const index = siblings.indexOf(currentPath);
      const target = siblings[index + delta];
      if (target) void openPath(target);
    };
    const onPrev = () => navigate(-1);
    const onNext = () => navigate(1);
    const onKey = event => {
      if (event.key === "ArrowLeft" && event.altKey) {
        event.preventDefault();
        navigate(-1);
      } else if (event.key === "ArrowRight" && event.altKey) {
        event.preventDefault();
        navigate(1);
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
          prev.removeEventListener("click", onPrev);
          next.removeEventListener("click", onNext);
          section.removeEventListener("keydown", onKey);
          try {
            releaseMedia();
          } finally {
            root.replaceChildren();
            releaseStyles();
          }
        }
      }
    };
    try {
      root.replaceChildren(section);
      prev.addEventListener("click", onPrev);
      next.addEventListener("click", onNext);
      section.addEventListener("keydown", onKey);
      section.tabIndex = 0;
      unsubscribeActivation = appActivation.subscribe(activation => {
        if (activation?.appId === "media-player" && validPath(activation.target)) {
          void openPath(activation.target);
        }
      });
      unsubscribeLocale = surfaceLifecycle.localization.subscribe(locale);
      locale();
      updateNavigation();
      return Object.freeze({destroy});
    } catch (error) {
      destroy();
      throw error;
    }
  },
});
