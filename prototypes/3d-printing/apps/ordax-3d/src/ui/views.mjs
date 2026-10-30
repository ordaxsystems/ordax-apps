import { mountFeature as mountLibrary } from "/features/biblioteca-3d/feature.mjs";
import { mountFeature as mountInspection } from "/features/inspecao-malha/feature.mjs";
import { mountFeature as mountSlicing } from "/features/fatiamento-3d/feature.mjs";
import { mountFeature as mountGcode } from "/features/visualizador-gcode/feature.mjs";
import { mountFeature as mountPreflight } from "/features/verificacao-impressao/feature.mjs";
import { mountFeature as mountCalibration } from "/features/calibracao/feature.mjs";
import { mountFeature as mountPrinters } from "/features/central-impressoras/feature.mjs";
import { mountFeature as mountQueue } from "/features/fila-impressao/feature.mjs";
import { mountFeature as mountMaterials } from "/features/materiais/feature.mjs";
import { mountFeature as mountCosts } from "/features/custos-impressao/feature.mjs";
import { mountFeature as mountQuality } from "/features/qualidade-manutencao/feature.mjs";

export const areas = Object.freeze([
  { id: "library", group: "Modelos", label: "Biblioteca", pageTitle: "Biblioteca de modelos", description: "Organize modelos no protótipo local; arquivos persistentes dependem do owner Files.", icon: "grid", featureId: "biblioteca-3d", mount: mountLibrary },
  { id: "inspection", group: "Modelos", label: "Inspeção de malha", pageTitle: "Inspeção de malha", description: "Analise geometria e dimensões antes da preparação.", icon: "cube", featureId: "inspecao-malha", mount: mountInspection },
  { id: "slicing", group: "Preparação", label: "Fatiamento 3D", pageTitle: "Fatiamento 3D", description: "Prepare o modelo, configure o trabalho e inspecione o resultado do motor.", icon: "layers", featureId: "fatiamento-3d", mount: mountSlicing },
  { id: "gcode", group: "Preparação", label: "Visualizar G-code", pageTitle: "Visualizar G-code", description: "Leia camadas e trajetos em modo somente leitura.", icon: "layers", featureId: "visualizador-gcode", mount: mountGcode },
  { id: "preflight", group: "Preparação", label: "Verificação pré-impressão", pageTitle: "Verificação pré-impressão", description: "Confira arquivo, parâmetros e compatibilidade do trabalho.", icon: "check", featureId: "verificacao-impressao", mount: mountPreflight },
  { id: "calibration", group: "Preparação", label: "Calibração", pageTitle: "Caderno de calibração", description: "Registre resultados de calibração por impressora e material.", icon: "tune", featureId: "calibracao", mount: mountCalibration },
  { id: "printers", group: "Produção", label: "Impressoras", pageTitle: "Central de impressoras", description: "Organize cadastros locais; conexão e controle físico ainda dependem de contrato autorizado.", icon: "printer", featureId: "central-impressoras", mount: mountPrinters },
  { id: "queue", group: "Produção", label: "Fila de impressão", pageTitle: "Fila de trabalhos técnicos", description: "Organize jobs técnicos e estimativas de fabricação do OrdaX 3D.", icon: "layers", featureId: "fila-impressao", mount: mountQueue },
  { id: "materials", group: "Planejamento", label: "Estimativa de materiais", pageTitle: "Estimativa de materiais", description: "Some o consumo previsto dos jobs técnicos; saldo e movimentações pertencem ao Inventory.", icon: "box", featureId: "materiais", mount: mountMaterials },
  { id: "costs", group: "Planejamento", label: "Custos e orçamento", pageTitle: "Custos e orçamento técnico", description: "Use peso e tempo do fatiador ou monte um orçamento avulso com material, custos da impressora e preço de referência.", icon: "grid", featureId: "custos-impressao", mount: mountCosts },
  { id: "quality", group: "Planejamento", label: "Qualidade e manutenção", pageTitle: "Qualidade e manutenção", description: "Documente resultados e revisões preventivas localmente.", icon: "check", featureId: "qualidade-manutencao", mount: mountQuality },
]);
