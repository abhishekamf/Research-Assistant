/**
 * Research AI Assistant - preload bridge
 * Exposes a minimal, secure API to the renderer (contextIsolation enabled).
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('researchai', {
  // request/response: call('listProjects') -> Promise<{ok, result|error}>
  call: (method, ...args) => ipcRenderer.invoke('call', method, args),

  // server-pushed events: on('chat:token', cb) -> unsubscribe fn
  on: (type, cb) => {
    const handler = (_e, data) => { if (data && data.type === type) cb(data); };
    ipcRenderer.on('evt', handler);
    return () => ipcRenderer.removeListener('evt', handler);
  },

  // Resolve an absolute path for a File object dropped into the window
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },

  platform: process.platform,
  version: '1.0.0'
});
