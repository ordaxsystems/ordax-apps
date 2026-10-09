import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createWebControls, registerWebControls, publicChatURL } = createRequire(import.meta.url)('../native/web-controls.cjs');

function fixture(url = 'https://chatgpt.com/') {
  let current = url, ready = false, busy = false; const loads = [], bounds = [], external = [], events = [];
  const frame = { url: 'http://127.0.0.1:45000/' };
  const window = { getContentSize: () => [1500, 900], show() {}, focus() {}, webContents: { mainFrame: frame, focus() {}, send: (...args) => events.push(args) } };
  const surface = { setBounds: value => bounds.push(value), webContents: { getURL: () => current, focus() {}, reload: () => loads.push('reload'), loadURL: async value => { loads.push(value); current = value; } } };
  const controls = createWebControls({ window, surface, isReady: () => ready, isBusy: () => busy, openExternal: async value => external.push(value) });
  return { controls, window, frame, surface, loads, bounds, external, events, ready: value => { ready = value; }, busy: value => { busy = value; } };
}
test('Entrar opens the public login in the same Web surface and expands it', async () => {
  const f = fixture(), original = f.surface.webContents;
  assert.deepEqual(await f.controls.login(), { embedded: true, expanded: true, mode: 'web', ratio: 0.6, pluginSetup: false });
  assert.deepEqual(f.loads, ['https://chatgpt.com/auth/login']); assert.equal(f.surface.webContents, original);
  assert.deepEqual(f.bounds.at(-1), { x: 0, y: 64, width: 1500, height: 804 });
});
test('an existing Google or ChatGPT login flow is preserved when Entrar is clicked', async () => {
  for (const url of ['https://accounts.google.com/v3/signin/identifier?state=test', 'https://auth.openai.com/log-in', 'https://chatgpt.com/auth/login']) {
    const f = fixture(url); await f.controls.login(); assert.equal(f.loads.length, 0); assert.equal(f.controls.state().expanded, true);
  }
});
test('Ampliar and Voltar change actual bounds without navigating or replacing the session', () => {
  const f = fixture('https://chatgpt.com/c/example'); f.controls.expand(); f.controls.collapse();
  assert.equal(f.bounds[0].x, 0); assert.equal(f.bounds[1].x, 900); assert.equal(f.bounds[1].width, 600);
  assert.equal(f.loads.length, 0); assert.equal(f.events.at(-1)[1].expanded, false);
});
test('browser button opens the public conversation URL and never passes an OAuth callback', async () => {
  const f = fixture('https://chatgpt.com/c/example?secret=ignored#ignored'); await f.controls.browser();
  assert.deepEqual(f.external, ['https://chatgpt.com/c/example']);
  assert.equal(publicChatURL('https://accounts.google.com/signin?state=private'), 'https://chatgpt.com/');
  assert.equal(publicChatURL('javascript:alert(1)'), 'https://chatgpt.com/');
});

test('external login opens the browser session without replacing the internal conversation', async () => {
  const f = fixture('https://chatgpt.com/c/existing'); f.ready(true); f.busy(true);
  assert.deepEqual(await f.controls.browserLogin(), { opened: true });
  assert.deepEqual(f.external, ['https://chatgpt.com/']);
  assert.equal(f.surface.webContents.getURL(), 'https://chatgpt.com/c/existing');
  assert.equal(f.loads.length, 0); assert.equal(f.bounds.length, 0);
});
test('native controls reject remote, child-frame and wrong-URL IPC senders', () => {
  const f = fixture(), handlers = new Map();
  const cleanup = registerWebControls({ handle: (name, action) => handlers.set(name, action), removeHandler: name => handlers.delete(name) }, { window: f.window, origin: 'http://127.0.0.1:45000', controls: f.controls });
  for (const action of handlers.values()) {
    assert.throws(() => action({ sender: {}, senderFrame: f.frame }), /Untrusted/);
    assert.throws(() => action({ sender: f.window.webContents, senderFrame: { url: f.frame.url } }), /Untrusted/);
    f.frame.url = 'https://chatgpt.com/'; assert.throws(() => action({ sender: f.window.webContents, senderFrame: f.frame }), /Untrusted/);
    f.frame.url = 'http://127.0.0.1:45000/';
  }
  assert.equal(handlers.get('assistant-web:expand')({ sender: f.window.webContents, senderFrame: f.frame }).expanded, true);
  cleanup(); assert.equal(handlers.size, 0);
});
test('login and reload wait for the current response, while expanding preserves it', async () => {
  const f = fixture(); f.busy(true); await assert.rejects(f.controls.login(), /Pare a resposta/); assert.throws(f.controls.reload, /Pare a resposta/);
  f.controls.expand(); assert.equal(f.loads.length, 0); f.busy(false); f.ready(true); await f.controls.login(); assert.equal(f.loads.length, 0);
});

test('conversation-only mode keeps the same live page and rejects malformed presentation inputs', async () => {
  const f = fixture('https://chatgpt.com/c/existing'); f.busy(true);
  const visibility = []; f.surface.setVisible = value => visibility.push(value);
  await f.controls.presentation({ mode: 'conversation', ratio: 0.7 }); assert.equal(visibility.at(-1), false); assert.equal(f.loads.length, 0);
  await f.controls.presentation({ mode: 'split', ratio: 0.7 }); assert.equal(visibility.at(-1), true); assert.equal(f.bounds.at(-1).x, 1050);
  for (const value of [null, { mode: 'split', ratio: NaN }, { mode: 'split', ratio: 0.99 }, { mode: 'web', ratio: 0.6, pluginSetup: false }]) await assert.rejects(f.controls.presentation(value), /inválida/);
  assert.equal(f.surface.webContents.getURL(), 'https://chatgpt.com/c/existing');
});
test('user-selected links open externally, with executable and credential-bearing URLs rejected', async () => {
  const f = fixture(); await f.controls.openLink('https://example.com/docs?q=1'); assert.deepEqual(f.external, ['https://example.com/docs?q=1']);
  for (const url of ['javascript:alert(1)', 'file:///C:/example.exe', 'https://user:password@example.com/']) await assert.rejects(f.controls.openLink(url), /inválido/);
  assert.equal(f.external.length, 1);
});

test('model and upload controls use fixed native page actions and wait for an idle authenticated session', async () => {
  const f = fixture('https://chatgpt.com/c/existing'), actions = [];
  f.surface.webContents.executeJavaScript = async script => { actions.push(script); return { opened: true }; };
  await assert.rejects(f.controls.modelPicker(), /Conecte/); f.ready(true);
  await f.controls.modelPicker(); assert.ok(actions[0].includes('return (function openModelPicker')); assert.equal(f.controls.state().expanded, true);
  f.controls.collapse(); await f.controls.attachmentPicker(); assert.ok(actions[1].includes('return (function openAttachmentPicker'));
  f.busy(true); await assert.rejects(f.controls.modelPicker(), /Aguarde/); await assert.rejects(f.controls.attachmentPicker(), /Aguarde/); assert.equal(actions.length, 2);
});
test('temporary expansion restores conversation-only presentation and malformed saved preferences are tolerated', async () => {
  const f = fixture(); await f.controls.presentation({ mode: 'conversation', ratio: 0.65 }); f.controls.expand(); f.controls.collapse();
  assert.equal(f.controls.state().mode, 'conversation'); assert.equal(f.controls.state().ratio, 0.65);
  const controls = createWebControls({ window: f.window, surface: f.surface, preferences: null }); assert.equal(controls.state().ratio, 0.6);
});


test('plugin setup navigates the existing right pane, restores its conversation and blocks navigation during a response', async () => {
  const f=fixture('https://chatgpt.com/c/existing?ignored=1'), original=f.surface.webContents;
  f.busy(true);await assert.rejects(f.controls.pluginSetup(),/Aguarde/);assert.equal(f.loads.length,0);f.busy(false);
  await f.controls.presentation({mode:'conversation',ratio:0.65});await f.controls.pluginSetup();
  assert.equal(f.surface.webContents,original);assert.equal(f.controls.state().pluginSetup,true);assert.equal(f.controls.state().expanded,false);
  assert.equal(f.controls.state().mode,'split');assert.equal(f.bounds.at(-1).x,975);
  assert.deepEqual(f.loads,['https://chatgpt.com/plugins']);await f.controls.pluginSetup();assert.equal(f.loads.length,1);
  await assert.rejects(f.controls.modelPicker(),/Volte/);
  await f.controls.pluginReturn();assert.equal(f.loads.at(-1),'https://chatgpt.com/c/existing');assert.equal(f.controls.state().pluginSetup,false);
});

test('concurrent plugin requests share a load and a network failure allows a new explicit attempt', async () => {
  const f=fixture('https://chatgpt.com/c/existing');let finish,fail=true,count=0;
  f.surface.webContents.loadURL=()=>{count++;return new Promise((resolve,reject)=>{finish=()=>fail?reject(new Error('offline')):resolve();});};
  const a=f.controls.pluginSetup(),b=f.controls.pluginSetup(),outcomes=Promise.allSettled([a,b]);await Promise.resolve();finish();
  assert.deepEqual((await outcomes).map(r=>r.status),['rejected','rejected']);assert.equal(count,1);
  fail=false;const next=f.controls.pluginSetup();await Promise.resolve();finish();await next;assert.equal(count,2);
  await f.controls.pluginSetup();assert.equal(count,2);
});

test('plugin OAuth redirects are preserved and returning cancels a queued setup navigation', async () => {
  const f=fixture('https://chatgpt.com/c/existing');let count=0;
  f.surface.webContents.getURL=()=> 'https://eobcxuyvhkvdmkbaihwh.supabase.co/auth/v1/oauth/authorize';
  f.surface.webContents.loadURL=async()=>{count++;throw Object.assign(new Error('redirect'),{code:'ERR_ABORTED'});};
  await f.controls.pluginSetup();await f.controls.pluginSetup();assert.equal(count,1);
  const g=fixture('https://chatgpt.com/c/existing');const open=g.controls.pluginSetup();await g.controls.pluginReturn();await open;
  assert.deepEqual(g.loads,['https://chatgpt.com/c/existing']);assert.equal(g.controls.state().pluginSetup,false);
});

test('a failed return retains the return control and retries the original conversation', async () => {
  const f=fixture('https://chatgpt.com/c/existing');await f.controls.pluginSetup();const original=f.surface.webContents.loadURL;
  f.surface.webContents.loadURL=async()=>{throw new Error('offline');};await assert.rejects(f.controls.pluginReturn(),/offline/);
  assert.equal(f.controls.state().pluginSetup,true);f.surface.webContents.loadURL=original;await f.controls.pluginReturn();
  assert.equal(f.surface.webContents.getURL(),'https://chatgpt.com/c/existing');
});


test('audio opens only fixed Web controls; active capture cannot be hidden or replaced until it ends', async () => {
  const f = fixture('https://chatgpt.com/c/voice'); f.ready(true); let clicks=0;
  f.surface.webContents.executeJavaScript = async code => { assert.ok(code.includes('function audioControl')); clicks++; return {opened:true}; };
  await assert.rejects(f.controls.audio('camera'), /inválido/); assert.equal(clicks,0);
  await f.controls.audio('voice'); assert.equal(clicks,1); assert.equal(f.controls.state().expanded,true);
  assert.throws(f.controls.collapse,/Encerre/); assert.throws(f.controls.reload,/áudio/); await assert.rejects(f.controls.login(),/áudio/); await assert.rejects(f.controls.pluginSetup(),/áudio/); await assert.rejects(f.controls.presentation({mode:'split',ratio:0.6}),/áudio/); await assert.rejects(f.controls.audio('voice'),/áudio/); assert.equal(clicks,1);
  await f.controls.audioEnd(); assert.deepEqual(f.loads,['https://chatgpt.com/c/voice']); assert.equal(f.controls.state().expanded,false);
});


test('reloading or losing the Studio renderer terminates the audio page without recording in a hidden view', async () => {
  const f=fixture('https://chatgpt.com/c/audio');f.ready(true);const events=new Map();f.window.webContents.on=(name,action)=>events.set(name,action);let revoked=0;
  f.surface.webContents.executeJavaScript=async()=>({opened:true});
  const controls=createWebControls({window:f.window,surface:f.surface,isReady:()=>true,openExternal:async()=>{},audioPermission:{arm(){},revoke(){revoked++;}}});
  await controls.audio('voice');events.get('did-start-navigation')({},'http://localhost/',false,true);await controls.audioEnd();assert.equal(controls.state().expanded,false);assert.equal(revoked>0,true);assert.equal(f.loads.length,1);
  await controls.audio('voice');events.get('render-process-gone')();await controls.audioEnd();assert.equal(f.loads.length,2);assert.equal(controls.state().expanded,false);
});
