// Conservative first-party provider UI classification. Never export body
// text, chat content, URLs, account identity or opaque error payloads.
// A sidebar history failure is not proof that the current conversation failed.
export function classifyProviderPageAvailability({
  body='',messageNodes=0,composerPresent=false
}={}) {
  const text=typeof body==='string' ? body.slice(-5000).normalize('NFC') : '';
  const historyUnavailable=
    /n[aã]o foi poss[ií]vel carregar (?:o|seu) hist[oó]rico/iu.test(text) ||
    /(?:could(?:n['’]t| not)|unable to) load (?:your|the) (?:chat )?history/iu.test(text);
  const errorCopy=
    /n[aã]o foi poss[ií]vel carregar (?:esta|essa|a) conversa(?: do chatgpt)?/iu.test(text) ||
    /(?:could(?:n['’]t| not)|unable to) load (?:this|the) conversation/iu.test(text);
  const currentConversationUnavailable=errorCopy &&
    Number.isSafeInteger(messageNodes) && messageNodes===0 &&
    composerPresent!==true;
  return {
    page_state:currentConversationUnavailable ? 'conversation_load_failed' : 'unknown',
    history_unavailable:historyUnavailable
  };
}
