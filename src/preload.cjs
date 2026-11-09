const { contextBridge, ipcRenderer } = require('electron');
const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('clip', {
  sources: invoke('sources'), select: invoke('select'), region: invoke('region'),
  begin: invoke('begin'), chunk: invoke('chunk'), finish: invoke('finish'),
  abort: invoke('abort'), save: invoke('save'), reveal: invoke('reveal'),
  minimize: invoke('minimize'), permissions: invoke('permissions'),
  surface: invoke('surface'), close: invoke('close'),
  options: invoke('options'), pickSource: invoke('pick-source'),
  completeRegion: invoke('complete-region'),
  on: (event, callback) => {
    if (!['stop-recording', 'progress', 'region-image', 'surface-state', 'toolbar-command'].includes(event)) return;
    const listener = (_, data) => callback(data);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  }
});
