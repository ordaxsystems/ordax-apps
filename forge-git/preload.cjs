const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('forgeGit', Object.freeze({
  connect: token => ipcRenderer.invoke('forge-git:connect', token),
  inspect: args => ipcRenderer.invoke('forge-git:inspect', args),
  run: args => ipcRenderer.invoke('forge-git:run', args),
  publish: () => ipcRenderer.invoke('forge-git:publish'),
  chatStatus: () => ipcRenderer.invoke('forge-git:chat-status'),
  chatLogin: () => ipcRenderer.invoke('forge-git:chat-login'),
  openPr: url => ipcRenderer.invoke('forge-git:open-pr', url),
  onStatus: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('forge-git:status', listener);
    return () => ipcRenderer.removeListener('forge-git:status', listener);
  }
}));
