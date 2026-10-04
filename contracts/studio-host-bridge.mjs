export const STUDIO_HOST_BRIDGE_SCHEMA = "ordax-apps.studio-host-bridge/1";

const PORT_SCHEMAS = Object.freeze({
  studioRuntime: "ordax.studio-runtime/1",
  memory: "ordax.memory/1",
  intelligence: "ordax.intelligence/1",
  localization: "ordax.localization/1",
});

const EXACT_FIELDS = Object.freeze([
  "schema",
  "authority",
  "studioRuntime",
  "memory",
  "intelligence",
  "localization",
]);

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (
    actual.length !== allowed.length
    || actual.some((key, index) => key !== allowed[index])
  ) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

function assertPort(value, field) {
  const port = objectValue(value, `Studio host bridge ${field}`);
  if (port.schema !== PORT_SCHEMAS[field]) {
    throw new TypeError(`Studio host bridge ${field} schema is incompatible`);
  }
  return port;
}

export function assertStudioHostBridge(value) {
  const bridge = objectValue(value, "Studio host bridge");
  exactKeys(bridge, EXACT_FIELDS, "Studio host bridge");

  if (bridge.schema !== STUDIO_HOST_BRIDGE_SCHEMA) {
    throw new TypeError("Studio host bridge schema is incompatible");
  }
  if (bridge.authority !== "none") {
    throw new TypeError("Studio host bridge must not mint authority");
  }

  const studioRuntime = assertPort(bridge.studioRuntime, "studioRuntime");
  if ("execute" in studioRuntime || "deviceAgent" in studioRuntime || "call" in studioRuntime) {
    throw new TypeError("Studio runtime bridge must not expose raw or generic dispatch");
  }

  return Object.freeze({
    schema: STUDIO_HOST_BRIDGE_SCHEMA,
    authority: "none",
    studioRuntime,
    memory: assertPort(bridge.memory, "memory"),
    intelligence: assertPort(bridge.intelligence, "intelligence"),
    localization: assertPort(bridge.localization, "localization"),
  });
}

export function studioHostBridgePortSchemas() {
  return PORT_SCHEMAS;
}
