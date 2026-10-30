export const PROFILE_COMPATIBILITY_SCHEMA = "ordax.slicer-profile-compatibility/1";

function compatibilityList(profile, key) {
  const present = Object.hasOwn(profile, key);
  const value = profile[key];
  if (!present) return { present: false, names: null };
  if (!Array.isArray(value) || value.some(name => typeof name !== "string")) return { present: true, names: null };
  const names = value.map(name => name.trim());
  if (names.some(name => !name)) return { present: true, names: null };
  return { present: true, names };
}

function compatibilityCondition(profile, key) {
  const present = Object.hasOwn(profile, key);
  const value = profile[key];
  return { present, value: present && typeof value === "string" ? value : null };
}

function compatibilityExpressionGroup(profile, key) {
  if (!Object.hasOwn(profile, key)) return { present: false, values: null };
  const value = profile[key];
  return { present: true, values: Array.isArray(value) && value.every(item => typeof item === "string") ? value.map(item => item.trim()) : null };
}

export function readProfileCompatibility(profile) {
  const parentName = typeof profile?.inherits === "string" && profile.inherits.trim() ? profile.inherits.trim().slice(0, 180) : null;
  const source = typeof profile?.from === "string" ? profile.from.trim().toLowerCase() : "";
  return Object.freeze({
    schema: PROFILE_COMPATIBILITY_SCHEMA,
    parentName,
    isSystem: source === "system" ? true : source ? false : null,
    compatiblePrinters: compatibilityList(profile || {}, "compatible_printers"),
    compatiblePrintersCondition: compatibilityCondition(profile || {}, "compatible_printers_condition"),
    compatiblePrints: compatibilityList(profile || {}, "compatible_prints"),
    compatiblePrintsCondition: compatibilityCondition(profile || {}, "compatible_prints_condition"),
    compatibleMachineExpressionGroup: compatibilityExpressionGroup(profile || {}, "compatible_machine_expression_group"),
    compatibleProcessExpressionGroup: compatibilityExpressionGroup(profile || {}, "compatible_process_expression_group"),
  });
}

function constraintList(compatibility, key, profile, label) {
  if (compatibility?.schema !== PROFILE_COMPATIBILITY_SCHEMA) {
    return { status: "unverified", reason: `O perfil de ${label} não informa metadados de compatibilidade verificáveis.` };
  }
  const entry = compatibility?.[key];
  if (!entry || typeof entry !== "object" || typeof entry.present !== "boolean") {
    return { status: "unverified", reason: `O perfil de ${label} não informa metadados de compatibilidade verificáveis.` };
  }
  if (!entry.present && compatibility.parentName) {
    return { status: "unverified", reason: `O perfil de ${label} herda configurações de compatibilidade que este host ainda não resolve.` };
  }
  if (entry.names !== null && (!Array.isArray(entry.names) || entry.names.some(name => typeof name !== "string" || !name.trim()))) {
    return { status: "unverified", reason: `A lista de compatibilidade do perfil de ${label} está em formato inválido.` };
  }
  const names = entry.names || [];
  const condition = compatibility.compatiblePrintersCondition;
  if (!Array.isArray(names)) return { status: "unverified", reason: `Os metadados de compatibilidade do perfil de ${label} estão incompletos.` };
  if (names.length) {
    const machineName = profile?.machine?.name;
    if (names.includes(machineName)) return { status: "compatible", reason: "" };
    const machineCompatibility = profile?.machine?.compatibility;
    const machineParent = machineCompatibility?.parentName;
    if (machineParent && machineCompatibility.isSystem === false && names.includes(machineParent)) {
      return { status: "compatible", reason: "" };
    }
    if (machineParent && machineCompatibility.isSystem == null && names.includes(machineParent)) {
      return { status: "unverified", reason: `Não foi possível confirmar se a variante da máquina pode herdar a compatibilidade do perfil de ${label}.` };
    }
    return { status: "incompatible", reason: `O perfil de ${label} não declara compatibilidade com a máquina “${machineName || "selecionada"}”.` };
  }
  if (!condition || typeof condition.present !== "boolean" || (condition.present && typeof condition.value !== "string")) {
    return { status: "unverified", reason: `Os metadados de compatibilidade do perfil de ${label} estão incompletos.` };
  }
  if (condition?.present && typeof condition.value === "string" && condition.value.trim()) {
    return { status: "unverified", reason: `O perfil de ${label} usa uma expressão de compatibilidade com a máquina que este app ainda não avalia.` };
  }
  return { status: "compatible", reason: "" };
}

function processConstraintList(compatibility, process) {
  if (compatibility?.schema !== PROFILE_COMPATIBILITY_SCHEMA) {
    return { status: "unverified", reason: "O perfil de filamento não informa compatibilidade verificável com processos." };
  }
  const entry = compatibility?.compatiblePrints;
  if (!entry || typeof entry !== "object" || typeof entry.present !== "boolean") {
    return { status: "unverified", reason: "O perfil de filamento não informa compatibilidade verificável com processos." };
  }
  if (!entry.present && compatibility.parentName) {
    return { status: "unverified", reason: "O perfil de filamento herda compatibilidade com processos que este host ainda não resolve." };
  }
  if (entry.names !== null && (!Array.isArray(entry.names) || entry.names.some(name => typeof name !== "string" || !name.trim()))) {
    return { status: "unverified", reason: "A lista de processos compatíveis do filamento está em formato inválido." };
  }
  const names = entry.names || [];
  const condition = compatibility.compatiblePrintsCondition;
  if (!Array.isArray(names)) return { status: "unverified", reason: "Os metadados de compatibilidade de processo do filamento estão incompletos." };
  if (names.length && !names.includes(process?.name)) {
    return { status: "incompatible", reason: `O filamento não declara compatibilidade com o processo “${process?.name || "selecionado"}”.` };
  }
  if (names.length) return { status: "compatible", reason: "" };
  if (!condition || typeof condition.present !== "boolean" || (condition.present && typeof condition.value !== "string")) {
    return { status: "unverified", reason: "Os metadados de compatibilidade de processo do filamento estão incompletos." };
  }
  if (!names.length && condition?.present && typeof condition.value === "string" && condition.value.trim()) {
    return { status: "unverified", reason: "O perfil de filamento usa uma expressão de compatibilidade com o processo que este app ainda não avalia." };
  }
  return { status: "compatible", reason: "" };
}

function expressionGroupReason(profile, label) {
  const compatibility = profile?.compatibility;
  if (!compatibility || compatibility.schema !== PROFILE_COMPATIBILITY_SCHEMA) {
    return `O perfil de ${label} não informa compatibilidade verificável.`;
  }
  for (const [key, description] of [
    ["compatibleMachineExpressionGroup", "máquina"],
    ["compatibleProcessExpressionGroup", "processo"],
  ]) {
    const entry = compatibility[key];
    if (entry === null || entry === undefined) continue;
    if (typeof entry !== "object" || typeof entry.present !== "boolean") {
      return `O perfil de ${label} tem uma expressão de compatibilidade de ${description} incompleta.`;
    }
    if (!entry.present) continue;
    if (!Array.isArray(entry.values) || entry.values.some(item => typeof item !== "string")) {
      return `O perfil de ${label} tem uma expressão de compatibilidade de ${description} em formato inválido.`;
    }
    if (entry.values.some(item => item.trim())) {
      return `O perfil de ${label} usa uma expressão de compatibilidade de ${description} que este app ainda não avalia.`;
    }
  }
  return "";
}

export function assessSlicerProfileCompatibility({ machine, process, filament } = {}) {
  if (!machine || !process || !filament) {
    return Object.freeze({ schema: PROFILE_COMPATIBILITY_SCHEMA, status: "unverified", reason: "Selecione os perfis reais de máquina, processo e filamento." });
  }
  for (const [profile, label] of [[machine, "máquina"], [process, "processo"], [filament, "filamento"]]) {
    if (profile.inheritance?.status === "unresolved") {
      return Object.freeze({ schema: PROFILE_COMPATIBILITY_SCHEMA, status: "unverified", reason: profile.inheritance.reason || `O perfil de ${label} tem uma cadeia de herança não resolvida.` });
    }
  }
  for (const [profile, label] of [[process, "processo"], [filament, "filamento"]]) {
    const groupReason = expressionGroupReason(profile, label);
    if (groupReason) return Object.freeze({ schema: PROFILE_COMPATIBILITY_SCHEMA, status: "unverified", reason: groupReason });
  }
  const processMachine = constraintList(process.compatibility, "compatiblePrinters", { machine }, "processo");
  if (processMachine.status !== "compatible") {
    return Object.freeze({ schema: PROFILE_COMPATIBILITY_SCHEMA, ...processMachine });
  }
  const filamentMachine = constraintList(filament.compatibility, "compatiblePrinters", { machine }, "filamento");
  if (filamentMachine.status !== "compatible") {
    return Object.freeze({ schema: PROFILE_COMPATIBILITY_SCHEMA, ...filamentMachine });
  }
  const filamentProcess = processConstraintList(filament.compatibility, process);
  if (filamentProcess.status !== "compatible") {
    return Object.freeze({ schema: PROFILE_COMPATIBILITY_SCHEMA, ...filamentProcess });
  }
  return Object.freeze({ schema: PROFILE_COMPATIBILITY_SCHEMA, status: "compatible", reason: "Compatibilidade verificada pelos metadados dos três perfis." });
}
