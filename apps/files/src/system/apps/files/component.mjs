import { defineComponentManifest } from "../../contracts/component-manifest.mjs";

// A identidade do componente Arquivos pertence ao próprio aplicativo.
// O catálogo da plataforma a consome sem manter uma segunda declaração.
export const filesComponent = defineComponentManifest({
  id: "files",
  title: "Arquivos",
  kind: "app",
  version: "0.1.0",
  releaseMode: "component-slot",
  criticality: "optional",
  failureDomain: "app",
  restartScope: "component",
  healthMode: "runtime",
  owner: "ordaxsystems/ordax-apps",
  dependencies: [],
});

