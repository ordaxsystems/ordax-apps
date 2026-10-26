import { mountFeature as mountLibrary } from "/features/biblioteca-3d/feature.mjs";
import { mountFeature as mountInspection } from "/features/inspecao-malha/feature.mjs";

export const areas = Object.freeze([
  { id: "library", label: "Biblioteca de modelos", pageTitle: "Biblioteca de modelos", description: "Organize arquivos, coleções e favoritos da oficina.", icon: "grid", featureId: "biblioteca-3d", mount: mountLibrary },
  { id: "inspection", label: "Inspeção de malha", pageTitle: "Inspeção de malha", description: "Analise geometria e dimensões antes da preparação.", icon: "cube", featureId: "inspecao-malha", mount: mountInspection },
]);
