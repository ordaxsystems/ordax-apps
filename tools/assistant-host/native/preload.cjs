'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const studioWebHost = Object.freeze({
  login: () => ipcRenderer.invoke('assistant-web:login'),
  expand: () => ipcRenderer.invoke('assistant-web:expand'),
  collapse: () => ipcRenderer.invoke('assistant-web:collapse'),
  getLayout: () => ipcRenderer.invoke('assistant-web:layout'),
  focus: () => ipcRenderer.invoke('assistant-web:expand'),
  reload: () => ipcRenderer.invoke('assistant-web:reload'),
  openBrowser: () => ipcRenderer.invoke('assistant-web:browser'),
  openBrowserLogin: () => ipcRenderer.invoke('assistant-web:browser-login'),
  setPresentation: value => ipcRenderer.invoke('assistant-web:presentation', value),
  setFallbackBounds: value => ipcRenderer.invoke('assistant-web:fallback-bounds', value),
  openLink: value => ipcRenderer.invoke('assistant-web:link', value),
  modelPicker: () => ipcRenderer.invoke('assistant-web:model-picker'),
  effortPicker: () => ipcRenderer.invoke('assistant-web:effort-picker'),
  chatMode: () => ipcRenderer.invoke('assistant-web:chat-mode'),
  attachmentPicker: () => ipcRenderer.invoke('assistant-web:attachment-picker'),
  audioEnd: () => ipcRenderer.invoke('assistant-web:audio-end'),
  audio: mode => ipcRenderer.invoke('assistant-web:audio', mode),
  pluginInfo: () => ipcRenderer.invoke('assistant-web:plugin-info'),
  pluginCheck: () => ipcRenderer.invoke('assistant-web:plugin-check'),
  pluginSetup: () => ipcRenderer.invoke('assistant-web:plugin-setup'),
  pluginPrepare: () => ipcRenderer.invoke('assistant-web:plugin-prepare'),
  pluginReturn: () => ipcRenderer.invoke('assistant-web:plugin-return'),
  pluginBrowser: () => ipcRenderer.invoke('assistant-web:plugin-browser'),
  onPrepareClose(callback) {
    const listener = async (_event, id) => {
      try { await callback(); ipcRenderer.send('assistant-web:close-ready', { id, ok: true }); }
      catch { ipcRenderer.send('assistant-web:close-ready', { id, ok: false }); }
    };
    ipcRenderer.on('assistant-web:prepare-close', listener);
    return () => ipcRenderer.removeListener('assistant-web:prepare-close', listener);
  },
  onLayout(callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('assistant-web:layout', listener);
    return () => ipcRenderer.removeListener('assistant-web:layout', listener);
  },
  onStatus(callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('assistant-web:status', listener);
    return () => ipcRenderer.removeListener('assistant-web:status', listener);
  },
});
contextBridge.exposeInMainWorld('ordaxStudioWebHost', studioWebHost);
// Credentials travel only through the trusted Studio main-frame IPC to the
// Electron main process. The returned object contains Product state, no token.
contextBridge.exposeInMainWorld('ordaxStudioAccountHost', Object.freeze({
  signIn: data => ipcRenderer.invoke('studio-product:sign-in', data),
  available: () => ipcRenderer.invoke('studio-product:availability'),
}));
contextBridge.exposeInMainWorld('ordaxStudioPreviewHost', Object.freeze({
  state: () => ipcRenderer.invoke('studio-preview:state'),
  setBounds: value => ipcRenderer.invoke('studio-preview:bounds', value),
  reload: () => ipcRenderer.invoke('studio-preview:reload'),
  openBrowser: () => ipcRenderer.invoke('studio-preview:browser'),
  setMode: value => ipcRenderer.invoke('studio-preview:mode',value),
  navigate: value => ipcRenderer.invoke('studio-preview:navigate',value),
  setDevice: value => ipcRenderer.invoke('studio-preview:device',value),
  history: value => ipcRenderer.invoke('studio-preview:history',value),
  syncProject: () => ipcRenderer.invoke('studio-preview:project'),
  onStatus(callback) { const listener = (_event, value) => callback(value); ipcRenderer.on('studio-preview:status', listener); return () => ipcRenderer.removeListener('studio-preview:status', listener); },
}));
// Compatibility for existing adapters. Public product identity is ORDAX Studio.
contextBridge.exposeInMainWorld('ordaxAssistantWebHost', studioWebHost);
