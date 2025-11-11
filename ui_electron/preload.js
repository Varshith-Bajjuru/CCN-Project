const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: (host, port) => ipcRenderer.invoke('udp:init', { host, port }),
  list: () => ipcRenderer.invoke('cmd:ls'),
  del: (filename) => ipcRenderer.invoke('cmd:delete', filename),
  get: (filename) => ipcRenderer.invoke('cmd:get', filename),
  put: () => ipcRenderer.invoke('cmd:put'),
  exit: () => ipcRenderer.invoke('cmd:exit'),
  onLog: (cb) => ipcRenderer.on('log:append', (_evt, log) => cb(log)),
  // New APIs for analytics and utilities
  enableMetrics: () => ipcRenderer.invoke('metrics:enable'),
  onMetrics: (cb) => ipcRenderer.on('metrics:update', (_evt, payload) => cb(payload)),
  ping: () => ipcRenderer.invoke('analyze:ping'),
  checksumFile: (filePath) => ipcRenderer.invoke('util:checksum', filePath),
  putPaths: (paths) => ipcRenderer.invoke('cmd:putPaths', paths),
});
