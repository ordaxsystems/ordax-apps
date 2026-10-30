const MEASURES = Object.freeze({
  chest: "Busto",
  waist: "Cintura",
  hip: "Quadril",
  shoulder: "Ombros",
  thigh: "Coxa",
});

const DEFAULT_EASE_CM = Object.freeze({
  shirt: Object.freeze({ chest: 8, waist: 10, hip: 8, shoulder: 1 }),
  dress: Object.freeze({ chest: 4, waist: 3, hip: 5 }),
  trousers: Object.freeze({ waist: 2, hip: 4, thigh: 4 }),
});
const STRETCH_TOLERANCE_FACTOR = 0.4;
const BASE_SMALL_TOLERANCE_CM = 2;
const LARGE_DEVIATION_TOLERANCE_CM = 8;

export const FIT_ESTIMATE_POLICY = Object.freeze({
  id: "ordax.moda-fit-estimate/1",
  stretchToleranceFactor: STRETCH_TOLERANCE_FACTOR,
  baseSmallToleranceCm: BASE_SMALL_TOLERANCE_CM,
  largeDeviationToleranceCm: LARGE_DEVIATION_TOLERANCE_CM,
});

function validCentimeters(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 20 && number <= 250 ? number : null;
}

function rounded(value) {
  return Math.round(value * 10) / 10;
}

function boundedStretchPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(50, Math.max(0, number)) : 0;
}

export function estimateStretchToleranceCm(bodyCm, stretchPercent) {
  const body = validCentimeters(bodyCm);
  if (body === null) return 0;
  return rounded(body * (boundedStretchPercent(stretchPercent) / 100) * STRETCH_TOLERANCE_FACTOR);
}

/**
 * Estimates garment ease from a selected reference profile and the product's
 * size chart. It deliberately does not infer measurements from photos or claim
 * a statistically calibrated probability.
 */
export function evaluateGarmentFit({ product, variant, bodyMeasurements }) {
  const profile = product?.fitProfile;
  if (!product || !variant) {
    return { status: "unavailable", message: "Selecione uma peça e uma variante para analisar o caimento." };
  }
  if (!profile) {
    return { status: "unavailable", message: "Esta peça ainda não tem uma tabela de medidas cadastrada." };
  }

  const dimensions = fitDimensionsForKind(product.kind).map(({ key }) => key);
  if (!dimensions.length) {
    return { status: "unavailable", message: "A análise está disponível para blusas, camisas, calças e vestidos." };
  }

  const garment = profile.measurementsBySize?.[variant.size];
  if (!garment || typeof garment !== "object") {
    return { status: "incomplete", message: "Complete a tabela de medidas da peça para o tamanho " + variant.size + "." };
  }
  const missingGarment = dimensions.filter((key) => validCentimeters(garment[key]) === null);
  if (missingGarment.length) {
    return {
      status: "incomplete",
      message: "Complete as medidas da peça: " + missingGarment.map((key) => MEASURES[key]).join(", ") + ".",
    };
  }

  const intendedEase = profile.easeByMeasurementCm ?? DEFAULT_EASE_CM[product.kind] ?? {};
  const invalidEase = dimensions.filter((key) => {
    const value = Number(intendedEase[key]);
    return !Number.isFinite(value) || value < -15 || value > 40;
  });
  if (invalidEase.length) {
    return {
      status: "incomplete",
      message: "Complete a folga planejada para: " + invalidEase.map((key) => MEASURES[key]).join(", ") + ".",
    };
  }

  const missing = dimensions.filter((key) => validCentimeters(bodyMeasurements?.[key]) === null);
  if (missing.length) {
    return {
      status: "incomplete",
      message: "Informe as medidas: " + missing.map((key) => MEASURES[key]).join(", ") + ".",
    };
  }

  const stretchPercent = boundedStretchPercent(profile.stretchPercent);
  const rows = dimensions.map((key) => {
    const bodyCm = validCentimeters(bodyMeasurements[key]);
    const garmentCm = validCentimeters(garment[key]);
    if (garmentCm === null) return null;
    const targetEaseCm = Number(intendedEase[key] ?? 0);
    const easeCm = garmentCm - bodyCm;
    const differenceCm = easeCm - targetEaseCm;
    const stretchAllowanceCm = bodyCm * (stretchPercent / 100) * STRETCH_TOLERANCE_FACTOR;
    const smallThresholdCm = -(BASE_SMALL_TOLERANCE_CM + stretchAllowanceCm);
    const largeThresholdCm = LARGE_DEVIATION_TOLERANCE_CM;
    const verdict = differenceCm < smallThresholdCm
      ? "small"
      : differenceCm > largeThresholdCm ? "large" : "balanced";
    return {
      key,
      label: MEASURES[key],
      bodyCm: rounded(bodyCm),
      garmentCm: rounded(garmentCm),
      easeCm: rounded(easeCm),
      targetEaseCm: rounded(targetEaseCm),
      differenceCm: rounded(differenceCm),
      stretchToleranceCm: rounded(stretchAllowanceCm),
      smallThresholdCm: rounded(smallThresholdCm),
      largeThresholdCm,
      verdict,
    };
  }).filter(Boolean);

  if (rows.length !== dimensions.length) {
    return { status: "unavailable", message: "Complete as medidas da peça para este tamanho no catálogo." };
  }

  const tightCount = rows.filter((row) => row.verdict === "small").length;
  const roomyCount = rows.filter((row) => row.verdict === "large").length;
  let verdict = "balanced";
  if (tightCount && roomyCount) verdict = "mixed";
  else if (tightCount) verdict = "small";
  else if (roomyCount) verdict = "large";

  const title = {
    small: "Pode ficar pequena",
    large: "Pode ficar grande",
    balanced: "Caimento próximo do ideal",
    mixed: "Caimento irregular entre medidas",
  }[verdict];

  return {
    status: "ready",
    method: FIT_ESTIMATE_POLICY,
    verdict,
    title,
    fabric: profile.fabric || "Tecido não informado",
    cut: profile.cut || "Regular",
    stretchPercent,
    size: variant.size,
    color: variant.color,
    rows,
    note: "Estimativa determinística pelas medidas da peça, folga planejada e elasticidade estimada informada pela equipe. A composição em texto não é interpretada; a margem de elasticidade é heurística, não ensaio físico nem probabilidade calibrada.",
  };
}

export function fitDimensionsForKind(kind) {
  return Object.freeze(Object.keys(DEFAULT_EASE_CM[kind] ?? {}).map((key) => ({ key, label: MEASURES[key] })));
}

export function defaultEaseForKind(kind) {
  return { ...(DEFAULT_EASE_CM[kind] ?? {}) };
}
