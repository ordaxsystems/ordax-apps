import { mountProductHost } from "/product-host.mjs";
import { areas } from "./views.mjs";

export function mountApp(services) {
  return mountProductHost({ appId: "preparacao-impressao", title: "Preparação de Impressão", subtitle: "REVISÃO ANTES DE PRODUZIR", mark: "PREP", services, areas });
}
