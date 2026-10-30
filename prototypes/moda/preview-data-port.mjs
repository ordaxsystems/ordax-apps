import { MODA_PREVIEW_PORT_SCHEMA } from "../../apps/moda/src/ports/data-port.mjs";
import { MODA_CATEGORIES } from "../../apps/moda/src/domain/derived.mjs";
import { normalizeCheckoutLines } from "../../apps/moda/src/domain/checkout.mjs";
import { buildTryOnBrief } from "../../apps/moda/src/domain/fit-brief.mjs";
import { evaluateGarmentFit, fitDimensionsForKind } from "../../apps/moda/src/domain/fit-engine.mjs";

// Bounds only this browser-local preview; it does not represent Inventory policy.
export const MAX_LOCAL_PREVIEW_MOVEMENTS = 2048;

const STORAGE_KEY = "ordax.moda.atelie-aurora.preview.v1";
const SIZES = Object.freeze({
  Camisa: ["P", "M", "G"],
  Vestido: ["PP", "P", "M", "G"],
  Calça: ["36", "38", "40", "42", "44"],
  Calçados: ["34", "35", "36", "37", "38", "39"],
  Bolsa: ["U"],
  Acessório: ["U"],
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureStudioContext(state, productId, variantId, modelId, capturedAt) {
  const product = state.catalog.products.find((item) => item.id === productId);
  const variant = product?.variants.find((item) => item.id === variantId);
  const model = state.studio.models.find((item) => item.id === modelId);
  if (!product || !variant || !model || !product.fitProfile) return null;
  const fitReport = evaluateGarmentFit({ product, variant, bodyMeasurements: model.measurements });
  if (fitReport.status !== "ready") return null;
  return {
    version: 1,
    capturedAt,
    product: clone(product),
    variant: clone(variant),
    model: clone(model),
    fitReport: clone(fitReport),
    brief: clone(buildTryOnBrief({ product, variant, model, report: fitReport })),
  };
}

function slug(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28);
}

function uid(prefix) {
  if (typeof globalThis.crypto?.randomUUID !== "function") throw new Error("O navegador não oferece identificadores seguros.");
  return prefix + "-" + globalThis.crypto.randomUUID();
}

function color(name, hex) {
  return { name, hex };
}

function makeProduct(id, name, category, kind, description, sizes, colors, priceCents, tone) {
  const variants = [];
  for (const size of sizes) {
    for (const shade of colors) {
      const sku = "AUR-" + slug(id).toUpperCase() + "-" + slug(size).toUpperCase() + "-" + slug(shade.name).toUpperCase();
      variants.push({
        id: id + "-" + slug(size) + "-" + slug(shade.name),
        sku, size, color: shade.name, colorHex: shade.hex,
        priceCents, active: true,
      });
    }
  }
  // Demo fixtures use owned vector artwork; no third-party photos are bundled.
  return { id, name, category, kind, description, tone, active: true, variants };
}

function fitProfile(fabric, stretchPercent, easeByMeasurementCm, measurementsBySize, cut = "Regular") {
  return { fabric, cut, stretchPercent, easeByMeasurementCm, measurementsBySize };
}

function seedCatalog() {
  const products = [
    makeProduct("camisa-brisa", "Camisa Brisa de Linho", "Roupas", "shirt",
      "Linho misto, caimento amplo e botões naturais.", ["P", "M", "G"],
      [color("Areia", "#cfbda2"), color("Oliva", "#69705a")], 18990, "linen"),
    makeProduct("vestido-serena", "Vestido Midi Serena", "Roupas", "dress",
      "Silhueta fluida, decote quadrado e alças reguláveis.", ["PP", "P", "M", "G"],
      [color("Vinho", "#813f4d"), color("Rosa antigo", "#bd8e91")], 27990, "rose"),
    makeProduct("calca-celeste", "Calça Reta Celeste", "Roupas", "trousers",
      "Alfaiataria leve com cintura alta e bolsos laterais.", ["36", "38", "40", "42", "44"],
      [color("Preto", "#343334"), color("Aveia", "#d8cbb5")], 23990, "sand"),
    makeProduct("blusa-marea", "Blusa Marea", "Roupas", "shirt",
      "Malha de algodão macia, ombro natural e modelagem reta.", ["PP", "P", "M", "G", "GG"],
      [color("Azul petróleo", "#477a7e"), color("Areia", "#cfbda2")], 14990, "canvas"),
    makeProduct("jaqueta-duna", "Jaqueta Duna", "Roupas", "shirt",
      "Sarja encorpada, corte curto e estrutura de alfaiataria.", ["P", "M", "G", "GG"],
      [color("Taupe", "#8c7565"), color("Preto", "#343334")], 36990, "sand"),
    makeProduct("moletom-nuvem", "Moletom Nuvem", "Roupas", "shirt",
      "Moletom de algodão com punhos canelados e caimento relaxado.", ["PP", "P", "M", "G", "GG"],
      [color("Mescla", "#c9cbca"), color("Azul cobalto", "#315d91")], 22990, "canvas"),
    makeProduct("calca-cargo-vale", "Calça Cargo Vale", "Roupas", "trousers",
      "Sarja resistente com bolsos utilitários e perna ampla.", ["36", "38", "40", "42", "44"],
      [color("Oliva", "#737967"), color("Preto", "#343334")], 28990, "olive"),
    makeProduct("tricot-cedro", "Tricô Cedro", "Roupas", "shirt",
      "Trama de lã macia com ombro levemente deslocado.", ["P", "M", "G", "GG"],
      [color("Marfim", "#efe8db"), color("Grafite", "#5a5854")], 26990, "linen"),
    makeProduct("jeans-horizonte", "Jeans Horizonte", "Roupas", "trousers",
      "Denim de peso médio, lavagem azul e perna reta.", ["36", "38", "40", "42", "44"],
      [color("Azul claro", "#afc7d8"), color("Índigo", "#293f61")], 25990, "canvas"),
    makeProduct("blazer-bruma", "Blazer Bruma", "Roupas", "shirt",
      "Lã fria com ombro marcado e modelagem confortável.", ["P", "M", "G", "GG"],
      [color("Ébano", "#222222"), color("Café", "#4c3328")], 42990, "leather"),
    makeProduct("vestido-lua", "Vestido Lua", "Roupas", "dress",
      "Cetim fluido com alças finas e recorte enviesado.", ["PP", "P", "M", "G"],
      [color("Champanhe", "#dcc7a8"), color("Preto", "#1a1a1a")], 31990, "rose"),
    makeProduct("bolsa-lumi", "Bolsa Tiracolo Lumi", "Bolsas", "bag",
      "Couro macio, alça ajustável e fechamento magnético.", ["U"],
      [color("Caramelo", "#aa7049"), color("Preto", "#373333")], 32990, "leather"),
    makeProduct("tenis-sol", "Tênis Canvas Sol", "Calçados", "shoe",
      "Lona orgânica, palmilha confortável e sola natural.", ["34", "35", "36", "37", "38", "39"],
      [color("Off-white", "#e9e3d7"), color("Verde sálvia", "#85917d")], 21990, "canvas"),
    makeProduct("sapatilha-alba", "Sapatilha Alba", "Calçados", "flat",
      "Couro flexível com acabamento artesanal e bico suave.", ["34", "35", "36", "37", "38", "39"],
      [color("Vinho", "#803d4b"), color("Preto", "#373333")], 19990, "wine"),
    makeProduct("colar-elo", "Colar Elo Dourado", "Acessórios", "jewelry",
      "Corrente delicada com fecho ajustável.", ["U"],
      [color("Dourado", "#bd9862"), color("Prata", "#a8a9a7")], 12990, "gold"),
  ];
  const fitProfiles = {
    "camisa-brisa": {
      fabric: "Linho misto",
      cut: "Ampla",
      stretchPercent: 2,
      easeByMeasurementCm: { chest: 8, waist: 10, hip: 8, shoulder: 1 },
      measurementsBySize: {
        P: { chest: 100, waist: 96, hip: 100, shoulder: 38 },
        M: { chest: 106, waist: 102, hip: 106, shoulder: 40 },
        G: { chest: 112, waist: 108, hip: 112, shoulder: 42 },
      },
    },
    "vestido-serena": {
      fabric: "Viscose com elastano",
      cut: "Regular",
      stretchPercent: 5,
      easeByMeasurementCm: { chest: 4, waist: 3, hip: 5 },
      measurementsBySize: {
        PP: { chest: 84, waist: 68, hip: 92 },
        P: { chest: 90, waist: 74, hip: 98 },
        M: { chest: 96, waist: 80, hip: 104 },
        G: { chest: 102, waist: 86, hip: 110 },
      },
    },
    "calca-celeste": {
      fabric: "Sarja com elastano",
      cut: "Regular",
      stretchPercent: 4,
      easeByMeasurementCm: { waist: 2, hip: 4, thigh: 4 },
      measurementsBySize: {
        "36": { waist: 72, hip: 94, thigh: 54 },
        "38": { waist: 76, hip: 98, thigh: 56 },
        "40": { waist: 80, hip: 102, thigh: 58 },
        "42": { waist: 84, hip: 106, thigh: 60 },
        "44": { waist: 88, hip: 110, thigh: 62 },
      },
    },
    "blusa-marea": fitProfile("Algodão penteado", 4, { chest: 6, waist: 6, hip: 6, shoulder: 1 }, {
      PP: { chest: 88, waist: 88, hip: 92, shoulder: 36 },
      P: { chest: 94, waist: 94, hip: 98, shoulder: 38 },
      M: { chest: 100, waist: 100, hip: 104, shoulder: 40 },
      G: { chest: 106, waist: 106, hip: 110, shoulder: 42 },
      GG: { chest: 112, waist: 112, hip: 116, shoulder: 44 },
    }),
    "jaqueta-duna": fitProfile("Sarja de algodão", 0, { chest: 10, waist: 8, hip: 6, shoulder: 2 }, {
      P: { chest: 100, waist: 92, hip: 98, shoulder: 40 },
      M: { chest: 106, waist: 98, hip: 104, shoulder: 42 },
      G: { chest: 112, waist: 104, hip: 110, shoulder: 44 },
      GG: { chest: 118, waist: 110, hip: 116, shoulder: 46 },
    }, "Ajustada"),
    "moletom-nuvem": fitProfile("Moletom de algodão", 5, { chest: 12, waist: 12, hip: 10, shoulder: 3 }, {
      PP: { chest: 100, waist: 98, hip: 102, shoulder: 39 },
      P: { chest: 106, waist: 104, hip: 108, shoulder: 41 },
      M: { chest: 112, waist: 110, hip: 114, shoulder: 43 },
      G: { chest: 118, waist: 116, hip: 120, shoulder: 45 },
      GG: { chest: 124, waist: 122, hip: 126, shoulder: 47 },
    }, "Ampla"),
    "calca-cargo-vale": fitProfile("Sarja utilitária", 1, { waist: 4, hip: 7, thigh: 7 }, {
      "36": { waist: 74, hip: 98, thigh: 58 },
      "38": { waist: 78, hip: 102, thigh: 60 },
      "40": { waist: 82, hip: 106, thigh: 62 },
      "42": { waist: 86, hip: 110, thigh: 64 },
      "44": { waist: 90, hip: 114, thigh: 66 },
    }, "Ampla"),
    "tricot-cedro": fitProfile("Lã merino", 12, { chest: 10, waist: 10, hip: 8, shoulder: 2 }, {
      P: { chest: 102, waist: 96, hip: 100, shoulder: 40 },
      M: { chest: 108, waist: 102, hip: 106, shoulder: 42 },
      G: { chest: 114, waist: 108, hip: 112, shoulder: 44 },
      GG: { chest: 120, waist: 114, hip: 118, shoulder: 46 },
    }, "Ampla"),
    "jeans-horizonte": fitProfile("Denim", 2, { waist: 2, hip: 4, thigh: 4 }, {
      "36": { waist: 72, hip: 94, thigh: 54 },
      "38": { waist: 76, hip: 98, thigh: 56 },
      "40": { waist: 80, hip: 102, thigh: 58 },
      "42": { waist: 84, hip: 106, thigh: 60 },
      "44": { waist: 88, hip: 110, thigh: 62 },
    }),
    "blazer-bruma": fitProfile("Lã fria", 0, { chest: 12, waist: 12, hip: 10, shoulder: 3 }, {
      P: { chest: 104, waist: 100, hip: 104, shoulder: 41 },
      M: { chest: 110, waist: 106, hip: 110, shoulder: 43 },
      G: { chest: 116, waist: 112, hip: 116, shoulder: 45 },
      GG: { chest: 122, waist: 118, hip: 122, shoulder: 47 },
    }, "Ampla"),
    "vestido-lua": fitProfile("Cetim de viscose", 3, { chest: 4, waist: 3, hip: 5 }, {
      PP: { chest: 84, waist: 68, hip: 92 },
      P: { chest: 90, waist: 74, hip: 98 },
      M: { chest: 96, waist: 80, hip: 104 },
      G: { chest: 102, waist: 86, hip: 110 },
    }, "Ajustada"),
  };
  for (const product of products) {
    if (fitProfiles[product.id]) product.fitProfile = fitProfiles[product.id];
  }
  return products;
}

function migrateCatalogFitProfiles(state, now) {
  const seededProducts = seedCatalog();
  const seedById = new Map(seededProducts.map((product) => [product.id, product]));
  const productIds = new Set(state.catalog.products.map((product) => product.id));
  let changed = false;
  for (const product of state.catalog.products) {
    const seeded = seedById.get(product.id);
    const profile = seeded?.fitProfile;
    if (!product.imageSrc && seeded?.imageSrc) {
      product.imageSrc = seeded.imageSrc;
      changed = true;
    }
    if (profile && !product.fitProfile) {
      product.fitProfile = clone(profile);
      changed = true;
    } else if (profile && product.fitProfile && !product.fitProfile.cut) {
      product.fitProfile.cut = profile.cut;
      changed = true;
    }
  }
  if (!Array.isArray(state.inventory.movements)) state.inventory.movements = [];
  if (!state.inventory.references || typeof state.inventory.references !== "object") state.inventory.references = {};
  for (const product of seededProducts) {
    if (productIds.has(product.id)) continue;
    const imported = clone(product);
    state.catalog.products.push(imported);
    productIds.add(product.id);
    changed = true;
    for (const variant of imported.variants) {
      const movementId = "initial-" + variant.sku;
      if (state.inventory.movements.some((movement) => movement.id === movementId)) continue;
      state.inventory.movements.push({
        id: movementId,
        sku: variant.sku,
        kind: "receive",
        quantity: 12 + (variant.sku.length % 7),
        occurredAt: new Date(now.getTime() - 12 * 86_400_000).toISOString(),
        reversesId: null,
      });
      state.inventory.references[movementId] = { kind: "initial-stock" };
      state.inventory.revision = (state.inventory.revision ?? 0) + 1;
    }
  }
  if (changed) state.catalog.revision += 1;
  return changed;
}

function seedProductStudio(now = new Date()) {
  return {
    revision: 1,
    models: [
      {
        id: "model-aurora-regular",
        name: "Silhueta Aurora · Regular",
        heightCm: 168,
        sizeReference: "P · 38",
        fitPreference: "Regular",
        synthetic: true,
        active: true,
        measurements: { chest: 90, waist: 72, hip: 98, shoulder: 38, thigh: 56 },
      },
      {
        id: "model-aurora-roomy",
        name: "Silhueta Aurora · Curvas",
        heightCm: 174,
        sizeReference: "G · 44",
        fitPreference: "Confortável",
        synthetic: true,
        active: true,
        measurements: { chest: 102, waist: 88, hip: 110, shoulder: 42, thigh: 64 },
      },
    ],
    jobs: [
      {
        id: "content-fixture-shirt",
        productId: "camisa-brisa",
        variantId: "camisa-brisa-m-areia",
        modelId: "model-aurora-regular",
        status: "local-illustration",
        createdAt: new Date(now.getTime() - 3 * 60 * 60_000).toISOString(),
      },
      {
        id: "content-fixture-dress",
        productId: "vestido-serena",
        variantId: "vestido-serena-m-vinho",
        modelId: "model-aurora-roomy",
        status: "local-brief",
        createdAt: new Date(now.getTime() - 7 * 60 * 60_000).toISOString(),
      },
    ],
  };
}

function migrateProductStudio(state, now) {
  let changed = false;
  if (!state.studio || typeof state.studio !== "object") {
    state.studio = seedProductStudio(now);
    changed = true;
  }
  const seeded = seedProductStudio(now);
  if (!Array.isArray(state.studio.models)) {
    state.studio.models = seeded.models;
    changed = true;
  }
  if (!Array.isArray(state.studio.jobs)) {
    state.studio.jobs = seeded.jobs;
    changed = true;
  }
  if (!Number.isSafeInteger(state.studio.revision)) {
    state.studio.revision = 1;
    changed = true;
  }
  for (const job of state.studio.jobs) {
    if (job.contextSnapshot) continue;
    const capturedAt = typeof job.createdAt === "string" ? job.createdAt : now.toISOString();
    const contextSnapshot = captureStudioContext(state, job.productId, job.variantId, job.modelId, capturedAt);
    if (contextSnapshot) {
      job.contextSnapshot = contextSnapshot;
      changed = true;
    }
  }
  if (changed) state.studio.revision += 1;
  return changed;
}

function makeBaseState(now = new Date()) {
  const products = seedCatalog();
  const state = {
    schema: "ordax.moda-local-preview-state/1",
    revision: 1,
    catalog: { revision: 1, products },
    sales: { revision: 0, orders: [] },
    inventory: { revision: 0, movements: [], references: {} },
    customers: { revision: 1, records: [
      { id: "customer-ana", name: "Ana Clara Martins", phone: "(11) 98842-1670", email: "ana.martins@example.test", joinedAt: new Date(now.getTime() - 160 * 86_400_000).toISOString(), note: "Prefere tons naturais." },
      { id: "customer-luiza", name: "Luiza Nogueira", phone: "(11) 97614-2085", email: "luiza.nogueira@example.test", joinedAt: new Date(now.getTime() - 90 * 86_400_000).toISOString(), note: "" },
      { id: "customer-marina", name: "Marina Azevedo", phone: "(11) 99120-6341", email: "marina.azevedo@example.test", joinedAt: new Date(now.getTime() - 48 * 86_400_000).toISOString(), note: "Numeração 37." },
      { id: "customer-clara", name: "Clara Ribeiro", phone: "(11) 98448-5712", email: "clara.ribeiro@example.test", joinedAt: new Date(now.getTime() - 32 * 86_400_000).toISOString(), note: "" },
      { id: "customer-bia", name: "Beatriz Mello", phone: "(11) 97310-4588", email: "bia.mello@example.test", joinedAt: new Date(now.getTime() - 15 * 86_400_000).toISOString(), note: "Compra para presente." },
    ] },
    customerLinks: {},
    returns: { revision: 0, items: [] },
    team: { revision: 1, members: [
      { id: "member-marina", name: "Marina Lopes", email: "marina@atelieaurora.example.test", role: "Gerente", status: "Ativa" },
      { id: "member-joana", name: "Joana Costa", email: "joana@atelieaurora.example.test", role: "Vendas", status: "Ativa" },
      { id: "member-lia", name: "Lia Fernandes", email: "lia@atelieaurora.example.test", role: "Estoque", status: "Ativa" },
    ] },
    studio: seedProductStudio(now),
    settings: {
      storeName: "Ateliê Aurora",
      unitName: "Vila Madalena",
      phone: "(11) 3034-7812",
      address: "Rua Harmonia, 428 · São Paulo, SP",
      lowStockAt: 5,
      openingHours: "Seg–Sáb · 10h às 19h",
    },
  };

  for (const product of products) {
    for (const variant of product.variants) {
      const movementId = "initial-" + variant.sku;
      const initialQuantity = variant.sku === "AUR-CAMISA-BRISA-M-AREIA"
        ? 6
        : 12 + (variant.sku.length % 7);
      state.inventory.movements.push({
        id: movementId, sku: variant.sku, kind: "receive",
        quantity: initialQuantity, occurredAt: new Date(now.getTime() - 12 * 86_400_000).toISOString(), reversesId: null,
      });
      state.inventory.references[movementId] = { kind: "initial-stock" };
    }
  }
  state.inventory.revision = state.inventory.movements.length;

  const variantFor = (productId, size, shade) => {
    const product = products.find((item) => item.id === productId);
    return product?.variants.find((item) => item.size === size && item.color === shade) ?? null;
  };
  const saleSpecs = [
    { id: "sale-1048", minutesAgo: 38, customerId: "customer-ana", items: [["camisa-brisa", "M", "Areia", 1], ["colar-elo", "U", "Dourado", 1]] },
    { id: "sale-1047", minutesAgo: 112, customerId: "customer-luiza", items: [["vestido-serena", "M", "Vinho", 1]] },
    { id: "sale-1046", minutesAgo: 1_620, customerId: "customer-marina", items: [["tenis-sol", "37", "Off-white", 1]] },
    { id: "sale-1045", minutesAgo: 3_380, customerId: "customer-clara", items: [["bolsa-lumi", "U", "Caramelo", 1], ["sapatilha-alba", "36", "Vinho", 1]] },
    { id: "sale-1044", minutesAgo: 6_240, customerId: "customer-bia", items: [["calca-celeste", "40", "Aveia", 1]] },
    { id: "sale-1043", minutesAgo: 8_820, customerId: "customer-ana", items: [["camisa-brisa", "P", "Oliva", 1], ["vestido-serena", "P", "Rosa antigo", 1]] },
    { id: "sale-1042", minutesAgo: 20_000, customerId: "customer-luiza", items: [["sapatilha-alba", "37", "Preto", 1]] },
  ];
  for (const spec of saleSpecs) {
    const lines = spec.items.map(([productId, size, shade, quantity]) => {
      const variant = variantFor(productId, size, shade);
      return { sku: variant.sku, quantity, unitPriceCents: variant.priceCents };
    });
    const sale = {
      id: spec.id, number: spec.id.replace("sale-", ""),
      createdAt: new Date(now.getTime() - spec.minutesAgo * 60_000).toISOString(),
      lines, totalCents: lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0),
    };
    state.sales.orders.push(sale);
    state.customerLinks[sale.id] = spec.customerId;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const movementId = "dispatch-" + sale.id + "-" + index;
      state.inventory.movements.push({
        id: movementId, sku: line.sku, kind: "dispatch",
        quantity: line.quantity, occurredAt: sale.createdAt, reversesId: null,
      });
      state.inventory.references[movementId] = { kind: "sale", sourceId: sale.id };
    }
  }
  state.sales.revision = state.sales.orders.length;
  state.inventory.revision = state.inventory.movements.length;

  const returnedSale = state.sales.orders.find((sale) => sale.id === "sale-1046");
  const returnedLine = returnedSale.lines[0];
  const returnDate = new Date(now.getTime() - 26 * 60 * 60_000).toISOString();
  const receiptId = "receive-return-seed-1046";
  state.inventory.movements.push({
    id: receiptId, sku: returnedLine.sku, kind: "receive",
    quantity: 1, occurredAt: returnDate, reversesId: null,
  });
  state.inventory.references[receiptId] = { kind: "customer-return", sourceId: "return-seed-1046" };
  state.inventory.revision = state.inventory.movements.length;
  state.returns.items.push({
    id: "return-seed-1046", saleId: returnedSale.id, sku: returnedLine.sku,
    quantity: 1, type: "return", condition: "resalable", reason: "Numeração não serviu",
    restocked: true, replacementSku: null, valueCents: returnedLine.unitPriceCents,
    replacementValueCents: 0, differenceCents: 0, settlement: "pending",
    createdAt: returnDate,
  });
  state.returns.revision = 1;
  return state;
}

function assertSnapshot(value) {
  if (!value || value.schema !== "ordax.moda-local-preview-state/1"
      || !Number.isSafeInteger(value.revision)
      || !Array.isArray(value.catalog?.products)
      || !Array.isArray(value.sales?.orders)
      || !Array.isArray(value.inventory?.movements)
      || !Array.isArray(value.customers?.records)
      || !Array.isArray(value.returns?.items)
      || !Array.isArray(value.team?.members)
      || (value.studio != null && (typeof value.studio !== "object"
        || (value.studio.models != null && !Array.isArray(value.studio.models))
        || (value.studio.jobs != null && !Array.isArray(value.studio.jobs))))
      || !value.settings || typeof value.settings !== "object") {
    throw new Error("Os dados locais da Moda não têm um formato reconhecido.");
  }
  return value;
}

function stockFor(state, sku) {
  let balance = 0;
  const reversed = new Set(state.inventory.movements.filter((row) => row.kind === "reversal").map((row) => row.reversesId));
  const byId = new Map(state.inventory.movements.map((row) => [row.id, row]));
  for (const row of state.inventory.movements) {
    if (row.sku !== sku) continue;
    if (row.kind === "reversal") {
      const original = byId.get(row.reversesId);
      if (original) balance += original.kind === "receive" ? -row.quantity : row.quantity;
    } else if (!reversed.has(row.id)) balance += row.kind === "receive" ? row.quantity : -row.quantity;
  }
  return balance;
}

function variantFor(state, sku) {
  for (const product of state.catalog.products) {
    const variant = product.variants.find((item) => item.sku === sku);
    if (variant) return { product, variant };
  }
  return null;
}

function addMovement(state, { sku, kind, quantity, occurredAt, referenceKind, sourceId, number = null }) {
  if (state.inventory.movements.length >= MAX_LOCAL_PREVIEW_MOVEMENTS) {
    throw new RangeError(`A prévia local alcançou seu limite de armazenamento de ${MAX_LOCAL_PREVIEW_MOVEMENTS.toLocaleString("pt-BR")} movimentações. Nenhum novo movimento foi gravado.`);
  }
  const movementId = uid(kind);
  state.inventory.movements.push({ id: movementId, sku, kind, quantity, occurredAt, reversesId: null });
  state.inventory.references[movementId] = { kind: referenceKind, sourceId, number };
  state.inventory.revision += 1;
}

function cents(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000_000) {
    throw new TypeError("Informe um preço válido.");
  }
  return amount;
}

function integer(value, label, minimum, maximum) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < minimum || amount > maximum) {
    throw new TypeError(label + " precisa ser um número inteiro entre " + minimum + " e " + maximum + ".");
  }
  return amount;
}

function applyCheckout(state, payload, now) {
  const lines = [];
  for (const { sku, quantity } of normalizeCheckoutLines(payload.lines)) {
    const found = variantFor(state, sku);
    if (!found || !found.product.active || !found.variant.active) throw new Error("Um item do carrinho não está mais disponível.");
    if (stockFor(state, sku) < quantity) throw new Error("Estoque insuficiente para " + found.product.name + " · " + found.variant.size + " · " + found.variant.color + ".");
    lines.push({ sku, quantity, unitPriceCents: cents(found.variant.priceCents) });
  }
  const customerId = payload.customerId || null;
  if (customerId && !state.customers.records.some((customer) => customer.id === customerId)) throw new Error("Selecione uma cliente disponível.");
  const saleId = uid("sale");
  const createdAt = now.toISOString();
  const order = {
    id: saleId,
    number: String(Math.max(1048, ...state.sales.orders.map((item) => Number(item.number) || 0)) + 1).padStart(4, "0"),
    createdAt,
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0),
  };
  state.sales.orders.push(order);
  state.sales.revision += 1;
  if (customerId) state.customerLinks[saleId] = customerId;
  for (const line of lines) addMovement(state, {
    sku: line.sku, kind: "dispatch", quantity: line.quantity, occurredAt: createdAt,
    referenceKind: "sale", sourceId: saleId, number: order.number,
  });
  return order;
}

function applyProductSave(state, payload, now) {
  const name = String(payload.name ?? "").trim();
  const category = String(payload.category ?? "");
  const description = String(payload.description ?? "").trim();
  if (name.length < 2 || name.length > 100) throw new Error("O nome do produto precisa ter entre 2 e 100 caracteres.");
  if (!MODA_CATEGORIES.includes(category)) throw new Error("Escolha uma categoria da loja.");
  if (description.length > 260) throw new Error("A descrição aceita até 260 caracteres.");
  const priceCents = cents(payload.priceCents);
  const sizes = [...new Set((Array.isArray(payload.sizes) ? payload.sizes : [])
    .map((value) => String(value).trim().toUpperCase()).filter(Boolean))];
  const colors = [...new Set((Array.isArray(payload.colors) ? payload.colors : [])
    .map((value) => String(value).trim()).filter(Boolean))];
  if (!sizes.length || sizes.length > 20) throw new Error("Informe entre 1 e 20 tamanhos ou numerações.");
  if (!colors.length || colors.length > 12) throw new Error("Informe entre 1 e 12 cores.");
  if (sizes.length * colors.length > 120) throw new Error("A combinação gera variantes demais.");
  const productId = uid("product");
  const code = slug(name).toUpperCase().slice(0, 20) + "-" + productId.slice(-6).replaceAll("-", "").toUpperCase();
  const variants = [];
  for (const size of sizes) {
    for (const colorName of colors) {
      const sku = "AUR-" + code + "-" + slug(size).toUpperCase() + "-" + slug(colorName).toUpperCase();
      if (state.catalog.products.some((product) => product.variants.some((variant) => variant.sku === sku))) {
        throw new Error("O SKU gerado já existe.");
      }
      variants.push({
        id: productId + "-" + slug(size) + "-" + slug(colorName),
        sku, size, color: colorName, colorHex: "#b78572",
        priceCents, active: true,
      });
    }
  }
  const initialStock = integer(payload.initialStock ?? 0, "Estoque inicial por variante", 0, 500);
  const categoryKind = {
    "Calçados": "shoe",
    "Bolsas": "bag",
    "Acessórios": "jewelry",
  }[category];
  const requestedKind = String(payload.kind ?? "shirt");
  const kind = categoryKind ?? (category === "Roupas" && ["shirt", "dress", "trousers", "other"].includes(requestedKind) ? requestedKind : "other");
  const product = {
    id: productId, name, category, kind,
    description, tone: "rose", active: true, variants,
  };
  state.catalog.products.unshift(product);
  state.catalog.revision += 1;
  if (initialStock > 0) {
    const occurredAt = now.toISOString();
    for (const variant of variants) addMovement(state, {
      sku: variant.sku, kind: "receive", quantity: initialStock, occurredAt,
      referenceKind: "initial-stock", sourceId: product.id,
    });
  }
  return product;
}

function applyProductUpdate(state, payload) {
  const product = state.catalog.products.find((item) => item.id === payload.productId);
  if (!product) throw new Error("Produto não encontrado no catálogo.");
  const name = String(payload.name ?? "").trim();
  const description = String(payload.description ?? "").trim();
  if (name.length < 2 || name.length > 100) throw new Error("O nome do produto precisa ter entre 2 e 100 caracteres.");
  if (description.length > 260) throw new Error("A descrição aceita até 260 caracteres.");
  const prices = payload.pricesByVariantId;
  if (!prices || typeof prices !== "object" || Array.isArray(prices)) {
    throw new Error("Informe o preço de cada variante.");
  }
  const variantIds = new Set(product.variants.map((variant) => variant.id));
  if (Object.keys(prices).length !== variantIds.size || Object.keys(prices).some((id) => !variantIds.has(id))) {
    throw new Error("A lista de preços não corresponde às variantes atuais do produto.");
  }
  const updatedPrices = product.variants.map((variant) => cents(prices[variant.id]));

  product.name = name;
  product.description = description;
  product.variants.forEach((variant, index) => { variant.priceCents = updatedPrices[index]; });
  state.catalog.revision += 1;
  return product;
}

function applyFitProfileSave(state, payload) {
  const product = state.catalog.products.find((item) => item.id === payload.productId);
  if (!product) throw new Error("Produto não encontrado no catálogo.");
  const dimensions = fitDimensionsForKind(product.kind).map(({ key }) => key);
  if (!dimensions.length) throw new Error("O provador está disponível para blusas, camisas, calças e vestidos.");
  const fabric = String(payload.fabric ?? "").trim();
  const cut = String(payload.cut ?? "");
  const stretchPercent = Number(payload.stretchPercent);
  if (fabric.length < 2 || fabric.length > 100) throw new Error("Informe o tecido da peça.");
  if (!["Ajustada", "Regular", "Ampla"].includes(cut)) throw new Error("Escolha uma modelagem para a peça.");
  if (!Number.isFinite(stretchPercent) || stretchPercent < 0 || stretchPercent > 50) {
    throw new Error("A elasticidade precisa ficar entre 0% e 50%.");
  }

  const sizes = [...new Set(product.variants.map((variant) => variant.size))];
  const measurementsBySize = {};
  for (const size of sizes) {
    const source = payload.measurementsBySize?.[size];
    if (!source || typeof source !== "object") throw new Error("Complete as medidas da peça para o tamanho " + size + ".");
    const measures = {};
    for (const dimension of dimensions) {
      const value = Number(source[dimension]);
      if (!Number.isFinite(value) || value < 20 || value > 250) {
        throw new Error("Confira " + dimension + " no tamanho " + size + ". Use centímetros entre 20 e 250.");
      }
      measures[dimension] = Math.round(value * 10) / 10;
    }
    measurementsBySize[size] = measures;
  }

  const easeByMeasurementCm = {};
  for (const dimension of dimensions) {
    const value = Number(payload.easeByMeasurementCm?.[dimension]);
    if (!Number.isFinite(value) || value < -15 || value > 40) {
      throw new Error("Confira a folga planejada para " + dimension + ".");
    }
    easeByMeasurementCm[dimension] = Math.round(value * 10) / 10;
  }

  product.fitProfile = { fabric, cut, stretchPercent, easeByMeasurementCm, measurementsBySize };
  state.catalog.revision += 1;
  return product.fitProfile;
}

function applyStockReceipt(state, payload, now) {
  const found = variantFor(state, payload.sku);
  if (!found) throw new Error("Variante não encontrada.");
  const quantity = integer(payload.quantity, "Quantidade recebida", 1, 100_000);
  addMovement(state, {
    sku: payload.sku, kind: "receive", quantity, occurredAt: now.toISOString(),
    referenceKind: "stock-receipt", sourceId: uid("receipt"),
  });
  return { sku: payload.sku, quantity };
}

function applyCustomerSave(state, payload, now) {
  const name = String(payload.name ?? "").trim();
  const phone = String(payload.phone ?? "").trim();
  const email = String(payload.email ?? "").trim().toLowerCase();
  if (name.length < 2 || name.length > 100) throw new Error("Informe o nome da cliente.");
  if (phone.length < 8 || phone.length > 32) throw new Error("Informe um telefone válido.");
  if (email && (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error("O e-mail não parece válido.");
  if (state.customers.records.some((customer) => email && customer.email.toLowerCase() === email)) throw new Error("Já existe uma cliente com esse e-mail.");
  const customer = { id: uid("customer"), name, phone, email, joinedAt: now.toISOString(), note: "" };
  state.customers.records.unshift(customer);
  state.customers.revision += 1;
  return customer;
}

function applyReturn(state, payload, now) {
  const sale = state.sales.orders.find((item) => item.id === payload.saleId);
  if (!sale) throw new Error("Selecione uma venda existente.");
  const line = sale.lines.find((item) => item.sku === payload.sku);
  if (!line) throw new Error("A variante não pertence a esta venda.");
  const priorQuantity = state.returns.items
    .filter((item) => item.saleId === sale.id && item.sku === line.sku)
    .reduce((sum, item) => sum + item.quantity, 0);
  const available = line.quantity - priorQuantity;
  const quantity = integer(payload.quantity, "Quantidade devolvida", 1, Math.max(1, available));
  if (quantity > available) throw new Error("A quantidade excede o saldo não devolvido desta venda.");
  if (!["return", "exchange"].includes(payload.type)) throw new Error("Escolha devolução ou troca.");
  if (!["resalable", "damaged"].includes(payload.condition)) throw new Error("Escolha a condição do item.");
  const reason = String(payload.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 180) throw new Error("Descreva o motivo em até 180 caracteres.");
  const replacementSku = payload.type === "exchange" ? String(payload.replacementSku ?? "") : null;
  let replacement = null;
  if (payload.type === "exchange") {
    replacement = variantFor(state, replacementSku);
    if (!replacement || !replacement.product.active || !replacement.variant.active) throw new Error("Escolha a variante disponível que substituirá o item.");
    if (replacementSku === line.sku) throw new Error("Escolha uma variante diferente para registrar uma troca.");
    if (stockFor(state, replacementSku) < quantity) throw new Error("Não há saldo suficiente da variante substituta.");
  }
  const returnId = uid("return");
  const occurredAt = now.toISOString();
  const valueCents = line.unitPriceCents * quantity;
  const replacementValueCents = replacement ? replacement.variant.priceCents * quantity : 0;
  const differenceCents = replacementValueCents - valueCents;
  const restocked = payload.condition === "resalable";
  const item = {
    id: returnId, saleId: sale.id, sku: line.sku, quantity,
    type: payload.type, condition: payload.condition, reason,
    restocked, replacementSku,
    valueCents, replacementValueCents, differenceCents,
    settlement: differenceCents === 0 ? "not-required" : "pending",
    createdAt: occurredAt,
  };
  state.returns.items.unshift(item);
  state.returns.revision += 1;
  if (restocked) addMovement(state, {
    sku: line.sku, kind: "receive", quantity, occurredAt,
    referenceKind: "customer-return", sourceId: returnId,
  });
  if (replacement) addMovement(state, {
    sku: replacementSku, kind: "dispatch", quantity, occurredAt,
    referenceKind: "exchange", sourceId: returnId,
  });
  return item;
}

function executeCommand(state, command, now) {
  const payload = command?.payload ?? {};
  switch (command?.type) {
    case "sale.complete": return applyCheckout(state, payload, now);
    case "catalog.create": return applyProductSave(state, payload, now);
    case "catalog.update": return applyProductUpdate(state, payload);
    case "catalog.fit-profile.save": return applyFitProfileSave(state, payload);
    case "studio.model.create": {
      if (state.studio.models.length >= 16) throw new Error("O estúdio aceita até 16 perfis locais de referência.");
      const name = String(payload.name ?? "").trim();
      const sizeReference = String(payload.sizeReference ?? "").trim();
      const fitPreference = String(payload.fitPreference ?? "");
      const heightCm = Number(payload.heightCm);
      if (name.length < 3 || name.length > 60) throw new Error("Dê um nome de 3 a 60 caracteres para a silhueta.");
      if (sizeReference.length < 1 || sizeReference.length > 32) throw new Error("Informe a grade de referência, por exemplo P · 38.");
      if (!["Justa", "Regular", "Confortável"].includes(fitPreference)) throw new Error("Escolha uma preferência de caimento.");
      if (!Number.isFinite(heightCm) || heightCm < 120 || heightCm > 220) throw new Error("A altura deve ficar entre 120 e 220 cm.");
      const measurements = {};
      for (const key of ["chest", "waist", "hip", "shoulder", "thigh"]) {
        const value = Number(payload.measurements?.[key]);
        if (!Number.isFinite(value) || value < 20 || value > 250) throw new Error("Confira as medidas de referência em centímetros.");
        measurements[key] = Math.round(value * 10) / 10;
      }
      const model = {
        id: uid("model"), name, heightCm: Math.round(heightCm), sizeReference,
        fitPreference, synthetic: true, active: true, measurements,
      };
      state.studio.models.unshift(model);
      state.studio.revision += 1;
      return model;
    }
    case "studio.preview.create": {
      const product = state.catalog.products.find((item) => item.id === payload.productId && item.active);
      const variant = product?.variants.find((item) => item.id === payload.variantId && item.active);
      const model = state.studio.models.find((item) => item.id === payload.modelId && item.active);
      if (!product || !variant || !product.fitProfile || !model) throw new Error("Selecione uma peça com ficha, variante e modelo de referência ativos.");
      const parent = payload.revisionOfJobId
        ? state.studio.jobs.find((item) => item.id === payload.revisionOfJobId)
        : null;
      if (payload.revisionOfJobId && !parent) throw new Error("A sessão que pediu ajustes não está mais no histórico local.");
      if (parent) {
        const latestReview = parent.reviews?.[0];
        if (latestReview?.decision !== "changes-requested") throw new Error("Só é possível criar uma nova versão depois de uma solicitação de ajustes.");
        if (parent.productId !== product.id) throw new Error("A nova versão precisa continuar ligada ao mesmo produto.");
        if (state.studio.jobs.some((item) => item.revision?.basedOnJobId === parent.id)) {
          throw new Error("Esta versão já tem uma revisão posterior no histórico.");
        }
      }
      const job = {
        id: uid("content-preview"), productId: product.id, variantId: variant.id,
        modelId: model.id, status: "local-illustration", createdAt: now.toISOString(),
      };
      job.revision = {
        rootJobId: parent?.revision?.rootJobId ?? parent?.id ?? job.id,
        basedOnJobId: parent?.id ?? null,
        version: parent ? (Number(parent.revision?.version) || 1) + 1 : 1,
        requestedChanges: parent?.reviews?.[0]?.note ?? null,
        reviewId: parent?.reviews?.[0]?.id ?? null,
      };
      job.contextSnapshot = captureStudioContext(state, product.id, variant.id, model.id, job.createdAt);
      if (!job.contextSnapshot) throw new Error("Não foi possível registrar a análise de caimento desta prévia.");
      state.studio.jobs.unshift(job);
      const currentJobs = state.studio.jobs;
      const recentJobs = currentJobs.slice(0, 24);
      const retainedIds = new Set(recentJobs.map((item) => item.id));
      for (const recentJob of recentJobs) {
        let ancestorId = recentJob.revision?.basedOnJobId;
        const visited = new Set();
        while (ancestorId && !visited.has(ancestorId)) {
          visited.add(ancestorId);
          const ancestor = currentJobs.find((item) => item.id === ancestorId);
          if (!ancestor) break;
          retainedIds.add(ancestor.id);
          ancestorId = ancestor.revision?.basedOnJobId;
        }
      }
      state.studio.jobs = currentJobs.filter((item) => retainedIds.has(item.id));
      state.studio.revision += 1;
      return job;
    }
    case "studio.preview.review": {
      const job = state.studio.jobs.find((item) => item.id === payload.jobId);
      if (!job) throw new Error("Prévia não encontrada no histórico local.");
      const decision = String(payload.decision ?? "approved");
      const note = String(payload.note ?? "").trim();
      if (!["approved", "changes-requested"].includes(decision)) throw new Error("Escolha aprovar o conteúdo ou solicitar ajustes.");
      if (note.length > 500) throw new Error("O comentário da revisão deve ter até 500 caracteres.");
      if (decision === "changes-requested" && note.length < 5) throw new Error("Descreva o ajuste solicitado em pelo menos 5 caracteres.");
      if (job.reviews?.[0]?.decision === "changes-requested") throw new Error("Esta versão já recebeu ajustes solicitados. Crie uma nova versão antes de revisar novamente.");
      job.reviews = Array.isArray(job.reviews) ? job.reviews : [];
      const review = { id: uid("review"), decision, note, createdAt: now.toISOString() };
      job.reviews.unshift(review);
      job.reviews = job.reviews.slice(0, 20);
      if (decision === "approved" && job.status === "local-illustration") job.status = "reviewed-local";
      if (decision === "changes-requested" && job.status === "reviewed-local") job.status = "local-illustration";
      job.reviewedAt = review.createdAt;
      state.studio.revision += 1;
      return job;
    }
    case "catalog.toggle": {
      const product = state.catalog.products.find((item) => item.id === payload.productId);
      if (!product) throw new Error("Produto não encontrado.");
      product.active = !product.active;
      state.catalog.revision += 1;
      return product;
    }
    case "inventory.receive": return applyStockReceipt(state, payload, now);
    case "customer.create": return applyCustomerSave(state, payload, now);
    case "return.create": return applyReturn(state, payload, now);
    case "team.invite": {
      const name = String(payload.name ?? "").trim();
      const email = String(payload.email ?? "").trim().toLowerCase();
      const role = String(payload.role ?? "");
      if (name.length < 2 || name.length > 100) throw new Error("Informe o nome da pessoa.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido.");
      if (!["Gerente", "Vendas", "Estoque"].includes(role)) throw new Error("Escolha uma função.");
      if (state.team.members.some((item) => item.email.toLowerCase() === email)) throw new Error("Este e-mail já está na equipe.");
      const member = { id: uid("member"), name, email, role, status: "Convite local" };
      state.team.members.unshift(member);
      state.team.revision += 1;
      return member;
    }
    case "settings.save": {
      const storeName = String(payload.storeName ?? "").trim();
      const unitName = String(payload.unitName ?? "").trim();
      const phone = String(payload.phone ?? "").trim();
      const address = String(payload.address ?? "").trim();
      const openingHours = String(payload.openingHours ?? "").trim();
      const lowStockAt = integer(payload.lowStockAt, "Estoque mínimo", 0, 999);
      if (storeName.length < 2 || storeName.length > 80) throw new Error("Informe o nome da loja.");
      if (!unitName || unitName.length > 80 || phone.length > 40 || address.length > 160 || openingHours.length > 100) {
        throw new Error("Confira os dados da unidade e do contato.");
      }
      state.settings = { storeName, unitName, phone, address, openingHours, lowStockAt };
      return state.settings;
    }
    case "preview.reset": return makeBaseState(now);
    default: throw new Error("Ação não disponível para o preview de Moda.");
  }
}

export function createModaPreviewDataPort({ storage = globalThis.localStorage, clock = () => new Date() } = {}) {
  let snapshot = null;
  const listeners = new Set();
  let destroyed = false;

  function persist(value) {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
  }

  function notify() {
    for (const listener of [...listeners]) {
      try { listener(clone(snapshot)); } catch {}
    }
  }

  return {
    schema: MODA_PREVIEW_PORT_SCHEMA,
    persistence: "browser-local-preview",
    async initialize() {
      if (destroyed) throw new Error("O port já foi encerrado.");
      if (snapshot) return clone(snapshot);
      let saved = null;
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw) saved = assertSnapshot(JSON.parse(raw));
      } catch {
        saved = null;
      }
      snapshot = saved ? clone(saved) : makeBaseState(clock());
      const catalogMigrated = saved ? migrateCatalogFitProfiles(snapshot, clock()) : false;
      const studioMigrated = migrateProductStudio(snapshot, clock());
      if (!saved) persist(snapshot);
      else if (catalogMigrated || studioMigrated) persist(snapshot);
      return clone(snapshot);
    },
    getSnapshot() {
      if (!snapshot) throw new Error("Inicialize os dados de Moda antes de consultar o estado.");
      return clone(snapshot);
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("A inscrição precisa ser uma função.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async execute(command) {
      if (!snapshot || destroyed) throw new Error("O adapter local não está ativo.");
      let next = clone(snapshot);
      let result = executeCommand(next, command, clock());
      if (command?.type === "preview.reset") {
        next = result;
        result = { reset: true };
      }
      next.revision = snapshot.revision + 1;
      assertSnapshot(next);
      persist(next);
      snapshot = next;
      notify();
      return { result: clone(result), snapshot: clone(snapshot) };
    },
    destroy() {
      destroyed = true;
      listeners.clear();
    },
  };
}
