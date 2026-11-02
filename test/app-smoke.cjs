'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net');
const root=path.resolve(__dirname,'..');
async function waitState(page,predicate,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){const state=await page.evaluate(()=>window.voodoo.invoke('state'));if(predicate(state))return state;await new Promise(r=>setTimeout(r,100));}throw Error('Application state did not reach the expected result: '+JSON.stringify(await page.evaluate(()=>window.voodoo.invoke('state'))));}
async function main(){
  const output=path.join(root,'test-output');await fs.mkdir(output,{recursive:true});
  const profile=await fs.mkdtemp(path.join(output,'profile-'));
  const env={...process.env,VOODOO_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  let electronApp;
  const checks=[];
  const record=message=>{checks.push(message);console.log('PASS '+message);};
  try{
    electronApp=await _electron.launch({args:[root],env,timeout:60000});
    const page=await electronApp.firstWindow();await page.waitForURL('voodoo://app/index.html');
    await page.frameLocator('#home-frame').locator('#search').waitFor();
    await page.screenshot({path:path.join(output,'home.png')});
    assert.equal(await page.locator('#chrome').evaluate(el=>Math.round(el.getBoundingClientRect().height)),118);
    record('Desktop shell renders with 118px browser controls');
    await page.locator('[data-panel="library"]').first().click();await page.locator('#new-note').click();
    await page.locator('#note-title').fill('A note for both screens');await page.locator('#note-body').fill('Keep this draft exactly as written.');await page.locator('#save-note').click();
    await page.waitForFunction(()=>document.querySelector('#library-items').textContent.includes('A note for both screens'));
    record('A note is saved from the real renderer');
    const bytes=await fs.readFile(path.join(profile,'library.vault'));
    assert.equal(bytes.includes(Buffer.from('Keep this draft')),false);assert.equal(bytes.includes(Buffer.from('A note for both screens')),false);
    record('Windows safeStorage encrypts the actual persisted library');
    assert.match(await page.evaluate(async()=>{try{await window.voodoo.invoke('new-tab',{url:'file:///C:/Windows/win.ini'});return 'accepted';}catch(e){return e.message;}}),/HTTPS|supported/);
    record('A local-file navigation is rejected');
    await page.locator('#address').fill('https://example.com');await page.locator('#address-form').evaluate(form=>form.requestSubmit());
    await waitState(page,s=>s.tabs.some(t=>t.url==='https://example.com/'&&t.title==='Example Domain'&&!t.loading));
    const external=await electronApp.evaluate(async({webContents})=>{
      const target=webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://example.com'));
      if(!target)throw Error('No external page loaded: '+JSON.stringify(webContents.getAllWebContents().map(w=>({id:w.id,url:w.getURL(),title:w.getTitle()}))));
      return {url:target.getURL(),prefs:target.getLastWebPreferences(),boundary:await target.executeJavaScript('({node:typeof require,app:typeof window.voodoo,electron:typeof window.electron})')};
    });
    assert.deepEqual(external.boundary,{node:'undefined',app:'undefined',electron:'undefined'});assert.equal(external.prefs.sandbox,true);assert.equal(external.prefs.contextIsolation,true);assert.equal(external.prefs.nodeIntegration,false);
    record('Real HTTPS page has no Node or app API and runs sandboxed');
    // Deterministic HTTPS documents exercise actual Chromium isolation and IPC.
    await electronApp.evaluate(({session,dialog})=>{
      dialog.showMessageBox=async()=>({response:1});
      session.fromPartition('persist:voodoo-web').protocol.handle('https',req=>new Response('<!doctype html><title>Script fixture</title><body><h1>Script test</h1></body>',{headers:{'content-type':'text/html','content-security-policy':"default-src 'none'; script-src 'none'"}}));
    });
    const scriptCode='// ==UserScript==\n// @name Desktop parity check\n// @match https://example.com/*\n// @run-at document-body\n// @grant GM_getValue\n// @grant GM_setValue\n// @grant GM_registerMenuCommand\n// ==/UserScript==\nconst count=GM_getValue("counter",0)+1;GM_setValue("counter",count);document.body.dataset.voodoo=String(count);GM_registerMenuCommand("Parity command",()=>document.body.dataset.command="ran");';
    const workbench=page.frameLocator('#studio-frame');
    await page.locator('[data-workspace="studio"]').click();await workbench.locator('#code').waitFor();
    await workbench.locator('#code').fill(scriptCode);await workbench.locator('#script-name').fill('Desktop parity check');
    await workbench.locator('#script-manual').check();await workbench.locator('#save-script').click();
    await workbench.locator('#script-status').filter({hasText:'Saved.'}).waitFor();
    assert.equal(await page.evaluate(async()=>{const d=await voodoo.invoke('studio',{op:'get-store',key:'studio'});return d.scripts[0].enabled;}),false);
    assert.equal(await electronApp.evaluate(({webContents})=>webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://example.com')).executeJavaScript('document.body.dataset.voodoo||null')),null);
    record('Mobile workbench saves Manual activation without running or reloading the website');
    await workbench.locator('#run-script').click();
    await waitState(page,s=>s.panel===null&&!s.tabs.find(t=>t.id===s.activeTabId)?.loading);
    const website=()=>electronApp.evaluate(({webContents})=>webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://example.com')).executeJavaScript('({count:document.body.dataset.voodoo||null,command:document.body.dataset.command||null,bridge:typeof VoodooGM,node:typeof require,api:typeof voodoo})'));
    let scriptResult;for(let i=0;i<80;i++){scriptResult=await website();if(scriptResult.count)break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(scriptResult.count,'1');assert.equal(scriptResult.bridge,'undefined');assert.equal(scriptResult.node,'undefined');assert.equal(scriptResult.api,'undefined');
    record('Manual activation runs a real userscript in an isolated Chromium world without exposing its bridge to the page');
    const status=await page.evaluate(()=>voodoo.invoke('studio',{op:'script-status'}));assert.equal(status.menus.length,1);
    await page.evaluate(command=>voodoo.invoke('studio',{op:'script-menu',...command}),status.menus[0]);
    for(let i=0;i<30&&!(await website()).command;i++)await new Promise(r=>setTimeout(r,100));assert.equal((await website()).command,'ran');
    record('Native script commands invoke only the selected isolated-world callback');
    await page.locator('#reload').click();await waitState(page,s=>!s.tabs.find(t=>t.id===s.activeTabId)?.loading);await new Promise(r=>setTimeout(r,300));assert.equal((await website()).count,null);
    record('Manual activation is consumed by one document and never runs again on an ordinary reload');
    await page.locator('[data-workspace="studio"]').click();await workbench.locator('#script-enabled').check();await workbench.locator('#save-script').click();await workbench.locator('#script-status').filter({hasText:'Starts on the next'}).waitFor();
    assert.equal((await website()).count,null);
    await page.locator('#return-page').click();await page.locator('#reload').click();await waitState(page,s=>!s.tabs.find(t=>t.id===s.activeTabId)?.loading);
    for(let i=0;i<80&&!(await website()).count;i++)await new Promise(r=>setTimeout(r,100));assert.equal((await website()).count,'2');
    record('Automatic activation waits for the next matching document and retains script-owned GM values');
    await page.locator('[data-workspace="magic"]').click();const magic=page.frameLocator('#magic-frame');await magic.locator('#saved').click();await magic.locator('#results').filter({hasText:'Desktop parity check'}).waitFor();await magic.locator('#results button').first().click();
    await magic.locator('#options').waitFor();await magic.locator('#manual-mode').check();assert.equal(await magic.locator('#automatic-mode').isChecked(),false);await magic.locator('#saved-mode').check();await magic.locator('#save').click();await magic.locator('#options').waitFor({state:'hidden'});
    record('Magic scripts opens the selected saved source and keeps its three activation choices exclusive');
    await page.locator('[data-workspace="studio"]').click();await workbench.locator('#script-list').filter({hasText:'Saved only'}).waitFor();await page.screenshot({path:path.join(output,'workbench.png')});
    await page.locator('[data-workspace="writing"]').click();await page.frameLocator('#writing-frame').locator('body').filter({hasText:'WORKBENCH'}).waitFor();
    await page.locator('#focus-view').click();assert.equal(await page.locator('#chrome').evaluate(el=>Math.round(el.getBoundingClientRect().height)),38);await page.locator('#focus-view').click();
    record('Workspace navigation preserves the editor, writing opens, and navigation can hide and restore');
    const workspaceBytes=await fs.readFile(path.join(profile,'workspace.vault'));assert.equal(workspaceBytes.includes(Buffer.from('Desktop parity check')),false);assert.equal(workspaceBytes.includes(Buffer.from('counter')),false);
    record('Windows safeStorage encrypts script source and GM values separately from the synced library');
    await page.locator('#return-page').click();
    await page.locator('#bookmark').click();await page.locator('#send-tab').click();
    await page.locator('[data-panel="library"]').first().click();
    await waitState(page,s=>s.items.some(x=>x.kind==='bookmark')&&s.items.some(x=>x.kind==='tab'));
    await page.screenshot({path:path.join(output,'library.png')});
    record('Current website can be saved and queued to the shared tab inbox');
    await page.locator('[data-panel="link"]').first().click();await page.locator('#toggle-link').click();
    await waitState(page,s=>s.link.running);
    const linkState=await page.evaluate(async()=>(await window.voodoo.invoke('state')).link);
    record('Local device link starts from the real UI');
    await page.locator('#toggle-link').click();await waitState(page,s=>!s.link.running);
    record('Stop link closes the listener');
    await page.locator('#toggle-link').click();await waitState(page,s=>s.link.running);
    const exited=new Promise(resolve=>electronApp.process().once('exit',resolve));
    await electronApp.evaluate(({BrowserWindow})=>{setTimeout(()=>BrowserWindow.getAllWindows()[0].close(),10);});
    await Promise.race([exited,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('App did not quit')),15000);t.unref();})]);
    const listening=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port:linkState.port});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.setTimeout(2000,()=>{socket.destroy();resolve(false);});});
    assert.equal(listening,false);record('Closing the app stops its HTTPS listener');
    electronApp=null;
    electronApp=await _electron.launch({args:[root],env,timeout:60000});
    const reopened=await electronApp.firstWindow();await reopened.waitForURL('voodoo://app/index.html');
    await waitState(reopened,s=>s.items.length===3);
    assert.equal(await reopened.evaluate(async()=>(await window.voodoo.invoke('state')).link.running),false);
    assert.equal((await reopened.evaluate(()=>voodoo.invoke('studio',{op:'get-store',key:'studio'}))).scripts[0].name,'Desktop parity check');
    record('Library and scripts decrypt after reopening; link starts off');
    await fs.writeFile(path.join(output,'app-smoke.json'),JSON.stringify({passed:checks.length,checks},null,2));
    console.log(JSON.stringify({passed:checks.length,checks},null,2));
  }catch(error){
    if(electronApp){const page=await electronApp.firstWindow();await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});console.log('UI failure state',await page.evaluate(()=>voodoo.invoke('state')).catch(()=>null));console.log('Internal frame diagnostics',await page.evaluate(()=>[...document.querySelectorAll('iframe')].map(f=>({id:f.id,url:f.src,hidden:f.hidden,text:f.contentDocument?.body?.innerText?.slice(0,2000)}))).catch(()=>null));console.log('Workspace diagnostics',await page.evaluate(()=>voodoo.invoke('studio',{op:'script-status'})).catch(()=>null));}
    throw error;
  }finally{await electronApp?.close().catch(()=>{});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
