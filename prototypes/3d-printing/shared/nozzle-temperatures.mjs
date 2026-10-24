export const nozzleTemperatureBoundsC = Object.freeze({ min: 150, max: 350 });

export function nozzleTemperatureLimits(machineProfile, filamentProfile) {
  const range = filamentProfile?.nozzleTemperatureRangeC;
  if (!Array.isArray(range) || range.length < 2 || !range.slice(0, 2).every(Number.isInteger) || range[0] < 0 || range[1] < range[0]) return null;
  const machineMaximum = machineProfile?.nozzleMaxTemperatureC;
  if (!Number.isInteger(machineMaximum) || machineMaximum < range[0]) return null;
  const max = Math.min(range[1], machineMaximum);
  return max >= range[0] ? Object.freeze({ min: range[0], max }) : null;
}

export function isNozzleTemperatureInRange(value, limits) {
  return Number.isInteger(value) && value >= nozzleTemperatureBoundsC.min && value <= nozzleTemperatureBoundsC.max
    && limits !== null && limits !== undefined && value >= limits.min && value <= limits.max;
}
