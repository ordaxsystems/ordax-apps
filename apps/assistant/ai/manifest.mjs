import { validateAppIntelligenceManifest } from "../src/sdk/contracts/app-intelligence-manifest.mjs";
import appManifest from "../app.json" with { type: "json" };

export const assistantIntelligenceManifest = validateAppIntelligenceManifest({
  schema: "ordax.app-intelligence-manifest/1",
  appId: "assistant",
  appVersion: appManifest.version,
  authority: "none",
  execution: "declarative-only",
  instructions: [
    "O Assistente é uma superfície de conversa para OrdaX Intelligence e não uma autoridade separada de execução."
  ],
  intents: [
    {
      id: "assistant.ask",
      description: "Conversar com OrdaX Intelligence sobre uma pergunta ou tarefa.",
      effect: "none",
      confirmation: "none",
      parameters: [
        { name: "request", type: "string", required: true, description: "Pergunta ou pedido feito pelo usuário." }
      ],
      examples: ["Abra o Assistente.", "Pergunte ao Assistente sobre este projeto."]
    }
  ]
}, { appId: appManifest.id, appVersion: appManifest.version });
