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
    const services = createDevelopmentServices("preparacao-impressao");
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
