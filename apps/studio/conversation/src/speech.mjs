export function speechChunks(text, limit = 240) {
  // Spoken prose stays bounded; code blocks are skipped instead of reading source code aloud.
  const prose = String(text).replace(/```[\s\S]*?```/g, ' Trecho de código. ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[#*_`>|]/g, '').trim();
  if (!prose || prose.length > 30000) throw new Error('Escolha uma resposta com até 30 mil caracteres para ouvir.');
  const words = prose.split(/\s+/), chunks = []; let current = '';
  for (const word of words) {
    if (current && current.length + word.length + 1 > limit) { chunks.push(current); current = ''; }
    if (word.length > limit) { if (current) { chunks.push(current); current = ''; } for (let i=0;i<word.length;i+=limit) chunks.push(word.slice(i,i+limit)); }
    else current += (current ? ' ' : '') + word;
  }
  if (current) chunks.push(current); return chunks;
}
export function createSpeech({ synthesis = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, changed = () => {} } = {}) {
  let generation = 0, current = null, status = 'idle', key = null;
  const voices = () => (synthesis?.getVoices() || []).filter(voice => voice.localService);
  const state = () => ({ status, key, available: Boolean(synthesis && Utterance && voices().length), voices: voices().map(voice => ({ name: voice.name, lang: voice.lang, id: voice.voiceURI })) });
  const paint = () => changed(state());
  function stop() { generation++; synthesis?.cancel(); current = null; status = 'idle'; key = null; paint(); }
  function play(text, id, voiceId) {
    const chunks = speechChunks(text); stop();
    if (!state().available) throw new Error('Nenhuma voz local está disponível neste dispositivo.');
    const voice = voices().find(item => item.voiceURI === voiceId) || voices().find(item => /^pt[-_]BR$/i.test(item.lang)) || voices().find(item => /^pt/i.test(item.lang)) || voices()[0];
    const ticket = generation; key = id; status = 'playing'; paint();
    const next = () => {
      if (generation !== ticket) return;
      if (!chunks.length) { stop(); return; }
      current = new Utterance(chunks.shift()); current.voice = voice; current.lang = voice.lang; current.rate = 1;
      current.onend = next; current.onerror = () => { if (generation === ticket) { stop(); status = 'error'; paint(); } };
      try { synthesis.speak(current); } catch (error) { stop(); status = 'error'; paint(); throw error; }
    };
    next();
  }
  function togglePause() { if (status === 'playing') { synthesis.pause(); status = 'paused'; } else if (status === 'paused') { synthesis.resume(); status = 'playing'; } paint(); }
  synthesis?.addEventListener?.('voiceschanged', paint);
  return { state, play, stop, togglePause, dispose: () => { stop(); synthesis?.removeEventListener?.('voiceschanged', paint); } };
}
