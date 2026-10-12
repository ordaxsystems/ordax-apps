// Narrow validation of public OrdaX App SDK 1.17 contracts.
// No platform transport, private service or authority is packaged here.
export const SURFACE_RENDER_LIFECYCLE_SCHEMA = "ordax.surface-render-lifecycle/5";
export const LOCALIZATION_SCHEMA = "ordax.localization/2";

export function assertSurfaceRenderLifecycle(value) {
  if (!value || typeof value !== "object" || value.schema !== SURFACE_RENDER_LIFECYCLE_SCHEMA) {
    throw new TypeError("Network requires a public Surface render lifecycle");
  }
  const locale = value.localization;
  if (!locale || locale.schema !== LOCALIZATION_SCHEMA) {
    throw new TypeError("Network requires a public localization port");
  }
  for (const method of ["getLocale", "translate", "subscribe"]) {
    if (typeof locale[method] !== "function") throw new TypeError("Network localization missing " + method);
  }
  for (const method of ["subscribeRender", "getAppTarget", "setAppTarget"]) {
    if (typeof value[method] !== "function") throw new TypeError("Network Surface lifecycle missing " + method);
  }
  if (typeof locale.getLocale() !== "string" || !locale.getLocale()) {
    throw new TypeError("Network locale must be nonempty");
  }
  return value;
}
