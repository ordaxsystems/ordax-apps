import { mountProductHost } from "/product-host.mjs";
import { mountFeature as mountQuality } from "/features/qualidade-manutencao/feature.mjs";

export function mountApp(services) {
  return mountProductHost({ appId: "qualidade-manutencao", title: "Qualidade e Manutenção", subtitle: "HISTÓRICO DA OFICINA", mark: "Q+M", services, areas: [
  { id: "records", label: "Registros", pageTitle: "Qualidade e manutenção", description: "Documente resultados de qualidade e revisões preventivas.", icon: "check", featureId: "qualidade-manutencao", mount: mountQuality },
  ] });
}
