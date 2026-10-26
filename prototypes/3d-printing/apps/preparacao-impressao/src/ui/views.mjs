import { mountFeature as mountGcode } from "/features/visualizador-gcode/feature.mjs";
import { mountFeature as mountPreflight } from "/features/verificacao-impressao/feature.mjs";
import { mountFeature as mountCalibration } from "/features/calibracao/feature.mjs";
import { mountFeature as mountSlicing } from "/features/fatiamento-3d/feature.mjs";

export const areas = Object.freeze([
  { id: "slicing", label: "Fatiamento 3D", pageTitle: "Fatiamento 3D", description: "Prepare o modelo, configure o trabalho e inspecione o resultado do motor de fatiamento.", icon: "layers", featureId: "fatiamento-3d", mount: mountSlicing },
  { id: "gcode", label: "Visualizar G-code", pageTitle: "Visualizar G-code", description: "Leia camadas e trajetos em modo somente leitura.", icon: "layers", featureId: "visualizador-gcode", mount: mountGcode },
  { id: "preflight", label: "Verificação pré-impressão", pageTitle: "Verificação pré-impressão", description: "Confira arquivo, parâmetros e compatibilidade do trabalho.", icon: "check", featureId: "verificacao-impressao", mount: mountPreflight },
  { id: "calibration", label: "Calibração", pageTitle: "Caderno de calibração", description: "Registre resultados de calibração por impressora e material.", icon: "tune", featureId: "calibracao", mount: mountCalibration },
]);
