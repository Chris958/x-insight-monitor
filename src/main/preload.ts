import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('xMonitor', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveSettings: (value: unknown) => ipcRenderer.invoke('settings:save', value),
  saveSecrets: (value: unknown) => ipcRenderer.invoke('secrets:save', value),
  addAccount: (value: unknown) => ipcRenderer.invoke('accounts:add', value),
  updateAccount: (id: string, value: unknown) => ipcRenderer.invoke('accounts:update', id, value),
  deleteAccount: (id: string) => ipcRenderer.invoke('accounts:delete', id),
  pollAccount: (id: string) => ipcRenderer.invoke('accounts:poll', id),
  start: () => ipcRenderer.invoke('engine:start'), stop: () => ipcRenderer.invoke('engine:stop'),
  testModel: () => ipcRenderer.invoke('test:model'), testWeComWebhook: () => ipcRenderer.invoke('test:wecom-webhook'), testCollector: () => ipcRenderer.invoke('test:collector'),
  onStateChanged: (callback: () => void) => { const listener=()=>callback(); ipcRenderer.on('state:changed',listener); return ()=>ipcRenderer.removeListener('state:changed',listener); }
});
