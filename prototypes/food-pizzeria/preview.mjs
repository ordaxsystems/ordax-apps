import { createBrowserLocalFoodStore } from "/apps/food-pizzeria/src/adapters/browser-local-store.mjs";
import { createFoodPizzeriaApp } from "/apps/food-pizzeria/src/ui/app.mjs";
import { createFoodPreviewMount } from "/apps/food-pizzeria/src/ui/preview-mount.mjs";

// URL flags exercise the content-only preview without implying a live Space host.
const params = new URL(window.location.href).searchParams;
const presentation = params.get("presentation") === "embedded-preview"
  ? "embedded-preview"
  : "standalone-preview";
const root = createFoodPreviewMount(document, presentation);
const dataPort = createBrowserLocalFoodStore({ businessId: "preview-na-garagem" });
let app;
try {
  app = createFoodPizzeriaApp({ root, dataPort, presentation });
  if (presentation === "embedded-preview") app.navigate(params.get("view") ?? "orders");
  await app.mount();
} catch (error) {
  if (new URL(window.location.href).searchParams.get("__browser_probe") === "1") {
    document.documentElement.dataset.foodPreviewStartupError = String(error?.stack ?? error).slice(0,1200);
  }
  app?.destroy();
  dataPort.destroy();
  throw error;
}

window.addEventListener("pagehide", () => {
  app.destroy();
  dataPort.destroy();
}, { once: true });