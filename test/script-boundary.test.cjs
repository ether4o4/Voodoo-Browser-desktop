'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../renderer/mobile/studio/engine.js');
const {Scripts}=require('../src/scripts.cjs');
const {hash}=require('../src/workspace.cjs');
function fixture(extra=''){
 const script={id:'fixture',name:'Fixture',enabled:true,code:'// ==UserScript==\n// @name Fixture\n// @match https://example.com/*\n// @grant none\n'+extra+'\n// ==/UserScript==\n'};
 let writes=0;const workspace={scripts:()=>[script],get:()=>({}),runtime:()=>({values:{},blocked:[]}),snapshot:()=>({logs:[],dependencies:{}}),setValue:async()=>{writes++;},log:async()=>{}};
 const runner=new Scripts(workspace),replies=[],c={id:10,scriptId:script.id,hash:hash(script.code),meta:E.metadata(script.code),frameId:'main',manual:false,token:'private-token',menus:new Map(),requests:new Map(),opened:new Set(),pending:0,count:0,since:Date.now()};
 const state={closed:false,contexts:new Map([[c.id,c]]),mainFrame:'main',frames:new Map([['main','https://example.com/']]),registrations:new Map([[script.id,{world:'private-world',binding:'private-binding',script}]]),tab:{id:'tab'}};
 runner.tabs.set('tab',state);runner.reply=async(_s,_c,r)=>replies.push(r);
 return {runner,state,c,script,replies,get writes(){return writes;},call:args=>runner.dispatch(state,c,JSON.stringify({id:'1',...args}))};
}
test('native grant enforcement rejects forged storage messages even if renderer API wrappers are bypassed',async()=>{const f=fixture();await f.call({op:'setValue',key:'secret',value:1});assert.equal(f.writes,0);assert.match(f.replies.at(-1).error,/Missing @grant/);});
test('binding events from a website default world or unknown context cannot access the native bridge',async()=>{const f=fixture();f.runner.event(f.state,'Runtime.executionContextCreated',{context:{id:50,name:'private-world',auxData:{isDefault:true,frameId:'main'}}});assert.equal(f.state.contexts.has(50),false);f.runner.event(f.state,'Runtime.bindingCalled',{executionContextId:50,name:'private-binding',payload:'{"id":"1","op":"ready"}'});f.runner.event(f.state,'Runtime.bindingCalled',{executionContextId:10,name:'wrong-binding',payload:'{"id":"1","op":"ready"}'});await Promise.resolve();assert.equal(f.replies.length,0);});
test('native matching uses the actual frame URL rather than a URL claimed by a script',async()=>{const f=fixture();f.state.frames.set('main','https://unrelated.example/');await f.call({op:'ready',url:'https://example.com/'});assert.match(f.replies.at(-1).error,/outside/);});
test('noframes is enforced in the native process for matching subframes',async()=>{const f=fixture('// @noframes');f.c.frameId='child';f.state.frames.set('child','https://example.com/');await f.call({op:'ready'});assert.match(f.replies.at(-1).error,/outside/);});
test('deleting a context cancels only its requests and revokes late side effects',async()=>{const f=fixture('// @grant GM_setValue'),controller=new AbortController();f.c.requests.set('own',controller);f.runner.dropContext(f.state,10);assert.equal(controller.signal.aborted,true);await f.call({op:'setValue',key:'late',value:1});assert.equal(f.writes,0);assert.match(f.replies.at(-1).error,/closed/);});
test('changing installed source revokes an older context even when its declared grants match',async()=>{const f=fixture();f.script.code+='\n// new version';await f.call({op:'ready'});assert.match(f.replies.at(-1).error,/inactive/);});
test('rejected excess requests cannot lower the count of native operations still in flight',async()=>{const f=fixture();f.c.pending=32;await f.call({op:'ready'});assert.equal(f.c.pending,32);assert.match(f.replies.at(-1).error,/rate limit/);f.c.pending=0;await f.call({op:'ready'});assert.equal(f.c.pending,0);assert.equal(f.replies.at(-1).ok,true);});
