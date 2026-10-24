import { createDevelopmentServices } from "/development-services.mjs";

const appId = document.documentElement.dataset.appId;
try {
  const app = await import("/app.mjs");
  if (typeof app.mountApp !== "function") throw new TypeError("App entrypoint must export mountApp(services)");
  app.mountApp(createDevelopmentServices(appId));
} catch (error) {
  console.error("3D app host could not mount the app:", error);
  const root = document.querySelector("#app");
  root.replaceChildren();
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = `Não foi possível abrir ${appId || "o app"}. Consulte o erro no console do host.`;
  root.append(message);
}
