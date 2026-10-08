const COMPONENT_RUNTIME_SCHEMA = "ordax.component-runtime/1";
const SURFACE_SCHEMA = "ordax.surface-render-lifecycle/5";
const VERSION = "0.2.0";
const STYLE_URL = new URL("../assets/paint.css", import.meta.url).href;

async function styles(root) {
  const documentObject = root.ownerDocument;
  const selector = 'link[data-ordax-component-style="paint"]';
  let link = documentObject.querySelector(selector);
  if (link) return () => {};
  link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL;
  link.dataset.ordaxComponentStyle = "paint";
  documentObject.head.append(link);
  return () => link.remove();
}

function labels(locale) {
  return String(locale || "").toLowerCase().startsWith("pt")
    ? {title:"Desenho",clear:"Limpar",erase:"Borracha",draw:"Desenhar",save:"Salvar PNG",size:"Tamanho"}
    : {title:"Paint",clear:"Clear",erase:"Eraser",draw:"Draw",save:"Save PNG",size:"Size"};
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "paint",
  version: VERSION,
  async mount({root, surfaceLifecycle} = {}) {
    if (!root?.ownerDocument
      || surfaceLifecycle?.schema !== SURFACE_SCHEMA
      || typeof surfaceLifecycle.localization?.getLocale !== "function"
      || typeof surfaceLifecycle.localization?.subscribe !== "function") {
      throw new TypeError("Paint requires compatible Surface lifecycle and localization");
    }

    const releaseStyles = await styles(root);
    const documentObject = root.ownerDocument;
    const events = [];
    let unsubscribeLocale = null;
    let destroyed = false;
    const listen = (node, name, handler) => {
      node.addEventListener(name, handler);
      events.push([node, name, handler]);
    };
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      try {
        unsubscribeLocale?.();
      } finally {
        for (const [node, name, handler] of events) {
          node.removeEventListener(name, handler);
        }
        root.replaceChildren();
        releaseStyles();
      }
    };

    try {
      const section = documentObject.createElement("section");
      section.className = "ordax-basic-app ordax-paint";
      section.innerHTML = '<header><div><strong data-title></strong><span>Canvas 1280 × 720</span></div><div class="ordax-paint__tools"><input data-color type="color" value="#111111" aria-label="Color"><label><span data-size-label></span><input data-size type="range" min="1" max="40" value="4"></label><button type="button" data-mode></button><button type="button" data-clear></button><button type="button" data-save></button></div></header><main class="ordax-basic-app__stage"><canvas width="1280" height="720" data-canvas></canvas></main>';
      root.replaceChildren(section);
      const title = section.querySelector("[data-title]");
      const sizeLabel = section.querySelector("[data-size-label]");
      const mode = section.querySelector("[data-mode]");
      const clear = section.querySelector("[data-clear]");
      const save = section.querySelector("[data-save]");
      const color = section.querySelector("[data-color]");
      const size = section.querySelector("[data-size]");
      const canvas = section.querySelector("[data-canvas]");
      const ctx = canvas.getContext("2d", {alpha:false});
      if (!ctx) throw new TypeError("Canvas 2D is unavailable");

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      let drawing = false, eraser = false, last = null;
      const applyLocale = () => {
        if (destroyed) return;
        const text = labels(surfaceLifecycle.localization.getLocale());
        title.textContent = text.title;
        sizeLabel.textContent = text.size;
        mode.textContent = eraser ? text.draw : text.erase;
        clear.textContent = text.clear;
        save.textContent = text.save;
      };
      const point = event => {
        const rect = canvas.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) return null;
        return {
          x:(event.clientX - rect.left) * (canvas.width / rect.width),
          y:(event.clientY - rect.top) * (canvas.height / rect.height),
        };
      };
      const down = event => {
        const position = point(event);
        if (!position) return;
        drawing = true;
        last = position;
        canvas.setPointerCapture?.(event.pointerId);
      };
      const move = event => {
        if (!drawing || !last) return;
        const position = point(event);
        if (!position) return;
        ctx.strokeStyle = eraser ? "#ffffff" : color.value;
        ctx.lineWidth = Number(size.value) || 4;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(position.x, position.y);
        ctx.stroke();
        last = position;
      };
      const up = () => {
        drawing = false;
        last = null;
      };
      const toggle = () => {
        eraser = !eraser;
        applyLocale();
      };
      const reset = () => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      };
      const exportPng = () => {
        const anchor = documentObject.createElement("a");
        anchor.download = "ordax-drawing.png";
        anchor.href = canvas.toDataURL("image/png");
        anchor.click();
      };
      listen(canvas, "pointerdown", down);
      listen(canvas, "pointermove", move);
      listen(canvas, "pointerup", up);
      listen(canvas, "pointercancel", up);
      listen(mode, "click", toggle);
      listen(clear, "click", reset);
      listen(save, "click", exportPng);
      unsubscribeLocale = surfaceLifecycle.localization.subscribe(applyLocale);
      applyLocale();
      return Object.freeze({destroy});
    } catch (error) {
      destroy();
      throw error;
    }
  },
});
