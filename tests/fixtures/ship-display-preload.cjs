const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ccu', { request: command => ipcRenderer.invoke('fixture:command', command) });
