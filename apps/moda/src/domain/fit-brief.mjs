import { estimateStretchToleranceCm, FIT_ESTIMATE_POLICY } from "./fit-engine.mjs";

const VERDICT_COPY = Object.freeze({
  small: "A representação precisa mostrar a peça sob tensão nos pontos que ficaram abaixo da folga planejada.",
  large: "A representação precisa preservar o volume excedente e o caimento solto nos pontos que ficaram acima da folga planejada.",
  balanced: "A representação precisa preservar a folga planejada e a silhueta cadastrada, sem afinar ou ampliar o corpo.",
  mixed: "A representação precisa mostrar as diferenças por região, sem esconder as áreas justas nem as áreas amplas.",
});

function safeText(value, fallback = "Não informado") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

/**
 * Builds the local, reviewable brief that a future authorized image provider
 * could consume. This helper performs no networking and is not a provider API.
 */
export function buildTryOnBrief({ product, variant, model, report }) {
  if (!product || !variant || !model || report?.status !== "ready") {
    throw new TypeError("Produto, variante, modelo e análise de caimento são necessários para montar o brief.");
  }
  const methodId = typeof report.method?.id === "string" ? report.method.id : null;
  const usesCurrentPolicy = methodId === FIT_ESTIMATE_POLICY.id;
  const hasNumber = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
  const color = /^#[\da-f]{6}$/i.test(String(variant.colorHex ?? "")) ? variant.colorHex : "#c7b7a4";
  const dimensions = report.rows.map((row) => {
    const stretchToleranceCm = hasNumber(row.stretchToleranceCm)
      ? Number(row.stretchToleranceCm)
      : usesCurrentPolicy ? estimateStretchToleranceCm(row.bodyCm, report.stretchPercent) : null;
    const smallThresholdCm = hasNumber(row.smallThresholdCm)
      ? Number(row.smallThresholdCm)
      : usesCurrentPolicy ? Math.round(-(FIT_ESTIMATE_POLICY.baseSmallToleranceCm + (stretchToleranceCm ?? 0)) * 10) / 10 : null;
    const largeThresholdCm = hasNumber(row.largeThresholdCm)
      ? Number(row.largeThresholdCm)
      : usesCurrentPolicy ? FIT_ESTIMATE_POLICY.largeDeviationToleranceCm : null;
    return {
      label: safeText(row.label),
      bodyCm: row.bodyCm,
      garmentCm: row.garmentCm,
      intendedEaseCm: row.targetEaseCm,
      actualEaseCm: row.easeCm,
      stretchToleranceCm,
      smallThresholdCm,
      largeThresholdCm,
      verdict: row.verdict,
    };
  });

  return Object.freeze({
    source: "local-preview",
    product: Object.freeze({
      id: product.id,
      name: safeText(product.name),
      category: safeText(product.category),
      fabric: safeText(product.fitProfile?.fabric),
      cut: safeText(report.cut),
      stretchPercent: report.stretchPercent,
    }),
    variant: Object.freeze({
      id: variant.id,
      sku: safeText(variant.sku),
      size: safeText(variant.size),
      color: safeText(variant.color),
      colorHex: color,
    }),
    referenceModel: Object.freeze({
      id: model.id,
      name: safeText(model.name),
      heightCm: model.heightCm,
      sizeReference: safeText(model.sizeReference),
      fitPreference: safeText(model.fitPreference),
    }),
    fit: Object.freeze({
      method: Object.freeze(report.method ? { ...report.method } : { id: "ordax.moda-fit-estimate/unversioned" }),
      verdict: report.verdict,
      headline: report.title,
      dimensions: Object.freeze(dimensions.map((item) => Object.freeze(item))),
      visualDirection: VERDICT_COPY[report.verdict] ?? VERDICT_COPY.mixed,
    }),
    instructions: Object.freeze([
      "Usar as fotos do produto como referência de tecido, cor, construção, costuras e acabamentos.",
      "Manter a variante, a cor e a modelagem " + safeText(report.cut).toLowerCase() + " cadastradas no catálogo.",
      "Representar o resultado do caimento de acordo com as medidas listadas, sem corrigir visualmente as diferenças.",
      usesCurrentPolicy
        ? "Usar a margem extra de elasticidade e os limites por região registrados; essa regra é heurística e não substitui ensaio físico do tecido."
        : "Preservar o veredito e os valores desta sessão; não atribuir a ela limites de uma regra atual sem versão correspondente.",
      "A composição textual do tecido é contexto para revisão; não inferir propriedades que não foram cadastradas numericamente.",
      "Registrar a preferência de caimento do perfil (" + safeText(model.fitPreference) + ") como contexto; ela não altera o resultado numérico desta análise.",
    ]),
    delivery: Object.freeze({
      state: "provider-unavailable",
      message: "Brief local para revisão. Nenhuma foto ou medida foi enviada a um serviço de IA.",
    }),
  });
}
