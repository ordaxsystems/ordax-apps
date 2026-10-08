const COMPONENT_RUNTIME_SCHEMA = "ordax.component-runtime/1";
const SURFACE_SCHEMA = "ordax.surface-render-lifecycle/5";
const VERSION = "0.2.0";
const STYLE_URL = new URL("../assets/character-map.css", import.meta.url).href;

const BLOCKS = Object.freeze([
  Object.freeze({ id: "latin", start: 0x20, end: 0xff }),
  Object.freeze({ id: "greek", start: 0x370, end: 0x3ff }),
  Object.freeze({ id: "symbols", start: 0x2000, end: 0x206f }),
  Object.freeze({ id: "currency", start: 0x20a0, end: 0x20cf }),
  Object.freeze({ id: "arrows", start: 0x2190, end: 0x21ff }),
  Object.freeze({ id: "math", start: 0x2200, end: 0x22ff }),
]);

function messages(locale) {
  const pt = String(locale || "").toLowerCase().startsWith("pt");
  return pt
    ? {
        title: "Mapa de Caracteres",
        search: "Código Unicode (ex.: 03A9)",
        select: "Selecione um caractere",
        blocks: { latin: "Latin-1", greek: "Grego", symbols: "Símbolos", currency: "Moedas", arrows: "Setas", math: "Matemática" },
      }
    : {
        title: "Character Map",
        search: "Unicode code point (e.g. 03A9)",
        select: "Select a character",
        blocks: { latin: "Latin-1", greek: "Greek", symbols: "Symbols", currency: "Currency", arrows: "Arrows", math: "Math" },
      };
}

async function mountStyles(root) {
  const d = root.ownerDocument;
  const link = d.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL;
  link.dataset.ordaxComponentStyle = "character-map";
  d.head.append(link);
  return () => link.remove();
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "character-map",
  version: VERSION,
  async mount({ root, surfaceLifecycle } = {}) {
    if (!root?.ownerDocument || surfaceLifecycle?.schema !== SURFACE_SCHEMA) {
      throw new TypeError("Character Map requires Surface lifecycle");
    }
    const releaseStyles = await mountStyles(root);
    const d = root.ownerDocument;
    const section = d.createElement("section");
    section.className = "ordax-character-map";
    root.replaceChildren(section);

    let selectedBlock = 0;
    let selectedCodePoint = null;

    const render = () => {
      const t = messages(surfaceLifecycle.localization.getLocale());
      section.innerHTML = `
        <header>
          <h1>${t.title}</h1>
          <select data-block></select>
          <input data-search placeholder="${t.search}">
        </header>
        <div data-grid></div>
        <output data-selected>${t.select}</output>`;

      const select = section.querySelector("[data-block]");
      const search = section.querySelector("[data-search]");
      const grid = section.querySelector("[data-grid]");
      const output = section.querySelector("[data-selected]");

      BLOCKS.forEach((block, index) => {
        const option = d.createElement("option");
        option.value = String(index);
        option.textContent = t.blocks[block.id];
        option.selected = index === selectedBlock;
        select.append(option);
      });

      const showCharacter = (codePoint) => {
        selectedCodePoint = codePoint;
        const character = String.fromCodePoint(codePoint);
        output.textContent = `${character}   U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
      };

      const renderGrid = () => {
        selectedBlock = Number(select.value) || 0;
        const block = BLOCKS[selectedBlock];
        grid.replaceChildren();
        for (let codePoint = block.start; codePoint <= block.end; codePoint += 1) {
          if (codePoint >= 0x7f && codePoint <= 0x9f) continue;
          const button = d.createElement("button");
          button.type = "button";
          button.textContent = String.fromCodePoint(codePoint);
          button.title = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
          button.addEventListener("click", () => showCharacter(codePoint));
          grid.append(button);
        }
      };

      const findCodePoint = () => {
        const value = search.value.trim().replace(/^U\+/i, "");
        if (!/^[0-9a-f]{1,6}$/i.test(value)) return;
        const codePoint = Number.parseInt(value, 16);
        if (codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          showCharacter(codePoint);
        }
      };

      select.addEventListener("change", renderGrid);
      search.addEventListener("input", findCodePoint);
      renderGrid();
      if (selectedCodePoint !== null) showCharacter(selectedCodePoint);
    };

    render();
    const unsubscribe = surfaceLifecycle.localization.subscribe(render);
    return Object.freeze({
      destroy() {
        unsubscribe?.();
        root.replaceChildren();
        releaseStyles();
      },
    });
  },
});
