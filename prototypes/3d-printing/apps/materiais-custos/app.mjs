import { mountProductHost } from "/product-host.mjs";
import { mountFeature as mountMaterials } from "/features/materiais/feature.mjs";
import { mountFeature as mountCosts } from "/features/custos-impressao/feature.mjs";

export function mountApp(services) {
  return mountProductHost({ appId: "materiais-custos", title: "Materiais e Custos", subtitle: "ESTOQUE E ORÇAMENTO", mark: "M+C", services, areas: [
  { id: "materials", label: "Materiais", pageTitle: "Materiais", description: "Acompanhe bobinas, saldos e consumo estimado.", icon: "box", featureId: "materiais", mount: mountMaterials },
  { id: "costs", label: "Custos e orçamento", pageTitle: "Custos e orçamento", description: "Calcule o custo estimado de cada peça antes de aprovar.", icon: "grid", featureId: "custos-impressao", mount: mountCosts },
  ] });
}
