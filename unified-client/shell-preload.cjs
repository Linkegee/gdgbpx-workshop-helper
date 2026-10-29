'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('client',{
  command:(op,id)=>ipcRenderer.invoke('panel-command',op,id),
  onState:callback=>ipcRenderer.on('panel-state',(_event,state)=>callback(state))
});
