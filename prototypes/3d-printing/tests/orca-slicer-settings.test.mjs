import assert from "node:assert/strict";
import test from "node:test";
import { buildOrcaSettingArguments } from "../shared/orca-slicer-development.mjs";
import { infillPatternOptions } from "../shared/infill-patterns.mjs";

const settings = Object.freeze({
  quality: "standard",
  layerHeight: 0.2,
  walls: 3,
  topShellLayers: 5,
  bottomShellLayers: 4,
  topShellThickness: 0.8,
  bottomShellThickness: 1.2,
  brimType: null,
  brimWidth: null,
  infill: 15,
  infillPattern: "gyroid",
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
    "--top-shell-layers=5",
    "--bottom-shell-layers=4",
    "--top-shell-thickness=0.8",
    "--bottom-shell-thickness=1.2",
    "--sparse-infill-density", "15%",
    "--sparse-infill-pattern=gyroid",
    "--enable-support=1",
    "--support-type", "normal(auto)",
    "--support-threshold-angle", "45",
    "--support-on-build-plate-only=0",
    "--fan-min-speed", "35",
    "--fan-max-speed", "80",
  ]);
});

test("mapeia tipo e largura de brim apenas quando há override explícito", () => {
  assert.deepEqual(buildOrcaSettingArguments({ ...settings, brimType: "outer_only", brimWidth: 5 }).slice(8, 10), [
    "--brim-type=outer_only", "--brim-width=5",
  ]);
  const inherited = buildOrcaSettingArguments(settings);
  assert.equal(inherited.some(argument => argument.startsWith("--brim-")), false);
  assert.throws(() => buildOrcaSettingArguments({ ...settings, brimType: "painted" }), /configurações solicitadas estão fora dos limites/);
  assert.throws(() => buildOrcaSettingArguments({ ...settings, brimWidth: 20.1 }), /configurações solicitadas estão fora dos limites/);
});

test("rejeita espessura de casca fora do intervalo suportado", () => {
  assert.throws(() => buildOrcaSettingArguments({ ...settings, topShellThickness: 10.1 }), /configurações solicitadas estão fora dos limites/);
  assert.throws(() => buildOrcaSettingArguments({ ...settings, bottomShellThickness: -0.1 }), /configurações solicitadas estão fora dos limites/);
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

test("rejeita padrões de preenchimento que não pertencem ao catálogo público", () => {
  assert.ok(infillPatternOptions.some(pattern => pattern.value === "gyroid"));
  assert.throws(() => buildOrcaSettingArguments({ ...settings, infillPattern: "infill-custom-command" }), /configurações solicitadas estão fora dos limites/);
});

