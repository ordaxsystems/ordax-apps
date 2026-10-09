export const MESSAGE_LIMIT = 100000;
export function composeTextMessage(message) {
  const invalid = detail => { throw Object.assign(new Error(detail), { status: 400 }); };
  if (!message || typeof message.text !== 'string' || message.text.length > MESSAGE_LIMIT) invalid('Escreva uma mensagem de até 100 mil caracteres.');
  const attachments = message.attachments ?? [];
  if (!Array.isArray(attachments) || attachments.length > 4 || attachments.some(a => !a || a.kind !== 'text' || typeof a.text !== 'string' || a.text.length > MESSAGE_LIMIT || typeof a.name !== 'string' || !a.name || a.name.length > 240)) invalid('Aqui são aceitos até quatro arquivos de texto. Use Arquivos no Web para anexar imagens e outros arquivos na área Web.');
  const text = [message.text.trim(), ...attachments.map(a => `Arquivo: ${a.name}\n\n${a.text}`)].filter(Boolean).join('\n\n');
  if (!text || text.length > MESSAGE_LIMIT) invalid('Mensagem e anexos juntos devem ter até 100 mil caracteres.');
  return { text, attachments };
}
