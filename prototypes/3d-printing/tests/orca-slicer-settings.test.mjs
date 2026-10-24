import assert from "node:assert/strict";
import test from "node:test";
import { buildOrcaSettingArguments } from "../shared/orca-slicer-development.mjs";

const settings = Object.freeze({
  quality: "standard",
  layerHeight: 0.2,
  walls: 3,
  infill: 15,
  supports: true,
  supportType: "normal(auto)",
  supportThresholdAngle: 45,
  supportOnBuildPlateOnly: false,
  fanMinSpeedPercent: 35,
  fanMaxSpeedPercent: 80,
});

test("mapeia as configurações do projeto para argumentos explícitos do OrcaSlicer", () => {
  assert.deepEqual(buildOrcaSettingArguments(settings), [
    "--layer-height", "0.2",
    "--wall-loops", "3",
    "--sparse-infill-density", "15%",
    "--enable-support=1",
    "--support-type", "normal(auto)",
    "--support-threshold-angle", "45",
    "--support-on-build-plate-only=0",
    "--fan-min-speed", "35",
    "--fan-max-speed", "80",
  ]);
});

test("não cria argumentos de resfriamento quando a faixa mínimo/máximo é inválida", () => {
  assert.throws(
    () => buildOrcaSettingArguments({ ...settings, fanMinSpeedPercent: 81, fanMaxSpeedPercent: 80 }),
    /configurações solicitadas estão fora dos limites/,
  );
});

test("rejeita suporte manual e ângulo não suportado pelo contrato", () => {
  assert.throws(() => buildOrcaSettingArguments({ ...settings, supportType: "normal(manual)" }), /configurações solicitadas estão fora dos limites/);
  assert.throws(() => buildOrcaSettingArguments({ ...settings, supportThresholdAngle: 91 }), /configurações solicitadas estão fora dos limites/);
});
