'use strict';
const {randomUUID,createHash}=require('node:crypto');
const vm=require('node:vm');
const E=require('../renderer/mobile/studio/engine.js');
const Pins=require('../renderer/mobile/pins.js');
const {request}=require('./script-network.cjs');
const keys=new Set(['studio','options','notes','bookmarks','pins','fourgauteau.workbench.v1']);
const copy=x=>x===undefined?null:structuredClone(x);
const hash=code=>createHash('sha256').update(code).digest('hex');
const safeId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id)&&!['constructor','prototype','__proto__'].includes(id);
const blank=()=>({scripts:[],draft:null,history:[],chat:{provider:'venice',messages:[]},_revision:0});
function validateScript(s) {
  if(!s||!safeId(s.id)||typeof s.name!=='string'||s.name.length>120||typeof s.code!=='string'||s.code.length>200000)throw Error('Invalid saved script.');
  const meta=E.metadata(s.code);new vm.Script('(function(){\n'+s.code+'\n})');
  if(s.enabled||s.activation==='manual'){const issues=E.diagnostics(meta);if(issues.length)throw Error(issues.join('\n'));}
  return meta;
}
class Workspace {
  constructor(store,{review=async()=>false,network=request,onChange=()=>{}}={}){this.store=store;this.review=review;this.network=network;this.onChange=onChange;this.queue=Promise.resolve();}
  snapshot(){const d=this.store.snapshot();d.areas??={};d.runtime??={};d.dependencies??={};d.logs??=[];return d;}
  get(key){if(!keys.has(key))throw Error('Unknown workspace area.');return copy(this.snapshot().areas[key]);}
  update(change){const operation=this.queue.catch(()=>{}).then(async()=>{const data=this.snapshot();const result=await change(data);await this.store.save(data);await this.onChange();return copy(result);});this.queue=operation;return operation;}
  async prepare(s,data){
    const key=hash(s.code);if(data.dependencies[key])return;
    const meta=validateScript(s),deps=[];
    for(const type of ['require','resource'])for(const value of meta.fields[type]||[]){
      if(deps.length>=20)throw Error('Up to 20 dependencies per script.');
      const parts=type==='resource'?value.split(/\s+/):['',value];if(parts.length!==2)throw Error('Invalid @resource.');
      const r=await this.network({url:parts[1]},{limit:type==='require'?1_000_000:2_000_000});if(r.status!==200)throw Error('Dependency HTTP '+r.status);
      if(type==='require')new vm.Script('(function(){\n'+r.responseText+'\n})');deps.push({type,name:parts[0],...r});
    }
    data.dependencies[key]=deps;
  }
  async put(key,value,expectedRevision){
    if(!keys.has(key)||JSON.stringify(value).length>4_500_000)throw Error('Invalid workspace data.');
    return this.update(async data=>{
      if(key==='studio'){
        const previous=data.areas.studio||blank();
        if(expectedRevision!==(previous._revision||0))throw Error('Workspace changed. Your draft was kept.');
        if(!Array.isArray(value.scripts)||value.scripts.length>100||!Array.isArray(value.history)||value.history.length>20||value._revision!==expectedRevision+1)throw Error('Invalid script workspace.');
        const ids=new Set(),approvals=[];
        for(const script of value.scripts){validateScript(script);if(ids.has(script.id))throw Error('Duplicate script ID.');ids.add(script.id);const old=previous.scripts.find(s=>s.id===script.id);if(script.enabled&&(!old?.enabled||old.code!==script.code))approvals.push(script);}
        if(approvals.length&&!await this.review(approvals,'automatic'))throw Error('Automatic script activation declined. Your draft was kept.');
        for(const s of value.scripts){const old=previous.scripts.find(x=>x.id===s.id);const runtime=data.runtime[s.id]??={values:{},blocked:[],history:[]};if(old&&old.code!==s.code)runtime.history=[{...old,savedAt:Date.now()},...runtime.history].slice(0,20);if(s.enabled)await this.prepare(s,data);}
        for(const id of Object.keys(data.runtime))if(!ids.has(id))delete data.runtime[id];
        // Dependency bodies are private cache, retained only while installed or versioned.
        const retained=new Set(value.scripts.flatMap(s=>[hash(s.code),...(data.runtime[s.id]?.history||[]).map(v=>hash(v.code))]));for(const id of Object.keys(data.dependencies))if(!retained.has(id))delete data.dependencies[id];
      }else if(key==='pins')value=Pins.validate(value);
      else if(key==='options'){
        if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid settings.');
        if(value.workspaceNames)value.workspaceNames=Pins.workspaceNames(value.workspaceNames);
        if(value.homeImage&&(!/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/]+=*$/i.test(value.homeImage)||value.homeImage.length>2_800_000))throw Error('Choose a supported image under 2 MB.');
      }
      data.areas[key]=copy(value);return true;
    });
  }
  scripts(){return this.get('studio')?.scripts||[];}
  runtime(id){return copy(this.snapshot().runtime[id]||{values:{},blocked:[],history:[]});}
  async log(scriptId,url,level,text){return this.update(d=>{d.logs.unshift({scriptId,url:String(url).slice(0,2048),level,text:String(text).slice(0,4000),at:Date.now()});d.logs=d.logs.slice(0,100);return true;});}
  async setValue(id,key,value,deleted=false){if(typeof key!=='string'||key.length>1000||(!deleted&&JSON.stringify(value).length>1_000_000))throw Error('Script value too large.');return this.update(d=>{if(!this.scripts().some(s=>s.id===id))throw Error('Script was removed.');const r=d.runtime[id]??={values:{},blocked:[],history:[]};if(deleted)delete r.values[key];else Object.defineProperty(r.values,key,{value:copy(value),writable:true,enumerable:true,configurable:true});if(JSON.stringify(r.values).length>1_000_000)throw Error('Script storage limit reached.');return true;});}
  async saveChoice({scriptId,code,name,sourceURL,sourceHost,mode,expectedHash}){
    if(!['saved','automatic','manual'].includes(mode))throw Error('Choose an activation mode.');
    // CAS plus source identity prevent a stale Magic screen overwriting an editor save.
    await this.queue.catch(()=>{});const studio=this.get('studio')||blank(),existing=studio.scripts.find(s=>s.id===scriptId);
    if(scriptId&&(!existing||hash(existing.code)!==expectedHash))throw Error('The saved script changed. Reopen its options.');
    if(!existing&&studio.scripts.some(s=>sourceURL&&s.sourceURL===sourceURL))throw Error('Already saved. Select it under Saved scripts.');
    const script={...(existing||{}),id:existing?.id||randomUUID(),name:existing?.name||name||E.metadata(code).name,code:existing?.code||code,enabled:mode==='automatic',activation:mode,updated:new Date().toISOString()};
    if(!existing){script.sourceURL=sourceURL||'';script.sourceHost=sourceHost||'';}
    studio.scripts=studio.scripts.filter(s=>s.id!==script.id);studio.scripts.push(script);const rev=studio._revision||0;studio._revision=rev+1;
    await this.put('studio',studio,rev);return script;
  }
  async rollback(scriptId,index){const item=this.runtime(scriptId).history[index];if(!item)throw Error('Version no longer available.');const studio=this.get('studio'),rev=studio._revision;studio.scripts=studio.scripts.map(s=>s.id===scriptId?{...item,id:scriptId,enabled:false,activation:'saved'}:s);studio._revision=rev+1;return this.put('studio',studio,rev);}
  async restore(backup){
    if(!backup||typeof backup!=='object')throw Error('Invalid backup.');
    const studio=copy(backup.studio);if(!Array.isArray(studio?.scripts)||studio.scripts.length>100)throw Error('Invalid scripts in backup.');
    const ids=new Set();for(const s of studio.scripts){s.enabled=false;s.activation='saved';validateScript(s);if(ids.has(s.id))throw Error('Duplicate script ID.');ids.add(s.id);}
    if(backup.pins)Pins.validate(backup.pins);
    return this.update(data=>{studio._revision=(data.areas.studio?._revision||0)+1;data.areas.studio=studio;for(const k of ['options','notes','bookmarks','pins'])if(backup[k]!==undefined)data.areas[k]=copy(backup[k]);if(backup.workbench)data.areas['fourgauteau.workbench.v1']=copy(backup.workbench);data.runtime={};data.dependencies={};for(const s of studio.scripts){const r=backup.scriptRuntime?.[s.id];if(r){if(!r.values||typeof r.values!=='object'||Array.isArray(r.values)||JSON.stringify(r.values).length>1_000_000)throw Error('Invalid script value backup.');data.runtime[s.id]={values:copy(r.values),blocked:Array.isArray(r.blocked)?r.blocked.filter(h=>typeof h==='string'&&/^[a-z0-9.-]+$/i.test(h)):[],history:(r.history||[]).slice(0,20).map(v=>{validateScript({...v,id:s.id});return {...v,id:s.id,enabled:false,activation:'saved'};})};}}return true;});
  }
}
module.exports={Workspace,hash,validateScript,blank};
