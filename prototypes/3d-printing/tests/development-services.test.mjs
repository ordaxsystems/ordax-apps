import assert from "node:assert/strict";
import test from "node:test";
import { createDevelopmentServices } from "../shared/development-services.mjs";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve: value => resolve(value) };
}

test("host de desenvolvimento transmite a fase real do Orca enquanto espera o G-code", async () => {
  const originalFetch = globalThis.fetch;
  const sliceResponse = deferred();
  const progress = [];
  globalThis.fetch = async input => {
    if (input === "/api/slicer/status") {
      return new Response(JSON.stringify({
        schema: "ordax.slicer-engine-status/2",
        available: true,
        engine: "OrcaSlicer",
        version: "2.3.1",
        reason: "",
        busy: true,
        progress: { percent: 48, stage: "Gerando perímetros" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (input === "/api/slicer/slice") return sliceResponse.promise;
    throw new Error(`Rota inesperada no teste: ${String(input)}`);
  };

  try {
    const services = createDevelopmentServices("ordax-3d");
    const slicing = services.slicer.slice({
      filename: "modelo.stl",
      preparedModel: { file: new Blob(["mesh"]), triangleCount: 1 },
      settings: { quality: "standard" },
      profileSelectionSchema: "ordax.slicer-profile-selection/1",
      profileIds: { machine: "machine", process: "process", filament: "filament" },
      objects: [],
      processes: [],
    }, { onProgress: event => progress.push(event) });

    await new Promise(resolve => setTimeout(resolve, 1_100));
    assert.ok(progress.some(event => event.stage === "Gerando perímetros" && event.percent === 48));

    const metadata = {
      schema: "ordax.slicer-result/1",
      engine: "OrcaSlicer",
      engineVersion: "2.3.1",
      filename: "modelo.gcode",
    };
    sliceResponse.resolve(new Response("G1 X0 Y0\n", {
      status: 200,
      headers: {
        "Content-Type": "application/gcode",
        "X-Ordax-Slicer-Metadata": Buffer.from(JSON.stringify(metadata)).toString("base64url"),
      },
    }));

    const result = await slicing;
    assert.match(await result.gcode.text(), /^G1 X0 Y0/);
    assert.ok(progress.some(event => event.stage === "G-code recebido do motor"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("host unificado migra a fila anterior para a coleção técnica compartilhada e deixa Inventory intacto", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  globalThis.fetch = async () => new Response(JSON.stringify({
    snapshot: { schema: "ordax.intelligence/1", state: "degraded", inferenceAvailable: false, engineId: null, modelId: null, authority: "none", toolExecution: false },
    setupHint: "",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const legacyQueueKey = "ordax.3d.dev.development-owner.development-space.operacoes-impressao.fila-impressao";
  const legacyMaterialsKey = "ordax.3d.dev.development-owner.development-space.materiais-custos.materiais";
  const legacyEstimatesKey = "ordax.3d.dev.development-owner.development-space.materiais-custos.custos-impressao";
  const oldQueue = [{ id: "old-job", name: "Peça existente", model: "peca.stl", printer: "Impressora local", material: "PLA", time: "1h 30m", grams: 18, status: "queued" }];
  const oldEstimates = [{ id: "estimate-1", name: "Cálculo anterior", order: 42, material: 12, spoolId: "spool-1", stockRemaining: 500, stockRequired: 18 }];
  values.set(legacyQueueKey, JSON.stringify(oldQueue));
  values.set(legacyMaterialsKey, JSON.stringify([{ id: "spool-1", remaining: 500 }]));
  values.set(legacyEstimatesKey, JSON.stringify(oldEstimates));
  try {
    const services = createDevelopmentServices("ordax-3d");
    const migratedQueue = [{ ...oldQueue[0], origin: "legacy-local" }];
    assert.deepEqual(services.appData.read("technical-print-jobs", null), migratedQueue);
    assert.equal(values.get("ordax.3d.dev.development-owner.development-space.ordax-3d.technical-print-jobs"), JSON.stringify(migratedQueue));
    assert.equal(values.get(legacyQueueKey), JSON.stringify(oldQueue), "a migração mantém os dados de origem intactos");
    assert.deepEqual(services.appData.read("manufacturing-estimates", []), [{ id: "estimate-1", name: "Cálculo anterior", order: 42, material: 12 }]);
    assert.equal(values.get(legacyEstimatesKey), JSON.stringify(oldEstimates), "a migração não apaga o histórico de origem");
    assert.equal(services.appData.read("materiais", null), null, "a preview do app não migra nem lê a coleção de estoque");
    assert.equal(values.get(legacyMaterialsKey), JSON.stringify([{ id: "spool-1", remaining: 500 }]));
    assert.throws(() => createDevelopmentServices("materiais-custos"), /Unknown 3D product app/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});
