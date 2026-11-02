'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const E=require('../renderer/mobile/studio/engine.js');
const {hash,validateScript}=require('./workspace.cjs');
const {connects,request}=require('./script-network.cjs');
const {websiteUrl}=require('./policy.cjs');
const API_NAMES=['GM',...('addStyle addElement getValue setValue deleteValue listValues getValues setValues deleteValues addValueChangeListener removeValueChangeListener xmlhttpRequest getResourceText getResourceURL download setClipboard registerMenuCommand unregisterMenuCommand notification info log openInTab'.split(' ').map(n=>'GM_'+n)),'console'];
const engine=fs.readFileSync(path.join(__dirname,'../renderer/mobile/studio/engine.js'),'utf8');
const runtime=fs.readFileSync(path.join(__dirname,'../renderer/mobile/tools/runtime.js'),'utf8').replace("os:'android'","os:'windows'");
const grant=(meta,name)=>name==='info'||meta.grants.includes('GM_'+name)||meta.grants.includes('GM.'+name)||(name==='xmlhttpRequest'&&meta.grants.includes('GM.xmlHttpRequest'));
function source(script,deps,binding){
  const required=deps.filter(d=>d.type==='require').map(d=>d.responseText).join('\n;\n');
  return '(function(){"use strict";\n'+engine+'\nconst config='+JSON.stringify({code:script.code,apiNames:API_NAMES})+';if(!VoodooEngine.matches(VoodooEngine.metadata(config.code),location.href))return;\nglobalThis.VoodooGM={postMessage(raw){globalThis['+JSON.stringify(binding)+'](raw);},onmessage:null};\n'+runtime+'\nVoodooRuntime(config,function('+API_NAMES.join(',')+'){\n'+required+'\n;\n'+script.code+'\n});})();';
}
class Scripts {
  constructor(workspace,{review,clipboard,download,openTab,closeTab,notify,network=request}={}){
    this.workspace=workspace;Object.assign(this,{review,clipboard,download,openTab,closeTab,notify,network});this.tabs=new Map();this.health={};this.refreshQueue=Promise.resolve();
  }
  async add(tab){
    const wc=tab.view.webContents,debug=wc.debugger;
    const state={tab,debug,registrations:new Map(),contexts:new Map(),frames:new Map(),manual:new Set(),pending:new Map(),closed:false};this.tabs.set(tab.id,state);
    debug.on('message',(_e,method,p)=>this.event(state,method,p));
    debug.on('detach',()=>{this.invalidate(tab.id);state.closed=true;void this.workspace.log('',tab.url,'error','Script isolation detached. Reload or reopen this tab.').catch(()=>{});});
    try{debug.attach('1.3');await debug.sendCommand('Runtime.enable');await debug.sendCommand('Page.enable');const {frameTree}=await debug.sendCommand('Page.getFrameTree');state.mainFrame=frameTree.frame.id;state.frames.set(frameTree.frame.id,frameTree.frame.url);await this.refreshTab(state);}
    catch(e){state.closed=true;void this.workspace.log('',tab.url,'error','Script isolation unavailable: '+e.message).catch(()=>{});}
  }
  event(s,method,p){
    if(s.closed)return;
    if(method==='Page.frameNavigated'){s.frames.set(p.frame.id,p.frame.url);if(!p.frame.parentId)s.mainFrame=p.frame.id;}
    if(method==='Page.navigatedWithinDocument')s.frames.set(p.frameId,p.url);
    if(method==='Page.frameDetached')s.frames.delete(p.frameId);
    if(method==='Runtime.executionContextCreated'){
      const ctx=p.context,reg=[...s.registrations.values()].find(r=>r.world===ctx.name);
      if(reg&&!ctx.auxData?.isDefault)s.contexts.set(ctx.id,{id:ctx.id,scriptId:reg.script.id,hash:hash(reg.script.code),meta:reg.meta,frameId:ctx.auxData?.frameId,manual:s.manual.has(reg.script.id),token:randomUUID(),menus:new Map(),opened:new Set(),requests:new Map(),count:0,since:Date.now(),pending:0});
    }
    if(method==='Runtime.executionContextDestroyed')this.dropContext(s,p.executionContextId);
    if(method==='Runtime.executionContextsCleared')for(const id of [...s.contexts.keys()])this.dropContext(s,id);
    if(method==='Runtime.bindingCalled'){
      const c=s.contexts.get(p.executionContextId);if(!c)return;const reg=s.registrations.get(c.scriptId);
      if(p.name!==reg?.binding)return;
      void this.dispatch(s,c,p.payload);
    }
  }
  dropContext(s,id){const c=s.contexts.get(id);if(!c)return;for(const ctl of c.requests.values())ctl.abort();c.menus.clear();s.contexts.delete(id);}
  invalidate(id){const s=this.tabs.get(id);if(s)for(const ctx of [...s.contexts.keys()])this.dropContext(s,ctx);}
  remove(id){const s=this.tabs.get(id);if(!s)return;this.invalidate(id);s.closed=true;this.tabs.delete(id);try{if(s.debug.isAttached())s.debug.detach();}catch{}}
  eligible(s,c){
    if(s.closed||!s.contexts.has(c.id))throw Error('This script document is closed.');
    const installed=this.workspace.scripts().find(x=>x.id===c.scriptId),url=s.frames.get(c.frameId);
    if(!installed||hash(installed.code)!==c.hash||this.workspace.get('options')?.scripts===false||(!installed.enabled&&!c.manual)||!url||!E.matches(c.meta,url)||(c.meta.noframes&&c.frameId!==s.mainFrame))throw Error('Script is inactive or this document is outside its allowed sites.');
    const host=new URL(url).hostname.toLowerCase().replace(/\.$/,'');if(this.workspace.runtime(c.scriptId).blocked.includes(host))throw Error('Script is blocked on this website.');return {installed,url};
  }
  async reply(s,c,value){if(s.closed||!s.contexts.has(c.id))return;try{await s.debug.sendCommand('Runtime.callFunctionOn',{executionContextId:c.id,functionDeclaration:'function(raw){globalThis.VoodooGM?.onmessage?.({data:raw});}',arguments:[{value:JSON.stringify(value)}]});}catch{}}
  refresh(){const op=this.refreshQueue.catch(()=>{}).then(()=>Promise.all([...this.tabs.values()].map(s=>this.refreshTab(s))));this.refreshQueue=op;return op;}
  async refreshTab(s){
    if(s.closed)return;const enabled=this.workspace.get('options')?.scripts!==false;
    const wanted=new Map(this.workspace.scripts().filter(x=>enabled&&(x.enabled||s.manual.has(x.id))).map(x=>[x.id,x]));
    for(const [id,r] of [...s.registrations])if(!wanted.has(id)||hash(wanted.get(id).code)!==hash(r.script.code)||(wanted.has(id)&&r.identifier===null)){
      const installed=this.workspace.scripts().find(x=>x.id===id);
      if(!wanted.has(id)&&enabled&&installed&&hash(installed.code)===hash(r.script.code)&&r.identifier===null&&[...s.contexts.values()].some(c=>c.scriptId===id&&c.manual))continue;
      await s.debug.sendCommand('Page.removeScriptToEvaluateOnNewDocument',{identifier:r.identifier}).catch(()=>{});
      // Existing DOM changes need a reload, but native privileges and runtime watchers stop now.
      for(const c of s.contexts.values())if(c.scriptId===id){await this.reply(s,c,{event:'stop'});for(const ctl of c.requests.values())ctl.abort();c.menus.clear();c.manual=false;}
      await s.debug.sendCommand('Runtime.removeBinding',{name:r.binding}).catch(()=>{});s.registrations.delete(id);
    }
    for(const [id,script] of wanted)if(!s.registrations.has(id)){
      const meta=validateScript(script),suffix=hash(script.id+script.code).slice(0,24),binding='__voodoo_gm_'+suffix,world='voodoo-script-'+suffix;
      const reg={script,meta,binding,world,identifier:null};s.registrations.set(id,reg);
      try{await s.debug.sendCommand('Runtime.addBinding',{name:binding,executionContextName:world});const r=await s.debug.sendCommand('Page.addScriptToEvaluateOnNewDocument',{worldName:world,source:source(script,this.workspace.snapshot().dependencies[hash(script.code)]||[],binding)});reg.identifier=r.identifier;}
      catch(e){s.registrations.delete(id);void this.workspace.log(id,s.tab.url,'error','Registration failed: '+e.message).catch(()=>{});}
    }
  }
  async manual(tab,script){
    await tab.scriptsReady;const s=this.tabs.get(tab.id);if(!s||s.closed)throw Error('Script isolation is unavailable in this tab.');
    const installed=this.workspace.scripts().find(x=>x.id===script.id);
    if(!installed||installed.activation!=='manual'||installed.enabled||installed.code!==script.code)throw Error('Save this script with Manual activation first.');
    const meta=validateScript(installed);if(!E.matches(meta,tab.view.webContents.getURL()))throw Error('This script does not match the current website.');
    if(this.workspace.get('options')?.scripts===false)throw Error('Enable Userscripts in Workbench settings first.');
    if(this.workspace.runtime(installed.id).blocked.includes(new URL(tab.view.webContents.getURL()).hostname))throw Error('This script is blocked on the current website.');
    if(!await this.review([installed],'manual'))throw Error('Manual activation declined.');
    await this.workspace.update(async d=>{await this.workspace.prepare(installed,d);});
    s.manual.add(installed.id);await this.refresh();
    const finish=()=>{tab.view.webContents.removeListener('did-finish-load',finish);tab.view.webContents.removeListener('did-fail-load',failed);s.manual.delete(installed.id);void this.expireManualRegistration(s,installed.id);};
    const failed=(_event,code,_desc,_url,main)=>{if(main&&code!==-3)finish();};
    tab.view.webContents.once('did-finish-load',finish);tab.view.webContents.on('did-fail-load',failed);
    tab.view.webContents.reload();return 'Activated. The website reloads once; saving by itself does not reload it.';
  }
  async expireManualRegistration(s,id){const r=s.registrations.get(id);if(!r||r.script.enabled)return;await s.debug.sendCommand('Page.removeScriptToEvaluateOnNewDocument',{identifier:r.identifier}).catch(()=>{});r.identifier=null;/* Keep binding for this live document only. */}
  status(){const scripts={};for(const script of this.workspace.scripts())scripts[script.id]={state:this.health[script.id]?.state||(script.enabled?'automatic':script.activation==='manual'?'manual':'saved'),...this.health[script.id],versions:this.workspace.runtime(script.id).history};return {isolatedWorlds:true,scripts,logs:this.workspace.snapshot().logs,menus:[...this.tabs.values()].flatMap(s=>[...s.contexts.values()].flatMap(c=>[...c.menus].map(([command,name])=>({tabId:s.tab.id,context:c.token,command,name,scriptId:c.scriptId}))))};}
  async menu({tabId,context,command}){const s=this.tabs.get(tabId),c=s&&[...s.contexts.values()].find(c=>c.token===context);if(!c||!c.menus.has(command))throw Error('Menu no longer active.');this.eligible(s,c);await this.reply(s,c,{event:'menu',command});return true;}
  async dispatch(s,c,raw){
    let req,counted=false;
    try{
      if(typeof raw!=='string'||raw.length>1_100_000)throw Error('Script request too large.');req=JSON.parse(raw);if(typeof req.id!=='string'||req.id.length>100)throw Error('Invalid script request.');
      if(Date.now()-c.since>=1000){c.since=Date.now();c.count=0;}if(++c.count>100||c.pending>=32)throw Error('Script request rate limit reached.');
      const {url}=this.eligible(s,c);c.pending++;counted=true;
      const alias={ready:'info',health:'info',bye:'info',log:'info',menu:'registerMenuCommand',unmenu:'unregisterMenuCommand',closeTab:'openInTab',abort:'xmlhttpRequest'};
      const op=req.op,permission=alias[op]||op,bulk=op==='setValue'&&grant(c.meta,'setValues')||op==='deleteValue'&&grant(c.meta,'deleteValues')||op==='getValue'&&grant(c.meta,'getValues')||op==='abort'&&grant(c.meta,'download');
      if(!grant(c.meta,permission)&&!bulk)throw Error('Missing @grant GM_'+permission);
      let result=true;
      switch(op){
        case 'ready':{const resources={};for(const dep of this.workspace.snapshot().dependencies[c.hash]||[])if(dep.type==='resource')Object.defineProperty(resources,dep.name,{value:dep,enumerable:true});result={values:this.workspace.runtime(c.scriptId).values,resources};break;}
        case 'getValue':{const values=this.workspace.runtime(c.scriptId).values;result={found:Object.hasOwn(values,req.key),value:values[req.key]??null};break;}
        case 'listValues':result=this.workspace.runtime(c.scriptId).values;break;
        case 'setValue':case 'deleteValue':{
          await this.workspace.setValue(c.scriptId,req.key,req.value,op==='deleteValue');
          for(const tab of this.tabs.values())for(const other of tab.contexts.values())if(other.scriptId===c.scriptId)await this.reply(tab,other,{event:'value',key:req.key,value:req.value,deleted:op==='deleteValue',remote:other.token!==c.token});break;
        }
        case 'xmlhttpRequest':case 'download':{
          const controller=new AbortController();c.requests.set(req.id,controller);
      const allow=address=>{this.eligible(s,c);if(!connects(c.meta,address,url))throw Error('Blocked by @connect.');};
          try{if(op==='download'){allow(req.details.url);if(!await this.review([{name:'Download '+String(req.details.name||'download'),code:c.meta.name+'\n'+req.details.url}],'download'))throw Error('Download declined.');this.eligible(s,c);}
            const response=await this.network(req.details,{allow,signal:controller.signal});this.eligible(s,c);result=op==='download'?await this.download(req.details.name,response):response;
          }finally{c.requests.delete(req.id);}break;
        }
        case 'abort':c.requests.get(req.requestId)?.abort();break;
        case 'log':await this.workspace.log(c.scriptId,url,req.level,req.text);break;
        case 'health':this.health[c.scriptId]={state:req.state,duration:Number(req.duration)||0,at:Date.now()};break;
        case 'bye':this.dropContext(s,c.id);return;
        case 'menu':if(c.menus.size>=30)throw Error('Script menu limit reached.');if(typeof req.command!=='string'||typeof req.name!=='string'||req.name.length>200)throw Error('Invalid menu.');c.menus.set(req.command,req.name);break;
        case 'unmenu':c.menus.delete(req.command);break;
        case 'setClipboard':if(typeof req.text!=='string'||req.text.length>1_000_000)throw Error('Clipboard text too large.');if(!await this.review([{name:c.meta.name,code:'Copy '+req.text.length+' characters to the clipboard?'}],'clipboard'))throw Error('Clipboard request declined.');this.eligible(s,c);this.clipboard.writeText(req.text);break;
        case 'notification':if(c.notifications)throw Error('Dismiss the previous notification first.');c.notifications=true;try{await this.notify(String(req.title||c.meta.name).slice(0,120),String(req.text||'').slice(0,4000));}finally{c.notifications=false;}break;
        case 'openInTab':{
          const target=websiteUrl(req.target);if(!await this.review([{name:c.meta.name,code:target}],'tab'))throw Error('Opening a tab was declined.');this.eligible(s,c);result=await this.openTab(target,req.active!==false);c.opened.add(result);break;
        }
        case 'closeTab':if(!c.opened.has(req.tabId))throw Error('A script can close only its own tabs.');this.closeTab(req.tabId);c.opened.delete(req.tabId);break;
        default:throw Error('Unsupported script operation.');
      }
      await this.reply(s,c,{id:req.id,ok:true,data:result});
    }catch(e){if(req?.id)await this.reply(s,c,{id:req.id,ok:false,error:e.message});}
    finally{if(counted)c.pending=Math.max(0,c.pending-1);}
  }
}
module.exports={Scripts,source,API_NAMES,grant};
