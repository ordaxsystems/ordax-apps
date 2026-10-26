import { mountFeature as mountQuality } from "/features/qualidade-manutencao/feature.mjs";

export const areas = Object.freeze([
  { id: "records", label: "Registros", pageTitle: "Qualidade e manutenção", description: "Documente resultados de qualidade e revisões preventivas.", icon: "check", featureId: "qualidade-manutencao", mount: mountQuality },
]);
