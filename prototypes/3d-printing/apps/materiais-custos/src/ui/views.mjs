import { mountFeature as mountMaterials } from "/features/materiais/feature.mjs";
import { mountFeature as mountCosts } from "/features/custos-impressao/feature.mjs";

export const areas = Object.freeze([
  { id: "materials", label: "Materiais", pageTitle: "Materiais", description: "Acompanhe bobinas, saldos e consumo estimado.", icon: "box", featureId: "materiais", mount: mountMaterials },
  { id: "costs", label: "Custos e orçamento", pageTitle: "Custos e orçamento", description: "Calcule o custo estimado de cada peça antes de aprovar.", icon: "grid", featureId: "custos-impressao", mount: mountCosts },
]);
