import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { WebBridge } from '../native/web-bridge.mjs';

async function fixture() {
  const disk = {}; let clock = 10000, submits = 0;
  let page = { conversationMode: 'chat', url: 'https://chatgpt.com/', conversationId: null, ready: true, draft: '', busy: false, loginRequired: false, model: 'Modelo da conta', turns: [], baseline: [], title: 'ChatGPT' };
  const contents = {
    isDestroyed: () => false, isLoadingMainFrame: () => false, getURL: () => page.url,
    loadURL: async url => { page = { ...page, url, conversationId: /^https:\/\/chatgpt.com\/c\/(.+)$/.exec(url)?.[1] || null, turns: [], baseline: [], draft: '' }; },
    executeJavaScript: async code => {
      const args = JSON.parse(/\)\(\.\.\.(\[.*\])\); \}\)\(\)$/.exec(code)[1]);
      if (code.includes('return (function selectChatMode')) return { selected: page.conversationMode === 'chat' };
      if (code.includes('return (function prepareMessage')) { page.draft = args[0]; return { prepared: true }; }
      if (code.includes('return (function consumeAudioDraft')) { if (page.draft !== args[0].text) throw new Error('draft changed'); page.draft = ''; return { cleared: true }; }
      if (code.includes('return (function submitMessage')) {
        submits++; page.turns.push({ id: 'user-new', role: 'user', text: page.draft }, { id: 'assistant-new', role: 'assistant', text: 'Resposta parcial', completedControl: false });
        page.draft = ''; page.busy = true; page.baseline = page.turns.map(t => t.id); page.url = 'https://chatgpt.com/c/new-chat'; page.conversationId = 'new-chat'; return { sent: true };
      }
      if (code.includes('return (function stopMessage')) { page.busy = false; return { stopped: true }; }
      return structuredClone(page);
    },
  };
  const storage = { read: async (key, fallback) => disk[key] || fallback, write: async (key, value) => { disk[key] = structuredClone(value); } };
  const bridge = new WebBridge({ startAtHome: false, surface: { webContents: contents }, storage, now: () => clock, interval: 100000 });
  await bridge.init(); const chat = await bridge.createChat(); await bridge.refresh();
  return { bridge, chat, contents, storage, get page() { return page; }, get submits() { return submits; }, disk, tick: value => { clock += value; } };
}
const input = id => ({ chatId: id, model: 'chatgpt-web', message: { text: 'Olá', attachments: [] } });

test('Work, Codex, unknown and absent mode never prepare, submit or consume a draft', async t => {
  const f = await fixture(); t.after(() => f.bridge.close());
  await f.bridge.drafts.save(f.chat.id, {text:'Olá',attachments:[],revision:1});
  for (const mode of ['work','codex','unknown',undefined]) {
    f.page.conversationMode = mode;
    await assert.rejects(f.bridge.respond(input(f.chat.id),()=>{},new AbortController().signal), /Envio bloqueado/);
    assert.equal(f.bridge.state().web.automatedSendAllowed,false);
    assert.equal(f.page.draft,''); assert.equal(f.submits,0);
    assert.equal(f.bridge.drafts.state()[f.chat.id].text,'Olá'); assert.equal(f.chat.delivery,undefined);
    await assert.rejects(f.bridge.prepareAudioDraft({chatId:f.chat.id,revision:1}),/modo Chat/);
  }
});

test('fresh conversations select Chat through a public control and verify it without sending', async t => {
  const f = await fixture(); t.after(() => f.bridge.close()); let selections=0;
  f.page.conversationMode='work';
  const execute=f.contents.executeJavaScript;
  f.contents.executeJavaScript=async code=>{if(code.includes('return (function selectChatMode')){selections++;f.page.conversationMode='chat';return {requested:true};}return execute(code);};
  const created=await f.bridge.createChat();
  assert.equal(f.bridge.activeId,created.id);assert.equal(selections,1);
  assert.equal(f.bridge.state().web.conversationMode,'chat');assert.equal(f.bridge.state().web.automatedSendAllowed,true);assert.equal(f.submits,0);
});

test('an existing Work conversation is observed without conversion and cannot use Studio sending', async t => {
  const f=await fixture();t.after(()=>f.bridge.close());
  f.chat.webId='work-task';f.page.conversationId='work-task';f.page.url='https://chatgpt.com/c/work-task';f.page.conversationMode='work';
  let selections=0;const execute=f.contents.executeJavaScript;
  f.contents.executeJavaScript=async code=>{if(code.includes('return (function selectChatMode'))selections++;return execute(code);};
  await f.bridge.refresh();assert.equal(selections,0);assert.equal(f.page.conversationMode,'work');
  await assert.rejects(f.bridge.respond(input(f.chat.id),()=>{},new AbortController().signal),/Envio bloqueado/);assert.equal(f.submits,0);
});

test('new chat drains an older observation and returns only after reading its loaded composer', async t => {
  const f = await fixture(); t.after(() => f.bridge.close());
  const inspect = f.contents.executeJavaScript, load = f.contents.loadURL;
  let release, first = true, loaded = false;
  f.contents.executeJavaScript = async code => {
    if (first && code.includes('return (function inspectPage')) { first = false; await new Promise(resolve => { release = resolve; }); }
    return inspect(code);
  };
  f.contents.loadURL = async url => { loaded = true; return load(url); };
  const observation = f.bridge.refresh(); await delay(1);
  const creating = f.bridge.createChat(); await delay(5);
  assert.equal(loaded, false); release(); await observation;
  const created = await creating;
  assert.equal(f.bridge.activeId, created.id); assert.equal(f.bridge.page.ready, true);
  assert.equal(f.bridge.page.conversationId, null); assert.equal(f.submits, 0);
});
test('accepted Web delivery consumes its durable draft despite losing the UI stream; stale input cannot submit', async t => {
  const f = await fixture(); t.after(() => f.bridge.close());
  await f.bridge.drafts.save(f.chat.id, { text: 'Olá', attachments: [], revision: 7 });
  const data = { ...input(f.chat.id), draftKey: f.chat.id, draftRevision: 6 };
  await assert.rejects(f.bridge.respond(data, () => {}, new AbortController().signal), /mudou/); assert.equal(f.submits, 0);
  const response = f.bridge.respond({ ...data, draftRevision: 7 }, () => {}, new AbortController().signal); response.catch(() => {});
  for (let i = 0; i < 100 && !f.bridge.run; i++) await delay(5);
  await f.bridge.refresh(); assert.equal(f.bridge.drafts.state()[f.chat.id].text, '');
  await f.bridge.drafts.save(f.chat.id, { text: 'Olá', attachments: [], revision: 7 }); assert.equal(f.bridge.drafts.state()[f.chat.id].text, '');
  await f.bridge.stop(f.chat.id); await assert.rejects(response); assert.equal(f.submits, 1);
});
async function start(f, signal = new AbortController().signal) {
  const events = [], promise = f.bridge.respond(input(f.chat.id), e => events.push(structuredClone(e)), signal);
  // Attach an immediate rejection handler; assertions await the original promise below.
  promise.catch(() => {});
  for (let i = 0; i < 100 && !f.bridge.run; i++) await delay(5);
  assert.ok(f.bridge.run); await f.bridge.refresh(); return { events, promise };
}

test('left submission uses the visible Web session once; streams actual turns and binds its URL', async t => {
  const f = await fixture(); t.after(() => f.bridge.close());
  const { events, promise } = await start(f);
  assert.equal(f.submits, 1); assert.equal(f.bridge.findChat(f.chat.id).webId, 'new-chat');
  assert.ok(events.some(e => e.type === 'start'));
  assert.equal(f.chat.messages.at(-1).text, 'Resposta parcial');
  f.page.turns.at(-1).text = 'Resposta completa'; f.page.turns.at(-1).completedControl = true; f.page.busy = false;
  await f.bridge.refresh(); f.tick(2000); await f.bridge.refresh(); await promise;
  assert.equal(events.at(-1).type, 'done'); assert.equal(f.chat.messages.at(-1).status, 'completed');
  assert.equal(f.submits, 1); assert.equal(f.disk['web-chats'].chats[0].webId, 'new-chat');
});

test('messages written on the right are imported; virtualized old turns stay in local history', async t => {
  const f = await fixture(); t.after(() => f.bridge.close());
  f.page.conversationId = 'right-chat'; f.page.url = 'https://chatgpt.com/c/right-chat';
  f.page.turns = [{ id: 'r-user', role: 'user', text: 'Escrito no Web' }, { id: 'r-answer', role: 'assistant', text: 'Espelhado', completedControl: true }];
  await f.bridge.refresh(); f.tick(2000); await f.bridge.refresh();
  const chat = f.bridge.findChat(f.bridge.activeId);
  assert.equal(chat.messages[0].text, 'Escrito no Web'); assert.equal(chat.messages[1].status, 'completed');
  f.page.turns = [{ id: 'next', role: 'user', text: 'Outra mensagem' }]; await f.bridge.refresh();
  assert.equal(chat.messages.length, 3); assert.equal(f.submits, 0);
});

test('draft conflicts, unsupported images, model substitution and retries never submit', async t => {
  const f = await fixture(); t.after(() => f.bridge.close()); const emit = () => {}, signal = new AbortController().signal;
  f.page.draft = 'Rascunho do usuário'; await assert.rejects(f.bridge.respond(input(f.chat.id), emit, signal), /rascunho/i); f.page.draft = '';
  await assert.rejects(f.bridge.respond({ ...input(f.chat.id), model: 'inventado' }, emit, signal), /modelo/i);
  await assert.rejects(f.bridge.respond({ ...input(f.chat.id), retry: true }, emit, signal), /Regenerar/);
  await assert.rejects(f.bridge.respond({ ...input(f.chat.id), message: { text: 'imagem', attachments: [{ kind: 'image', name: 'x.png', data: 'x' }] } }, emit, signal), /área Web/);
  assert.equal(f.submits, 0);
  f.page.url = 'https://accounts.google.com/signin?state=private-flow'; await f.bridge.refresh();
  assert.equal(f.bridge.state().web.url, 'https://chatgpt.com/');
});

test('an uncertain or mismatched accepted message fails without resubmission', async t => {
  const f = await fixture(); t.after(() => f.bridge.close());
  const events = [], promise = f.bridge.respond(input(f.chat.id), e => events.push(e), new AbortController().signal); promise.catch(() => {});
  for (let i = 0; i < 100 && !f.bridge.run; i++) await delay(5);
  f.page.turns[0].text = 'Mensagem diferente'; await f.bridge.refresh();
  await assert.rejects(promise, /confirmar/); assert.equal(events.at(-1).type, 'error'); assert.equal(f.submits, 1);
});

test('stop cancels the Web generation, preserves partial output and does not duplicate the user', async t => {
  const f = await fixture(); t.after(() => f.bridge.close()); const { promise } = await start(f);
  await f.bridge.stop(f.chat.id); await assert.rejects(promise, /interrompida/);
  assert.equal(f.chat.messages.at(-1).status, 'cancelled'); assert.equal(f.chat.messages.at(-1).text, 'Resposta parcial');
  assert.equal(f.chat.messages.filter(m => m.role === 'user').length, 1); assert.equal(f.submits, 1);
});

test('Web navigation during a turn does not bind another conversation or send again', async t => {
  const f = await fixture(); t.after(() => f.bridge.close()); const { promise } = await start(f);
  f.page.conversationId = 'another'; f.page.url = 'https://chatgpt.com/c/another'; await f.bridge.refresh();
  await assert.rejects(promise, /mudou/); assert.equal(f.chat.webId, 'new-chat'); assert.equal(f.submits, 1);
});

test('deleted local chats stay deleted when their Web page is still visible', async t => {
  const f = await fixture(); t.after(() => f.bridge.close());
  f.page.url = 'https://chatgpt.com/c/keep-web'; f.page.conversationId = 'keep-web'; f.page.turns = [{ id: 'u', role: 'user', text: 'Manter no Web' }];
  await f.bridge.refresh(); const id = f.bridge.activeId; await f.bridge.deleteChat(id); await f.bridge.refresh();
  assert.ok(!f.bridge.chats.some(c => c.id === id)); assert.equal(f.submits, 0);
});

test('observed thinking and tool activity streams and remains attached to the final answer', async t => {
  const f = await fixture(); t.after(() => f.bridge.close()); const { promise, events } = await start(f);
  f.page.signals = [{ label: 'Pensando…' }]; await f.bridge.refresh(); f.tick(1000);
  f.page.signals = [{ label: 'Pesquisando na Web' }]; await f.bridge.refresh(); f.tick(1000);
  f.page.signals = [{ label: 'Executando análise' }]; await f.bridge.refresh();
  f.page.signals = []; f.page.turns.at(-1).text = 'Concluído'; f.page.turns.at(-1).completedControl = true; f.page.busy = false;
  await f.bridge.refresh(); f.tick(2000); await f.bridge.refresh(); await promise;
  const activity = f.chat.messages.at(-1).activity;
  assert.deepEqual(activity.events.map(e => e.kind), ['sending', 'waiting', 'responding', 'thinking', 'searching', 'tool', 'settling', 'completed']);
  assert.equal(activity.turnId, 'user-new'); assert.equal(activity.current.kind, 'completed'); assert.ok(activity.endedAt > activity.startedAt);
  assert.ok(events.some(e => e.type === 'activity' && e.activity.current.kind === 'thinking')); assert.equal(f.submits, 1);
  assert.deepEqual(f.disk['web-chats'].chats[0].messages.at(-1).activity, activity);
});
test('renderer failure disables the session and terminates tracking without resending', async t => {
  const f = await fixture(); t.after(() => f.bridge.close()); const { promise } = await start(f);
  f.bridge.setTransportStatus('error', 'A área Web foi interrompida.'); await assert.rejects(promise, /interrompida/);
  assert.equal(f.bridge.state().web.ready, false); assert.equal(f.bridge.state().web.transport.state, 'error');
  assert.equal(f.chat.messages.at(-1).activity.current.kind, 'error'); assert.equal(f.submits, 1);
});

test('reopening after an interrupted run retains partial text and ends the saved activity', async t => {
  const f = await fixture(); t.after(() => f.bridge.close()); const { promise } = await start(f);
  const saved = { chats: [structuredClone(f.chat)], ignored: [] }; let written;
  await f.bridge.stop(f.chat.id); await assert.rejects(promise, /interrompida/);
  const recovered = new WebBridge({ startAtHome: false, surface: f.bridge.surface, storage: { read: async () => saved, write: async (_, value) => { written = structuredClone(value); } }, now: () => 20000, interval: 100000 });
  t.after(() => recovered.close()); await recovered.init(); await recovered.persist();
  assert.equal(recovered.chats[0].messages.at(-1).text, 'Resposta parcial');
  assert.equal(recovered.chats[0].messages.at(-1).status, 'interrupted');
  assert.equal(written.chats[0].messages.at(-1).activity.current.kind, 'interrupted'); assert.equal(f.submits, 1);
});

test('a send waits for the shared in-flight observation instead of sending against a stale draft', async t => {
  const f = await fixture(); t.after(() => f.bridge.close());
  let release; const original = f.contents.executeJavaScript;
  f.contents.executeJavaScript = async code => { if (code.includes('return (function inspectPage')) await new Promise(resolve => { release = resolve; }); return original(code); };
  const reading = f.bridge.refresh();
  await delay(1); f.page.draft = 'Rascunho alterado no Web';
  const sending = f.bridge.respond(input(f.chat.id), () => {}, new AbortController().signal); sending.catch(() => {});
  await delay(10); assert.equal(f.submits, 0); release(); await reading;
  await assert.rejects(sending, /rascunho/i); assert.equal(f.submits, 0);
});
test('history failure blocks submission and retains dirty data until a later successful write', async t => {
  const f = await fixture(); t.after(() => f.bridge.close()); const original = f.storage.write;
  f.storage.write = async () => { throw new Error('disk full'); }; f.bridge.touch();
  await f.bridge.persist(); assert.equal(f.bridge.dirty, true); assert.match(f.bridge.state().web.issue, /salvar/);
  await assert.rejects(f.bridge.respond(input(f.chat.id), () => {}, new AbortController().signal), /salvar/);
  assert.equal(f.submits, 0); assert.equal(f.chat.delivery.status, 'not-sent');
  f.storage.write = original; await f.bridge.persist(); assert.equal(f.bridge.dirty, false); assert.equal(f.bridge.storageIssue, '');
});
test('an ambiguous submission is never retried and requires review before another send', async t => {
  const f = await fixture(); t.after(() => f.bridge.close()); const original = f.contents.executeJavaScript;
  f.contents.executeJavaScript = async code => { const result = await original(code); if (code.includes('return (function submitMessage')) throw new Error('renderer disconnected after clicking'); return result; };
  await assert.rejects(f.bridge.respond(input(f.chat.id), () => {}, new AbortController().signal), /disconnected/);
  assert.equal(f.submits, 1); assert.equal(f.chat.delivery.status, 'uncertain');
  f.page.busy = false;
  await assert.rejects(f.bridge.respond(input(f.chat.id), () => {}, new AbortController().signal), /sem confirmação/);
  await f.bridge.reviewDelivery(f.chat.id); assert.equal(f.chat.delivery.status, 'reviewed'); assert.equal(f.submits, 1);
});
test('state revisions omit unchanged history and restored receipts reconnect to the saved public URL', async t => {
  const f = await fixture(); t.after(() => f.bridge.close());
  assert.equal(Object.hasOwn(f.bridge.state({ since: f.bridge.version }), 'chats'), false);
  f.bridge.touch(); assert.ok(f.bridge.state({ since: f.bridge.version - 1 }).chats);
  const { promise } = await start(f); const saved = { ...structuredClone(f.disk['web-chats']), chats: [structuredClone(f.chat)], activeId: f.chat.id };
  await f.bridge.stop(f.chat.id); await assert.rejects(promise);
  const recovered = new WebBridge({ startAtHome: false, surface: f.bridge.surface, storage: { read: async () => saved, write: async () => {} }, interval: 100000 }); t.after(() => recovered.close());
  await recovered.init(); assert.equal(recovered.resumeURL(), 'https://chatgpt.com/c/new-chat'); assert.equal(recovered.chats[0].delivery.status, 'uncertain');
});
test('a stop for another chat leaves the actual generation running', async t => {
  const f = await fixture(); t.after(() => f.bridge.close()); const { promise } = await start(f);
  await assert.rejects(f.bridge.stop('other-chat'), /ativa mudou/); assert.equal(f.page.busy, true); assert.equal(f.bridge.run.finished, false);
  await f.bridge.stop(f.chat.id); await assert.rejects(promise); assert.equal(f.submits, 1);
});

test('an ambiguous click is reconciled to its original local chat when the Web confirms completion', async t => {
  const f = await fixture(); t.after(() => f.bridge.close()); const original=f.contents.executeJavaScript;
  f.contents.executeJavaScript=async code=>{const result=await original(code);if(code.includes('return (function submitMessage'))throw new Error('lost click result');return result;};
  await assert.rejects(f.bridge.respond(input(f.chat.id),()=>{},new AbortController().signal));
  f.page.busy=false;f.page.turns.at(-1).text='Resposta confirmada';f.page.turns.at(-1).completedControl=true;
  await f.bridge.refresh();f.tick(2000);await f.bridge.refresh();
  assert.equal(f.bridge.chats.length,1);assert.equal(f.bridge.activeId,f.chat.id);assert.equal(f.chat.delivery.status,'completed');assert.equal(f.chat.messages.at(-1).status,'completed');assert.equal(f.chat.activity.current.kind,'completed');assert.equal(f.submits,1);
});
test('switching existing chats on the Web persists the active conversation without reserializing unchanged turns', async t => {
  const f=await fixture();t.after(()=>f.bridge.close());
  const old=f.chat;old.webId='old';old.messages=[{id:'old-user',role:'user',text:'Histórico antigo',status:'completed'}];
  const current=f.bridge.newRecord();current.webId='current';
  f.page.url='https://chatgpt.com/c/current';f.page.conversationId='current';await f.bridge.refresh();await f.bridge.persist();
  f.page.url='https://chatgpt.com/c/old';f.page.conversationId='old';f.page.turns=[{id:'old-user',role:'user',text:'Histórico antigo'}];
  const revision=f.bridge.version;await f.bridge.refresh();assert.equal(f.bridge.activeId,old.id);assert.ok(f.bridge.version>revision);
  await f.bridge.persist();assert.equal(f.disk['web-chats'].activeId,old.id);
  const stable=f.bridge.version;await f.bridge.refresh();assert.equal(f.bridge.version,stable);
});


test('plugin registration and OAuth pages never become conversations or login errors', async t => {
  const f=await fixture();t.after(()=>f.bridge.close());const id=f.bridge.activeId, count=f.bridge.chats.length;
  f.page.url='https://chatgpt.com/plugins';f.page.turns=[{id:'fake',role:'user',text:'Plugin settings'}];
  await f.bridge.refresh();assert.equal(f.bridge.page.ready,false);assert.equal(f.bridge.page.loginRequired,false);
  assert.equal(f.bridge.activeId,id);assert.equal(f.bridge.chats.length,count);assert.equal(f.chat.messages.length,0);
  f.page.url='https://eobcxuyvhkvdmkbaihwh.supabase.co/auth/v1/oauth/authorize';f.bridge.setupActive=()=>true;
  await f.bridge.refresh();assert.equal(f.bridge.page.loginRequired,false);assert.equal(f.bridge.activeId,id);
});


test('failed history deletion preserves the chat, its draft, selection and Web import identity', async t => {
  const f = await fixture(); t.after(() => f.bridge.close());
  f.page.url = 'https://chatgpt.com/c/kept'; f.page.conversationId = 'kept'; f.page.turns = [{ id: 'kept-u', role: 'user', text: 'preserved' }]; await f.bridge.refresh();
  const id = f.bridge.activeId; await f.bridge.drafts.save(id, {text:'draft', attachments:[], revision:1});
  const write = f.storage.write; f.storage.write = async (key, value) => { if (key === 'web-chats') throw new Error('disk full'); return write(key, value); };
  const originalTitle=f.bridge.findChat(id).title; await assert.rejects(f.bridge.renameChat(id,'Changed title'), /disk full|histórico/); assert.equal(f.bridge.findChat(id).title,originalTitle);
  await assert.rejects(f.bridge.deleteChat(id), /disk full|histórico/);
  assert.equal(f.bridge.activeId, id); assert.ok(f.bridge.chats.some(c => c.id === id)); assert.equal(f.bridge.ignored.has('kept'), false); assert.equal(f.bridge.drafts.state()[id].text, 'draft');
  f.storage.write = write; await f.bridge.deleteChat(id); await f.bridge.refresh(); assert.ok(!f.bridge.chats.some(c => c.id === id));
});

test('dictation never submits and clears Web text only after the exact durable copy; foreign or pending chats are refused', async t => {
  const f = await fixture(); t.after(() => f.bridge.close()); const chatId = f.chat.id;
  await f.bridge.drafts.save(chatId, {text:'Initial ',attachments:[],revision:1});
  await assert.rejects(f.bridge.prepareAudioDraft({chatId,revision:0}), /mudou/);
  await f.bridge.prepareAudioDraft({chatId,revision:1}); assert.equal(f.page.draft,'Initial '); assert.equal(f.submits,0);
  f.page.draft = 'Initial spoken words'; const value = await f.bridge.webDraft(chatId);
  await assert.rejects(f.bridge.consumeWebDraft({chatId,revision:1,text:value.text}), /Salve/); assert.equal(f.page.draft,value.text);
  await f.bridge.drafts.save(chatId, {text:value.text,attachments:[],revision:2});
  await assert.rejects(f.bridge.consumeWebDraft({chatId,revision:1,text:value.text}), /Salve/);
  await f.bridge.consumeWebDraft({chatId,revision:2,text:value.text}); assert.equal(f.page.draft,''); assert.equal(f.bridge.drafts.state()[chatId].text,value.text); assert.equal(f.submits,0);
  f.page.url = 'https://chatgpt.com/c/foreign'; f.page.conversationId = 'foreign'; await assert.rejects(f.bridge.webDraft(chatId), /correspondente/);
  f.page.url = 'https://chatgpt.com/'; f.page.conversationId = null; f.bridge.findChat(chatId).delivery = {status:'uncertain'}; await assert.rejects(f.bridge.webDraft(chatId), /pendente/); await assert.rejects(f.bridge.deleteChat(chatId), /pendente/);
});


test('confirmed Web deletion can finish local cleanup after disk failure without another remote click or navigation', async t => {
  const f = await fixture(); t.after(() => f.bridge.close());
  f.page.url='https://chatgpt.com/c/deleted';f.page.conversationId='deleted';f.page.turns=[{id:'d-u',role:'user',text:'delete me'}];await f.bridge.refresh();const id=f.bridge.activeId;
  let remoteCalls=0;f.bridge.chatDeletion.remove=async()=>{remoteCalls++;await f.bridge.chatDeletion.save({webId:'deleted',status:'confirmed'});f.page.url='https://chatgpt.com/';f.page.conversationId=null;};
  const write=f.storage.write;f.storage.write=async(key,value)=>{if(key==='web-chats')throw new Error('disk full');return write(key,value);};
  await assert.rejects(f.bridge.deleteChat(id,{scope:'web'}),/disk full|histórico/);assert.ok(f.bridge.chats.some(c=>c.id===id));assert.equal(remoteCalls,1);
  f.storage.write=write;await f.bridge.deleteChat(id,{scope:'web'});assert.ok(!f.bridge.chats.some(c=>c.id===id));assert.equal(remoteCalls,1);assert.equal(f.page.url,'https://chatgpt.com/');
});
