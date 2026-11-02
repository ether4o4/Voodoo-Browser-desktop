const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const assets=path.join(__dirname,'../renderer/mobile');
const {API_NAMES:names}=require('../src/scripts.cjs');
const tick=()=>new Promise(r=>setTimeout(r,30));
const windows=[];test.afterEach(()=>{for(const w of windows.splice(0))w.close();});
function fixture({url='https://example.com/',grants=[],match='https://example.com/*',values={},runAt='document-start'}={}){
 const dom=new JSDOM('<body></body>',{url,runScripts:'outside-only'}),w=dom.window,calls=[];windows.push(w);let stored={...values};
 w.VoodooGM={postMessage(raw){const q=JSON.parse(raw);calls.push(q);let data=true;
  if(q.op==='ready')data={values:stored,resources:{}};
  if(q.op==='setValue')stored[q.key]=q.value;
  if(q.op==='deleteValue')delete stored[q.key];
  if(q.op==='getValue')data={found:Object.hasOwn(stored,q.key),value:stored[q.key]};
  if(q.op==='listValues')data={...stored};
  if(q.op==='xmlhttpRequest')data={status:200,statusText:'OK',readyState:4,responseText:'{"ok":true}',base64:'',responseHeaders:'content-type: application/json',finalUrl:q.details.url};
  queueMicrotask(()=>w.VoodooGM.onmessage({data:JSON.stringify({id:q.id,ok:true,data})}));
 }};
 w.eval(fs.readFileSync(path.join(assets,'studio/engine.js'),'utf8'));w.eval(fs.readFileSync(path.join(assets,'tools/runtime.js'),'utf8'));
 const code='// ==UserScript==\n// @name Fixture\n// @match '+match+'\n// @run-at '+runAt+'\n'+grants.map(g=>'// @grant '+g).join('\n')+'\n// ==/UserScript==\n';
 return {dom,w,calls,start(fn){w.VoodooRuntime({code,apiNames:names},(...args)=>fn(Object.fromEntries(names.map((n,i)=>[n,args[i]]))));},get stored(){return stored;}};
}

test('document-body runs at handshake when body exists even with a loading parser',async()=>{
 const f=fixture({runAt:'document-body'});Object.defineProperty(f.w.document,'readyState',{value:'loading'});
 let runs=0;f.start(()=>runs++);await tick();assert.equal(runs,1);f.w.document.dispatchEvent(new f.w.Event('DOMContentLoaded'));assert.equal(runs,1);
});

test('document-body pending wait cannot execute after pagehide',async()=>{
 const f=fixture({runAt:'document-body'});f.w.document.body.remove();let runs=0;f.start(()=>runs++);await tick();
 f.w.dispatchEvent(new f.w.Event('pagehide'));f.w.document.documentElement.append(f.w.document.createElement('body'));await tick();assert.equal(runs,0);assert.ok(f.calls.some(c=>c.op==='bye'));
});
test('revocation immediately stops body waiting and native error reporting',async()=>{
 const f=fixture({runAt:'document-body',grants:['GM_setValue','GM_registerMenuCommand']});f.w.document.body.remove();let runs=0;
 f.start(()=>runs++);await tick();f.w.VoodooGM.onmessage({data:JSON.stringify({event:'stop'})});
 const before=f.calls.length;f.w.document.documentElement.append(f.w.document.createElement('body'));await tick();
 f.w.dispatchEvent(new f.w.Event('error'));f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));await tick();
 assert.equal(runs,0);assert.equal(f.calls.length,before);
});
test('revoked instances cannot invoke menus or issue more native storage operations',async()=>{
 const f=fixture({grants:['GM_setValue','GM_registerMenuCommand']});let api,menu,runs=0;
 f.start(x=>{api=x;menu=x.GM_registerMenuCommand('Manual command',()=>runs++);});await tick();
 f.w.VoodooGM.onmessage({data:JSON.stringify({event:'stop'})});const before=f.calls.length;
 f.w.VoodooGM.onmessage({data:JSON.stringify({event:'menu',command:menu})});await assert.rejects(api.GM.setValue('after-stop',1),/Script stopped/);
 assert.equal(runs,0);assert.equal(f.calls.length,before);
});
test('visible route checks resume once and cannot restart after native revocation',async()=>{
 const f=fixture();let hidden=true;Object.defineProperty(f.w.document,'hidden',{get:()=>hidden});let routes=0,runs=0;
 f.w.addEventListener('voodoo:urlchange',()=>routes++);f.start(()=>runs++);await tick();
 f.w.history.pushState({},'','/hidden-route');await tick();assert.equal(routes,0);
 hidden=false;f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));await tick();assert.equal(routes,1);assert.equal(runs,1);
 f.w.VoodooGM.onmessage({data:JSON.stringify({event:'stop'})});f.w.history.pushState({},'','/stopped');f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));await tick();assert.equal(routes,1);
});
test('legacy snapshot storage and Promise storage share native state, never website storage',async()=>{
 const f=fixture({grants:['GM_getValue','GM_setValue','GM_deleteValue','GM_listValues'],values:{persisted:3}});let done;
 f.start(api=>{assert.equal(api.GM_getValue('persisted'),3);api.GM_setValue('x',{ok:true});assert.equal(JSON.stringify(api.GM_getValue('x')),'{"ok":true}');done=api.GM.setValue('y',7).then(()=>api.GM.getValue('y'));});
 await tick();assert.equal(await done,7);assert.equal(f.stored.y,7);assert.equal(f.w.localStorage.length,0);f.dom.window.close();
});
test('grant none exposes no privileged helper, and failures are independent and reported',async()=>{
 const f=fixture({grants:['none']});f.start(api=>{assert.equal(api.GM_setValue,undefined);assert.equal(api.GM.xmlHttpRequest,undefined);assert.equal(api.GM.info.scriptHandler,'Voodoo');throw Error('fixture failure');});
 await tick();assert.ok(f.calls.some(c=>c.op==='log'&&c.text.includes('fixture failure')));assert.ok(f.calls.some(c=>c.op==='health'&&c.state==='failed'));f.dom.window.close();
});
test('unmatched and internal pages do not even contact the native script bridge',async()=>{
 for(const url of ['https://elsewhere.org/','https://appassets.androidplatform.net/assets/home.html']){const f=fixture({url});f.start(()=>assert.fail('must not run'));await tick();assert.equal(f.calls.length,0);f.dom.window.close();}
});
test('value change listeners distinguish local and remote changes and can be removed',async()=>{
 const f=fixture({grants:['GM_setValue','GM_addValueChangeListener','GM_removeValueChangeListener']});const changes=[];let api,id;
 f.start(x=>{api=x;id=x.GM_addValueChangeListener('k',(...args)=>changes.push(args));x.GM_setValue('k',1);});await tick();
 f.w.VoodooGM.onmessage({data:JSON.stringify({event:'value',key:'k',value:2,remote:true})});
 api.GM_removeValueChangeListener(id);f.w.VoodooGM.onmessage({data:JSON.stringify({event:'value',key:'k',value:3,remote:true})});
 assert.equal(changes.length,2);assert.equal(changes[0][3],false);assert.equal(changes[1][3],true);f.dom.window.close();
});
test('modern XHR parses JSON and legacy calls deliver callbacks',async()=>{
 const f=fixture({grants:['GM.xmlHttpRequest']});let modern,legacy;
 f.start(api=>{modern=api.GM.xmlHttpRequest({url:'https://api.example.com/',responseType:'json'});api.GM_xmlhttpRequest({url:'https://api.example.com/',onload:r=>legacy=r.status});});
 await tick();assert.equal((await modern).response.ok,true);assert.equal(legacy,200);f.dom.window.close();
});
test('menus register native commands and dispatch only their own callback',async()=>{
 const f=fixture({grants:['GM_registerMenuCommand','GM_unregisterMenuCommand']});let ran=0,id,api;
 f.start(x=>{api=x;id=x.GM_registerMenuCommand('Test',()=>ran++);});await tick();f.w.VoodooGM.onmessage({data:JSON.stringify({event:'menu',command:id})});assert.equal(ran,1);api.GM_unregisterMenuCommand(id);f.w.VoodooGM.onmessage({data:JSON.stringify({event:'menu',command:id})});assert.equal(ran,1);f.dom.window.close();
});
test('source diffs remain reviewable and do not apply code',()=>{
 const {diff}=require(path.join(assets,'studio/script-hub.js'));assert.equal(diff('a','a'),'No source changes.');assert.match(diff('a\nold\nz','a\nnew\nz'),/-old\n\+new/);
});
