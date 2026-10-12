'use strict';
const { MCP_URL, PLUGINS_URL } = require('./plugin-connection.cjs');
// Fixed public fields only. Never accepts credentials or approves permissions.
function registrationStep(config) {
  if (location.origin + location.pathname !== config.pluginsURL) return { status: 'manual', message: 'Entre no ChatGPT para continuar o cadastro.' };
  const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const text = node => (node.innerText || node.textContent || '').trim();
  const dialogs = [...document.querySelectorAll('[role="dialog"],dialog')].filter(visible);
  const matches = dialogs.filter(node => /criar servidor MCP personalizado|create custom MCP server/i.test(text(node)));
  if (matches.length !== 1) return { status: 'manual', message: 'No ChatGPT, escolha Adicionar → servidor MCP personalizado. Depois clique novamente em Preparar cadastro no Studio.' };
  const dialog = matches[0];
  const inputs = [...dialog.querySelectorAll('input:not([type]),input[type="text"],input[type="url"],textarea')].filter(visible);
  const label = node => [node.getAttribute('aria-label'), node.placeholder, ...[...(node.labels || [])].map(text)].filter(Boolean).join(' ');
  const fields = [
    { pattern: /^(nome|name)(\s|$)|ferramenta personalizada|custom tool/i, value: config.name },
    { pattern: /descri[çc][aã]o|description|explique em poucas palavras/i, value: config.description },
    { pattern: /URL do servidor|server URL|https?:\/\//i, value: config.mcpURL },
  ];
  // Validate the whole form before mutation; preserve user-edited values.
  const resolved = fields.map(field => ({ ...field, nodes: inputs.filter(node => field.pattern.test(label(node))) }));
  if (resolved.some(field => field.nodes.length !== 1)) return { status: 'manual', message: 'O formulário mudou. Use os campos do guia do Studio para concluir o cadastro.' };
  if (resolved.some(field => field.nodes[0].value && field.nodes[0].value !== field.value)) return { status: 'manual', message: 'Há campos preenchidos por você. O Studio preservou os valores; revise o cadastro.' };
  for (const { nodes: [node], value } of resolved) {
    const prototype = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { status: 'prepared', message: 'Nome, descrição e URL preparados. Revise OAuth e conclua o consentimento e a instalação no ChatGPT.', requiresUserConsent: true };
}
function registrationScript() {
  return `(${registrationStep.toString()})(${JSON.stringify({ pluginsURL: PLUGINS_URL, mcpURL: MCP_URL, name: 'ORDAX Studio', description: 'Conecta o ChatGPT aos projetos e computadores autorizados no ORDAX.' })})`;
}
module.exports = { registrationScript };
