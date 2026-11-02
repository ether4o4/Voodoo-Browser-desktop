const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');const root=path.join(__dirname,'../renderer/mobile');
const tick=()=>new Promise(r=>setTimeout(r,30));
async function fixture(overrides={},hash=''){
 const data={},calls=[],dom=new JSDOM(fs.readFileSync(path.join(root,'studio/index.html'),'utf8'),{url:'https://appassets.androidplatform.net/assets/studio/index.html'+hash,runScripts:'outside-only'});const w=dom.window;
 w.confirm=()=>true;w.Host={call:async(op,args={})=>{calls.push({op,args});if(overrides[op])return overrides[op](args,data);if(op==='get-store')return data[args.key]||null;if(op==='put-store'){if(args.expectedRevision!==undefined)assert.equal(args.expectedRevision,data[args.key]?._revision||0);data[args.key]=JSON.parse(JSON.stringify(args.value));return true;}if(op==='context')return {url:'https://example.com/Create',title:'Fixture',...(args.includePage?{page:{text:'Explicitly shared'}}:{})};if(op==='chat')return {text:'Done.\n```javascript\n// ==UserScript==\n// @name AI draft\n// @match https://example.com/*\n// @grant none\n// ==/UserScript==\nwindow.fromAI=true;\n```',truncated:false};if(op==='run-script')return 'Ran test';return true;}};
 w.eval(fs.readFileSync(path.join(root,'pins.js'),'utf8'));w.eval(fs.readFileSync(path.join(root,'studio/engine.js'),'utf8'));w.eval(fs.readFileSync(path.join(root,'studio/workspace.js'),'utf8'));w.eval(fs.readFileSync(path.join(root,'studio/studio.js'),'utf8'));await tick();return {dom,w,data,calls,$:id=>w.document.getElementById(id)};
}
test('manual activation saves disabled and runs only after Activate is pressed',async()=>{
 const f=await fixture({},'#workbench');try{
  f.$('script-manual').click();assert.equal(f.$('script-enabled').checked,false);assert.equal(f.$('script-saved-only').checked,false);
  f.$('save-script').click();await tick();await tick();
  assert.equal(f.data.studio.scripts[0].enabled,false);assert.equal(f.data.studio.scripts[0].activation,'manual');
  assert.equal(f.calls.filter(c=>c.op==='run-script').length,0);assert.equal(f.$('run-script').disabled,false);
  f.$('run-script').click();await tick();await tick();
  assert.equal(f.calls.filter(c=>c.op==='run-script').length,1);assert.equal(f.data.studio.scripts[0].enabled,false);
 }finally{f.dom.window.close();}
});
test('activation choices stay exclusive and saving automatic never runs the current page',async()=>{
 const f=await fixture({},'#workbench');try{
  f.$('script-manual').click();f.$('script-enabled').click();assert.equal(f.$('script-manual').checked,false);assert.equal(f.$('run-script').disabled,true);
  f.$('save-script').click();await tick();await tick();assert.equal(f.data.studio.scripts[0].enabled,true);assert.equal(f.calls.some(c=>c.op==='run-script'),false);
  f.$('script-saved-only').click();f.$('save-script').click();await tick();await tick();
  assert.equal(f.data.studio.scripts[0].enabled,false);assert.equal(f.data.studio.scripts[0].activation,'saved');assert.equal(f.$('run-script').disabled,true);
 }finally{f.dom.window.close();}
});
test('failed script save preserves the draft and does not leave a phantom installed script',async()=>{
 const f=await fixture({'put-store':async()=>{throw Error('Save declined');}},'#workbench');try{
  f.$('script-name').value='Keep this draft';f.$('save-script').click();await tick();await tick();
  assert.equal(f.$('script-name').value,'Keep this draft');assert.equal(f.$('script-list').querySelectorAll('button').length,0);assert.match(f.$('status').textContent,/Save declined/);
 }finally{f.dom.window.close();}
});
test('website and Magic shortcuts keep the current draft before leaving the editor',async()=>{
 const f=await fixture({},'#workbench');try{
  f.$('script-name').value='Unsent draft';f.$('script-name').dispatchEvent(new f.w.Event('input'));
  f.$('back-to-site').click();await tick();await tick();assert.equal(f.data.studio.draft.name,'Unsent draft');assert.equal(f.calls.filter(c=>c.op==='return-to-site').length,1);
  f.$('magic-scripts').click();await tick();await tick();assert.equal(f.calls.filter(c=>c.op==='script-discovery').length,1);
 }finally{f.dom.window.close();}
});
test('native Magic saves merge back into the editor without dropping scripts or drafts',async()=>{
 const f=await fixture({'put-store':async(args,data)=>{if(args.expectedRevision!==(data[args.key]?._revision||0))throw Error('Workspace changed in another tab.');data[args.key]=JSON.parse(JSON.stringify(args.value));return true;}},'#workbench');try{
  f.$('save-script').click();await tick();await tick();
  f.data.studio.scripts.push({id:'native-script',name:'Native addition',code:f.$('code').value,enabled:false,activation:'manual'});f.data.studio._revision++;
  f.$('script-name').value='Keep open draft';f.$('script-name').dispatchEvent(new f.w.Event('input'));f.$('back-to-site').click();await tick();await tick();
  assert.equal(f.data.studio.scripts.length,2);assert.equal(f.data.studio.scripts.find(s=>s.id==='native-script').activation,'manual');assert.equal(f.data.studio.draft.name,'Keep open draft');assert.equal(f.calls.filter(c=>c.op==='return-to-site').length,1);
 }finally{f.dom.window.close();}
});
test('concurrent edits to the same saved source keep the draft and refuse to overwrite',async()=>{
 const f=await fixture({'put-store':async(args,data)=>{if(args.expectedRevision!==(data[args.key]?._revision||0))throw Error('Workspace changed in another tab.');data[args.key]=JSON.parse(JSON.stringify(args.value));return true;}},'#workbench');try{
  f.$('save-script').click();await tick();await tick();f.data.studio.scripts[0].code+='\n// Remote change';f.data.studio._revision++;
  f.$('code').value+='\n// Local change';f.$('code').dispatchEvent(new f.w.Event('input'));f.$('save-script').click();await tick();await tick();
  assert.match(f.data.studio.scripts[0].code,/Remote change/);assert.doesNotMatch(f.data.studio.scripts[0].code,/Local change/);assert.match(f.$('code').value,/Local change/);assert.match(f.$('status').textContent,/changed in another screen/);
 }finally{f.dom.window.close();}
});
test('tool backup includes current workspace pins and names without provider keys',async()=>{
 const f=await fixture();f.data.pins=[{id:'pin-1',title:'Music',url:'https://example.com',group:'pink',lat:10,lon:20}];f.data.options={workspaceNames:{pink:'Music'}};f.$('backup').click();await tick();await tick();const exported=f.calls.find(c=>c.op==='export-file');assert.ok(exported);const backup=JSON.parse(exported.args.text);assert.deepEqual(backup.pins,f.data.pins);assert.equal(backup.options.workspaceNames.pink,'Music');assert.equal(backup.profiles,undefined);assert.equal(backup.keys,undefined);f.dom.window.close();
});
