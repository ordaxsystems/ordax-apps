import { createBrowserLocalFoodStore } from "/apps/food-pizzeria/src/adapters/browser-local-store.mjs";
import { createFoodPizzeriaApp } from "/apps/food-pizzeria/src/ui/app.mjs";

const root = document.querySelector("#app");
if (!root) throw new TypeError("O host local não encontrou a área de montagem do OrdaX Food.");

const dataPort = createBrowserLocalFoodStore({ businessId: "preview-na-garagem" });
const app = createFoodPizzeriaApp({ root, dataPort });
try {
  await app.mount();
} catch (error) {
  dataPort.destroy();
  throw error;
}

window.addEventListener("pagehide", () => {
  app.destroy();
  dataPort.destroy();
}, { once: true });