import { contextBridge, ipcRenderer } from 'electron';
import type { Command, BridgeResult } from './main/commands';
contextBridge.exposeInMainWorld('ccu', Object.freeze({
  request: (command: Command): Promise<BridgeResult> => ipcRenderer.invoke('ccu:command', command),
  onConcealPledge: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('ccu:conceal-pledge', listener);
    return () => { ipcRenderer.removeListener('ccu:conceal-pledge', listener); };
  },
}));
