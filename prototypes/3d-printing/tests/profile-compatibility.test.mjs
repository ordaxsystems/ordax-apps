import assert from "node:assert/strict";
import test from "node:test";
import { assessSlicerProfileCompatibility, PROFILE_COMPATIBILITY_SCHEMA, readProfileCompatibility } from "../features/fatiamento-3d/profile-compatibility.mjs";

function compatibility({
  parentName = null,
  isSystem = null,
  printerNames = [],
  printerListPresent = true,
  printerCondition = "",
  printNames = [],
  printListPresent = true,
  printCondition = "",
  machineGroup = [],
  processGroup = [],
} = {}) {
  return {
    schema: PROFILE_COMPATIBILITY_SCHEMA,
    parentName,
    isSystem,
    compatiblePrinters: { present: printerListPresent, names: printerListPresent ? printerNames : null },
    compatiblePrintersCondition: { present: true, value: printerCondition },
    compatiblePrints: { present: printListPresent, names: printListPresent ? printNames : null },
    compatiblePrintsCondition: { present: true, value: printCondition },
    compatibleMachineExpressionGroup: { present: true, values: machineGroup },
    compatibleProcessExpressionGroup: { present: true, values: processGroup },
  };
}

function selection({ machineName = "Printer A", machineParent = null, machineSource = "system", processPrinters = [machineName], filamentPrinters = [machineName], filamentProcesses = ["0.20 Standard"] } = {}) {
  return {
    machine: {
      name: machineName,
      compatibility: compatibility({ parentName: machineParent, isSystem: machineSource === "system" ? true : machineSource === "user" ? false : null }),
    },
    process: { name: "0.20 Standard", compatibility: compatibility({ printerNames: processPrinters }) },
    filament: { name: "Generic PLA", compatibility: compatibility({ printerNames: filamentPrinters, printNames: filamentProcesses }) },
  };
}

test("aceita a combinação cujos nomes de máquina e processo coincidem com os perfis", () => {
  const result = assessSlicerProfileCompatibility(selection());
  assert.equal(result.status, "compatible");
});

test("converte os campos de compatibilidade Orca para o contrato versionado", () => {
  const parsed = readProfileCompatibility({
    from: "user",
    inherits: "Shared Process Base",
    compatible_printers: ["Printer A 0.4 nozzle"],
    compatible_printers_condition: "",
    compatible_prints: ["0.20 Standard"],
    compatible_prints_condition: "",
    compatible_machine_expression_group: [],
    compatible_process_expression_group: [""],
  });
  assert.deepEqual(parsed, compatibility({
    parentName: "Shared Process Base",
    isSystem: false,
    printerNames: ["Printer A 0.4 nozzle"],
    printNames: ["0.20 Standard"],
    machineGroup: [],
    processGroup: [""],
  }));
});

test("bloqueia processo e filamento que listam outra máquina", () => {
  const processMismatch = assessSlicerProfileCompatibility(selection({ processPrinters: ["Printer B"] }));
  assert.equal(processMismatch.status, "incompatible");
  assert.match(processMismatch.reason, /processo não declara compatibilidade/);

  const filamentMismatch = assessSlicerProfileCompatibility(selection({ filamentPrinters: ["Printer B"] }));
  assert.equal(filamentMismatch.status, "incompatible");
  assert.match(filamentMismatch.reason, /filamento não declara compatibilidade/);
});

test("considera compatibilidade com o perfil pai somente para máquina de usuário", () => {
  const userMachine = assessSlicerProfileCompatibility(selection({ machineName: "My Printer", machineParent: "Printer Base", machineSource: "user", processPrinters: ["Printer Base"], filamentPrinters: ["Printer Base"] }));
  assert.equal(userMachine.status, "compatible");

  const systemMachine = assessSlicerProfileCompatibility(selection({ machineName: "Printer Variant", machineParent: "Printer Base", machineSource: "system", processPrinters: ["Printer Base"] }));
  assert.equal(systemMachine.status, "incompatible");
});

test("bloqueia em vez de adivinhar quando dependência ou expressão não pode ser resolvida", () => {
  const condition = selection();
  condition.process.compatibility.compatiblePrinters.names = [];
  condition.process.compatibility.compatiblePrintersCondition.value = 'printer_model == "Printer A"';
  assert.equal(assessSlicerProfileCompatibility(condition).status, "unverified");

  const inherited = selection();
  inherited.process.compatibility.parentName = "Shared Process Base";
  inherited.process.compatibility.compatiblePrinters.present = false;
  inherited.process.compatibility.compatiblePrinters.names = null;
  assert.equal(assessSlicerProfileCompatibility(inherited).status, "unverified");
});

test("filamento limitado a outro perfil de processo é incompatível", () => {
  const result = assessSlicerProfileCompatibility(selection({ filamentProcesses: ["0.12 Fine"] }));
  assert.equal(result.status, "incompatible");
  assert.match(result.reason, /filamento não declara compatibilidade com o processo/);
});
