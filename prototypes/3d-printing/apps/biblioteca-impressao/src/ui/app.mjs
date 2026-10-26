import { mountProductHost } from "/product-host.mjs";
import { areas } from "./views.mjs";

export function mountApp(services) {
  return mountProductHost({ appId: "biblioteca-impressao", title: "Biblioteca 3D", subtitle: "ARQUIVOS E MODELOS", mark: "B3D", services, areas });
}
