/* Executed only in a per-script AndroidX isolated world, before literal userscript source. */
function VoodooRuntime(config, entry) {
  'use strict';
  const bridge=globalThis.VoodooGM, E=VoodooEngine, meta=E.metadata(config.code);
  if(location.hostname.replace(/\.$/,'')==='appassets.androidplatform.net'||(meta.noframes&&top!==window))return;
  const pending=new Map(),listeners=new Map(),menus=new Map();let seq=0,values=Object.create(null),resources={},started=false,lastURL=location.href,live=true,routeTimer=null,bodyObserver=null;
  const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
  const has=key=>Object.prototype.hasOwnProperty.call(values,key);
  function call(op,args={}) {
    if(!live)return Promise.reject(Error('Script stopped. Reload this page.'));
    const id=String(++seq);
    const result=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('Native script operation timed out: '+op));},70000);
      pending.set(id,{resolve,reject,timer});
      try{bridge.postMessage(JSON.stringify({...args,id,op,url:location.href}));}
      catch(e){clearTimeout(timer);pending.delete(id);reject(e);}
    });result.requestId=id;return result;
  }
  function log(level,...items){if(live)call('log',{level,text:items.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ').slice(0,4000)}).catch(()=>{});}
  function stop(){live=false;clearTimeout(routeTimer);routeTimer=null;bodyObserver?.disconnect();bodyObserver=null;listeners.clear();menus.clear();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Script stopped. Reload this page.'));}pending.clear();}
  function changed(key,oldValue,newValue,remote){for(const [name,callback] of listeners.values())if(name===key)try{callback(key,copy(oldValue),copy(newValue),remote);}catch(e){log('error',e.message);}}
  bridge.onmessage=event=>{
    let r;try{r=JSON.parse(event.data);}catch{return;}
    if(r.event==='stop'){stop();return;}
    if(!live)return;
    if(r.event==='value'){
      const old=has(r.key)?values[r.key]:undefined;if(r.deleted)delete values[r.key];else values[r.key]=r.value;
      if(r.remote)changed(r.key,old,r.deleted?undefined:r.value,true);return;
    }
    if(r.event==='menu'){try{menus.get(r.command)?.();}catch(e){log('error',e.message);}return;}
    const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.ok?p.resolve(r.data):p.reject(Error(r.error||'Script operation failed.'));
  };
  const style=css=>{const el=document.createElement('style');el.textContent=css;(document.head||document.documentElement).append(el);return el;};
  function element(parent,tag,attrs){if(typeof parent==='string'){attrs=tag;tag=parent;parent=document.head||document.documentElement;}const el=document.createElement(tag);for(const [k,v] of Object.entries(attrs||{}))k==='textContent'?el.textContent=v:el.setAttribute(k,String(v));parent.append(el);return el;}
  const get=(key,fallback)=>copy(has(String(key))?values[String(key)]:fallback);
  function set(key,value){key=String(key);if(value===undefined)throw Error('Stored undefined is unsupported; use GM_deleteValue.');const safe=copy(value),old=get(key);values[key]=safe;changed(key,old,safe,false);return call('setValue',{key,value:safe}).catch(e=>{log('error','Storage write failed:',e.message);throw e;});}
  function del(key){key=String(key);const old=get(key);delete values[key];changed(key,old,undefined,false);return call('deleteValue',{key});}
  function resource(name,asURL){const r=resources[name];if(!r)throw Error('Unknown @resource: '+name);return asURL?'data:'+r.contentType+';base64,'+r.base64:r.responseText;}
  function xhr(details,modern=false){
    if(!details||typeof details.url!=='string')throw Error('Provide an HTTP request URL.');
    for(const key of ['fetch','cookie','cookiePartition','user','password','binary','redirect'])if(details[key]!==undefined)throw Error('Unsupported request option: '+key);
    if(details.synchronous)throw Error('Synchronous HTTP is unsupported.');
    const responseType=details.responseType||'text';if(!['text','json','arraybuffer','blob','document'].includes(responseType))throw Error('Unsupported response type.');
    const input={};for(const key of ['url','method','headers','data','timeout'])if(details[key]!==undefined)input[key]=details[key];
    let aborted=false;const task=call('xmlhttpRequest',{details:input});
    const promise=task.then(r=>{
      if(aborted)throw Error('Request aborted.');
      if(responseType==='json')r.response=JSON.parse(r.responseText);
      else if(responseType==='document')r.response=new DOMParser().parseFromString(r.responseText,'text/html');
      else if(responseType==='arraybuffer'||responseType==='blob'){const bytes=Uint8Array.from(atob(r.base64),c=>c.charCodeAt(0));r.response=responseType==='blob'?new Blob([bytes],{type:r.contentType}):bytes.buffer;}
      else r.response=r.responseText;
      delete r.base64;details.onreadystatechange?.(r);details.onload?.(r);return r;
    }).catch(e=>{const r={error:e.message,status:0,readyState:4};if(aborted)details.onabort?.(r);else if(/time/i.test(e.message))details.ontimeout?.(r);else details.onerror?.(r);throw e;});
    const abort=()=>{aborted=true;call('abort',{requestId:task.requestId}).catch(()=>{});};
    promise.abort=abort;if(modern)return promise;promise.catch(e=>log('error',e.message));return {abort};
  }
  function download(details,name,modern=false){
    const d=typeof details==='string'?{url:details,name}:details;
    if(!d||typeof d.url!=='string')throw Error('Download requires an HTTPS URL.');
    const request=call('download',{details:{url:d.url,name:d.name||'download'}});
    const promise=request.then(r=>{d.onload?.();return r;}).catch(e=>{d.onerror?.({error:e.message});throw e;});
    const abort=()=>call('abort',{requestId:request.requestId}).catch(()=>{});
    promise.abort=abort;if(modern)return promise;promise.catch(e=>log('error',e.message));return {abort};
  }
  const all={
    addStyle:style,addElement:element,getValue:get,setValue:(k,v)=>{set(k,v).catch(()=>{});},
    deleteValue:k=>{del(k).catch(e=>log('error',e.message));},listValues:()=>Object.keys(values),
    getValues:keys=>Object.fromEntries((Array.isArray(keys)?keys:Object.keys(keys)).map(k=>[k,get(k,Array.isArray(keys)?undefined:keys[k])])),
    setValues:items=>{for(const [k,v] of Object.entries(items))set(k,v).catch(()=>{});},deleteValues:keys=>{for(const k of keys)del(k).catch(e=>log('error',e.message));},
    addValueChangeListener:(key,callback)=>{const id=++seq;listeners.set(id,[String(key),callback]);return id;},removeValueChangeListener:id=>listeners.delete(id),
    getResourceText:name=>resource(name,false),getResourceURL:name=>resource(name,true),
    xmlhttpRequest:xhr,log:(...items)=>log('info',...items),
    setClipboard:(text,info,callback)=>{call('setClipboard',{text:String(text)}).then(()=>callback?.()).catch(e=>log('error',e.message));},
    download,
    notification:(details,title,image,onclick)=>{const d=typeof details==='string'?{text:details,title}:details;call('notification',{text:d.text||'',title:d.title||meta.name}).then(()=>d.ondone?.()).catch(e=>log('error',e.message));},
    registerMenuCommand:(name,callback)=>{const id=String(++seq);menus.set(id,callback);call('menu',{command:id,name:String(name)}).catch(e=>log('error',e.message));return id;},
    unregisterMenuCommand:id=>{menus.delete(String(id));call('unmenu',{command:String(id)}).catch(()=>{});},
    openInTab:(url,options)=>{let tabId,closed=false;const p=call('openInTab',{target:new URL(url,location.href).href,active:typeof options==='object'?options.active!==false:!options}).then(id=>tabId=id);p.catch(e=>log('error',e.message));return {get closed(){return closed;},close(){closed=true;p.then(()=>call('closeTab',{tabId})).catch(e=>log('error',e.message));}}},
    info:{script:{name:meta.name,namespace:meta.namespace,version:meta.version,description:meta.description,matches:meta.matches,includes:meta.includes,excludes:meta.excludeGlobs,grant:meta.grants,resources:[]},scriptMetaStr:config.code.split('==/UserScript==')[0]+'==/UserScript==',scriptHandler:'Voodoo',version:'0.3',platform:{os:'android'},injectInto:'isolated'}
  };
  const allowed=name=>name==='info'||meta.grants.includes('GM_'+name)||meta.grants.includes('GM.'+name)||(name==='xmlhttpRequest'&&meta.grants.includes('GM.xmlHttpRequest'));
  const GM={info:all.info};for(const [name,fn] of Object.entries(all))if(name!=='info'&&allowed(name))GM[name]=(...args)=>Promise.resolve().then(()=>fn(...args));
  if(allowed('getValue'))GM.getValue=async(k,fallback)=>{const r=await call('getValue',{key:String(k)});if(r.found)values[k]=r.value;else delete values[k];return r.found?copy(r.value):fallback;};
  if(allowed('setValue'))GM.setValue=set;if(allowed('deleteValue'))GM.deleteValue=del;
  if(allowed('xmlhttpRequest'))GM.xmlHttpRequest=GM.xmlhttpRequest=d=>xhr(d,true);
  if(allowed('download'))GM.download=(details,name)=>download(details,name,true);
  if(allowed('setClipboard'))GM.setClipboard=text=>call('setClipboard',{text:String(text)});
  if(allowed('setValues'))GM.setValues=async items=>{for(const [k,v] of Object.entries(items))await set(k,v);};
  if(allowed('deleteValues'))GM.deleteValues=async keys=>{for(const k of keys)await del(k);};
  if(allowed('listValues'))GM.listValues=async()=>{values=Object.assign(Object.create(null),await call('listValues'));return Object.keys(values);};
  const apiNames=config.apiNames,apiArgs=apiNames.map(n=>n==='GM'?GM:n==='console'?{...console,log:(...x)=>log('info',...x),warn:(...x)=>log('warn',...x),error:(...x)=>log('error',...x)}:allowed(n.replace(/^GM_/,''))?all[n.replace(/^GM_/,'')]:undefined);
  async function start(){
    if(!live||started||!E.matches(meta,location.href))return;
    started=true;lastURL=location.href;
    try{
      const init=await call('ready');values=Object.assign(Object.create(null),init.values||{});resources=init.resources||{};
      const run=()=>{if(!live||!E.matches(meta,location.href))return;const began=performance.now();try{entry(...apiArgs);call('health',{state:'enabled',duration:performance.now()-began}).catch(()=>{});}catch(e){log('error',e.stack||e.message);call('health',{state:'failed',duration:performance.now()-began}).catch(()=>{});}};
      if(meta.runAt==='document-start')run();
      else if(meta.runAt==='document-body'){if(document.body)run();else{bodyObserver=new MutationObserver(()=>{if(document.body){bodyObserver.disconnect();bodyObserver=null;if(live)run();}});bodyObserver.observe(document,{childList:true,subtree:true});}}
      else if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>meta.runAt==='document-idle'?setTimeout(run,0):run(),{once:true});
      else meta.runAt==='document-idle'?setTimeout(run,0):run();
    }catch(e){log('error',e.message);}
  }
  addEventListener('error',e=>log('error',e.message));addEventListener('unhandledrejection',e=>log('error',String(e.reason?.stack||e.reason)));
  // Isolated history globals do not see page-world monkey-patches: detect URL changes without altering page history.
  function watchRoute(){clearTimeout(routeTimer);routeTimer=null;if(!live||document.hidden)return;if(location.href!==lastURL){const previous=lastURL;lastURL=location.href;dispatchEvent(new CustomEvent('voodoo:urlchange',{detail:{url:lastURL,previous}}));if(!started)start();}routeTimer=setTimeout(watchRoute,500);}
  document.addEventListener('visibilitychange',watchRoute);
  addEventListener('pagehide',()=>{if(live)call('bye').catch(()=>{});stop();},{once:true});
  watchRoute();
  start();
}
