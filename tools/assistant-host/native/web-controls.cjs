'use strict';
const { isAccountURL, surfaceBounds } = require('./policy.cjs');
const { scriptFor } = require('./web-dom.cjs');
const { PLUGINS_URL, isPluginURL } = require('./plugin-connection.cjs');
const { registrationScript } = require('./plugin-registration.cjs');
const LOGIN_URL = 'https://chatgpt.com/auth/login';

function isLoginPage(value) {
  if (!isAccountURL(value)) return false;
  const url = new URL(value);
  return url.hostname !== 'chatgpt.com' || /^\/auth(?:\/|$)/.test(url.pathname);
}
function publicChatURL(value) {
  try {
    const url = new URL(value);
    if (url.origin === 'https://chatgpt.com' && /^\/c\/[^/]{1,256}$/.test(url.pathname)) return url.origin + url.pathname;
  } catch { /* Only public ChatGPT URLs may be opened externally. */ }
  return 'https://chatgpt.com/';
}

function createWebControls({ window, surface, plugin, studioSurfaces, resumeURL = () => 'https://chatgpt.com/', isBusy = () => false, isReady = () => false, openExternal, audioPermission, preferences = {}, savePreferences = async () => {} }) {
  preferences = preferences && typeof preferences === 'object' ? preferences : {};
  // Legacy "hide Web" preferences must not hide the new default project preview.
  let audioMode = null, endingAudio = null;
  let expanded = false, loginRequest = null, mode = !studioSurfaces && preferences.mode === 'conversation' ? 'conversation' : 'split';
  let previousMode = mode;
  let ratio = Number.isFinite(preferences.ratio) && preferences.ratio >= 0.45 && preferences.ratio <= 0.75 ? preferences.ratio : 0.6;
  let pluginSetupActive = false, pluginRequest = null, pluginFailed = false, returnURL = null, navigation = 0;
  const state = () => ({ expanded, mode, ratio, pluginSetup: pluginSetupActive, ...(studioSurfaces ? { studioPreview: true } : {}) });
  const layout = () => {
    const [width, height] = window.getContentSize();
    if (studioSurfaces) studioSurfaces.layout(state());
    else { surface.setVisible?.(mode !== 'conversation'); surface.setBounds(surfaceBounds(width, height, expanded, ratio)); }
    window.webContents.send('assistant-web:layout', state());
  };
  const focus = () => { window.show(); window.focus(); surface.webContents.focus(); };
  function expand() { if (!expanded) previousMode = mode; expanded = true; mode = 'web'; layout(); focus(); return state(); }
  function collapse() { if (audioMode) throw new Error('Encerre o áudio antes de voltar à conversa do Studio.'); expanded = false; mode = previousMode; layout(); window.webContents.focus(); return state(); }
  async function presentation(value) {
    if (!value || !['split', 'conversation'].includes(value.mode) || !Number.isFinite(value.ratio) || value.ratio < 0.45 || value.ratio > 0.75) throw new Error('Aparência inválida.');
    if (audioMode) throw new Error('Encerre o áudio antes de alterar a apresentação.');
    ratio = value.ratio; mode = value.mode; expanded = false; layout();
    await savePreferences({ mode, ratio }); return state();
  }
  async function login() {
    if (audioMode || isBusy()) throw new Error('Pare a resposta ou encerre o áudio antes de abrir o login.');
    expand();
    // Preserve an authentication flow already open, including an identity provider.
    if (isLoginPage(surface.webContents.getURL()) || isReady()) return { embedded: true, ...state() };
    if (!loginRequest) loginRequest = surface.webContents.loadURL(LOGIN_URL).catch(error => {
      if (error.code !== 'ERR_ABORTED' && error.errno !== -3) throw error;
      if (!isLoginPage(surface.webContents.getURL()) && !isReady()) throw error;
    }).finally(() => { loginRequest = null; });
    await loginRequest; surface.webContents.focus();
    return { embedded: true, ...state() };
  }
  function reload() {
    if (audioMode || isBusy()) throw new Error('Pare a resposta ou encerre o áudio antes de recarregar.');
    surface.webContents.reload();
  }
  async function browser() { await openExternal(publicChatURL(surface.webContents.getURL())); return { opened: true }; }
  async function browserLogin() { await openExternal('https://chatgpt.com/'); return { opened: true }; }
  async function openLink(value) {
    if (typeof value !== 'string' || value.length > 4096) throw new Error('Link inválido.');
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Link inválido.');
    await openExternal(url.href); return { opened: true };
  }
  async function composerControl(action) {
    if (audioMode) throw new Error('Encerre o áudio antes de usar o compositor.');
    if (pluginSetupActive) throw new Error('Volte à conversa para usar o compositor.');
    if (isBusy()) throw new Error('Aguarde ou pare a resposta para alterar o modelo ou anexar arquivos.');
    if (!isReady() || new URL(surface.webContents.getURL()).origin !== 'https://chatgpt.com') throw new Error('Conecte a sessão interna do ChatGPT primeiro.');
    expand();
    return surface.webContents.executeJavaScript(scriptFor(action), true);
  }
  const modelPicker = () => composerControl('modelPicker');
  const effortPicker = () => composerControl('effortPicker');
  const chatMode = () => composerControl('chatMode');
  const attachmentPicker = () => composerControl('attachmentPicker');
  async function audio(mode) {
    if (!['dictation','voice'].includes(mode)) throw new Error('Modo de áudio inválido.');
    if (audioMode || pluginSetupActive || isBusy() || !isReady()) throw new Error('Abra uma conversa conectada e aguarde a resposta antes de usar áudio.');
    if (new URL(surface.webContents.getURL()).origin !== 'https://chatgpt.com') throw new Error('Abra a sessão ChatGPT antes de usar áudio.');
    expand(); audioMode = mode; audioPermission?.arm();
    try {
      const result = await surface.webContents.executeJavaScript(scriptFor('audio', mode), true);
      if (result?.opened !== true) throw new Error('O ChatGPT não confirmou o início do áudio.');
      return result;
    }
    catch (error) {
      audioPermission?.revoke();
      // A lost acknowledgement can follow a successful voice click. Terminate
      // the page before releasing the capture lock; permission revocation alone
      // cannot prove that an already-open MediaStream has stopped.
      try { await audioEnd(); }
      catch { return { opened: false, terminationRequired: true, error: 'Não foi possível confirmar o encerramento do áudio. Use Encerrar áudio para tentar novamente.' }; }
      throw error;
    }
  }
  async function audioEnd() {
    if (endingAudio) return endingAudio;
    audioPermission?.revoke();
    // Leaving the audio page terminates its microphone streams. No user message is sent.
    endingAudio = Promise.resolve().then(() => surface.webContents.loadURL(publicChatURL(surface.webContents.getURL()))).then(() => {
      audioMode = null; return collapse();
    }).finally(() => { endingAudio = null; });
    return endingAudio;
  }
  const resetAudio = () => { audioPermission?.revoke(); if (audioMode) audioEnd().catch(() => {}); };
  window.webContents.on?.('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) resetAudio(); });
  window.webContents.on?.('render-process-gone', resetAudio);
  async function pluginSetup() {
    if (audioMode || isBusy()) throw new Error('Aguarde a resposta ou encerre o áudio antes de cadastrar o plugin.');
    if (!pluginSetupActive) {
      returnURL = publicChatURL(surface.webContents.getURL());
      if (returnURL === 'https://chatgpt.com/') returnURL = publicChatURL(resumeURL());
      pluginSetupActive = true; pluginFailed = true;
    }
    if (studioSurfaces && !expanded) previousMode = mode;
    expanded = Boolean(studioSurfaces); mode = 'split'; layout(); focus();
    if (!pluginRequest && pluginFailed) {
      const attempt = ++navigation;
      pluginRequest = Promise.resolve().then(() => { if (attempt === navigation) return surface.webContents.loadURL(PLUGINS_URL); }).then(() => {
        if (attempt === navigation) pluginFailed = false;
      }).catch(error => {
        if (attempt !== navigation) return;
        if ((error.code === 'ERR_ABORTED' || error.errno === -3) && isPluginURL(surface.webContents.getURL())) { pluginFailed = false; return; }
        throw error;
      }).finally(() => { pluginRequest = null; });
    }
    await pluginRequest;
    return { opened: pluginSetupActive, ...state() };
  }
  async function pluginPrepare() {
    const opened = await pluginSetup();
    const result = await surface.webContents.executeJavaScript(registrationScript(), true);
    return { ...opened, ...result };
  }
  async function pluginReturn() {
    if (!pluginSetupActive) return state();
    if (isBusy()) throw new Error('Aguarde ou pare a resposta antes de voltar à conversa.');
    ++navigation; pluginSetupActive = false; layout();
    try { await surface.webContents.loadURL(returnURL || publicChatURL(resumeURL())); }
    catch (error) {
      if ((error.code !== 'ERR_ABORTED' && error.errno !== -3) || !isAccountURL(surface.webContents.getURL())) { pluginSetupActive = true; layout(); throw error; }
    }
    if (studioSurfaces) return collapse();
    surface.webContents.focus(); return state();
  }
  return Object.freeze({ state, layout, login, expand, collapse, reload, browser, browserLogin, presentation, openLink, modelPicker, effortPicker, chatMode, attachmentPicker,
    fallbackBounds: value => { if (!studioSurfaces) return; return studioSurfaces.setFallbackBounds(value); },
    pluginInfo: () => plugin?.info() ?? { status: 'unsupported' },
    pluginCheck: () => plugin?.check() ?? { status: 'unsupported' },
    audio, audioEnd, pluginSetup, pluginPrepare, pluginReturn,
    pluginBrowser: () => { if (!plugin) throw new Error('Configuração do plugin indisponível neste host.'); return plugin.browser(); },
  });
}

function registerWebControls(ipcMain, { window, origin, controls }) {
  const commands = { login: controls.login, expand: controls.expand, collapse: controls.collapse, layout: controls.state, reload: controls.reload, browser: controls.browser, 'browser-login': controls.browserLogin, presentation: controls.presentation, link: controls.openLink, 'model-picker': controls.modelPicker, 'attachment-picker': controls.attachmentPicker,
    'effort-picker': controls.effortPicker, 'chat-mode': controls.chatMode,
    audio: controls.audio, 'audio-end': controls.audioEnd, 'plugin-info': controls.pluginInfo, 'plugin-check': controls.pluginCheck, 'plugin-setup': controls.pluginSetup, 'plugin-prepare': controls.pluginPrepare, 'plugin-return': controls.pluginReturn, 'plugin-browser': controls.pluginBrowser, 'fallback-bounds': controls.fallbackBounds };
  for (const [name, action] of Object.entries(commands)) {
    ipcMain.handle('assistant-web:' + name, (event, value) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || ![origin + '/', origin + '/src/index.html'].includes(event.senderFrame?.url)) throw new Error('Untrusted IPC sender');
      return action(value);
    });
  }
  return () => { for (const name of Object.keys(commands)) ipcMain.removeHandler('assistant-web:' + name); };
}
module.exports = { createWebControls, registerWebControls, isLoginPage, publicChatURL };
