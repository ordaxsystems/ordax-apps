import { mountProductHost } from "/product-host.mjs";
import { areas } from "./views.mjs";

export function mountApp(services) {
  return mountProductHost({ appId: "operacoes-impressao", title: "Operações de Impressão", subtitle: "DISPOSITIVOS E TRABALHOS", mark: "OPS", services, areas });
}
