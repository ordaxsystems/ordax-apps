import assert from "node:assert/strict";
import test from "node:test";
import { handleGroqRequest } from "../shared/groq-development-api.mjs";

test("pedido Groq protege a amostra e ancora cobertura em métricas determinísticas", async () => {
  const previousKey = process.env.GROQ_API_KEY;
  const previousModel = process.env.GROQ_MODEL;
  const previousFetch = globalThis.fetch;
  let payload;
  process.env.GROQ_API_KEY = "test-only-key";
  process.env.GROQ_MODEL = "openai/gpt-oss-20b";
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "resposta de teste" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const response = await handleGroqRequest({
      intent: "diagnose",
      prompt: "Revise as dimensões desta amostra.",
      maxTokens: 128,
      context: [{
        id: "slicer-project-metadata",
        scope: "document",
        text: JSON.stringify({ model: {
          demonstrationOnly: true,
          dimensionsMm: [58, 109, 55],
          objectEnvelopeOverlaps: {
            method: "transformed-axis-aligned-3d-bounds-pairs/1",
            overlapPairCount: 1,
            pairs: [{ firstObject: 1, secondObject: 2, overlapMm: [2, 7, 6] }],
          },
          printableSpaceFit: { xyBoundingRectangleCoverage: {
            method: "axis-aligned-xy-bounding-rectangles/1",
            boundingRectangleAreaMm2: 6322,
            bedRectangleAreaMm2: 65536,
            coveragePercent: 9.65,
          } },
        } }),
        provenance: "ordax-apps:3d-printing:fatiamento-3d:local-metadata",
      }],
    });

    assert.equal(response.engineId, "groq");
    assert.match(payload.messages[0].content, /amostra visual/);
    assert.match(payload.messages[0].content, /Nunca peça o envio da malha ou do G-code/);
    assert.match(payload.messages[0].content, /não declare colisão entre malhas/);
    assert.match(payload.messages[0].content, /Não recalcule porcentagens/);
    assert.match(payload.messages[1].content, /coveragePercent\\?":9\.65/);
    assert.match(payload.messages[1].content, /objectEnvelopeOverlaps/);
    assert.match(payload.messages[1].content, /overlapPairCount":1/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = previousModel;
  }
});
