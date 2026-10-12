const MESSAGES = Object.freeze({
  "pt-BR": Object.freeze({
    title: "Calculadora",
    expression: "Expressão",
    result: "Resultado",
    clear: "Limpar",
    backspace: "Apagar último caractere",
    calculate: "Calcular",
    invalid: "Expressão inválida",
  }),
  "en-US": Object.freeze({
    title: "Calculator",
    expression: "Expression",
    result: "Result",
    clear: "Clear",
    backspace: "Delete last character",
    calculate: "Calculate",
    invalid: "Invalid expression",
  }),
});

export function calculatorMessages(locale) {
  const normalized = String(locale || "").toLowerCase();
  if (normalized.startsWith("pt")) return MESSAGES["pt-BR"];
  return MESSAGES["en-US"];
}
