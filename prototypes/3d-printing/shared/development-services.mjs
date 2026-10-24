const appIds = new Set(["biblioteca-impressao", "preparacao-impressao", "operacoes-impressao", "materiais-custos", "qualidade-manutencao"]);

const INTELLIGENCE_SCHEMA = "ordax.intelligence/1";
const INTELLIGENCE_RESPONSE_SCHEMA = "ordax.intelligence-response/1";

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
  if (appId === "preparacao-impressao") services.intelligence = createDevelopmentIntelligence();
  return Object.freeze(services);
}
