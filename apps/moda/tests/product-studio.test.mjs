import test from "node:test";
import assert from "node:assert/strict";
import { money, stockForSku } from "../src/domain/derived.mjs";
import { buildTryOnBrief } from "../src/domain/fit-brief.mjs";
import { evaluateGarmentFit } from "../src/domain/fit-engine.mjs";
import { renderInventoryPage, renderOverviewPage, renderPosPage, renderProductStudioPage, renderProductsPage } from "../src/ui/views.mjs";
import { createModaPreviewDataPort } from "../../../prototypes/moda/preview-data-port.mjs";

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
}

function mockPort() {
  const storage = new MemoryStorage();
  const clock = () => new Date("2026-10-25T12:00:00.000Z");
  return { storage, port: createModaPreviewDataPort({ storage, clock }) };
}

test("POS selects the first in-stock variant and displays the matching SKU price", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const product = state.catalog.products.find((item) => item.id === "camisa-brisa");
  const first = product.variants.find((variant) => variant.active);
  const available = product.variants.find((variant) => variant.active && variant.sku !== first.sku);
  const firstStock = stockForSku(state, first.sku);
  assert.ok(firstStock > 0, "fixture variant starts with stock before the simulated sale");
  state.inventory.movements.push({
    id: "fixture-disable-first-variant", sku: first.sku, kind: "dispatch",
    quantity: firstStock, occurredAt: "2026-10-25T12:00:00.000Z",
  });
  available.priceCents += 5_000;

  const page = renderPosPage(state);

  assert.ok(page.includes('value="' + first.sku + '" disabled>'), "the unavailable first SKU is disabled");
  assert.match(page, new RegExp('value="' + available.sku + '"[^>]*\\bselected\\b'), "the first available SKU is explicitly selected");
  assert.ok(page.includes('data-product-price="' + product.id + '">' + money(available.priceCents) + "</strong>"), "the card price comes from that selected SKU");
  port.destroy();
});

test("POS cart and checkout totals always use the current catalog price for each SKU", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const product = state.catalog.products.find((item) => item.id === "camisa-brisa");
  const variant = product.variants.find((item) => item.active && stockForSku(state, item.sku) > 0);
  const oldPrice = variant.priceCents;
  variant.priceCents += 7_500;

  const page = renderPosPage(state, {
    cart: [{ sku: variant.sku, quantity: 2, unitPriceCents: oldPrice }],
  });

  assert.ok(page.includes("2 × " + money(variant.priceCents) + " · " + variant.sku));
  assert.ok(page.includes(money(variant.priceCents * 2)));
  assert.ok(!page.includes("2 × " + money(oldPrice) + " · " + variant.sku));
  port.destroy();
});

test("local studio seeds fictional synthetic profiles and product preview records", async () => {
  const { port } = mockPort();
  const state = await port.initialize();

  assert.equal(state.settings.storeName, "Ateliê Aurora");
  assert.equal(state.catalog.products.find((item) => item.id === "camisa-brisa").imageSrc, "/apps/moda/assets/wearly/product-linen-shirt.jpg");
  assert.equal(state.studio.models.length, 2);
  assert.ok(state.studio.models.every((model) => model.synthetic));
  assert.equal(state.studio.jobs.length, 2);
  assert.ok(state.studio.jobs.every((job) => job.status.startsWith("local-")));
  assert.ok(state.studio.jobs.every((job) => job.contextSnapshot?.fitReport?.status === "ready"));
  assert.ok(state.studio.jobs.every((job) => job.contextSnapshot?.brief?.source === "local-preview"));
  port.destroy();
});

test("fit report and structured image brief agree on the selected garment size", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const product = state.catalog.products.find((item) => item.id === "camisa-brisa");
  const variant = product.variants.find((item) => item.size === "M" && item.color === "Areia");
  const model = state.studio.models.find((item) => item.id === "model-aurora-regular");
  const report = evaluateGarmentFit({ product, variant, bodyMeasurements: model.measurements });
  const brief = buildTryOnBrief({ product, variant, model, report });

  assert.equal(report.status, "ready");
  const chest = report.rows.find((row) => row.key === "chest");
  assert.equal(chest.stretchToleranceCm, 0.7);
  assert.equal(chest.smallThresholdCm, -2.7);
  assert.equal(chest.largeThresholdCm, 8);
  assert.equal(report.method.id, "ordax.moda-fit-estimate/1");
  assert.equal(brief.variant.sku, variant.sku);
  assert.equal(brief.fit.verdict, report.verdict);
  assert.equal(brief.fit.method.id, report.method.id);
  assert.equal(brief.fit.dimensions.find((row) => row.label === "Busto").stretchToleranceCm, chest.stretchToleranceCm);
  assert.equal(brief.product.cut, product.fitProfile.cut);
  assert.equal(brief.fit.dimensions.length, report.rows.length);
  assert.equal(brief.referenceModel.fitPreference, model.fitPreference);
  assert.ok(brief.instructions.some((instruction) => instruction.includes("Regular") && instruction.includes("não altera o resultado numérico")));
  assert.equal(brief.delivery.state, "provider-unavailable");
  assert.match(brief.delivery.message, /Nenhuma foto ou medida foi enviada/);

  const preview = renderProductStudioPage(state, { selectedJobId: state.studio.jobs[0].id });
  assert.match(preview, /Ilustração esquemática baseada em medidas numéricas, não é prova virtual nem foi gerada por IA/);
  assert.match(preview, /margem de elasticidade é heurística/);
  assert.match(preview, /diferença para o alvo/);
  assert.match(preview, /alertas: justo abaixo de .* cm, amplo acima de \+/);
  assert.match(preview, /Marcadores esquemáticos; não representam uma prova fotográfica/);
  for (const row of state.studio.jobs[0].contextSnapshot.fitReport.rows) {
    assert.match(preview, new RegExp('data-fit-measure="' + row.key + '" data-verdict="' + row.verdict + '"'));
    assert.ok(preview.includes(row.label));
  }
  const savedModelId = state.studio.jobs[0].contextSnapshot.model.id;
  assert.match(preview, new RegExp('data-model-profile="' + savedModelId + '"'));
  const uploadedReferences = renderProductStudioPage(state, {
    productId: product.id,
    variantId: variant.id,
    modelId: model.id,
    report,
    brief,
    references: {
      front: { url: "blob:local/front" },
      detail: { url: "blob:local/detail" },
      back: { url: "blob:local/back" },
    },
  });
  assert.match(uploadedReferences, /src="blob:local\/front" alt="Foto temporária da frente de Camisa Brisa de Linho"/);
  assert.match(uploadedReferences, /src="blob:local\/detail"/);
  assert.match(uploadedReferences, /src="blob:local\/back"/);
  assert.match(uploadedReferences, /FOTO LOCAL · FRENTE/);
  assert.match(uploadedReferences, /RASCUNHO LOCAL/);
  assert.match(uploadedReferences, /REGIÕES DO CÁLCULO/);
  assert.match(uploadedReferences, /data-action="studio-preview-create" >/);
  port.destroy();
});

test("studio illustration changes with the synthetic body profile and selected size", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const product = state.catalog.products.find((item) => item.id === "camisa-brisa");
  const regular = state.studio.models.find((item) => item.id === "model-aurora-regular");
  const curves = state.studio.models.find((item) => item.id === "model-aurora-roomy");
  const variantForSize = (size) => product.variants.find((item) => item.size === size && item.color === "Areia");
  const render = (model, size) => renderProductStudioPage(state, {
    productId: product.id,
    variantId: variantForSize(size).id,
    modelId: model.id,
  });
  const regularM = render(regular, "M");
  const curvesM = render(curves, "M");
  const regularP = render(regular, "P");
  const regularG = render(regular, "G");
  const readScale = (html) => {
    const match = html.match(/data-angle="FRENTE" data-model-profile="[^"]+" data-body-width-scale="([^"]+)" data-garment-size="([^"]+)" data-garment-width-scale="([^"]+)"/);
    assert.ok(match, "the illustration should expose its schematic profile and size scales");
    return { body: Number(match[1]), size: match[2], garment: Number(match[3]) };
  };

  const regularMScale = readScale(regularM);
  assert.equal(regularMScale.body, 1);
  assert.ok(readScale(curvesM).body > regularMScale.body);
  assert.equal(regularMScale.garment, 1);
  assert.ok(readScale(regularP).garment < regularMScale.garment);
  assert.ok(readScale(regularG).garment > regularMScale.garment);
  assert.match(curvesM, /ESCALA ESQUEMÁTICA/);
  assert.match(curvesM, /Proporções esquemáticas baseadas nas medidas numéricas do perfil/);
  assert.match(curvesM, /não é prova virtual nem geração de IA/);
  port.destroy();
});

test("opening the studio starts a fresh draft with its catalog reference visible", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const html = renderProductStudioPage(state);

  assert.match(html, /RASCUNHO LOCAL/);
  assert.match(html, /MOCK DE CATÁLOGO · WEARLY/);
  assert.match(html, /Imagem de referência do mock para Camisa Brisa de Linho/);
  assert.match(html, /studio-profile-silhouette/);
  assert.match(html, /studio-photo-action">Trocar foto/);
  assert.match(html, /studio-photo-action">Adicionar foto/);
  assert.match(html, /studio-photo-input" type="file"/);
  assert.match(html, /Analise o caimento para destacar as regiões/);
  assert.match(html, /data-action="studio-preview-create" disabled/);
  assert.doesNotMatch(html, /Você está vendo a versão 1 salva/);
  port.destroy();
});

test("profile photo references appear only in the current studio preview and stay out of saved data", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const references = {
    front: { url: "blob:local/profile-front" },
    side: { url: "blob:local/profile-side" },
    back: { url: "blob:local/profile-back" },
  };
  const html = renderProductStudioPage(state, { modelReferences: references });

  assert.match(html, /FOTOS DE REFERÊNCIA/);
  assert.match(html, /data-studio-model-photo="front"/);
  assert.match(html, /data-studio-model-photo="side"/);
  assert.match(html, /data-studio-model-photo="back"/);
  assert.match(html, /REFERÊNCIAS DO PERFIL/);
  assert.match(html, /blob:local\/profile-front/);
  assert.match(html, /Foto temporária costas do perfil/);
  assert.match(html, /não alteram as medidas/);
  assert.doesNotMatch(JSON.stringify(state), /blob:local\/profile-/);
  port.destroy();
});

test("new apparel can move from catalog creation to a size chart and an analyzable studio draft", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const created = await port.execute({
    type: "catalog.create",
    payload: {
      name: "Vestido Jardim",
      category: "Roupas",
      kind: "dress",
      description: "Vestido de algodão com modelagem reta.",
      priceCents: 15990,
      initialStock: 4,
      sizes: ["P", "M", "G"],
      colors: ["Azul"],
    },
  });
  const product = created.result;
  assert.equal(product.fitProfile, undefined);
  assert.equal(product.variants.length, 3);
  assert.equal(created.snapshot.catalog.products[0].name, "Vestido Jardim");

  const saved = await port.execute({
    type: "catalog.fit-profile.save",
    payload: {
      productId: product.id,
      fabric: "Algodão",
      cut: "Regular",
      stretchPercent: 1,
      measurementsBySize: {
        P: { chest: 86, waist: 72, hip: 94 },
        M: { chest: 92, waist: 78, hip: 100 },
        G: { chest: 98, waist: 84, hip: 106 },
      },
      easeByMeasurementCm: { chest: 4, waist: 3, hip: 5 },
    },
  });
  assert.deepEqual(saved.snapshot.sales, created.snapshot.sales, "a fit sheet does not create or edit sales");
  assert.equal(saved.snapshot.inventory.movements.length, created.snapshot.inventory.movements.length, "saving garment measurements does not create an inventory movement");
  const savedProduct = saved.snapshot.catalog.products.find((item) => item.id === product.id);
  const variant = savedProduct.variants.find((item) => item.size === "M");
  const model = saved.snapshot.studio.models.find((item) => item.active);
  const report = evaluateGarmentFit({ product: savedProduct, variant, bodyMeasurements: model.measurements });
  const brief = buildTryOnBrief({ product: savedProduct, variant, model, report });
  const studio = renderProductStudioPage(saved.snapshot, {
    productId: savedProduct.id,
    variantId: variant.id,
    modelId: model.id,
    report,
    brief,
  });

  assert.equal(report.status, "ready");
  assert.equal(report.size, "M");
  assert.equal(brief.product.fabric, "Algodão");
  assert.match(studio, /Vestido Jardim/);
  assert.match(studio, /data-action="studio-preview-create" >/);
  assert.match(studio, /REGIÕES DO CÁLCULO/);
  assert.match(studio, /Composição é contextual; só a elasticidade informada altera a margem heurística do alerta/);
  const garmentViews = [...studio.matchAll(/data-garment-view="([^"]+)"/g)];
  assert.deepEqual(garmentViews.map(([, angle]) => angle), ["FRENTE", "LATERAL", "COSTAS"]);
  assert.equal((studio.match(/class="studio-garment-view"/g) ?? []).length, 3, "each angle should have its own garment drawing");
  assert.match(studio, /studio-garment-view" data-garment-view="FRENTE" transform="translate\(/);
  const shoe = saved.snapshot.catalog.products.find((item) => item.kind === "shoe");
  await assert.rejects(port.execute({
    type: "catalog.fit-profile.save",
    payload: { productId: shoe.id, fabric: "Couro", cut: "Regular", stretchPercent: 0, measurementsBySize: {}, easeByMeasurementCm: {} },
  }), /provador está disponível para blusas, camisas, calças e vestidos/);
  port.destroy();
});

test("seller-entered elasticity changes only the explicit heuristic tolerance", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const product = structuredClone(state.catalog.products.find((item) => item.id === "vestido-serena"));
  const variant = product.variants.find((item) => item.size === "P");
  const model = state.studio.models.find((item) => item.id === "model-aurora-regular");
  product.fitProfile.measurementsBySize.P = { chest: 90, waist: 75, hip: 103 };
  product.fitProfile.easeByMeasurementCm = { chest: 4, waist: 3, hip: 5 };

  product.fitProfile.stretchPercent = 5;
  const lowerStretch = evaluateGarmentFit({ product, variant, bodyMeasurements: model.measurements });
  product.fitProfile.stretchPercent = 6;
  const higherStretch = evaluateGarmentFit({ product, variant, bodyMeasurements: model.measurements });
  const lowerChest = lowerStretch.rows.find((row) => row.key === "chest");
  const higherChest = higherStretch.rows.find((row) => row.key === "chest");

  assert.equal(lowerChest.differenceCm, -4);
  assert.equal(lowerChest.verdict, "small");
  assert.equal(higherChest.verdict, "balanced");
  assert.equal(higherChest.stretchToleranceCm, 2.2);
  assert.equal(higherChest.smallThresholdCm, -4.2);

  const sameStretchDifferentComposition = structuredClone(product);
  sameStretchDifferentComposition.fitProfile.fabric = "Composição textual diferente";
  const sameNumericResult = evaluateGarmentFit({
    product: sameStretchDifferentComposition,
    variant,
    bodyMeasurements: model.measurements,
  });
  assert.deepEqual(sameNumericResult.rows, higherStretch.rows, "fiber text is context, not an automatic material inference");
  port.destroy();
});

test("Wearly reference photos bring the same ten products into catalog, overview, and POS", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const references = state.catalog.products.filter((product) => product.imageSrc);

  assert.equal(references.length, 10);
  const catalog = renderProductsPage(state);
  const pointOfSale = renderPosPage(state);
  const overview = renderOverviewPage(state);
  assert.equal((catalog.match(/catalog-product-card/g) ?? []).length, state.catalog.products.length, "the catalog should render an editorial card for every product");
  assert.equal((catalog.match(/product-art-source/g) ?? []).length, 10);
  assert.equal((pointOfSale.match(/product-art-source/g) ?? []).length, 10);
  assert.match(overview, /feature-product-photo/);
  assert.match(overview, /has-wearly-photo/);
  const featuredPhotos = [...overview.matchAll(/<img class="feature-product-photo" src="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(featuredPhotos.length, 4, "overview should lead with four photo references");
  assert.ok(featuredPhotos.every((src) => references.some((product) => product.imageSrc === src)));
  assert.ok(overview.indexOf("Peças em destaque") < overview.indexOf("Vendas recentes"), "the photo rail should appear before the operations table");
  for (const product of references) {
    assert.ok(catalog.includes(product.imageSrc), product.name + " should use its Wearly reference in the catalog");
    assert.ok(pointOfSale.includes(product.imageSrc), product.name + " should use its Wearly reference in the point of sale");
  }
  port.destroy();
});

test("catalog and inventory active-variant totals exclude archived products", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  state.catalog.products.find((item) => item.id === "camisa-brisa").active = false;

  const catalog = renderProductsPage(state);
  const inventory = renderInventoryPage(state);

  assert.match(catalog, /<span>Variantes ativas<\/span><strong>118<\/strong>/);
  assert.match(inventory, /<strong class="metric-value">118<\/strong><small>em 14 produtos<\/small>/);
  assert.match(inventory, /<strong class="metric-value">0<\/strong><small>mínimo configurado: 5 un\.<\/small>/);
  port.destroy();
});

test("inventory distinguishes archived products and inactive variants from sellable stock", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const stockedVariant = (product) => product.variants.find((variant) => variant.active && stockForSku(state, variant.sku) > state.settings.lowStockAt);
  const archivedProduct = state.catalog.products.find((product) => product.active && stockedVariant(product));
  const archivedSku = stockedVariant(archivedProduct).sku;
  const inactiveProduct = state.catalog.products.find((product) => product.active && product.id !== archivedProduct.id && stockedVariant(product));
  const inactiveVariant = stockedVariant(inactiveProduct);
  const inactiveSku = inactiveVariant.sku;
  const availableProduct = state.catalog.products.find((product) => product.active && product.id !== archivedProduct.id && product.id !== inactiveProduct.id && stockedVariant(product));
  const availableSku = stockedVariant(availableProduct).sku;
  const balances = [archivedSku, inactiveSku, availableSku].map((sku) => stockForSku(state, sku));

  archivedProduct.active = false;
  inactiveVariant.active = false;

  assert.match(renderInventoryPage(state, archivedSku), /class="status-pill status-off">Produto arquivado<\/span>/);
  assert.match(renderInventoryPage(state, inactiveSku), /class="status-pill status-off">Variante inativa<\/span>/);
  assert.match(renderInventoryPage(state, availableSku), /class="status-pill status-active">Disponível<\/span>/);
  assert.deepEqual([archivedSku, inactiveSku, availableSku].map((sku) => stockForSku(state, sku)), balances, "archiving catalog entries must preserve their historical inventory balances");
  port.destroy();
});

test("catalog edits update variant pricing without rewriting inventory, fit data, or historical sales", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const product = state.catalog.products.find((item) => item.id === "camisa-brisa");
  const salesBefore = structuredClone(state.sales);
  const inventoryBefore = structuredClone(state.inventory);
  const fitBefore = structuredClone(product.fitProfile);
  const variantIdentity = product.variants.map(({ id, sku, size, color }) => ({ id, sku, size, color }));
  const pricesByVariantId = Object.fromEntries(product.variants.map((variant, index) => [variant.id, variant.priceCents + (index + 1) * 100]));
  const updated = await port.execute({
    type: "catalog.update",
    payload: {
      productId: product.id,
      name: "Camisa Brisa Atualizada",
      description: "Descrição revisada para a coleção atual.",
      pricesByVariantId,
    },
  });
  const current = updated.snapshot.catalog.products.find((item) => item.id === product.id);

  assert.equal(current.name, "Camisa Brisa Atualizada");
  assert.equal(current.description, "Descrição revisada para a coleção atual.");
  assert.deepEqual(current.variants.map(({ id, sku, size, color }) => ({ id, sku, size, color })), variantIdentity);
  assert.deepEqual(current.variants.map((variant) => variant.priceCents), Object.values(pricesByVariantId));
  assert.deepEqual(current.fitProfile, fitBefore);
  assert.deepEqual(updated.snapshot.inventory, inventoryBefore);
  assert.deepEqual(updated.snapshot.sales, salesBefore);

  const editHtml = renderProductsPage(updated.snapshot, "", { editProductId: product.id });
  assert.match(editHtml, /data-form="product-edit"/);
  assert.match(editHtml, /Camisa Brisa Atualizada/);
  for (const variant of current.variants) assert.match(editHtml, new RegExp("price__" + variant.id));

  await assert.rejects(port.execute({
    type: "catalog.update",
    payload: { productId: product.id, name: "Alteração inválida", pricesByVariantId: {} },
  }), /lista de preços não corresponde/);
  assert.equal(port.getSnapshot().catalog.products.find((item) => item.id === product.id).name, "Camisa Brisa Atualizada");
  port.destroy();
});

test("overall fit verdict does not contradict a single outlying measurement", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const product = state.catalog.products.find((item) => item.id === "camisa-brisa");
  const variant = product.variants.find((item) => item.size === "P" && item.color === "Areia");
  const report = evaluateGarmentFit({
    product,
    variant,
    bodyMeasurements: { chest: 90, waist: 72, hip: 92, shoulder: 37 },
  });

  assert.equal(report.rows.filter((row) => row.verdict === "large").length, 1);
  assert.equal(report.verdict, "large");
  assert.equal(report.title, "Pode ficar grande");
  port.destroy();
});

test("fit analysis refuses partial size charts and reports the missing measurement", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const product = state.catalog.products.find((item) => item.id === "camisa-brisa");
  const variant = product.variants.find((item) => item.size === "P" && item.color === "Areia");
  const model = state.studio.models[0];
  const incompleteProduct = structuredClone(product);
  delete incompleteProduct.fitProfile.measurementsBySize[variant.size].shoulder;

  const report = evaluateGarmentFit({
    product: incompleteProduct,
    variant,
    bodyMeasurements: model.measurements,
  });
  assert.equal(report.status, "incomplete");
  assert.match(report.message, /Ombros/);
  const html = renderProductStudioPage(state, {
    productId: product.id,
    variantId: variant.id,
    modelId: model.id,
    report,
  });
  assert.match(html, /Dados de caimento incompletos/);
  assert.match(html, /Complete as medidas da peça: Ombros/);
  assert.doesNotMatch(html, /studio-fit-overlay|REGIÕES DO CÁLCULO/);

  const incompleteEase = structuredClone(product);
  delete incompleteEase.fitProfile.easeByMeasurementCm.shoulder;
  const easeReport = evaluateGarmentFit({
    product: incompleteEase,
    variant,
    bodyMeasurements: model.measurements,
  });
  assert.equal(easeReport.status, "incomplete");
  assert.match(easeReport.message, /folga planejada.*Ombros/i);
  port.destroy();
});

test("preview creation and review stay in the local history without calling a provider", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const product = state.catalog.products.find((item) => item.fitProfile);
  const variant = product.variants.find((item) => item.active);
  const model = state.studio.models[0];

  const created = await port.execute({
    type: "studio.preview.create",
    payload: { productId: product.id, variantId: variant.id, modelId: model.id },
  });
  assert.equal(created.result.status, "local-illustration");
  assert.equal(created.snapshot.studio.jobs[0].productId, product.id);
  assert.equal(created.result.contextSnapshot.fitReport.status, "ready");
  assert.equal(created.result.contextSnapshot.brief.variant.sku, variant.sku);

  await assert.rejects(port.execute({
    type: "studio.preview.review",
    payload: { jobId: created.result.id, decision: "changes-requested", note: "" },
  }), /pelo menos 5 caracteres/);
  assert.equal(port.getSnapshot().studio.jobs[0].reviews, undefined);
  const changesRequested = await port.execute({
    type: "studio.preview.review",
    payload: { jobId: created.result.id, decision: "changes-requested", note: "Revisar o tom da variante." },
  });
  assert.equal(changesRequested.result.status, "local-illustration");
  assert.equal(changesRequested.result.reviews[0].decision, "changes-requested");
  const requestedChangesHtml = renderProductStudioPage(changesRequested.snapshot, {
    productId: product.id, variantId: variant.id, modelId: model.id,
    selectedJobId: created.result.id,
  });
  assert.match(requestedChangesHtml, /data-action="studio-revise"/);
  assert.match(requestedChangesHtml, /Preparar nova versão/);

  await assert.rejects(port.execute({
    type: "studio.preview.review",
    payload: { jobId: created.result.id, decision: "approved", note: "Conferido para publicação." },
  }), /Crie uma nova versão/);
  const revision = await port.execute({
    type: "studio.preview.create",
    payload: {
      productId: product.id, variantId: variant.id, modelId: model.id,
      revisionOfJobId: created.result.id,
    },
  });
  assert.equal(revision.result.revision.version, 2);
  assert.equal(revision.result.revision.rootJobId, created.result.id);
  assert.equal(revision.result.revision.basedOnJobId, created.result.id);
  assert.equal(revision.result.revision.requestedChanges, "Revisar o tom da variante.");
  const parentHtml = renderProductStudioPage(revision.snapshot, {
    productId: product.id, variantId: variant.id, modelId: model.id,
    selectedJobId: created.result.id,
  });
  assert.match(parentHtml, /Abrir versão 2/);
  await assert.rejects(port.execute({
    type: "studio.preview.create",
    payload: {
      productId: product.id, variantId: variant.id, modelId: model.id,
      revisionOfJobId: created.result.id,
    },
  }), /já tem uma revisão posterior/);
  const revisionDraftHtml = renderProductStudioPage(revision.snapshot, {
    productId: product.id, variantId: variant.id, modelId: model.id,
    revisionOfJobId: created.result.id,
    revisionRequestNote: changesRequested.result.reviews[0].note,
  });
  assert.match(revisionDraftHtml, /Nova versão a partir da versão 1/);
  assert.match(revisionDraftHtml, /Revisar o tom da variante/);
  assert.match(revisionDraftHtml, /não altera a imagem esquemática/);
  assert.match(revisionDraftHtml, /Criar ilustração mock/);

  const reviewed = await port.execute({
    type: "studio.preview.review",
    payload: { jobId: revision.result.id, decision: "approved", note: "Conferido para publicação." },
  });
  assert.equal(reviewed.result.status, "reviewed-local");
  assert.equal(reviewed.snapshot.studio.jobs[0].reviewedAt, "2026-10-25T12:00:00.000Z");
  assert.deepEqual(reviewed.result.reviews.map((item) => item.decision), ["approved"]);
  assert.equal(reviewed.snapshot.studio.jobs.find((item) => item.id === created.result.id).reviews[0].decision, "changes-requested");
  const reviewHtml = renderProductStudioPage(reviewed.snapshot, {
    productId: product.id, variantId: variant.id, modelId: model.id,
    selectedJobId: reviewed.result.id, reviewJobId: reviewed.result.id,
    report: reviewed.result.contextSnapshot.fitReport,
    brief: reviewed.result.contextSnapshot.brief,
  });
  assert.match(reviewHtml, /Aprovada localmente/);
  assert.match(reviewHtml, /Conferido para publicação/);
  assert.match(reviewHtml, /Revisar novamente/);
  assert.match(reviewHtml, /data-form="studio-review"/);
  assert.match(reviewHtml, /Solicitar ajustes/);
  assert.match(reviewHtml, /Versão 2/);
  port.destroy();
});

test("studio version chains remain linked when old unrelated previews are pruned", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const product = state.catalog.products.find((item) => item.fitProfile);
  const variant = product.variants.find((item) => item.active);
  const model = state.studio.models[0];
  const create = (revisionOfJobId = null) => port.execute({
    type: "studio.preview.create",
    payload: { productId: product.id, variantId: variant.id, modelId: model.id, revisionOfJobId },
  });
  const requestChanges = (jobId) => port.execute({
    type: "studio.preview.review",
    payload: { jobId, decision: "changes-requested", note: "Rever detalhe visual." },
  });
  const first = await create();
  await requestChanges(first.result.id);
  const second = await create(first.result.id);
  await requestChanges(second.result.id);
  const third = await create(second.result.id);
  for (let index = 0; index < 23; index += 1) await create();

  const jobs = port.getSnapshot().studio.jobs;
  assert.ok(jobs.length >= 24);
  assert.ok([first.result.id, second.result.id, third.result.id].every((id) => jobs.some((job) => job.id === id)));
  assert.equal(jobs.find((job) => job.id === second.result.id).revision.basedOnJobId, first.result.id);
  assert.equal(jobs.find((job) => job.id === third.result.id).revision.basedOnJobId, second.result.id);
  assert.equal(jobs.find((job) => job.id === third.result.id).revision.version, 3);
  port.destroy();
});

test("studio history keeps its original garment, variant, model, fit result, and brief", async () => {
  const { storage, port } = mockPort();
  const state = await port.initialize();
  const product = state.catalog.products.find((item) => item.fitProfile);
  const variant = product.variants.find((item) => item.active);
  const model = state.studio.models[0];
  const created = await port.execute({
    type: "studio.preview.create",
    payload: { productId: product.id, variantId: variant.id, modelId: model.id },
  });
  const captured = created.result.contextSnapshot;
  const stored = JSON.parse(storage.getItem("ordax.moda.atelie-aurora.preview.v1"));
  const currentProduct = stored.catalog.products.find((item) => item.id === product.id);
  const currentVariant = currentProduct.variants.find((item) => item.id === variant.id);
  const currentModel = stored.studio.models.find((item) => item.id === model.id);
  currentProduct.name = "Peça atualizada no catálogo";
  currentProduct.fitProfile.fabric = "Linho novo";
  currentVariant.color = "Azul";
  currentModel.measurements.chest += 12;
  storage.setItem("ordax.moda.atelie-aurora.preview.v1", JSON.stringify(stored));
  port.destroy();

  const reopenedPort = createModaPreviewDataPort({ storage, clock: () => new Date("2026-10-25T12:00:00.000Z") });
  const reopened = await reopenedPort.initialize();
  const historicalJob = reopened.studio.jobs.find((job) => job.id === created.result.id);
  const current = reopened.catalog.products.find((item) => item.id === product.id);
  assert.equal(current.name, "Peça atualizada no catálogo");
  assert.equal(current.fitProfile.fabric, "Linho novo");
  assert.equal(historicalJob.contextSnapshot.product.name, captured.product.name);
  assert.equal(historicalJob.contextSnapshot.product.fitProfile.fabric, captured.product.fitProfile.fabric);
  assert.equal(historicalJob.contextSnapshot.variant.color, captured.variant.color);
  assert.equal(historicalJob.contextSnapshot.model.measurements.chest, captured.model.measurements.chest);
  assert.deepEqual(historicalJob.contextSnapshot.fitReport, captured.fitReport);
  assert.deepEqual(historicalJob.contextSnapshot.brief, captured.brief);
  reopenedPort.destroy();
});

test("unversioned historical fit results keep their verdict without borrowing current thresholds", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const product = state.catalog.products.find((item) => item.fitProfile);
  const variant = product.variants.find((item) => item.active);
  const model = state.studio.models[0];
  const currentReport = evaluateGarmentFit({ product, variant, bodyMeasurements: model.measurements });
  const historicalReport = structuredClone(currentReport);
  delete historicalReport.method;
  delete historicalReport.stretchPercent;
  historicalReport.note = "Resultado preservado de uma sessão anterior.";
  for (const row of historicalReport.rows) {
    delete row.stretchToleranceCm;
    delete row.smallThresholdCm;
    delete row.largeThresholdCm;
  }
  const brief = buildTryOnBrief({ product, variant, model, report: historicalReport });
  const html = renderProductStudioPage(state, {
    productId: product.id,
    variantId: variant.id,
    modelId: model.id,
    report: historicalReport,
    brief,
  });

  assert.equal(brief.fit.method.id, "ordax.moda-fit-estimate/unversioned");
  assert.equal(brief.fit.dimensions[0].stretchToleranceCm, null);
  assert.match(brief.instructions.join(" "), /não atribuir a ela limites de uma regra atual/);
  assert.match(html, /Sessão histórica sem versão de cálculo registrada/);
  assert.match(html, /Resultado preservado de uma sessão anterior/);
  assert.doesNotMatch(html, /alertas: justo abaixo de/);
  assert.doesNotMatch(html, /margem estimada \+/);
  port.destroy();
});

test("studio history renders the captured context and asks for reanalysis before another preview", async () => {
  const { port } = mockPort();
  const state = await port.initialize();
  const product = state.catalog.products.find((item) => item.fitProfile);
  const variant = product.variants.find((item) => item.active);
  const model = state.studio.models[0];
  const created = await port.execute({
    type: "studio.preview.create",
    payload: { productId: product.id, variantId: variant.id, modelId: model.id },
  });
  const job = created.result;
  const currentProduct = created.snapshot.catalog.products.find((item) => item.id === product.id);
  currentProduct.name = "Peça nova do catálogo";
  currentProduct.fitProfile.fabric = "Tecido atualizado";
  const html = renderProductStudioPage(created.snapshot, {
    productId: product.id,
    variantId: variant.id,
    modelId: model.id,
    selectedJobId: job.id,
    report: job.contextSnapshot.fitReport,
    brief: job.contextSnapshot.brief,
  });

  assert.match(html, /Camisa Brisa de Linho/);
  assert.match(html, /Linho misto/);
  assert.match(html, /Peça nova do catálogo/); // current product remains visible in its selector
  assert.match(html, /data-action="studio-preview-create" disabled/);
  assert.match(html, /Você está vendo a versão 1 salva/);
  assert.match(html, /Grade e preferência/);
  assert.match(html, /A leitura numérica usa medidas e folga da peça/);
  assert.match(html, /Caimento irregular entre medidas/);
  const reanalyzedHtml = renderProductStudioPage(created.snapshot, {
    productId: product.id,
    variantId: variant.id,
    modelId: model.id,
    selectedJobId: null,
    report: job.contextSnapshot.fitReport,
    brief: job.contextSnapshot.brief,
  });
  assert.doesNotMatch(reanalyzedHtml, /Você está vendo uma sessão salva/);
  assert.match(reanalyzedHtml, /data-action="studio-preview-create" >/);
  port.destroy();
});

test("legacy local state migrates to the studio without replacing catalog data", async () => {
  const { storage, port } = mockPort();
  const prior = await port.initialize();
  const productIds = prior.catalog.products.map((item) => item.id);
  delete prior.studio;
  storage.setItem("ordax.moda.atelie-aurora.preview.v1", JSON.stringify(prior));
  port.destroy();

  const nextPort = createModaPreviewDataPort({ storage, clock: () => new Date("2026-10-25T12:00:00.000Z") });
  const migrated = await nextPort.initialize();
  assert.deepEqual(migrated.catalog.products.map((item) => item.id), productIds);
  assert.equal(migrated.studio.models.length, 2);
  nextPort.destroy();
});

test("older local catalog gains new clothing fixtures and opening stock without replacing edits", async () => {
  const { storage, port } = mockPort();
  const prior = await port.initialize();
  prior.catalog.products.find((item) => item.id === "camisa-brisa").name = "Nome editado na loja local";
  prior.catalog.products.find((item) => item.id === "camisa-brisa").imageSrc = "/assets/loja/camisa-local.jpg";
  const addedProductIds = new Set([
    "blusa-marea", "jaqueta-duna", "moletom-nuvem", "calca-cargo-vale",
    "tricot-cedro", "jeans-horizonte", "blazer-bruma", "vestido-lua",
  ]);
  const removedSkus = new Set(prior.catalog.products.filter((item) => addedProductIds.has(item.id)).flatMap((item) => item.variants.map((variant) => variant.sku)));
  const removedMovementIds = new Set(prior.inventory.movements.filter((item) => removedSkus.has(item.sku)).map((item) => item.id));
  prior.catalog.products = prior.catalog.products.filter((item) => !addedProductIds.has(item.id));
  prior.inventory.movements = prior.inventory.movements.filter((item) => !removedSkus.has(item.sku));
  for (const [id, movement] of Object.entries(prior.inventory.references)) {
    if (removedMovementIds.has(id)) delete prior.inventory.references[id];
  }
  storage.setItem("ordax.moda.atelie-aurora.preview.v1", JSON.stringify(prior));
  port.destroy();

  const nextPort = createModaPreviewDataPort({ storage, clock: () => new Date("2026-10-25T12:00:00.000Z") });
  const migrated = await nextPort.initialize();
  assert.equal(migrated.catalog.products.length, 15);
  assert.equal(migrated.catalog.products.find((item) => item.id === "camisa-brisa").name, "Nome editado na loja local");
  assert.equal(migrated.catalog.products.find((item) => item.id === "camisa-brisa").imageSrc, "/assets/loja/camisa-local.jpg");
  assert.ok(migrated.catalog.products.find((item) => item.id === "blazer-bruma").fitProfile);
  assert.equal(migrated.catalog.products.find((item) => item.id === "blazer-bruma").imageSrc, "/apps/moda/assets/wearly/product-relaxed-blazer.jpg");
  const newVariant = migrated.catalog.products.find((item) => item.id === "blusa-marea").variants[0];
  assert.ok(migrated.inventory.movements.some((item) => item.id === "initial-" + newVariant.sku));
  nextPort.destroy();
});
