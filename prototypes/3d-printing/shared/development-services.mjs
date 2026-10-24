const appIds = new Set(["biblioteca-impressao", "preparacao-impressao", "operacoes-impressao", "materiais-custos", "qualidade-manutencao"]);

const INTELLIGENCE_SCHEMA = "ordax.intelligence/1";
const INTELLIGENCE_RESPONSE_SCHEMA = "ordax.intelligence-response/1";
const SLICER_STATUS_SCHEMA = "ordax.slicer-engine-status/2";
const SLICER_RESULT_SCHEMA = "ordax.slicer-result/1";

function createDevelopmentIntelligence() {
  let snapshot = Object.freeze({
    schema: INTELLIGENCE_SCHEMA,
    state: "degraded",
    inferenceAvailable: false,
    engineId: null,
    modelId: null,
    authority: "none",
    toolExecution: false,
  });
  let setupHint = "Conectando ao adaptador Groq local…";
  let inFlight = 0;
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(); };
  const visibleSnapshot = () => inFlight > 0 && snapshot.state === "ready"
    ? Object.freeze({ ...snapshot, state: "busy", inferenceAvailable: false })
    : snapshot;
  const port = {
    schema: INTELLIGENCE_SCHEMA,
    getSnapshot: visibleSnapshot,
    getSetupHint: () => setupHint,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Intelligence listener must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async respond(request, { signal } = {}) {
      if (signal?.aborted) throw new DOMException("Solicitação cancelada.", "AbortError");
      if (request?.intent !== "diagnose" || typeof request.prompt !== "string" || !Array.isArray(request.context) || !Number.isInteger(request.maxTokens)) {
        throw new TypeError("O pedido não corresponde ao contrato consultivo OrdaX Intelligence.");
      }
      inFlight++;
      emit();
      try {
        const result = await fetch("/api/intelligence", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(request),
          signal,
          cache: "no-store",
          credentials: "same-origin",
        });
        let body;
        try { body = await result.json(); } catch { throw new Error("O host local retornou uma resposta inválida."); }
        if (!result.ok) throw new Error(typeof body?.error === "string" ? body.error.slice(0, 500) : `O host local respondeu com HTTP ${result.status}.`);
        if (!body || body.schema !== INTELLIGENCE_RESPONSE_SCHEMA || body.authority !== "none" || typeof body.text !== "string" || typeof body.engineId !== "string" || typeof body.modelId !== "string") {
          throw new Error("A resposta não corresponde ao contrato consultivo OrdaX Intelligence.");
        }
        return body;
      } finally {
        inFlight = Math.max(0, inFlight - 1);
        emit();
      }
    },
  };
  fetch("/api/intelligence/status", { headers: { Accept: "application/json" }, cache: "no-store", credentials: "same-origin" })
    .then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (!result?.snapshot || result.snapshot.schema !== INTELLIGENCE_SCHEMA || result.snapshot.authority !== "none" || result.snapshot.toolExecution !== false) {
        throw new Error("Contrato de status incompatível");
      }
      snapshot = Object.freeze(result.snapshot);
      setupHint = typeof result.setupHint === "string" ? result.setupHint.slice(0, 500) : "";
      emit();
    })
    .catch(() => {
      snapshot = Object.freeze({ schema: INTELLIGENCE_SCHEMA, state: "error", inferenceAvailable: false, engineId: null, modelId: null, authority: "none", toolExecution: false });
      setupHint = "API de desenvolvimento indisponível. Confirme que o host Node está aberto na mesma origem.";
      emit();
    });
  return Object.freeze(port);
}

function decodeSlicerMetadata(value) {
  if (typeof value !== "string" || value.length > 16 * 1024) throw new Error("O motor retornou metadados inválidos.");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!metadata || metadata.schema !== SLICER_RESULT_SCHEMA || metadata.engine !== "OrcaSlicer" || typeof metadata.engineVersion !== "string") {
    throw new Error("A resposta não corresponde ao contrato de resultado do motor.");
  }
  return metadata;
}

function createDevelopmentSlicer() {
  return Object.freeze({
    async getStatus() {
      const response = await fetch("/api/slicer/status", { headers: { Accept: "application/json" }, cache: "no-store", credentials: "same-origin" });
      let body;
      try { body = await response.json(); } catch { throw new Error("O host retornou um status do motor inválido."); }
      if (!response.ok || body?.schema !== SLICER_STATUS_SCHEMA || typeof body.available !== "boolean" || typeof body.reason !== "string") {
        throw new Error("O host não forneceu um status OrcaSlicer compatível.");
      }
      return body;
    },
    async slice(request, { signal } = {}) {
      if (signal?.aborted) throw new DOMException("Fatiamento cancelado.", "AbortError");
      const meshFile = request?.preparedModel?.file;
      if (!(meshFile instanceof Blob) || meshFile.size <= 0 || meshFile.size > 16 * 1024 * 1024) {
        throw new Error("O adaptador precisa receber a malha STL transformada localmente.");
      }
      const manifest = {
        schema: "ordax.orca-slice-request/4",
        filename: String(request.filename || "ordax-print.stl").slice(0, 180),
        settings: request.settings,
        profileSelectionSchema: request.profileSelectionSchema,
        profileIds: request.profileIds,
        objects: request.objects,
        processes: request.processes,
      };
      const form = new FormData();
      form.set("manifest", JSON.stringify(manifest));
      form.set("mesh", meshFile, "ordax-model.stl");
      const response = await fetch("/api/slicer/slice", {
        method: "POST", body: form, signal, cache: "no-store", credentials: "same-origin",
      });
      if (!response.ok) {
        let body;
        try { body = await response.json(); } catch { body = null; }
        throw new Error(typeof body?.error === "string" ? body.error.slice(0, 500) : `O host respondeu com HTTP ${response.status} durante o fatiamento.`);
      }
      const metadata = decodeSlicerMetadata(response.headers.get("X-Ordax-Slicer-Metadata"));
      const gcode = await response.blob();
      if (!gcode.size || gcode.type !== "application/gcode") throw new Error("O host não devolveu um arquivo G-code válido.");
      return Object.freeze({ ...metadata, gcode });
    },
  });
}

export function createDevelopmentServices(appId) {
  if (!appIds.has(appId)) throw new TypeError("Unknown 3D product app for development services");
  const ownerId = "development-owner";
  const spaceId = "development-space";
  const storageKey = collection => `ordax.3d.dev.${encodeURIComponent(ownerId)}.${encodeURIComponent(spaceId)}.${encodeURIComponent(appId)}.${encodeURIComponent(collection)}`;
  const appData = {
    read(collection, fallback) {
      try {
        const current = localStorage.getItem(storageKey(collection));
        if (current !== null) return JSON.parse(current);
        const legacy = localStorage.getItem(`ordax.3d.${collection}`);
        if (legacy !== null) { localStorage.setItem(storageKey(collection), legacy); return JSON.parse(legacy); }
        return structuredClone(fallback);
      } catch { return structuredClone(fallback); }
    },
    write(collection, value) { localStorage.setItem(storageKey(collection), JSON.stringify(value)); },
  };
  const services = { appData };
  if (appId === "preparacao-impressao") {
    services.intelligence = createDevelopmentIntelligence();
    services.slicer = createDevelopmentSlicer();
  }
  return Object.freeze(services);
}
