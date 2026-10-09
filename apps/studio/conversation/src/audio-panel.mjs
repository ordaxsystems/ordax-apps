import { createSpeech } from './speech.mjs';
export function createAudioPanel({ host, nativeWeb, snapshot, current, ensureChat, draft, saveText, notify, locked, changed = () => {} }) {
  const $ = id => document.getElementById(id);
  let capture = null, starting = false, finishing = false;
  const speech = createSpeech({ changed: paintSpeech });
  function paintSpeech(state = speech.state()) {
    $('speechPlayer').hidden = !['playing','paused','error'].includes(state.status);
    $('speechStatus').textContent = state.status === 'error' ? 'A leitura foi interrompida.' : state.status === 'paused' ? 'Leitura pausada' : 'Lendo com a voz deste dispositivo';
    $('speechPause').textContent = state.status === 'paused' ? 'Continuar' : 'Pausar'; $('speechPause').disabled = state.status === 'error';
    const selected = $('speechVoice').value; $('speechVoice').replaceChildren(new Option('Voz do dispositivo', ''));
    for (const voice of state.voices) $('speechVoice').append(new Option(`${voice.name} · ${voice.lang}`, voice.id));
    if (state.voices.some(voice => voice.id === selected)) $('speechVoice').value = selected;
    for (const button of document.querySelectorAll('[data-listen]')) { button.disabled = !state.available; button.title = state.available ? 'Ler com uma voz local do dispositivo' : 'Nenhuma voz local detectada neste dispositivo'; button.textContent = state.key === button.dataset.listen && state.status !== 'idle' ? '■ Parar leitura' : 'Ouvir'; }
  }
  const task = fn => Promise.resolve().then(fn).catch(error => notify(error.message));
  async function begin(mode) {
    if (locked() || capture || starting) return;
    starting = true;
    try {
    speech.stop();
    await ensureChat();
    if (snapshot().chatModeRequired === true && snapshot().automatedSendAllowed !== true) throw new Error('Confirme o modo Chat antes de iniciar áudio pelo Studio.');
    const id = current(); const saved = await draft();
    if (mode === 'voice' && (saved.text.trim() || saved.attachments.length)) throw new Error('Guarde ou envie seu rascunho antes de iniciar uma conversa por voz.');
    if (mode === 'dictation') await host.prepareAudioDraft({ chatId: id, revision: saved.revision });
    capture = { id, mode, revision: saved.revision }; paint(); changed();
    await nativeWeb.audio(mode);
    notify(mode === 'dictation' ? 'Conclua o ditado no ChatGPT e use Trazer ditado para revisar o texto no Studio.' : 'Use os controles de voz do ChatGPT. Para finalizar, use Encerrar áudio no Studio.');
    } catch (error) { capture = null; changed(); throw error; }
    finally { starting = false; paint(); }
  }
  async function finish() {
    if (!capture || finishing) return;
    finishing = true; paint(); try {
    if (capture.id !== current()) throw new Error('Volte à conversa em que o áudio foi iniciado.');
    if (capture.mode === 'dictation') {
      if (!capture.consumed) {
        const saved = await draft();
        if (capture.imported) {
          if (saved.revision !== capture.imported.revision || saved.text !== capture.imported.text) throw new Error('O texto salvo mudou. Confira o ditado no ChatGPT antes de encerrar.');
        } else {
          if (saved.revision !== capture.revision) throw new Error('Seu rascunho mudou. O ditado permanece no ChatGPT para você revisar.');
          const result = await host.webDraft(capture.id);
          const updated = await saveText(result.text);
          capture.imported = { revision: updated.revision, text: result.text };
        }
        await host.consumeWebDraft({ chatId: capture.id, ...capture.imported });
        capture.consumed = true;
      }
    }
    const mode = capture.mode; await nativeWeb.audioEnd(); capture = null; paint(); changed(); notify(mode === 'dictation' ? 'Ditado salvo. Revise o texto antes de enviar.' : 'Conversa por voz encerrada.');
    } finally { finishing = false; paint(); }
  }
  $('dictate').addEventListener('click', () => task(() => begin('dictation'))); $('voiceChat').addEventListener('click', () => task(() => begin('voice')));
  $('webDictate').addEventListener('click', () => task(() => begin('dictation')));
  $('webVoice').addEventListener('click', () => task(() => begin('voice')));
  $('audioFinish').addEventListener('click', () => task(finish));
  $('audioCancel').addEventListener('click', () => task(async () => { if (!capture || finishing) return; finishing = true; paint(); try { await nativeWeb.audioEnd(); capture = null; paint(); changed(); notify('Áudio encerrado; o rascunho do Studio foi preservado.'); } finally { finishing = false; paint(); } }));
  $('speechPause').addEventListener('click', () => speech.togglePause()); $('speechStop').addEventListener('click', () => speech.stop());
  function paint() {
    const web = snapshot();
    const modeBlocked = web.chatModeRequired === true && web.automatedSendAllowed !== true;
    $('dictate').hidden = !nativeWeb?.audio || !host.prepareAudioDraft; $('voiceChat').hidden = !nativeWeb?.audio;
    $('dictate').disabled = locked() || modeBlocked || starting || Boolean(capture) || !web.ready || !web.audio?.dictation;
    $('voiceChat').disabled = locked() || modeBlocked || starting || Boolean(capture) || !web.ready || !web.audio?.voice;
    $('dictate').title = web.audio?.dictation ? 'Ditar na mesma sessão ChatGPT' : 'Ditado não detectado nesta sessão. Confira o GPT Web.';
    $('voiceChat').title = web.audio?.voice ? 'Conversar por voz na mesma sessão ChatGPT' : 'Modo de voz não detectado nesta sessão. Confira o GPT Web.';
    for (const [primary, source] of [['webDictate','dictate'],['webVoice','voiceChat']]) { $(primary).hidden = $(source).hidden; $(primary).disabled = $(source).disabled; $(primary).title = $(source).title; }
    $('audioFinish').disabled = finishing; $('audioCancel').disabled = finishing;
    $('audioCancel').textContent = capture?.mode === 'dictation' ? 'Descartar ditado do Web' : 'Encerrar voz';
    $('audioSession').hidden = !capture; $('audioFinish').textContent = capture?.mode === 'dictation' ? 'Trazer ditado' : 'Encerrar áudio';
    $('audioSessionText').textContent = capture?.mode === 'dictation' ? 'Ditado aberto no ChatGPT · revise antes de enviar' : 'Conversa por voz aberta no ChatGPT';
    paintSpeech();
  }
  return { paint, active: () => Boolean(capture), stopReading: speech.stop,
    listen(message) { if (speech.state().key === message.id) speech.stop(); else speech.play(message.text, message.id, $('speechVoice').value); },
    dispose: speech.dispose };
}
