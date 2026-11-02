'use strict';
const {randomUUID}=require('node:crypto');
const Pins=require('../renderer/mobile/pins.js');
const {hash}=require('./workspace.cjs');
const {websiteUrl}=require('./policy.cjs');
function createHost({workspace,scripts,discovery,current,navigate,route,openTab,tabCount,exportFile,addBookmark}){
  const pinState=()=>({pins:workspace.get('pins')||[],names:Pins.workspaceNames(workspace.get('options')?.workspaceNames),active:workspace.get('options')?.activeWorkspace||'all'});
  const options=async change=>workspace.update(d=>{d.areas.options??={};change(d.areas.options);return true;});
  return async function host(payload){
    const {op}=payload;
    switch(op){
      case 'get-store':return workspace.get(payload.key);
      case 'put-store':return workspace.put(payload.key,payload.value,payload.expectedRevision);
      case 'context':{const t=current();if(!t?.hasDocument||t.loading)throw Error('Open a website first, then return here.');return {url:websiteUrl(t.view.webContents.getURL()),title:t.title};}
      case 'navigate':await navigate(payload.text);return true;
      case 'return-to-site':if(!current()?.url)throw Error('Open a website first.');route(null);return true;
      case 'open-home':route('home');return true;
      case 'open-workbench':case 'open-studio':case 'open-script-hub':route('studio');return true;
      case 'open-writing':route('writing');return true;
      case 'script-discovery':route('magic');return true;
      case 'discovery-cancel':discovery.cancel();return true;
      case 'discovery-list':{const t=current();if(!t?.url)throw Error('Open a website to discover its scripts. Saved scripts remain available here.');return discovery.list(t.view.webContents.getURL(),!!payload.refresh);}
      case 'discovery-code':return discovery.code(payload.id);
      case 'discovery-save':{
        const record=payload.sourceId?discovery.records.get(String(payload.sourceId)):null;
        if(payload.sourceId&&!record)throw Error('Refresh discovery before saving this result.');
        return workspace.saveChoice({...payload,name:record?.name.slice(0,120),sourceURL:record?.code_url,sourceHost:current()?.url?new URL(current().url).hostname:'',expectedHash:hash(payload.code)});
      }
      case 'run-script':{const t=current();if(!t?.hasDocument||t.loading)throw Error('Wait for the website to load first.');const result=await scripts.manual(t,payload.script);route(null);return result;}
      case 'script-status':{const status=scripts.status();status.menus=status.menus.filter(m=>m.tabId===current()?.id);return status;}
      case 'script-menu':return scripts.menu(payload);
      case 'script-log':return workspace.snapshot().logs.map(l=>new Date(l.at).toLocaleString()+' · '+l.scriptId+' · '+l.level+' · '+l.text).join('\n');
      case 'script-backup':{const data=workspace.snapshot(),result={};for(const s of workspace.scripts()){const r=data.runtime[s.id]||{};result[s.id]={values:r.values||{},blocked:r.blocked||[],history:r.history||[]};}return result;}
      case 'script-rollback':return workspace.rollback(payload.scriptId,payload.index);
      case 'script-site-policy':{
        const host=String(payload.host||'').toLowerCase().replace(/\.$/,'');if(!/^[a-z0-9.-]{1,253}$/.test(host)||!workspace.scripts().some(s=>s.id===payload.scriptId))throw Error('Choose a saved script and an exact website host.');
        return workspace.update(d=>{const r=d.runtime[payload.scriptId]??={values:{},blocked:[],history:[]};r.blocked=r.blocked.filter(h=>h!==host);if(payload.blocked)r.blocked.push(host);return true;});
      }
      case 'script-update':{const s=workspace.scripts().find(s=>s.id===payload.scriptId);if(!s)throw Error('Save this script first.');return discovery.update(s);}
      case 'restore-backup':return workspace.restore(payload.backup);
      case 'export-file':return exportFile(payload.filename,payload.text);
      case 'recent-sites':return workspace.snapshot().recent||[];
      case 'pins':{
        // Import the desktop's existing favorites once; preserve their shared-library entries.
        if(workspace.get('pins')===null){const pins=await addBookmark(null);if(pins?.length)await workspace.put('pins',Pins.validate(pins.slice(0,60)));}
        return pinState();
      }
      case 'set-workspace':if(!['all',...Pins.groups].includes(payload.group))throw Error('Unknown workspace.');await options(o=>{o.activeWorkspace=payload.group;});return true;
      case 'rename-workspaces':await options(o=>{o.workspaceNames=Pins.workspaceNames(payload.names);});return true;
      case 'pin-site':{
        const pins=pinState().pins,pin=Pins.validate([{id:randomUUID(),title:String(payload.title||''),url:Pins.url(payload.url),group:payload.group,lat:15+Math.random()*45,lon:Math.random()*320-160}])[0];pins.push(pin);await workspace.put('pins',pins);await addBookmark(pin);return pin;
      }
      case 'update-pin':{const pins=pinState().pins,index=pins.findIndex(p=>p.id===payload.pin?.id);if(index<0)throw Error('Pin no longer available.');const {id,title,group,lat,lon}=payload.pin;const changes=Object.fromEntries(Object.entries({id,title,group,lat,lon}).filter(([,v])=>v!==undefined));pins[index]={...pins[index],...changes};await workspace.put('pins',Pins.validate(pins));return pins[index];}
      case 'delete-pin':await workspace.put('pins',pinState().pins.filter(p=>p.id!==payload.pinId));return true;
      case 'open-pin':{const pin=pinState().pins.find(p=>p.id===payload.pinId);if(!pin)throw Error('Pin no longer available.');await navigate(pin.url);return true;}
      case 'open-workspace':{const pins=pinState().pins.filter(p=>payload.group==='all'||p.group===payload.group);let opened=0;for(const p of pins){if(tabCount()>=12)break;await openTab(p.url);opened++;}return {opened,remaining:pins.length-opened};}
      default:throw Error('This desktop workspace operation is unavailable.');
    }
  };
}
module.exports={createHost};
