'use strict';
// Deterministic integration test, isolated from the production profile and the network.
const { app, BrowserWindow, WebContentsView, session, ipcMain } = require('electron');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { scriptFor } = require('../native/web-dom.cjs');
const { surfaceBounds } = require('../native/policy.cjs');
const { createWebControls, registerWebControls } = require('../native/web-controls.cjs');
const { createPluginConnection, PLUGINS_URL, MCP_URL } = require('../native/plugin-connection.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function capture(contents) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await contents.capturePage(); }
    catch (error) { if (!String(error.message).includes('UnknownVizError') || attempt === 2) throw error; await pause(250); }
  }
}
app.setPath('userData',path.join(__dirname,'../.data/native-fixture-profile-'+randomUUID()));
const fixture = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>TESTE LOCAL · sem conta ChatGPT</title>
<style>body{background:#171717;color:white;font:16px system-ui;padding:24px}form{position:fixed;bottom:28px;left:24px;right:24px}#prompt-textarea{min-height:40px;border:1px solid #777;padding:12px}.markdown{white-space:normal}button{padding:10px}</style>
<button data-testid="model-switcher-dropdown-button" onclick="document.body.dataset.modelOpened='true'">Modelo simulado · teste local</button><button type="button" data-testid="composer-plus-btn" onclick="document.body.dataset.attachOpened='true'">Arquivos</button><main id="turns"></main>
<form data-chatgpt-composer><div role="tablist" aria-label="Conversation mode"><button type="button" role="tab" aria-selected="false" onclick="this.setAttribute('aria-selected','true');this.nextElementSibling.setAttribute('aria-selected','false')">Chat</button><button type="button" role="tab" aria-selected="true" onclick="this.setAttribute('aria-selected','true');this.previousElementSibling.setAttribute('aria-selected','false')">Work</button></div><div id="prompt-textarea" contenteditable="true" role="textbox"></div><button type="submit" data-testid="send-button">Enviar</button><button type="button" data-testid="stop-button" hidden>Parar</button></form>
<script>
let sends=0; const editor=document.getElementById('prompt-textarea'), turns=document.getElementById('turns'), stop=document.querySelector('[data-testid="stop-button"]');
document.querySelector('form').addEventListener('submit', e=>{
 e.preventDefault(); document.body.dataset.submits=String(++sends); const key='fixture-'+sends;
 const user=document.createElement('article'); user.dataset.testid='conversation-turn-'+sends*2; user.dataset.turnId='user-'+key; user.dataset.turn='user';
 const bubble=document.createElement('div'); bubble.dataset.messageAuthorRole='user'; bubble.textContent=editor.innerText.trim(); user.append(bubble); turns.append(user);
 editor.innerHTML=''; history.replaceState(null,'','/c/fixture'); stop.hidden=false;
 const answer=document.createElement('article'); answer.dataset.testid='conversation-turn-'+(sends*2+1); answer.dataset.turnId='assistant-'+key; answer.dataset.turn='assistant';
 const status=document.createElement('button'); status.dataset.testid='cot-header'; status.textContent='Thinking…'; answer.append(status);
 const hidden=document.createElement('div'); hidden.hidden=true; hidden.dataset.testid='cot-body'; hidden.textContent='Não deve ser lido'; answer.append(hidden);
 const content=document.createElement('div'); content.dataset.messageAuthorRole='assistant'; content.innerHTML='<div class="markdown"></div>'; answer.append(content); turns.append(answer);
 window.advanceFixture=phase=>{
  if(phase==='search') status.textContent='Pesquisando na Web';
  if(phase==='tool') status.textContent='Executando análise';
  if(phase==='response'){status.remove();content.innerHTML='<div class="markdown"><p>Resposta parcial</p></div>';}
  if(phase==='done'){content.innerHTML='<div class="markdown"><p>Resposta completa sincronizada.</p><pre><code class="language-python">print("teste")</code></pre><table><tr><th>Etapa</th><th>Estado</th></tr><tr><td>Teste</td><td>Concluído</td></tr></table><p><a href="https://example.com/docs">Fonte do teste</a></p></div>'; const copy=document.createElement('button'); copy.dataset.testid='copy-turn-action-button'; copy.textContent='Copiar'; answer.append(copy); stop.hidden=true;}
 };
});
stop.addEventListener('click',()=>{stop.hidden=true});
</script></html>`;

app.whenReady().then(async () => {
  let host, bridge, window, runtime;
  try {
    const { WebBridge } = await import('../native/web-bridge.mjs');
    const { createWebServer } = await import('../web-server.mjs');
    const { ProductRuntime } = await import('../native/product-runtime.mjs');
    let authenticated = false; const browserOpened = [];
    const isolated = session.fromPartition('ordax-assistant-test-' + randomUUID());
    await isolated.protocol.handle('https', req => {
      const url = new URL(req.url);
      const html = url.pathname === '/plugins' ? '<!doctype html><meta charset="utf-8"><title>Plugins · teste local</title><dialog open><h1>Criar servidor MCP personalizado</h1><label for="name">Nome</label><input id="name" placeholder="Nome"><label for="description">Descrição</label><textarea id="description"></textarea><label for="url">URL do servidor</label><input id="url" type="url"><select><option>OAuth</option></select><input type="checkbox" id="consent"><button id="create">Criar</button></dialog>' : url.pathname === '/auth/login' ? '<!doctype html><title>Login simulado</title><h1>Login simulado</h1><button>Entrar</button>' : authenticated ? fixture : fixture.replace('<main id="turns">', '<button data-testid="login-button">Entrar</button><main id="turns">');
      return new Response(url.hostname === 'chatgpt.com' ? html : 'Network disabled in tests', { status: url.hostname === 'chatgpt.com' ? 200 : 403, headers: { 'Content-Type': 'text/html' } });
    });
    window = new BrowserWindow({ show: false, width: 1550, height: 900, webPreferences: { preload: path.join(__dirname, '../native/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, details) => { if (details?.level === 'error') console.error('Fixture UI:', details.message); });
    const surface = new WebContentsView({ webPreferences: { session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    window.contentView.addChildView(surface); const [width,height]=window.getContentSize(); surface.setBounds(surfaceBounds(width,height));
    const disk = {}, storage = { read: async (key, fallback) => structuredClone(disk[key] || fallback), write: async (key,value) => { disk[key] = structuredClone(value); } };
    let fileContent = 'print("original")\n', remoteSequence = 0, simulateConflict = false, deviceOnline = true;
    const remoteCalls = [], remoteActions = new Map(), digest = text => require('node:crypto').createHash('sha256').update(text).digest('hex');
    const fixtureProjects = [{ slug: 'fixture-project', name: 'Projeto de teste' }];
    runtime = new ProductRuntime({ storage, interval: 100, env: { ORDAX_PRODUCT_ACCESS_TOKEN: 'fixture-token-only', ORDAX_PRODUCT_CONTROL_PLANE_URL: 'https://runtime.fixture.invalid' }, fetcher: async (url, options) => {
      const route = new URL(url).pathname; let data;
      if (route.endsWith('/session')) data = { session: { subject_id: 'fixture-subject' } };
      else if (route.endsWith('/targets')) data = { targets: [{ device_id: 'fixture-device', device_name: 'Dispositivo de teste', online: deviceOnline, last_seen_at: '2026-10-09T12:00:00Z' }] };
      else if (options.method === 'POST') {
        const body = JSON.parse(options.body), request = 'fixture-request-' + ++remoteSequence; remoteCalls.push(body);
        let result = { ok: true, data: {} };
        if (body.action === 'projects.list') result.data = { projects: [...fixtureProjects], default_project: 'fixture-project' };
        if (['workspace.project_create','workspace.bind_project'].includes(body.action)) { fixtureProjects.push({ slug: body.arguments.slug, name: body.arguments.name || body.arguments.slug }); result.data = { project: body.arguments.slug }; }
        if (body.action === 'workspace.directory_list') result.data = { entries: [{ kind: 'file', relative_path: 'src/main.py' }] };
        if (body.action === 'workspace.text_read') result.data = { relative_path: 'src/main.py', sha256: digest(fileContent), content: fileContent, line_count: 1, end_line: 1 };
        if (body.action === 'workspace.text_write') {
          if (simulateConflict || body.arguments.expected_sha256 !== digest(fileContent)) result = { ok: false, summary: 'O arquivo mudou; gravação recusada.' };
          else { fileContent = body.arguments.content; result.data = { sha256: digest(fileContent) }; }
        }
        if (body.action === 'terminal.exec') result.data = { stdout: 'TESTE LOCAL: comando simulado', exit_code: 0 };
        if (body.action === 'git.status') result.data = { branch: 'main', dirty: true, entries: [{ path: 'src/main.py', status: 'M' }] };
        if (body.action === 'git.diff') result.data = { diff: '+<script>unsafe()</script>\n' };
        if (body.action === 'project.search_text') result.data = { matches: [{ path: 'src/main.py', line: 1, text: 'studio-search-result' }] };
        if (body.action === 'project.preview_status') result.data = { mode: 'web', runtime: { state: 'stopped' } };
        if (body.action === 'agent.project_briefing') result.data = { summary: 'studio-project-context' };
        if (body.action === 'continuity.get') result.data = { project: 'fixture-project', state: { summary: 'studio-existing-state', completed: ['foundation'], blockers: ['review'], changed_paths: ['src/main.py'] } };
        if (body.action === 'continuity.update') result.data = { project: 'fixture-project', state: { ...body.arguments } };
        remoteActions.set(request, { request_id: request, action: body.action, project: body.project ?? null, status: 'succeeded', result }); data = { request_id: request };
      } else data = { action: remoteActions.get(route.split('/').at(-1)) };
      return Response.json({ ok: true, ...data });
    } }); await runtime.init();
    const pluginIssuer = 'https://eobcxuyvhkvdmkbaihwh.supabase.co/auth/v1';
    const plugin = createPluginConnection({ openExternal: async url => browserOpened.push(url), fetcher: async url => {
      if(String(url).endsWith('oauth-protected-resource')) return Response.json({ resource: MCP_URL, authorization_servers: [pluginIssuer], scopes_supported: ['openid', 'email', 'offline_access'] });
      if(String(url).endsWith('oauth-authorization-server')) return Response.json({ issuer: pluginIssuer, authorization_endpoint: pluginIssuer+'/oauth/authorize', token_endpoint: pluginIssuer+'/oauth/token', registration_endpoint: pluginIssuer+'/oauth/clients/register', code_challenge_methods_supported: ['S256'] });
      return new Response(null, { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource', MCP_URL)}"` } });
    } });
    const controls = createWebControls({ window, surface, plugin, resumeURL: () => bridge.resumeURL(), isReady: () => Boolean(bridge?.page?.ready), isBusy: () => Boolean(bridge?.run || bridge?.sending || bridge?.page?.busy), openExternal: async url => browserOpened.push(url) });
    bridge = new WebBridge({ surface, storage, openLogin: controls.login, setupActive: () => controls.state().pluginSetup, interval: 100 }); await bridge.init();
    const chat = await bridge.createChat();
    const realState = bridge.state.bind(bridge);
    let failInitialState = true;
    bridge.state = (...args) => { if (failInitialState) { failInitialState = false; return null; } return realState(...args); };
    let localProbeCount = 0;
    host = await createWebServer({ bridge, runtime, observeInstalled: async () => {
      localProbeCount++;
      return { schema: 'ordax.studio-local-runtime-observation/1',
        observed: true, authorization: 'not-established', canExecute: false,
        reason: 'loopback-response', version: '0.4.5', state: 'local-ready' };
    } }); registerWebControls(ipcMain, { window, origin: host.origin, controls });
    ipcMain.handle('studio-product:availability', event => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
          || event.senderFrame.url !== host.origin + '/src/index.html') throw new Error('Untrusted Studio account fixture frame');
      return false; // The test runner has no installed Product account host.
    });
    await window.loadURL(host.origin + '/src/index.html');
    for (let i = 0; i < 50; i++) { if (await window.webContents.executeJavaScript('document.getElementById("hostAvailability").dataset.state === "unavailable"')) break; await pause(50); }
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("hostAvailability").dataset.state'), 'unavailable');
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("newChat").disabled && document.getElementById("send").disabled && document.getElementById("welcomeConnect").disabled'), true);
    await window.webContents.executeJavaScript('document.getElementById("hostRetry").click(); document.getElementById("hostRetry").click()');
    for (let i = 0; i < 50; i++) { if (await window.webContents.executeJavaScript('document.getElementById("hostAvailability").hidden')) break; await pause(50); }
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("hostAvailability").hidden'), true);
    assert.equal(bridge.chats.length, 1); assert.equal(bridge.chats[0].id, chat.id);
    console.log('PASS BOOT: resposta incompatível bloqueia ações; tentativa explícita recupera o mesmo host sem criar conversa.');
    for (let i = 0; i < 50 && !bridge.page; i++) { await bridge.refresh(); await pause(100); }
    assert.equal(bridge.page?.ready, false);
    await window.webContents.executeJavaScript('document.getElementById("welcomeBrowser").click()');
    for (let i = 0; i < 30 && !browserOpened.length; i++) await pause(50);
    assert.deepEqual(browserOpened.splice(0), ['https://chatgpt.com/']);
    assert.equal(bridge.page?.ready, false); assert.equal(controls.state().expanded, false);
    assert.match(await window.webContents.executeJavaScript('document.getElementById("notice").textContent'), /separado/);
    console.log('PASS: Entrar pelo navegador abre a sessão externa sem marcar a sessão interna como conectada.');
    await window.webContents.executeJavaScript('document.getElementById("welcomeConnect").click()');
    for (let i = 0; i < 50; i++) { if (surface.webContents.getURL().endsWith('/auth/login') && !surface.webContents.isLoading() && await window.webContents.executeJavaScript('document.body.classList.contains("web-expanded")')) break; await pause(100); }
    assert.equal(surface.webContents.getURL(), 'https://chatgpt.com/auth/login'); assert.equal(surface.getBounds().x, 0);
    assert.equal(await window.webContents.executeJavaScript('document.body.classList.contains("web-expanded")'), true);
    authenticated = true; await surface.webContents.loadURL('https://chatgpt.com/');
    for (let i = 0; i < 50 && !bridge.page?.ready; i++) { await bridge.refresh(); await pause(100); }
    assert.equal(bridge.page?.ready, true, bridge.issue || 'Fixture did not become ready');
    for (let i = 0; i < 50 && controls.state().expanded; i++) await pause(100);
    assert.equal(controls.state().expanded, false); assert.equal(surface.getBounds().x, Math.floor(width * 0.6));
    console.log('PASS: botão Entrar → login ampliado na mesma sessão → retorno à conversa após autenticação simulada.');
    for(let i=0;i<50;i++){ if(await window.webContents.executeJavaScript('document.getElementById("model").value === "chatgpt-web"')) break; await pause(100); }
    await window.webContents.executeJavaScript('document.getElementById("chooseModel").click()');
    for(let i=0;i<30;i++){if(await surface.webContents.executeJavaScript('document.body.dataset.modelOpened === "true"')) break;await pause(50);}
    assert.equal(controls.state().expanded, true); assert.equal(await surface.webContents.executeJavaScript('document.body.dataset.modelOpened'), 'true');
    await window.webContents.executeJavaScript('document.getElementById("webClose").click()'); await pause(100);
    await window.webContents.executeJavaScript('document.getElementById("webAttach").click()');
    for(let i=0;i<30;i++){if(await surface.webContents.executeJavaScript('document.body.dataset.attachOpened === "true"')) break;await pause(50);}
    assert.equal(await surface.webContents.executeJavaScript('document.body.dataset.attachOpened'), 'true'); assert.equal(surface.webContents.getURL(), 'https://chatgpt.com/');
    await window.webContents.executeJavaScript('document.getElementById("webClose").click()'); await pause(100);
    console.log('PASS: Alterar modelo e Arquivos no Web abrem os controles nativos na mesma sessão, sem enviar mensagens.');
    const inspectMode = () => surface.webContents.executeJavaScript(scriptFor('inspect'));
    const modeError = async (script, pattern) => { const result=await surface.webContents.executeJavaScript('(() => { try { return ('+script+'); } catch(error) { return {error:error.message}; } })()'); assert.match(result.error,pattern); };
    assert.equal((await inspectMode()).conversationMode,'chat');
    await surface.webContents.executeJavaScript('document.querySelector("[role=tablist] button:last-child").click()');
    const workPage=await inspectMode();assert.equal(workPage.conversationMode,'work');
    await modeError(scriptFor('prepare','Não enviar',workPage),/Envio bloqueado/);
    await bridge.refresh();await pause(1000);
    assert.match(await window.webContents.executeJavaScript('document.getElementById("chatModeStatus").textContent'),/Work.*cota/);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("send").disabled'),true);
    await surface.webContents.executeJavaScript('document.querySelector("[role=tablist] button:first-child").click()');
    const chatPage=await inspectMode(),preparedMode=await surface.webContents.executeJavaScript(scriptFor('prepare','Teste de troca de modo',chatPage));
    await surface.webContents.executeJavaScript('document.querySelector("[role=tablist] button:last-child").click()');
    await modeError(scriptFor('submit','Teste de troca de modo',chatPage,preparedMode.draft),/modo mudou/);
    assert.equal(await surface.webContents.executeJavaScript('sends'),0);
    await surface.webContents.executeJavaScript('document.getElementById("prompt-textarea").innerHTML="";document.querySelector("[role=tablist] button:first-child").click();document.querySelector("[role=tablist]").hidden=true;const fake=document.createElement("div");fake.className="markdown";fake.innerHTML=`<div role="tablist"><button role="tab" aria-selected="true">Chat</button><button role="tab" aria-selected="false">Work</button></div>`;document.querySelector("main").append(fake)');
    assert.equal((await inspectMode()).conversationMode,'unknown');
    await modeError(scriptFor('prepare','Não enviar',await inspectMode()),/Envio bloqueado/);
    await surface.webContents.executeJavaScript('document.querySelector("main .markdown").remove();document.querySelector("form [role=tablist]").hidden=false;const effort=document.createElement("button");effort.id="effort-fixture";effort.type="button";effort.textContent="Médio";effort.setAttribute("aria-haspopup","menu");effort.onclick=()=>document.body.dataset.effortOpened="true";document.querySelector("form").append(effort)');
    assert.equal((await inspectMode()).effort,'Médio');
    await controls.effortPicker();assert.equal(await surface.webContents.executeJavaScript('document.body.dataset.effortOpened'),'true');assert.equal(await surface.webContents.executeJavaScript('sends'),0);
    await surface.webContents.executeJavaScript('document.getElementById("effort-fixture").remove()');controls.collapse();await bridge.refresh();await pause(1000);
    console.log('PASS MODE: Work bloqueia preparação/UI; Chat→Work bloqueia clique; texto da resposta não prova modo; raciocínio abre apenas o controle público observado, sem envio.');
    await window.webContents.executeJavaScript('window.fixtureFetch=window.fetch; window.fetch=(input,options={})=>{ if(input==="/api/respond"){window.fixtureStreamAbort=new AbortController();options={...options,signal:window.fixtureStreamAbort.signal}} return window.fixtureFetch(input,options) }; true');
    await window.webContents.executeJavaScript('document.getElementById("prompt").value="Teste de sincronização"; document.getElementById("prompt").dispatchEvent(new Event("input")); document.getElementById("composer").requestSubmit();');
    for(let i=0;i<50;i++){ if(await window.webContents.executeJavaScript('document.getElementById("runLabel").textContent === "Pensando"')) break; await pause(50); }
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("runLabel").textContent'), 'Pensando');
    const observed = await surface.webContents.executeJavaScript(scriptFor('inspect'));
    assert.equal(observed.progress, 'Thinking…'); assert.ok(!JSON.stringify(observed).includes('Não deve ser lido'));
    await window.webContents.executeJavaScript('document.getElementById("webToggle").click()');
    for (let i=0;i<30 && controls.state().mode !== 'conversation';i++) await pause(50);
    assert.equal(surface.getVisible(), false); assert.equal(surface.webContents.getURL(), 'https://chatgpt.com/c/fixture');
    for(let i=0;i<30;i++){ if(await window.webContents.executeJavaScript('document.body.classList.contains("conversation-only")')) break; await pause(50); }
    const preview = await capture(window.webContents); await fs.mkdir(path.join(__dirname,'../.data'),{recursive:true}); await fs.writeFile(path.join(__dirname,'../.data/activity-preview.png'),preview.toPNG());
    await window.webContents.executeJavaScript('window.testAnswerNode=document.querySelector(".message.assistant"); document.querySelector(".message-activity details").open=true');
    for (const [phase,label] of [['search','Pesquisando'],['tool','Usando ferramentas'],['response','Respondendo']]) {
      await surface.webContents.executeJavaScript('window.advanceFixture(' + JSON.stringify(phase) + ')');
      for(let i=0;i<60;i++){if(await window.webContents.executeJavaScript('document.getElementById("runLabel").textContent === ' + JSON.stringify(label))) break; await pause(50);}
      assert.equal(await window.webContents.executeJavaScript('document.getElementById("runLabel").textContent'),label);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector(".message.assistant") === window.testAnswerNode && document.querySelector(".message-activity details").open'),true);
    }
    await window.webContents.executeJavaScript('window.fixtureStreamAbort.abort()'); await pause(1200);
    assert.ok(bridge.run && !bridge.run.finished); assert.equal((await surface.webContents.executeJavaScript(scriptFor('inspect'))).busy, true);
    await surface.webContents.executeJavaScript('window.advanceFixture("done")');
    for(let i=0;i<100;i++){ if(chat.messages.at(-1)?.status === 'completed' && chat.messages.length === 2) break; await pause(100); }
    assert.equal(chat.messages.length, 2, await window.webContents.executeJavaScript('document.getElementById("notice").textContent')); assert.equal(chat.messages[0].text, 'Teste de sincronização');
    assert.equal(chat.messages[1].status, 'completed'); assert.match(chat.messages[1].text, /Resposta completa sincronizada/); assert.match(chat.messages[1].text, /```/);
    assert.deepEqual(chat.messages[1].activity.events.map(e=>e.kind), ['sending','waiting','thinking','searching','tool','responding','settling','completed']);
    assert.equal(chat.webId, 'fixture'); assert.equal(await surface.webContents.executeJavaScript('document.body.dataset.submits'), '1');
    await pause(1000);
    const left = await window.webContents.executeJavaScript('document.getElementById("messages").innerText');
    assert.match(left, /Teste de sincronização/); assert.match(left, /Resposta completa sincronizada/);
    assert.match(left, /Pensando|Concluído/);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("stop").hidden'), true);
    console.log('PASS: a conexão da interface cai durante a geração; o Web continua e a UI recupera a resposta pela mesma conversa, com exatamente um envio.');
    assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".message-content table").length'), 1);
    await window.webContents.executeJavaScript('document.querySelector(".message-activity details").open=true');
    const finalPreview = await window.webContents.capturePage(); await fs.writeFile(path.join(__dirname,'../.data/integration-preview.png'),finalPreview.toPNG());
    await window.webContents.executeJavaScript('document.querySelector(".message-content a").click()');
    for (let i=0;i<30 && !browserOpened.length;i++) await pause(50);
    assert.deepEqual(browserOpened.splice(0), ['https://example.com/docs']);
    console.log('PASS: estados Thinking → pesquisa → ferramenta → resposta → conclusão aparecem no app, inclusive com Web oculto; conteúdo oculto não é extraído.');
    await window.webContents.executeJavaScript('document.getElementById("webToggle").click()');
    for (let i=0;i<30 && controls.state().mode !== 'split';i++) await pause(50);
    assert.equal(surface.getVisible(), true);
    await window.webContents.executeJavaScript('document.getElementById("integrationInfo").click(); document.getElementById("splitRatio").value="70"; document.getElementById("splitRatio").dispatchEvent(new Event("change"));');
    for(let i=0;i<30 && controls.state().ratio!==0.7;i++) await pause(50);
    assert.equal(surface.getBounds().x, Math.floor(width*0.7));
    const dialogRect = await window.webContents.executeJavaScript('({right:document.getElementById("integrationDialog").getBoundingClientRect().right,width:innerWidth})');
    assert.ok(dialogRect.right <= Math.floor(width*0.7), `Native dialog escaped the Studio pane: ${JSON.stringify({ dialogRect, studioPaneEnd: Math.floor(width*0.7) })}`);
    await window.webContents.executeJavaScript('document.getElementById("splitRatio").value="60"; document.getElementById("splitRatio").dispatchEvent(new Event("change")); document.getElementById("integrationDialog").close()');
    for(let i=0;i<30 && controls.state().ratio!==0.6;i++) await pause(50);
    console.log('PASS: ocultar/mostrar Web e ajustar proporção preservam a conversa; o diálogo fica inteiramente na área do app.');
    console.log('PASS: interface própria → HTTP local → editor Web real → envio único → resposta parcial/final → interface própria.');
    await window.webContents.executeJavaScript('document.getElementById("webFocus").click()');
    for (let i = 0; i < 30 && !controls.state().expanded; i++) await pause(50);
    assert.equal(surface.getBounds().x, 0); assert.equal(surface.getBounds().width, width);
    await window.webContents.executeJavaScript('document.getElementById("webClose").click()');
    for (let i = 0; i < 30 && controls.state().expanded; i++) await pause(50);
    assert.equal(surface.getBounds().x, Math.floor(width * 0.6));
    await window.webContents.executeJavaScript('document.getElementById("webBrowser").click()');
    for (let i = 0; i < 30 && !browserOpened.length; i++) await pause(50);
    assert.deepEqual(browserOpened, ['https://chatgpt.com/c/fixture']);
    for (let i=0;i<100;i++){if(await window.webContents.executeJavaScript('!document.getElementById("connectBrowser").disabled')) break;await pause(50);}
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("connectBrowser").disabled'),false);
    await window.webContents.executeJavaScript('document.getElementById("accountButton").click(); document.getElementById("connectBrowser").click()');
    for (let i = 0; i < 30 && browserOpened.length < 2; i++) await pause(50);
    assert.deepEqual(browserOpened, ['https://chatgpt.com/c/fixture', 'https://chatgpt.com/']);
    assert.equal(surface.webContents.getURL(), 'https://chatgpt.com/c/fixture');
    // The native browser call may be observed before its IPC promise resolves.
    // Wait for the actual UI transition, not a fixed delay or a weaker assert.
    for (let attempt = 0; attempt < 100
      && await window.webContents.executeJavaScript('document.getElementById("accountDialog").open'); attempt++) {
      await pause(50);
    }
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("accountDialog").open'), false);
    console.log('PASS: botões Ampliar Web, Voltar à conversa e Abrir no navegador executam ações nativas via IPC.');

    chat.delivery.status='uncertain'; chat.delivery.fingerprint='0'.repeat(64); bridge.touch();
    for(let i=0;i<50;i++){if(await window.webContents.executeJavaScript('!document.getElementById("deliveryReview").hidden')) break;await pause(100);}
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("send").disabled'), true);
    await window.webContents.executeJavaScript('document.getElementById("reviewOpen").click()'); await pause(100); assert.equal(controls.state().expanded,true);
    await window.webContents.executeJavaScript('document.getElementById("webClose").click()'); await pause(100);
    await window.webContents.executeJavaScript('document.getElementById("reviewConfirm").click()');
    for(let i=0;i<30 && chat.delivery.status!=='reviewed';i++) await pause(50);
    assert.equal(chat.delivery.status,'reviewed'); assert.equal(await surface.webContents.executeJavaScript('document.body.dataset.submits'), '1');
    console.log('PASS: envio incerto bloqueia a UI, abre a conversa para conferência e só libera após revisão explícita, sem repetir envio.');

    await surface.webContents.executeJavaScript('document.querySelector("[data-turn=\\"user\\"]").removeAttribute("data-turn-id")');
    assert.match((await surface.webContents.executeJavaScript(scriptFor('inspect'))).identityError, /identidade estável/);
    await surface.webContents.executeJavaScript('document.querySelector("[data-turn=\\"user\\"]").setAttribute("data-turn-id","user-fixture-1")');
    await surface.webContents.executeJavaScript('const b=document.createElement("button"); b.dataset.testid="login-button"; b.textContent="Login"; document.body.append(b)');
    assert.equal((await surface.webContents.executeJavaScript(scriptFor('inspect'))).ready, false);
    console.log('PASS: identidade ausente e sessão desconectada bloqueiam o envio.');

    await surface.webContents.executeJavaScript('document.querySelector("[data-testid=\\"login-button\\"]").remove(); document.getElementById("turns").innerHTML=`<div data-turn-key="group-stable"><div data-user-message-bubble>Mensagem no Web</div><div data-conversation-role="assistant"><div class="markdown"><p>Resposta do Web</p></div><div class="turn-action-controls"><button>Copiar</button></div></div></div>`');
    const grouped = await surface.webContents.executeJavaScript(scriptFor('inspect'));
    assert.deepEqual(grouped.turns.map(t=>t.id), ['group:user:group-stable','group:assistant:group-stable']); assert.equal(grouped.turns[1].text, 'Resposta do Web'); assert.equal(grouped.turns[1].completedControl, true);
    console.log('PASS: renderer Web com data-turn-key preserva ambas as identidades e somente a resposta visível.');
    await surface.webContents.executeJavaScript('document.querySelector(".turn-action-controls button").textContent="Compartilhar"; const toast=document.createElement("div");toast.id="fixtureToast";toast.role="alert";toast.textContent="Copiado para a área de transferência";document.body.append(toast)');
    const nonTerminal=await surface.webContents.executeJavaScript(scriptFor('inspect')); assert.equal(nonTerminal.turns[1].completedControl,false);assert.equal(nonTerminal.alert,'');
    await surface.webContents.executeJavaScript('document.getElementById("fixtureToast").textContent="Você atingiu o limite de mensagens"');assert.match((await surface.webContents.executeJavaScript(scriptFor('inspect'))).alert,/limite/);
    await surface.webContents.executeJavaScript('document.getElementById("fixtureToast").remove();document.querySelector(".turn-action-controls button").textContent="Copiar"');
    console.log('PASS: Compartilhar não conclui uma resposta; toast de cópia não interrompe geração; aviso de limite é reconhecido.');
    await surface.webContents.executeJavaScript('document.getElementById("prompt-textarea").id="mobile-composer-prompt"');
    assert.equal((await surface.webContents.executeJavaScript(scriptFor('inspect'))).ready, true);
    await surface.webContents.executeJavaScript('const header=document.createElement("header"), login=document.createElement("button"); login.textContent="Entrar"; header.append(login); document.body.append(header)');
    assert.equal((await surface.webContents.executeJavaScript(scriptFor('inspect'))).ready, false);
    console.log('PASS: compositor móvel é reconhecido e sessão sem login não é confundida com conta conectada.');
    await surface.webContents.executeJavaScript('document.querySelector("header").remove()'); await bridge.refresh(); await pause(1000);
    await window.webContents.executeJavaScript('document.getElementById("prompt").value="Rascunho original";document.getElementById("prompt").dispatchEvent(new Event("input"));document.getElementById("newChat").click()');
    for(let i=0;i<50 && bridge.activeId===chat.id;i++)await pause(100);
    const nextId=bridge.activeId;assert.notEqual(nextId,chat.id);await pause(1000);
    await window.webContents.executeJavaScript('document.getElementById("prompt").value="Outro rascunho";document.getElementById("prompt").dispatchEvent(new Event("input"));document.querySelector(\'button[data-studio-page=recent]\').click();document.querySelector(\'[data-chat-id="' + chat.id + '"]\').click()');
    for(let i=0;i<50 && bridge.activeId!==chat.id;i++)await pause(100);await pause(1000);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("prompt").value'),'Rascunho original');
    console.log('PASS: trocar conversas preserva rascunhos separados na interface sem enviar o texto ao ChatGPT.');
    await pause(500); await window.webContents.reload();
    for(let i=0;i<50;i++){if(await window.webContents.executeJavaScript('document.getElementById("prompt").value==="Rascunho original"'))break;await pause(100);}
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("prompt").value'),'Rascunho original');
    assert.equal(bridge.drafts.state()[nextId].text,'Outro rascunho');
    console.log('PASS: recarregar a interface restaura os rascunhos persistentes de ambas as conversas sem envio.');
    const until = async code => { for(let i=0;i<100;i++){if(await window.webContents.executeJavaScript(code))return;await pause(50);}assert.fail('Condição da UI não alcançada: '+code); };
    const projectSubmitsBefore = await surface.webContents.executeJavaScript('document.body.dataset.submits || "0"');
    await window.webContents.executeJavaScript('document.getElementById("openProject").click()');
    await until('!document.getElementById("projectDialog").hidden && !document.getElementById("runtimeConnect").disabled');
    await until('document.getElementById("localRuntimeObservation").textContent.includes("NÃO confirma identidade")');
    const remoteCallsBeforeProbe = remoteCalls.length;
    await window.webContents.executeJavaScript('document.getElementById("localRuntimeCheck").click()');
    await until('!document.getElementById("localRuntimeCheck").disabled && document.getElementById("localRuntimeObservation").textContent.includes("NÃO confirma identidade")');
    assert.ok(localProbeCount >= 2);
    assert.equal(remoteCalls.length, remoteCallsBeforeProbe);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("runtimeState").textContent.includes("Plataforma conectada")'), false);
    console.log('PASS RUNTIME LOCAL: health responde sem autorizar Product, executar comandos ou alterar grants.');
    await window.webContents.executeJavaScript('document.getElementById("runtimeConnect").click()');
    await until('document.getElementById("runtimeProject").value==="fixture-project" && !document.getElementById("projectList").disabled');
    await window.webContents.executeJavaScript('document.getElementById("projectList").click()');
    await until('document.querySelectorAll("#projectFiles button").length===1 && !document.querySelector("#projectFiles button").disabled');
    await window.webContents.executeJavaScript('document.querySelector("#projectFiles button").click()');
    await until('document.getElementById("projectEditor").value.includes("original") && !document.getElementById("projectAttach").disabled');
    await window.webContents.executeJavaScript('document.getElementById("projectAttach").click()');
    await until('!!document.getElementById("projectDialog").hidden');
    assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".attachment-chip").length'),1);
    assert.equal(await surface.webContents.executeJavaScript('document.body.dataset.submits || "0"'),projectSubmitsBefore);
    console.log('PASS: UI de projeto → API local → contrato Product → lista e leitura → arquivo anexado à próxima mensagem, sem envio ao Web.');
    await window.webContents.executeJavaScript('document.getElementById("openProject").click(); document.getElementById("projectEditor").value=\'print("alterado")\\n\';document.getElementById("projectEditor").dispatchEvent(new Event("input"));document.getElementById("projectReview").click()');
    await until('!document.getElementById("projectReviewArea").hidden && !document.getElementById("projectApply").disabled');
    await until('!document.getElementById("projectDialog").hidden'); await pause(300);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("runtimeConnect").disabled && document.getElementById("runtimeDevice").disabled && document.getElementById("runtimeProject").disabled'),true);
    assert.match(await window.webContents.executeJavaScript('document.getElementById("projectDiff").textContent'), /original[\s\S]*alterado/);
    assert.equal(remoteCalls.filter(c=>c.action==='workspace.text_write').length,0);
    const projectPreview = await capture(window.webContents); await fs.writeFile(path.join(__dirname,'../.data/project-preview.png'),projectPreview.toPNG());
    await window.webContents.executeJavaScript('document.getElementById("projectApply").click()');
    await until('document.getElementById("projectEditor").value.includes("alterado") && !document.getElementById("projectAttach").disabled');
    assert.equal(remoteCalls.filter(c=>c.action==='workspace.text_write').length,1); assert.equal(fileContent,'print("alterado")\n');
    console.log('PASS: alteração mostra a prévia antes de aplicar; gravação contém o SHA-256 lido; uma gravação e releitura da versão final.');
    simulateConflict=true;
    await window.webContents.executeJavaScript('document.getElementById("projectEditor").value=\'print("conflito")\\n\';document.getElementById("projectEditor").dispatchEvent(new Event("input"));document.getElementById("projectReview").click();document.getElementById("projectApply").click()');
    await until('document.getElementById("projectOperations").textContent.includes("gravação recusada") && !document.getElementById("projectDiscard").disabled');
    assert.equal(fileContent,'print("alterado")\n'); assert.equal(await window.webContents.executeJavaScript('document.getElementById("projectEditor").value'),'print("conflito")\n');
    await window.webContents.executeJavaScript('document.getElementById("projectClose").click()');
    assert.equal(await window.webContents.executeJavaScript('!document.getElementById("projectDialog").hidden'),true);
    await window.webContents.executeJavaScript('document.getElementById("projectDiscard").click();document.getElementById("terminalArgv").value=\'["git","status","--short"]\';document.getElementById("terminalReview").click()');
    await until('!document.getElementById("terminalRun").disabled');
    assert.equal(remoteCalls.filter(c=>c.action==='terminal.exec').length,0);
    await window.webContents.executeJavaScript('document.getElementById("terminalRun").click()');
    await until('document.getElementById("projectOperations").textContent.includes("comando simulado")');
    assert.equal(remoteCalls.filter(c=>c.action==='terminal.exec').length,1); assert.equal(remoteCalls.at(-1).arguments.shell,false);
    assert.equal(await surface.webContents.executeJavaScript('document.body.dataset.submits || "0"'),projectSubmitsBefore);
    console.log('PASS: conflito mantém a edição e o arquivo original; terminal só é enviado após revisão explícita e usa shell=false, com resultado observado.');
    await until('!document.getElementById("studioGitStatus").disabled');
    await window.webContents.executeJavaScript('document.getElementById("studioTabGit").click();document.getElementById("studioGitStatus").click()');
    await until('document.getElementById("studioGitResult").textContent.includes("main") && !document.getElementById("studioGitDiff").disabled');
    await window.webContents.executeJavaScript('document.getElementById("studioGitDiff").click()');
    await until('document.getElementById("studioGitResult").textContent.includes("<script>") && !document.getElementById("studioGitDiff").disabled');
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("studioGitResult").querySelector("script")'),null);
    await window.webContents.executeJavaScript('document.getElementById("studioTabSearch").click();document.getElementById("studioSearchQuery").value="studio";document.getElementById("studioSearchRun").click()');
    await until('document.getElementById("studioSearchResult").textContent.includes("studio-search-result") && !document.getElementById("studioSearchRun").disabled');
    await window.webContents.executeJavaScript('document.getElementById("studioTabPreview").click();document.getElementById("studioPreviewStatus").click()');
    await until('document.getElementById("studioPreviewResult").textContent.includes("parado") && !document.getElementById("studioPreviewStatus").disabled');
    console.log('PASS: abas do Studio consultam Git, diff, busca e preview por ações tipadas; HTML no diff permanece texto, sem executar scripts.');
    await window.webContents.executeJavaScript('document.getElementById("studioTabContinuity").click();document.getElementById("studioBriefing").click()');
    await until('document.getElementById("studioContinuityResult").textContent.includes("studio-project-context") && !document.getElementById("studioBriefing").disabled');
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("studioContinuityReview").disabled'),true);
    await window.webContents.executeJavaScript('document.getElementById("studioContinuityRead").click()');
    await until('document.getElementById("studioContinuityResult").textContent.includes("studio-existing-state") && !document.getElementById("studioContinuityReview").disabled');
    await window.webContents.executeJavaScript('document.getElementById("studioSummary").value="Projeto revisado";document.getElementById("studioSummary").dispatchEvent(new Event("input"));document.getElementById("studioContinuityReview").click()');
    await until('!document.getElementById("studioContinuityReviewArea").hidden');
    assert.equal(remoteCalls.filter(c=>c.action==='continuity.update').length,0);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("runtimeProject").disabled'),true);
    await window.webContents.executeJavaScript('document.getElementById("studioNextAction").value="Testar alteração";document.getElementById("studioNextAction").dispatchEvent(new Event("input"))');
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("studioContinuityReviewArea").hidden'),true);
    await window.webContents.executeJavaScript('document.getElementById("studioContinuityReview").click();document.getElementById("studioContinuityApply").click()');
    await until('document.getElementById("studioSummary").value==="" && document.getElementById("studioContinuityResult").textContent.includes("Testar alteração")');
    assert.equal(remoteCalls.filter(c=>c.action==='continuity.update').length,1);
    assert.deepEqual(remoteCalls.filter(c=>c.action==='continuity.update')[0].arguments.completed,['foundation']);
    assert.deepEqual(remoteCalls.filter(c=>c.action==='continuity.update')[0].arguments.blockers,['review']);
    assert.deepEqual(remoteCalls.filter(c=>c.action==='continuity.update')[0].arguments.changed_paths,['src/main.py']);
    assert.equal(await surface.webContents.executeJavaScript('document.body.dataset.submits || "0"'),projectSubmitsBefore);
    await until('!document.getElementById("studioContinuityReview").disabled');
    await pause(150);
    await fs.writeFile(path.join(__dirname,'../.data/studio-workspace-preview.png'), (await capture(window.webContents)).toPNG());
    console.log('PASS: continuidade requer revisão atual, bloqueia troca de projeto com rascunho, salva uma única operação e mantém o ChatGPT sem envio.');
    assert.match(await window.webContents.executeJavaScript('document.getElementById("studioContextSource").textContent'), /Projeto fixture-project.*Recibo fixture-request/);
    const beforeActivityCalls = remoteCalls.length;
    await window.webContents.executeJavaScript('document.getElementById("openActivity").click()');
    await until('!document.getElementById("studioActivity").hidden && document.getElementById("studioTabActivity").getAttribute("aria-selected")==="true"');
    assert.match(await window.webContents.executeJavaScript('document.getElementById("projectOperations").textContent'), /Registro Runtime.*Projeto: fixture-project/s);
    await window.webContents.executeJavaScript('document.getElementById("activityRefresh").click();document.getElementById("openContext").click()');
    await until('!document.getElementById("studioContinuity").hidden');
    assert.equal(remoteCalls.length, beforeActivityCalls); assert.equal(await surface.webContents.executeJavaScript('document.body.dataset.submits || "0"'), projectSubmitsBefore);
    console.log('PASS: Atividade e Contexto abrem as abas com fonte/recibo/projeto; atualizar acompanhamento não envia outra ação nem mensagem GPT.');
    await window.webContents.executeJavaScript('document.getElementById("projectClose").click();document.getElementById("openPlugin").click();document.getElementById("pluginCheck").click()');
    await until('document.getElementById("pluginService").textContent.includes("Disponível")');
    await until('document.getElementById("pluginDialog").open && !!document.getElementById("projectDialog").hidden');
    assert.match(await window.webContents.executeJavaScript('document.getElementById("pluginConversation").textContent'), /não verificada/);
    assert.equal(await window.webContents.executeJavaScript('(()=>{const r=document.getElementById("pluginDialog").getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("dialog")?.id})()'), 'pluginDialog');
    await pause(400);
    await fs.writeFile(path.join(__dirname,'../.data/plugin-preview.png'), (await window.webContents.capturePage()).toPNG());
    const chatURL=surface.webContents.getURL(), originalSurface=surface.webContents, originalChat=bridge.activeId;
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("pluginScopes").value'), 'openid email offline_access');
    assert.match(await window.webContents.executeJavaScript('document.getElementById("pluginOAuthGuide").textContent'), /DCR/);
    await window.webContents.executeJavaScript('document.getElementById("pluginOpen").click()');
    for(let i=0;i<50;i++){if(surface.webContents.getURL()===PLUGINS_URL && !surface.webContents.isLoading())break;await pause(50);}
    assert.equal(surface.webContents.getURL(),PLUGINS_URL);assert.equal(surface.webContents,originalSurface);assert.equal(surface.webContents.session,isolated);
    assert.equal(BrowserWindow.getAllWindows().filter(w=>w!==window).length,0);assert.ok(surface.getBounds().x>0);
    const prefs=surface.webContents.getLastWebPreferences();assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.sandbox,true);assert.ok(!prefs.preload);
    await bridge.refresh();assert.equal(bridge.activeId,originalChat);assert.equal(bridge.page.ready,false);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("prompt").value'),'Rascunho original');
    await until('!document.getElementById("webReturnChat").hidden');
    assert.equal(await surface.webContents.executeJavaScript('document.getElementById("name").value'),'ORDAX Studio');
    assert.equal(await surface.webContents.executeJavaScript('document.getElementById("url").value'),MCP_URL);
    assert.equal(await surface.webContents.executeJavaScript('document.getElementById("consent").checked'),false);
    assert.equal((await controls.pluginPrepare()).requiresUserConsent,true);
    await surface.webContents.executeJavaScript('document.getElementById("name").value="Minha integração";document.getElementById("url").value="https://example.com/mcp"');
    assert.equal((await controls.pluginPrepare()).status,'manual');
    assert.equal(await surface.webContents.executeJavaScript('document.getElementById("url").value'),'https://example.com/mcp');
    await surface.webContents.executeJavaScript('document.getElementById("name").value="";document.getElementById("url").value="";document.querySelector("label[for=description]").textContent="Campo alterado"');
    assert.equal((await controls.pluginPrepare()).status,'manual');
    assert.equal(await surface.webContents.executeJavaScript('document.getElementById("name").value'),'');
    await surface.webContents.executeJavaScript('document.querySelector("label[for=description]").textContent="Description"');
    assert.equal((await controls.pluginPrepare()).status,'prepared');
    assert.equal(await surface.webContents.executeJavaScript('document.querySelector("select").value'),'OAuth');
    assert.equal(await surface.webContents.executeJavaScript('document.getElementById("consent").checked'),false);
    console.log('PASS: cadastro do plugin preserva campos do usuário; formulário alterado falha sem preencher parcialmente, OAuth e consentimento ficam intactos.');

    await window.webContents.executeJavaScript('document.getElementById("openPlugin").click();document.querySelector(".plugin-oauth").open=true;document.getElementById("pluginDialog").scrollTop=400');
    await pause(400);await fs.writeFile(path.join(__dirname,'../.data/plugin-setup-preview.png'),(await window.webContents.capturePage()).toPNG());
    await controls.pluginSetup();assert.equal(surface.webContents.getURL(),PLUGINS_URL);
    await window.webContents.executeJavaScript('document.getElementById("pluginReturn").click()');
    for(let i=0;i<50;i++){if(surface.webContents.getURL()===chatURL && !surface.webContents.isLoading())break;await pause(50);}
    assert.equal(surface.webContents.getURL(),chatURL);await bridge.refresh();assert.equal(bridge.page.ready,true);assert.equal(bridge.activeId,originalChat);
    await until('document.getElementById("webReturnChat").hidden && !document.getElementById("pluginTest").disabled');
    console.log('PASS: cadastro prepara nome/descrição/URL sem consentir ou instalar, na mesma sessão; guia OAuth verificado, rascunho e conversa preservados, sem janela adicional.');
    await window.webContents.executeJavaScript('document.getElementById("pluginTest").click()');
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("prompt").value'),'Rascunho original');
    assert.match(await window.webContents.executeJavaScript('document.getElementById("pluginDetails").textContent'), /rascunho/);
    await until('!document.getElementById("prompt").disabled && !document.getElementById("pluginTest").disabled');
    await window.webContents.executeJavaScript('document.querySelector(".attachment-chip button").click();document.getElementById("prompt").value="";document.getElementById("prompt").dispatchEvent(new Event("input"))');
    await until('!document.querySelector(".attachment-chip") && !document.getElementById("pluginTest").disabled');
    await window.webContents.executeJavaScript('document.getElementById("pluginTest").click()');
    await until('!document.getElementById("pluginDialog").open');
    assert.match(await window.webContents.executeJavaScript('document.getElementById("prompt").value'), /ordax_session e ordax_targets/);
    assert.equal(await surface.webContents.executeJavaScript('document.body.dataset.submits || "0"'),projectSubmitsBefore);
    console.log('PASS: teste do plugin protege rascunhos e prepara a consulta para revisão, sem consumir mensagem ou executar ferramenta.');
    await surface.webContents.executeJavaScript('const chip=document.createElement("button");chip.textContent="ORDAX Studio";document.querySelector("form").append(chip);const status=document.createElement("div");status.dataset.testid="tool-call-status";status.textContent="Capture desktop…";document.querySelector("main").append(status);document.querySelector("[data-testid=\\"stop-button\\"]").hidden=false');
    const pluginPage=await surface.webContents.executeJavaScript(scriptFor('inspect'));assert.equal(pluginPage.ordaxSelected,true);assert.ok(pluginPage.signals.some(s=>s.kind==='tool' && s.label==='Capture desktop…'));
    const { observedActivity }=await import('../native/activity.mjs');assert.equal(observedActivity(pluginPage).kind,'tool');
    console.log('PASS: seleção do plugin e rótulos públicos de ferramenta são observados no compositor, inclusive títulos sem prefixo Thinking/Using.');
    await surface.webContents.executeJavaScript('[...document.querySelectorAll("form button")].find(button=>button.textContent==="ORDAX Studio").textContent="ORDAX for ChatGPT"');
    assert.equal((await surface.webContents.executeJavaScript(scriptFor('inspect'))).ordaxSelected,true);
    await surface.webContents.executeJavaScript('document.querySelector("[data-testid=\\"stop-button\\"]").hidden=true');
    await bridge.refresh();
    await until('!document.getElementById("createConversationProject").disabled');
    // Legacy unbound groups remain readable; new user creation is tested below via Product.
    await bridge.selectConversationProject((await bridge.createProject({name:'Site da loja'})).id);
    await until('!document.getElementById("conversationProjectDialog").open && document.getElementById("projectScopeName").textContent==="Site da loja" && !document.getElementById("prompt").disabled');
    const projectA = bridge.projects.find(p=>p.name==='Site da loja').id;
    await window.webContents.executeJavaScript('document.getElementById("prompt").value="Rascunho da loja";document.getElementById("prompt").dispatchEvent(new Event("input"))');
    await pause(500); await bridge.selectConversationProject((await bridge.createProject({name:"Jogo"})).id);
    await until('document.getElementById("projectScopeName").textContent==="Jogo" && !document.getElementById("prompt").disabled');
    const projectB = bridge.projects.find(p=>p.name==='Jogo').id;
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("prompt").value'),'');
    await window.webContents.executeJavaScript('document.getElementById("prompt").value="Rascunho do jogo";document.getElementById("prompt").dispatchEvent(new Event("input"))');
    await window.webContents.executeJavaScript(`document.querySelector('button[data-studio-page=projects]').click();document.querySelector('[data-project-id="${projectA}"]').click()`);
    await until('document.getElementById("prompt").value==="Rascunho da loja" && !document.getElementById("newChat").disabled');
    assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll("#chatList [data-chat-id]").length'),0);
    await window.webContents.executeJavaScript('document.getElementById("newChat").click()');
    await until('!document.getElementById("chatOptions").disabled');
    const organizedChat = bridge.activeId;
    assert.equal(bridge.findChat(organizedChat).projectId,projectA);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("prompt").value'),'Rascunho da loja');
    assert.equal(bridge.drafts.state()[`project:${projectA}`].text,'');
    console.log('PASS: projetos filtram conversas; rascunhos isolados são restaurados e transferidos para uma nova conversa sem duplicar.');
    const loadsBeforeMove=surface.webContents.getURL();
    await window.webContents.executeJavaScript('document.getElementById("chatOptions").click();document.getElementById("chatProjectDestination").value="";document.getElementById("moveConversationProject").click()');
    await until('document.getElementById("projectScopeName").textContent==="Sem projeto" && !document.getElementById("optionsDialog").open');
    assert.equal(bridge.findChat(organizedChat).projectId,null); assert.equal(surface.webContents.getURL(),loadsBeforeMove);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("prompt").value'),'Rascunho da loja');
    await window.webContents.executeJavaScript(`document.querySelector('button[data-studio-page=projects]').click();document.querySelector('[data-project-id="${projectA}"]').click()`);
    await until('document.getElementById("projectScopeName").textContent==="Site da loja" && !document.getElementById("conversationProjectOptions").disabled');
    await window.webContents.executeJavaScript('document.getElementById("conversationProjectOptions").click();document.getElementById("conversationProjectName").value="Loja revisada";document.getElementById("saveConversationProject").click()');
    await until('document.getElementById("projectScopeName").textContent==="Loja revisada" && !document.getElementById("conversationProjectDialog").open');
    await window.webContents.executeJavaScript('document.getElementById("conversationProjectOptions").click();document.getElementById("removeConversationProject").click();document.getElementById("removeConversationProject").click()');
    await until('document.getElementById("projectScopeName").textContent==="Sem projeto" && !document.getElementById("conversationProjectDialog").open');
    assert.ok(bridge.chats.some(c=>c.id===organizedChat));assert.equal(bridge.drafts.state()[organizedChat].text,'Rascunho da loja');
    await window.webContents.executeJavaScript(`document.querySelector('button[data-studio-page=projects]').click();document.querySelector('[data-project-id="${projectB}"]').click()`);
    await until('document.getElementById("prompt").value==="Rascunho do jogo" && !document.getElementById("newChat").disabled');
    // Electron webContents.reload() returns void. Await the real navigation,
    // otherwise the post-reload assertion races the old renderer/disposal.
    const reloaded = new Promise((resolve, reject) => {
      window.webContents.once('did-finish-load', resolve);
      window.webContents.once('did-fail-load', (_event, code, description) => reject(new Error(`Studio reload failed: ${code} ${description}`)));
    });
    window.webContents.reload();
    await reloaded;
    await until('document.getElementById("projectScopeName").textContent==="Jogo" && document.getElementById("prompt").value==="Rascunho do jogo" && !document.getElementById("newChat").disabled');
    await pause(250); await fs.writeFile(path.join(__dirname,'../.data/studio-projects-preview.png'),(await window.webContents.capturePage()).toPNG());
    console.log('PASS: mover mantém URL e rascunho; renomear e remover projeto preservam chats; recarregar restaura escopo e rascunho do projeto.');
    await window.webContents.executeJavaScript('document.getElementById("openProject").click()');
    await until('!document.getElementById("runtimeConnect").disabled');
    await window.webContents.executeJavaScript('document.getElementById("runtimeConnect").click()');
    await until('!document.getElementById("workspaceProjectConversations").disabled');
    await window.webContents.executeJavaScript('document.getElementById("workspaceProjectConversations").click()');
    await until('!!document.getElementById("projectDialog").hidden && !document.getElementById("newChat").disabled && document.getElementById("projectScopeName").textContent!=="Jogo"');
    const boundProject=bridge.projects.find(p=>p.id===bridge.activeProjectId);
    assert.equal(boundProject.binding.project,'fixture-project');assert.equal(boundProject.binding.deviceId,'fixture-device');
    await window.webContents.executeJavaScript(`
      window.fixtureFetch=window.fetch;
      window.fixtureRuntimeIntercept=true;
      window.fetch=async (...args)=>{
        const response=await window.fixtureFetch(...args);
        if(window.fixtureRuntimeIntercept && String(args[0]).startsWith('/api/runtime?')){
          window.fixtureRuntimeIntercept=false;
          await new Promise(resolve=>{window.fixtureReleaseSnapshot=resolve});
        }
        return response;
      };
      document.getElementById('openProject').click();
    `);
    await until('typeof window.fixtureReleaseSnapshot==="function" && !document.getElementById("studioGitStatus").disabled');
    await window.webContents.executeJavaScript('document.getElementById("studioTabGit").click();document.getElementById("studioGitStatus").click()');
    await pause(400);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("studioGitStatus").disabled && document.getElementById("runtimeProject").disabled'),true);
    await window.webContents.executeJavaScript('window.fixtureReleaseSnapshot();window.fetch=window.fixtureFetch;void 0');
    await until('document.getElementById("studioGitResult").textContent.includes("main") && !document.getElementById("studioGitDiff").disabled');
    console.log('PASS: snapshot atrasado anterior ao envio não libera controles; a UI espera uma leitura posterior à operação.');
    await window.webContents.executeJavaScript('document.getElementById("studioTabFiles").click();document.getElementById("projectList").click()');
    await until('document.querySelectorAll("#projectFiles button").length===1');
    await window.webContents.executeJavaScript('document.querySelector("#projectFiles button").click()');
    await until('!document.getElementById("projectEditor").disabled');
    await window.webContents.executeJavaScript('document.getElementById("projectEditor").value="edição pendente";document.getElementById("projectEditor").dispatchEvent(new Event("input"))');
    await window.webContents.executeJavaScript(`document.querySelector('button[data-studio-page=projects]').click();document.querySelector('[data-project-id="${projectB}"]').click()`);
    await until('document.getElementById("notice").textContent.includes("antes de trocar de projeto")');
    assert.equal(bridge.activeProjectId,boundProject.id);assert.equal(await window.webContents.executeJavaScript('document.getElementById("projectEditor").value'),'edição pendente');
    await window.webContents.executeJavaScript('document.getElementById("projectDiscard").click()');
    await window.webContents.executeJavaScript(`document.querySelector('button[data-studio-page=projects]').click();document.querySelector('[data-project-id="${projectB}"]').click()`);
    await until('document.getElementById("projectScopeName").textContent==="Jogo" && document.getElementById("prompt").value==="Rascunho do jogo"');
    console.log('PASS: projeto autorizado do Runtime abre seu grupo de conversas; edição pendente impede troca de contexto e permanece intacta.');
    for (const [mode, slug] of [['projectCreate','created-site'],['projectImport','existing-site']]) {
      const before = remoteCalls.filter(call => call.action === 'workspace.project_create' || call.action === 'workspace.bind_project').length;
      await window.webContents.executeJavaScript(`document.getElementById('${mode === 'projectCreate' ? 'homeNewProject' : 'homeWorkspace'}').click()`);
      await until('document.getElementById("projectEntryDialog").open && document.getElementById("entryDevice").value==="fixture-device" && !document.getElementById("entryName").disabled');
      assert.equal(await window.webContents.executeJavaScript('document.getElementById("projectDialog").hidden'),true);
      if (mode === 'projectImport') await window.webContents.executeJavaScript('document.getElementById("entryFolderTab").click()');
      await window.webContents.executeJavaScript(`document.getElementById('${mode === 'projectCreate' ? 'entryName' : 'entryFolder'}').value='${mode === 'projectCreate' ? 'Created site' : 'sites/existing-site'}';document.getElementById('${mode === 'projectCreate' ? 'entryName' : 'entryFolder'}').dispatchEvent(new Event('input'));`);
      assert.equal(remoteCalls.filter(call => call.action === 'workspace.project_create' || call.action === 'workspace.bind_project').length,before);
      await window.webContents.executeJavaScript(`document.getElementById('${mode === 'projectCreate' ? 'entryCreateSubmit' : 'entryImportSubmit'}').click();document.getElementById('${mode === 'projectCreate' ? 'entryCreateSubmit' : 'entryImportSubmit'}').click();`);
      await until(`!document.getElementById('projectEntryDialog').open && document.getElementById('projectScopeName').textContent===${JSON.stringify(mode === 'projectCreate' ? 'Created site' : slug)}`);
      assert.equal(bridge.activeId,null);assert.equal(bridge.projects.find(p=>p.id===bridge.activeProjectId).binding.project,slug);
      assert.equal(remoteCalls.filter(call => call.action === 'workspace.project_create' || call.action === 'workspace.bind_project').length,before+1);
    }
    console.log('PASS: criar projeto gera pasta automaticamente; abrir pasta usa formulário próprio e uma ação Product tipada, mesmo com clique duplo e catálogo confirmado antes de abrir o projeto; não enviam mensagem GPT.');
    await window.webContents.executeJavaScript('document.getElementById("openActivity").click()');
    await until('!document.getElementById("studioActivity").hidden');
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("projectOperations").textContent.includes("Projeto: fixture-project")'), false);
    assert.match(await window.webContents.executeJavaScript('document.getElementById("projectOperations").textContent'), /Registrar pasta/);
    await window.webContents.executeJavaScript('document.getElementById("activityScope").value="all";document.getElementById("activityScope").dispatchEvent(new Event("change"))');
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("projectOperations").textContent.includes("Projeto: fixture-project")'), true);
    await fs.writeFile(path.join(__dirname,'../.data/studio-runtime-activity-preview.png'), (await capture(window.webContents)).toPNG());
    console.log('PASS: Atividade separa o histórico do projeto atual, preserva seu recibo de importação e permite consultar explicitamente todos os projetos.');
    window.setBounds({ x: 0, y: 0, width: 1000, height: 900 });
    await until(`window.innerWidth===${window.getContentSize()[0]}`); await pause(300);
    assert.equal(await window.webContents.executeJavaScript(`(() => { const bounds=document.querySelector('.main').getBoundingClientRect(), header=document.querySelector('.topbar').getBoundingClientRect(); return bounds.left>=0&&bounds.right<=innerWidth+1&&[...document.querySelectorAll('.top-actions button')].filter(button=>button.getClientRects().length && !button.closest('details:not([open])')).every(button=>{const rect=button.getBoundingClientRect();return rect.left>=bounds.left-1&&rect.right<=bounds.right+1&&rect.bottom<=header.bottom+1;}); })()`), true);
    await fs.writeFile(path.join(__dirname,'../.data/studio-narrow-toolbar-preview.png'), (await capture(window.webContents)).toPNG());
    window.setSize(1550, 900); await pause(200);
    console.log('PASS: janela de 1000 pixels reorganiza os controles do topo dentro da coluna do Studio, sem cortar Atividade ou Contexto.');
    await window.webContents.executeJavaScript('document.getElementById("openHome").click()');
    await until('document.getElementById("conversationTitle").textContent==="Início" && !document.getElementById("newChat").disabled');
    assert.equal(bridge.activeId,null);assert.equal(bridge.activeProjectId,null);
    console.log('PASS: Início sai do projeto/conversa sem excluir histórico, criar chat ou enviar ao GPT.');
    await surface.webContents.executeJavaScript('document.getElementById("prompt-textarea").innerHTML="";document.getElementById("prompt-textarea").style.whiteSpace="pre-wrap"');
    const beforeMultiline = await surface.webContents.executeJavaScript('document.body.dataset.submits || "0"');
    const expectedMultiline = await surface.webContents.executeJavaScript(scriptFor('inspect'));
    const multiline = 'Plano\n\nCódigo:\n    linha indentada\n\nContexto';
    const preparedMultiline = await surface.webContents.executeJavaScript(`(() => {try{return ${scriptFor('prepare',multiline,expectedMultiline)};}catch(error){return {fixtureError:error.message};}})()`);
    assert.ok(!preparedMultiline.fixtureError,preparedMultiline.fixtureError);
    assert.match(preparedMultiline.draft,/    linha indentada/);
    await surface.webContents.executeJavaScript('document.getElementById("prompt-textarea").append(document.createTextNode(" adulterado"))');
    await assert.rejects(surface.webContents.executeJavaScript(scriptFor('submit',multiline,expectedMultiline,preparedMultiline.draft)));
    assert.equal(await surface.webContents.executeJavaScript('document.body.dataset.submits || "0"'),beforeMultiline);
    await surface.webContents.executeJavaScript('document.getElementById("prompt-textarea").innerHTML=""');
    console.log('PASS: preparação multilinha preserva indentação; editar o rascunho preparado bloqueia o clique e não gera envio.');
    const beforeOffline = remoteCalls.length;
    deviceOnline = false; await runtime.refreshTargets();
    await window.webContents.executeJavaScript('document.getElementById("openProject").click()');
    await until('!document.getElementById("projectDialog").hidden');
    await window.webContents.executeJavaScript('document.getElementById("runtimeDevice").value="fixture-device";document.getElementById("runtimeDevice").dispatchEvent(new Event("change"))');
    await until('document.getElementById("runtimeDeviceStatus").textContent.includes("offline") && document.getElementById("projectList").disabled && document.getElementById("terminalReview").disabled');
    assert.match(await window.webContents.executeJavaScript('document.getElementById("runtimeState").textContent'), /Plataforma conectada/);
    assert.equal(remoteCalls.length, beforeOffline);
    await window.webContents.executeJavaScript('document.getElementById("projectClose").click();document.getElementById("homeNewProject").click()');
    await until('document.getElementById("projectEntryDialog").open && document.getElementById("entryDeviceStatus").textContent.includes("offline")');
    await window.webContents.executeJavaScript('document.getElementById("entryName").value="Projeto offline";document.getElementById("entryName").dispatchEvent(new Event("input"))');
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("entryCreateSubmit").disabled'), true);
    assert.equal(remoteCalls.length, beforeOffline);
    await window.webContents.executeJavaScript('document.getElementById("entryClose").click()');
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("newChat").disabled'), false);
    console.log('PASS: desktop offline mantém conexão de plataforma e conversas, mas bloqueia arquivos, terminal e criação sem POST nem execução alternativa.');
    await bridge.close(); await runtime.close(); await host.close(); window.destroy(); app.exit(0);
  } catch(error) {
    console.error(error); await bridge?.close().catch(()=>{}); await runtime?.close().catch(()=>{}); await host?.close().catch(()=>{}); if(window && !window.isDestroyed()) window.destroy(); app.exit(1);
  }
});
