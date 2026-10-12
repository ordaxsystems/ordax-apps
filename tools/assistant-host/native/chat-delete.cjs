'use strict';
// Only public, visible controls of the exact conversation; no backend API.
function deleteStep(expected, phase) {
  const canonical = location.origin + location.pathname;
  if (canonical !== expected.url) throw new Error('A conversa Web mudou. Exclusão interrompida.');
  const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const text = node => (node.innerText || node.textContent || '').trim();
  const label = node => node.getAttribute('aria-label') || text(node);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  if (all('[data-testid="stop-button"]').length) throw new Error('Aguarde a resposta antes de excluir.');
  if (phase === 'menu') {
    const links = all('a[href]').filter(node => { try { return new URL(node.href).origin + new URL(node.href).pathname === expected.url; } catch { return false; } });
    if (links.length !== 1) throw new Error('Abra a barra lateral do ChatGPT para localizar esta conversa.');
    const row = links[0].closest('[data-sidebar-item],li') || links[0];
    if (all('a[href]', row).length > 1) throw new Error('O item da conversa é ambíguo.');
    const buttons = all('button,[role="button"]', row).filter(node => /^(open conversation options|conversation options|abrir opções da conversa|opções da conversa|more options|mais opções)$/i.test(label(node)));
    if (buttons.length !== 1) throw new Error('O menu desta conversa não foi reconhecido. Exclua pelo ChatGPT Web.');
    buttons[0].click(); return { phase: 'menu' };
  }
  if (phase === 'dialog') {
    const items = all('[role="menuitem"]').filter(node => /^(delete|delete chat|excluir|excluir conversa)$/i.test(label(node)));
    if (items.length !== 1) return { waiting: true };
    items[0].click(); return { phase: 'dialog' };
  }
  const dialogs = all('[role="dialog"],dialog').filter(node => /delete chat|excluir (?:chat|conversa)/i.test(text(node)) && text(node).includes(expected.title));
  if (dialogs.length !== 1) return { waiting: true };
  const buttons = all('button', dialogs[0]).filter(node => /^(delete|delete chat|excluir|excluir conversa)$/i.test(label(node)) && !node.disabled);
  if (buttons.length !== 1) throw new Error('A confirmação Web não foi reconhecida. Nenhuma exclusão foi enviada.');
  buttons[0].click(); return { clicked: true };
}
function deleteScript(expected, phase) { return `(${deleteStep.toString()})(${JSON.stringify(expected)},${JSON.stringify(phase)})`; }
function deletionObserved(expected) {
  if (location.origin !== 'https://chatgpt.com' || location.pathname !== '/') return false;
  const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const alerts = [...document.querySelectorAll('[role="alert"],[role="status"]')].filter(visible);
  return alerts.some(node => /^(chat deleted|conversation deleted|conversa excluída|chat excluído)[.!]?$/i.test((node.innerText || '').trim())) && ![...document.querySelectorAll('a[href]')].some(node => node.href === expected.url);
}
const confirmationScript = expected => `(${deletionObserved.toString()})(${JSON.stringify(expected)})`;
module.exports = { deleteScript, confirmationScript };
