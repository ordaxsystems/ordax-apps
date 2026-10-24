import { mountProductHost } from "/product-host.mjs";
import { mountFeature as mountPrinters } from "/features/central-impressoras/feature.mjs";
import { mountFeature as mountQueue } from "/features/fila-impressao/feature.mjs";

export function mountApp(services) {
  return mountProductHost({ appId: "operacoes-impressao", title: "Operações de Impressão", subtitle: "DISPOSITIVOS E TRABALHOS", mark: "OPS", services, areas: [
  { id: "printers", label: "Impressoras", pageTitle: "Central de impressoras", description: "Cadastre dispositivos e acompanhe o estado registrado na oficina.", icon: "printer", featureId: "central-impressoras", mount: mountPrinters },
  { id: "queue", label: "Fila de trabalhos", pageTitle: "Fila de impressão", description: "Organize a sequência de trabalhos e suas estimativas.", icon: "layers", featureId: "fila-impressao", mount: mountQueue },
  ] });
}
