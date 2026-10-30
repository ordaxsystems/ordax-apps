import assert from "node:assert/strict";
import test from "node:test";
import {
  availableBedTypes,
  bedTemperaturesByType,
  isSupportedBedType,
  normalizeBedType,
  supportedBedTypes,
  validateBedTypeSelection,
} from "../shared/bed-types.mjs";

const material = {
  cool_plate_temp: ["45"],
  cool_plate_temp_initial_layer: [50],
  eng_plate_temp: 55,
  eng_plate_temp_initial_layer: 60,
  hot_plate_temp: 0,
  hot_plate_temp_initial_layer: 0,
  textured_plate_temp: 65,
  textured_plate_temp_initial_layer: 70,
  textured_cool_plate_temp: 38,
  textured_cool_plate_temp_initial_layer: null,
  supertack_plate_temp: 40,
  supertack_plate_temp_initial_layer: 45,
};

test("normaliza nomes de perfil e enum do Orca para os seis tipos canônicos", () => {
  assert.equal(supportedBedTypes.length, 6);
  assert.equal(normalizeBedType("Smooth Cool Plate"), "Cool Plate");
  assert.equal(normalizeBedType("Textured PEI Plate"), "Textured PEI Plate");
  assert.equal(normalizeBedType(6), "Supertack Plate");
  assert.equal(normalizeBedType("5"), "Textured Cool Plate");
  assert.equal(normalizeBedType(0), null);
  assert.equal(normalizeBedType("unknown plate"), null);
  assert.equal(isSupportedBedType("Cool Plate"), true);
  assert.equal(isSupportedBedType("cool plate"), false);
});

test("só expõe temperaturas quando o perfil declara as duas camadas e valores plausíveis", () => {
  assert.deepEqual(bedTemperaturesByType(material), {
    "Cool Plate": { otherLayerC: 45, initialLayerC: 50 },
    "Engineering Plate": { otherLayerC: 55, initialLayerC: 60 },
    "Textured PEI Plate": { otherLayerC: 65, initialLayerC: 70 },
    "Supertack Plate": { otherLayerC: 40, initialLayerC: 45 },
  });
  assert.deepEqual(bedTemperaturesByType({ cool_plate_temp: 45, cool_plate_temp_initial_layer: 151 }), {});
});

test("intersecta suporte da máquina, lista de placas não suportadas e dados do filamento", () => {
  const machine = { supportMultiBedTypes: true, unsupportedBedTypes: ["Engineering Plate", 6] };
  assert.deepEqual(availableBedTypes(machine, material).map(item => item.value), ["Cool Plate", "Textured PEI Plate"]);
  assert.deepEqual(availableBedTypes({ supportMultiBedTypes: false }, material), []);
  assert.equal(validateBedTypeSelection("Cool Plate", machine, material).valid, true);
  assert.match(validateBedTypeSelection("Engineering Plate", machine, material).reason, /não permite/);
  assert.match(validateBedTypeSelection("Textured Cool Plate", machine, material).reason, /não define temperaturas válidas/);
  assert.match(validateBedTypeSelection("Cool Plate", { supportMultiBedTypes: false }, material).reason, /não declara suporte/);
  assert.equal(validateBedTypeSelection(null, { supportMultiBedTypes: false }, {}).valid, true);
});
