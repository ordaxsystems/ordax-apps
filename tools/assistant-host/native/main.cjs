'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, nativeTheme, dialog } = require('electron');
const path = require('node:path');
const { homedir } = require('node:os');
const { createAudioPermission } = require('./audio-permission.cjs');
const { isAccountURL } = require('./policy.cjs');
const { createWebControls, registerWebControls } = require('./web-controls.cjs');
const { createPluginConnection, isPluginURL } = require('./plugin-connection.cjs');
app.setName('ORDAX Studio');
if (process.platform === 'win32') app.setAppUserModelId('org.ordax.assistant');
app.setPath('userData', path.join(process.env.LOCALAPPDATA || (process.platform === 'win32' ? path.join(homedir(), 'AppData', 'Local') : path.join(homedir(), '.local/share')), 'OrdaX', 'Assistant-web'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window, surface, bridge, host, runtime, studioSurfaces, shuttingDown = false, closing = false, uiReady = false;
  async function flushComposer() {
    if (!uiReady || !window || window.isDestroyed() || window.webContents.isDestroyed()) return true;
    const id = require('node:crypto').randomUUID();
    return new Promise(resolve => {
      const finish = ok => { clearTimeout(timer); ipcMain.removeListener('assistant-web:close-ready', listener); resolve(ok); };
      const listener = (event, value) => { if (event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && value?.id === id) finish(value.ok === true); };
      const timer = setTimeout(() => finish(false), 8000);
      ipcMain.on('assistant-web:close-ready', listener); window.webContents.send('assistant-web:prepare-close', id);
    });
  }
  const preferences = { partition: 'persist:ordax-assistant-chatgpt-web', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false };
  const status = (state, detail = '') => { bridge?.setTransportStatus(state, detail); if (window && !window.isDestroyed()) window.webContents.send('assistant-web:status', { state, detail }); };
  function contain(contents, allowed = isAccountURL) {
    contents.on('will-navigate', (event, url) => { if (!allowed(url)) { event.preventDefault(); status('notice', 'Abra links externos pelo seu navegador.'); } });
    contents.on('will-redirect', (event, url) => { if (!allowed(url)) event.preventDefault(); });
    contents.setWindowOpenHandler(({ url }) => isPluginURL(url) ? { action: 'allow', overrideBrowserWindowOptions: { width: 680, height: 780, autoHideMenuBar: true, webPreferences: preferences } } : { action: 'deny' });
    contents.on('did-create-window', popup => contain(popup.webContents, isPluginURL));
  }
  app.whenReady().then(async () => {
    console.log('ORDAX Studio: inicializando o host Web.');
    const { LocalStorage } = await import('../storage.mjs');
    const { WebBridge } = await import('./web-bridge.mjs');
    const { ProductRuntime } = await import('./product-runtime.mjs');
    const { createWebServer } = await import('../web-server.mjs');
    const { createStudioSurfaces } = await import('./studio-surfaces.mjs');
    const storage = new LocalStorage(app.getPath('userData'));
    await storage.init();
    runtime = new ProductRuntime({ storage }); await runtime.init();
    console.log('ORDAX Studio: perfil local pronto.');
    nativeTheme.themeSource = 'dark';
    window = new BrowserWindow({ show: false, width: 1550, height: 900, minWidth: 360, minHeight: 520, title: 'ORDAX Studio · Projetos e preview', backgroundColor: '#080f19', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.on('close', event => { if (!shuttingDown) { event.preventDefault(); app.quit(); } });
    const profile = session.fromPartition(preferences.partition);
    profile.on('will-download', (_event, item) => item.setSaveDialogOptions({ title: 'Salvar arquivo do ChatGPT', defaultPath: path.basename(item.getFilename()) }));
    surface = new WebContentsView({ webPreferences: preferences });
    window.contentView.addChildView(surface); surface.setBackgroundColor('#171717');
    const audioPermission = createAudioPermission({ contents: surface.webContents, confirm: async () => {
      const result = await dialog.showMessageBox(window, { type: 'question', title: 'Microfone no ChatGPT', message: 'Permitir que o ChatGPT use seu microfone nesta sessão?', detail: 'O áudio será tratado pelo ChatGPT na sua conta. Câmera e compartilhamento de tela permanecem bloqueados.', buttons: ['Permitir microfone', 'Cancelar'], defaultId: 1, cancelId: 1 });
      return result.response === 0;
    } });
    profile.setPermissionCheckHandler(audioPermission.check);
    profile.setPermissionRequestHandler(audioPermission.request);
    surface.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) audioPermission.revoke(); });

    const plugin = createPluginConnection({ openExternal: url => shell.openExternal(url) });
    const preferencesUI = await storage.read('appearance', {});
    const previewSessions = new WeakSet();
    studioSurfaces = createStudioSurfaces({ window, chatSurface: surface, project: () => bridge?.projects.find(project => project.id === bridge.activeProjectId), ownOrigin: () => host?.origin, blockedOrigins: [runtime.base], openExternal: url => shell.openExternal(url), createPreviewView: (id, kind='preview') => {
      const previewSession = session.fromPartition('ordax-studio-' + kind + '-' + id);
      previewSession.setPermissionCheckHandler(() => false);
      previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      if (!previewSessions.has(previewSession)) { previewSessions.add(previewSession); previewSession.on('will-download', event => event.preventDefault()); }
      return new WebContentsView({ webPreferences: { session: previewSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false } });
    } });
    const controls = createWebControls({ window, surface, plugin, studioSurfaces, audioPermission, resumeURL: () => bridge?.resumeURL() || 'https://chatgpt.com/', isBusy: () => Boolean(bridge?.run || bridge?.sending || bridge?.page?.busy), isReady: () => Boolean(bridge?.page?.ready), openExternal: url => shell.openExternal(url), preferences: preferencesUI, savePreferences: value => storage.write('appearance', value) });
    controls.layout(); window.on('resize', controls.layout);
    contain(surface.webContents, url => controls.state().pluginSetup ? isPluginURL(url) : isAccountURL(url));
    bridge = new WebBridge({ surface, storage, openLogin: controls.login, setupActive: () => controls.state().pluginSetup });
    await bridge.init(); host = await createWebServer({ bridge, runtime });
    console.log('ORDAX Studio: transporte local pronto.');
    let loadFailed = false;
    surface.webContents.on('did-start-loading', () => { loadFailed = false; status('loading'); });
    surface.webContents.on('did-stop-loading', () => { if (!loadFailed) status('ready'); });
    surface.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) { loadFailed = true; status('error', 'Não foi possível carregar o ChatGPT. Use Recarregar.'); } });
    surface.webContents.on('render-process-gone', () => status('error', 'A área Web foi interrompida. Use Recarregar.'));
    registerWebControls(ipcMain, { window, origin: host.origin, controls });
    for (const [name, action] of Object.entries({ state: studioSurfaces.state, bounds: studioSurfaces.setBounds, reload: studioSurfaces.reload, browser: studioSurfaces.browser, mode:studioSurfaces.setMode, navigate:studioSurfaces.navigate, device:studioSurfaces.setDevice, history:studioSurfaces.history, project:async()=>{await studioSurfaces.sync();return studioSurfaces.state();} })) ipcMain.handle('studio-preview:' + name, (event,value) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== host.origin + '/src/index.html') throw new Error('Untrusted IPC sender');
      return action(value);
    });
    await window.loadURL(host.origin + '/src/index.html');
    uiReady = true;
    window.show();
    window.focus();
    console.log('ORDAX Studio: janela pronta.');
    await surface.webContents.loadURL(bridge.resumeURL()).catch(() => status('error', 'Não foi possível carregar o ChatGPT. Use Recarregar.'));
  }).catch(error => { console.error('Falha ao iniciar ORDAX Studio:', error); dialog.showErrorBox('ORDAX Studio — falha ao iniciar', 'Não foi possível iniciar o app. Verifique o espaço livre, as permissões do perfil local e os arquivos do aplicativo.\n\n' + String(error.message).slice(0, 400)); app.quit(); });
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('before-quit', event => {
    if (shuttingDown) return; event.preventDefault(); if (closing) return; closing = true;
    (async () => {
      if (!await flushComposer()) {
        const choice = await dialog.showMessageBox(window, { type: 'warning', title: 'Alteração pendente', message: 'Há alterações sem confirmação de salvamento.', detail: 'Você pode continuar editando ou sair mantendo a última versão salva.', buttons: ['Continuar editando', 'Sair'], defaultId: 0, cancelId: 0 });
        if (choice.response !== 1) { closing = false; return; }
      }
      shuttingDown = true;
      await host?.close(); await Promise.allSettled([bridge?.close(), runtime?.close()]);
      studioSurfaces?.close();
      if (surface && !surface.webContents.isDestroyed()) surface.webContents.close(); app.quit();
    })().catch(error => { closing = false; console.error('Falha ao fechar o app:', error.message); });
  });
  app.on('window-all-closed', () => app.quit());
}
