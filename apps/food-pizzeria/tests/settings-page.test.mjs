import assert from "node:assert/strict";
import test from "node:test";
import { renderSettingsPage } from "../src/ui/views/settings.mjs";
import { createSeedFoodState } from "../src/fixtures/mock-data.mjs";

test("configurações mostram a taxa de entrega padrão persistida no Food", () => {
  const snapshot = createSeedFoodState();
  const html = renderSettingsPage({
    snapshot,
    busy: false,
    iconSvg: () => "",
    escapeHtml: (value) => String(value),
    money: (cents) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100),
    settingsSizesDraft: snapshot.settings.pizzaSizes,
    settingsTablesDraft: snapshot.settings.tables,
  });

  assert.match(html, /Taxa padrão de entrega/);
  assert.match(html, /name="deliveryFee"[^>]*value="R\$ 5,00"/);
  assert.match(html, /pode ser ajustada em cada pedido/);
  assert.match(html, /neste navegador/);
});
