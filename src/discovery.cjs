'use strict';
const {getDomain}=require('tldts');
const {websiteUrl}=require('./policy.cjs');
const E=require('../renderer/mobile/studio/engine.js');
const {request}=require('./script-network.cjs');
const {validateScript}=require('./workspace.cjs');
function catalogHost(url){const host=new URL(websiteUrl(url)).hostname.toLowerCase().replace(/\.$/,'');return getDomain(host,{allowPrivateDomains:true})||host;}
class Discovery {
  constructor({network=request}={}){this.network=network;this.cache=new Map();this.active=null;this.records=new Map();}
  cancel(){this.active?.abort();this.active=null;}
  async list(url,refresh=false){
    this.cancel();const domain=catalogHost(url),cached=this.cache.get(domain);if(!refresh&&cached&&Date.now()-cached.at<600000)return {domain,records:cached.records};
    const controller=new AbortController();this.active=controller;
    try{
      const response=await this.network({url:'https://api.greasyfork.org/scripts/by-site/'+encodeURIComponent(domain)+'.json?language=all'},{signal:controller.signal,allow:address=>{if(new URL(websiteUrl(address)).hostname!=='api.greasyfork.org')throw Error('Unexpected discovery redirect.');}});
      if(response.status!==200)throw Error('Greasy Fork HTTP '+response.status);
      const all=JSON.parse(response.responseText);if(!Array.isArray(all))throw Error('Invalid script catalog.');
      const records=all.slice(0,1000).filter(r=>r&&Number.isSafeInteger(r.id)&&typeof r.name==='string'&&typeof r.code_url==='string').map(r=>({id:r.id,name:r.name.slice(0,200),description:String(r.description||'').slice(0,1000),code_url:r.code_url,url:r.url,version:String(r.version||''),daily_installs:Number(r.daily_installs)||0}));
      if(controller.signal.aborted)throw Error('Discovery cancelled.');
      for(const r of records)this.records.set(String(r.id),r);
      this.cache.delete(domain);this.cache.set(domain,{at:Date.now(),records});while(this.cache.size>8)this.cache.delete(this.cache.keys().next().value);
      // Bound catalog identity storage as well as visible result caches.
      this.records=new Map([...this.cache.values()].flatMap(c=>c.records.map(r=>[String(r.id),r])));
      return {domain,records};
    }finally{if(this.active===controller)this.active=null;}
  }
  async code(id){
    const record=this.records.get(String(id));if(!record)throw Error('Refresh discovery before opening this result.');
    this.cancel();const controller=new AbortController();this.active=controller;
    try{const response=await this.network({url:record.code_url},{limit:200000,signal:controller.signal,allow:url=>{if(!['update.greasyfork.org','greasyfork.org'].includes(new URL(websiteUrl(url)).hostname))throw Error('Untrusted script code host.');}});if(response.status!==200)throw Error('Script source HTTP '+response.status);const code=response.responseText;const meta=validateScript({id:'review',name:record.name.slice(0,120),code,enabled:false});return {record,code,metadata:meta,issues:E.diagnostics(meta)};}
    finally{if(this.active===controller)this.active=null;}
  }
  async update(script){const meta=E.metadata(script.code),url=meta.fields.downloadURL?.[0]||script.sourceURL;if(!url||url==='none'||meta.fields.updateURL?.[0]==='none')throw Error('No update source configured.');const response=await this.network({url},{limit:200000});if(response.status!==200)throw Error('Update source HTTP '+response.status);const next=validateScript({...script,code:response.responseText,enabled:false,activation:'saved'});return {changed:script.code!==response.responseText,code:response.responseText,oldVersion:meta.version,version:next.version,url};}
}
module.exports={Discovery,catalogHost};
