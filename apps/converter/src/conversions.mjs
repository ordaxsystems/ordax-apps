const GROUPS = Object.freeze({
  length: Object.freeze({ m:1, km:1000, cm:0.01, mm:0.001, in:0.0254, ft:0.3048, yd:0.9144, mi:1609.344 }),
  mass: Object.freeze({ kg:1, g:0.001, mg:0.000001, lb:0.45359237, oz:0.028349523125 }),
  volume: Object.freeze({ l:1, ml:0.001, cup:0.2365882365, tbsp:0.0147867648, tsp:0.00492892159 }),
});
const TEMP = new Set(["c","f","k"]);
export function unitGroups(){ return GROUPS; }
export function convert(value, from, to) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError("value must be finite");
  const a = String(from).toLowerCase(), b = String(to).toLowerCase();
  if (TEMP.has(a) || TEMP.has(b)) {
    if (!TEMP.has(a) || !TEMP.has(b)) throw new TypeError("temperature units cannot mix with other dimensions");
    const c = a === "c" ? number : a === "f" ? (number - 32) * 5 / 9 : number - 273.15;
    const out = b === "c" ? c : b === "f" ? c * 9 / 5 + 32 : c + 273.15;
    if (!Number.isFinite(out)) throw new RangeError("result is outside supported range");
    return out;
  }
  for (const group of Object.values(GROUPS)) {
    if (Object.hasOwn(group,a) && Object.hasOwn(group,b)) return number * group[a] / group[b];
  }
  throw new TypeError("units are incompatible or unsupported");
}
export function formatConversion(value){ return Number.parseFloat(value.toPrecision(12)).toString(); }
