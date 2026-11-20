import { contextBridge, ipcRenderer } from 'electron';
import type { Command, BridgeResult } from './main/commands';
contextBridge.exposeInMainWorld('ccu', Object.freeze({
  request: (command: Command): Promise<BridgeResult> => ipcRenderer.invoke('ccu:command', command),
}));
