function requireLayerCount(layerCount) {
  if (!Number.isSafeInteger(layerCount) || layerCount < 1) {
    throw new RangeError("A contagem de camadas precisa ser um inteiro positivo.");
  }
}

export function layerSliderState(layerIndex, layerCount) {
  requireLayerCount(layerCount);
  if (!Number.isSafeInteger(layerIndex)) throw new RangeError("O índice da camada precisa ser inteiro.");

  const value = Math.min(Math.max(layerIndex, 0), layerCount - 1) + 1;
  return {
    min: 1,
    max: layerCount,
    value,
    valueText: "Camada " + value + " de " + layerCount,
  };
}

export function layerIndexFromSliderValue(value, layerCount) {
  requireLayerCount(layerCount);
  const sliderValue = Number(value);
  if (!Number.isFinite(sliderValue)) return 0;
  return Math.min(Math.max(Math.trunc(sliderValue) - 1, 0), layerCount - 1);
}