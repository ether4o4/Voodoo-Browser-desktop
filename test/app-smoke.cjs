'use strict';
const {_electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net');
const root=path.resolve(__dirname,'..');
async function waitState(page,predicate,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){const state=await page.evaluate(()=>window.voodoo.invoke('state'));if(predicate(state))return state;await new Promise(r=>setTimeout(r,100));}throw Error('Application state did not reach the expected result.');}
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
    await page.locator('#home-title').waitFor();
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
    record('Library decrypts after reopening; link starts off');
    await fs.writeFile(path.join(output,'app-smoke.json'),JSON.stringify({passed:checks.length,checks},null,2));
    console.log(JSON.stringify({passed:checks.length,checks},null,2));
  }finally{await electronApp?.close().catch(()=>{});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
