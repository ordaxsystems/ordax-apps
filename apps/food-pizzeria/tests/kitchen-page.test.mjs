import assert from "node:assert/strict";
import test from "node:test";
import { renderKitchenPage } from "../src/ui/views/kitchen.mjs";

test("KDS displays the active queue count without claiming a live shift", () => {
  const page = renderKitchenPage({
    KITCHEN_CHANNEL_FILTERS: [],
    kitchenChannelFilter: "all",
    snapshot: {
      orders: [
        { id: "order-received", status: "received", channel: "pickup" },
        { id: "order-preparing", status: "preparing", channel: "dine-in" },
        { id: "order-delivery", status: "out-for-delivery", channel: "delivery" },
      ],
    },
    ORDER_STAGE_ALERT_MINUTES: { received: 15, preparing: 35, ready: 15 },
    stageStartedAt: () => "2026-10-26T12:00:00.000Z",
    elapsedMinutes: () => 0,
    renderOrderCard: () => "<article></article>",
    kitchenChannelButton: () => "",
  });

  assert.match(page, /<span class="kitchen-active-count">3 pedidos ativos<\/span>/);
  assert.doesNotMatch(page, /Turno aberto|live-indicator/);
});
