import assert from "node:assert/strict";
import test from "node:test";
import { renderSettingsPage } from "../src/ui/views/settings.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";

test("configurações separam a preferência local de entrega do estado Food", () => {
  const snapshot = createSeedFoodState();
  const html = renderSettingsPage({
    snapshot,
    busy: false,
    iconSvg: () => "",
    escapeHtml: (value) => String(value),
    money: (cents) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100),
    deliveryFeeCents: 500,
    settingsSizesDraft: snapshot.settings.pizzaSizes,
    settingsTablesDraft: snapshot.settings.tables,
  });

  const previewPreferenceForm = html.match(/<form id="preview-delivery-fee-form"[\s\S]*?<\/form>/)?.[0];
  const operationalSettingsForm = html.match(/<form id="settings-form"[\s\S]*?<\/form>/)?.[0];
  const settingsSideColumn = html.match(/<aside class="settings-side-column"[\s\S]*?<\/aside>/)?.[0];
  assert.ok(previewPreferenceForm, "a dedicated form contains the local preview preference");
  assert.ok(operationalSettingsForm, "a separate form contains canonical Food settings");
  assert.match(html, /class="settings-layout"/);
  assert.ok(settingsSideColumn, "local settings and pending integrations share the side column");
  assert.ok(html.indexOf('id="settings-form"') < html.indexOf('class="settings-side-column"'),
    "canonical operational settings precede local preferences in reading order");
  assert.match(settingsSideColumn, /id="preview-delivery-fee-form"[\s\S]*?class="panel capability-pending"/);
  assert.match(previewPreferenceForm, /type="submit"/);
  assert.match(html, /Taxa padrão de entrega/);
  assert.match(html, /name="deliveryFee"[^>]*value="R\$ 5,00"/);
  assert.doesNotMatch(operationalSettingsForm, /name="deliveryFee"/);
  assert.match(previewPreferenceForm, /neste navegador; não calcula distância nem altera o estado dos pedidos/);
  assert.match(html, /nem altera o estado dos pedidos/);
});
