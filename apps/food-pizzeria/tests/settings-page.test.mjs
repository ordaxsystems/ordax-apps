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

  assert.match(html, /Taxa padrão local de entrega/);
  assert.match(html, /name="deliveryFee"[^>]*value="R\$ 5,00"/);
  assert.match(html, /data-action="save-preview-delivery-fee"/);
  assert.match(html, /nem altera o contrato Food/);
});
