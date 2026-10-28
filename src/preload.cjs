'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const allowed=new Set(['state','navigate','new-tab','close-tab','select-tab','back','forward','reload','home','panel','bookmark','send-tab','add-note','open-item','link-start','link-stop','link-pair','link-revoke','copy-pair-code','clear-browsing-data']);
contextBridge.exposeInMainWorld('voodoo',Object.freeze({
  invoke(action,payload={}) { if(!allowed.has(action))return Promise.reject(Error('Unknown action.'));return ipcRenderer.invoke('voodoo:action',action,payload); },
  onState(fn) { if(typeof fn!=='function')throw Error('Callback required');const handler=(_event,state)=>fn(state);ipcRenderer.on('voodoo:state',handler);return ()=>ipcRenderer.removeListener('voodoo:state',handler); }
  ,onFocusAddress(fn) { if(typeof fn!=='function')throw Error('Callback required');const handler=()=>fn();ipcRenderer.on('voodoo:focus-address',handler);return ()=>ipcRenderer.removeListener('voodoo:focus-address',handler); }
}));
