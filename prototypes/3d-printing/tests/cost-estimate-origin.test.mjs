import assert from "node:assert/strict";
import test from "node:test";
import { updateEstimateOriginForEdit } from "../features/custos-impressao/estimate-origin.mjs";

const fromSlicer = Object.freeze({
  source: "slicer",
  scope: "plate",
  engine: "OrcaSlicer",
  engineVersion: "2.3.1",
});

test("editar nome, material, impressora ou quantidade preserva a origem e o escopo do fatiamento", () => {
  for (const field of ["name", "material", "printer", "quantity"]) {
    assert.deepEqual(updateEstimateOriginForEdit(fromSlicer, field), fromSlicer);
  }
});

test("editar peso ou tempo marca a entrada como manual e mantém peça/prato", () => {
  for (const field of ["gramsPerUnit", "hoursPerUnit"]) {
    assert.deepEqual(updateEstimateOriginForEdit(fromSlicer, field), {
      source: "manual",
      scope: "plate",
      engine: "",
      engineVersion: "",
    });
  }
});

test("entrada manual e escopo individual continuam estáveis em outras edições", () => {
  const manual = { source: "manual", scope: "piece", engine: "", engineVersion: "" };
  assert.deepEqual(updateEstimateOriginForEdit(manual, "quantity"), manual);
  assert.deepEqual(updateEstimateOriginForEdit(manual, "gramsPerUnit"), manual);
});
