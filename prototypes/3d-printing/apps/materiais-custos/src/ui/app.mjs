import { mountProductHost } from "/product-host.mjs";
import { areas } from "./views.mjs";

export function mountApp(services) {
  return mountProductHost({ appId: "materiais-custos", title: "Materiais e Custos", subtitle: "ESTOQUE E ORÇAMENTO", mark: "M+C", services, areas });
}
