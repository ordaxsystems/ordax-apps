import { mountProductHost } from "/product-host.mjs";
import { areas } from "./views.mjs";

export function mountApp(services) {
  return mountProductHost({ appId: "qualidade-manutencao", title: "Qualidade e Manutenção", subtitle: "HISTÓRICO DA OFICINA", mark: "Q+M", services, areas });
}
