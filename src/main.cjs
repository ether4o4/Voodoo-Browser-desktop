'use strict';
const {app,BrowserWindow,WebContentsView,protocol,session,ipcMain,safeStorage,dialog,clipboard}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {APP_URL,MAX_TABS,websiteUrl,navigationInput,newItem,trustedSender,text}=require('./policy.cjs');
const {ProtectedStore}=require('./store.cjs');
const {createLink}=require('./sync/link.cjs');
const {Workspace}=require('./workspace.cjs');
const {Scripts}=require('./scripts.cjs');
const {Discovery}=require('./discovery.cjs');
const {createHost}=require('./desktop-host.cjs');

protocol.registerSchemesAsPrivileged([{scheme:'voodoo',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
if(!app.isPackaged && process.env.VOODOO_TEST_PROFILE) app.setPath('userData',path.resolve(process.env.VOODOO_TEST_PROFILE));
const testMode=!app.isPackaged && !!process.env.VOODOO_TEST_PROFILE;
let window,link,store,webSession,workspace,scripts,discovery,studioHost,active=null,panel='home',workspacePage='studio',focusView=false,quitting=false,lastPair=null,clipTimer=null;
const tabs=new Map();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const rendererRoot=path.join(__dirname,'../renderer');
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'self'; form-action 'none'";

function current() {return tabs.get(active);}
function publicState(error) {
  const data={tabs:[...tabs.values()].map(t=>({id:t.id,title:t.title,url:t.url,loading:t.loading,canGoBack:!t.view.webContents.isDestroyed()&&t.view.webContents.navigationHistory.canGoBack(),canGoForward:!t.view.webContents.isDestroyed()&&t.view.webContents.navigationHistory.canGoForward()})),activeTabId:active,panel,items:link?link.items():[],link:link?link.status():{running:false,port:45443,addresses:[],peers:[]},version:app.getVersion()};
  data.workspacePage=workspacePage;data.workspaceRevision=workspace?.get('studio')?._revision||0;data.focusView=focusView;if(error)data.error=error;return data;
}
function emit(error) {if(window&&!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('voodoo:state',publicState(error));}
function layout() {
  if(!window||window.isDestroyed())return;
  const [width,height]=window.getContentSize();
  const chromeHeight=focusView?38:118;
  for(const tab of tabs.values()){tab.view.setVisible(!panel&&tab.id===active);tab.view.setBounds({x:0,y:chromeHeight,width,height:Math.max(0,height-chromeHeight)});}
}
function select(id) {if(!tabs.has(id))throw Error('This tab is closed.');hidePairCode();active=id;panel=tabs.get(id).url?null:'home';layout();emit();}
function newTab(url) {
  if(tabs.size>=MAX_TABS)throw Error('Close a tab before opening another (12 tab limit).');
  hidePairCode();
  const view=new WebContentsView({webPreferences:{session:webSession,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,backgroundThrottling:true,spellcheck:true}});
  const tab={id:randomUUID(),title:'New tab',url:'',loading:false,hasDocument:false,failed:false,view};tabs.set(tab.id,tab);window.contentView.addChildView(view);
  const wc=view.webContents;tab.scriptsReady=wc.loadURL('about:blank').then(()=>scripts.add(tab));
  const navigation=(event,destination)=>{try{websiteUrl(destination);}catch{event.preventDefault();emit('Blocked an unsupported navigation.');}};
  wc.on('will-navigate',navigation);wc.on('will-redirect',navigation);
  // No website can open tabs without explicit review in this first preview.
  wc.setWindowOpenHandler(()=>{emit('This site tried to open a new window. Open its link in a tab yourself.');return {action:'deny'};});
  wc.on('did-start-navigation',(_event,_url,inPlace,main)=>{if(main&&!inPlace){scripts.invalidate(tab.id);tab.hasDocument=false;tab.failed=false;tab.loading=true;}});
  wc.on('did-finish-load',()=>{if(!tab.failed){try{tab.url=websiteUrl(wc.getURL());tab.hasDocument=true;void workspace.update(d=>{d.recent=[{url:tab.url,title:tab.title},...(d.recent||[]).filter(x=>new URL(x.url).hostname!==new URL(tab.url).hostname)].slice(0,30);return true;}).catch(()=>{});}catch{tab.hasDocument=false;}}emit();});
  wc.on('did-start-loading',()=>{tab.loading=true;emit();});
  wc.on('did-stop-loading',()=>{if(wc.getURL()===tab.url&&!wc.isLoadingMainFrame())tab.loading=false;emit();});
  wc.on('did-navigate',(_event,target)=>{try{tab.url=websiteUrl(target);}catch{tab.url='';}emit();});
  wc.on('did-navigate-in-page',(_event,target,main)=>{if(main){tab.url=target;emit();}});
  wc.on('page-title-updated',(_event,title)=>{tab.title=String(title).slice(0,200);emit();});
  wc.on('did-fail-load',(_event,code,_description,_url,main)=>{if(main&&code!==-3){tab.failed=true;tab.hasDocument=false;tab.loading=false;try{tab.url=websiteUrl(wc.getURL());}catch{tab.url='';}emit('The page could not load. Check its address and connection.');}});
  wc.on('render-process-gone',()=>{closeTab(tab.id);emit('A page stopped responding and its tab was closed.');});
  wc.on('will-attach-webview',event=>event.preventDefault());
  wc.on('before-input-event',(event,input)=>{
    if(input.type!=='keyDown')return;
    if(input.control&&input.key.toLowerCase()==='l'){event.preventDefault();window.webContents.focus();window.webContents.send('voodoo:focus-address');}
    if(input.control&&input.key.toLowerCase()==='w'){event.preventDefault();closeTab(tab.id);}
    if(input.control&&input.key.toLowerCase()==='t'){event.preventDefault();panel='home';layout();emit();window.webContents.focus();}
  });
  active=tab.id;
  if(url){const target=websiteUrl(url);tab.loading=true;panel=null;void tab.scriptsReady.then(()=>wc.loadURL(target)).catch(()=>{});} else panel='home';
  layout();emit();return tab.id;
}
function closeTab(id) {
  const t=tabs.get(id);if(!t)return;
  scripts.remove(id);tabs.delete(id);window.contentView.removeChildView(t.view);
  if(!t.view.webContents.isDestroyed())t.view.webContents.close();
  if(active===id)active=[...tabs.keys()].at(-1)||null;
  if(!active)panel='home';layout();emit();
}
function hidePairCode(){if(lastPair&&clipboard.readText()===lastPair.code)clipboard.clear();lastPair=null;if(clipTimer){clearTimeout(clipTimer);clipTimer=null;}}
async function act(event,action,payload={}) {
  if(!trustedSender(event,window))throw Error('This page cannot access Voodoo controls.');
  if(quitting)throw Error('Voodoo is closing.');
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||JSON.stringify(payload).length>(action==='studio'?13_000_000:25000))throw Error('Invalid request.');
  switch(action){
    case 'studio':return studioHost(payload);
    case 'workspace':setWorkspace(payload.page);break;
    case 'focus-view':focusView=!focusView;break;
    case 'state': return publicState();
    case 'navigate':await navigate(payload.url);break;
    case 'new-tab':newTab(payload.url?websiteUrl(payload.url):null);break;
    case 'close-tab':closeTab(payload.id);break;
    case 'select-tab':select(payload.id);break;
    case 'back':if(current()?.view.webContents.navigationHistory.canGoBack())current().view.webContents.navigationHistory.goBack();break;
    case 'forward':if(current()?.view.webContents.navigationHistory.canGoForward())current().view.webContents.navigationHistory.goForward();break;
    case 'reload':current()?.view.webContents.reload();break;
    case 'home':panel='home';hidePairCode();break;
    case 'panel':if(![null,'home','library','link','settings'].includes(payload.name))throw Error('Unknown panel.');panel=payload.name;if(panel!=='link')hidePairCode();break;
    case 'bookmark':case 'send-tab':{const t=current();if(!t?.hasDocument||t.loading)throw Error('Wait for a website to load first.');const url=websiteUrl(t.view.webContents.getURL());await link.add(newItem(action==='bookmark'?'bookmark':'tab',{title:payload.title||t.title,url}));if(action==='bookmark'){const pins=workspace.get('pins')||[];if(pins.length<60&&!pins.some(p=>p.group==='favorites'&&p.url===url)){pins.push({id:randomUUID(),title:String(payload.title||t.title||new URL(url).hostname).slice(0,120),url,group:'favorites',lat:35,lon:pins.length*53%320-160});await workspace.put('pins',pins);}}break;}
    case 'add-note':await link.add(newItem('note',payload));break;
    case 'open-item':{const item=link.items().find(x=>x.id===payload.id);if(!item||item.kind==='note')throw Error('Select a shared page.');newTab(websiteUrl(item.url));break;}
    case 'link-start':await link.start({port:45443});break;
    case 'link-stop':await link.stop();hidePairCode();break;
    case 'link-pair':lastPair=await link.pair({address:text(payload.address,64,'address'),name:text(payload.name||'My phone',80,'device name')});return lastPair;
    case 'link-revoke':await link.revoke(payload.id);hidePairCode();break;
    case 'copy-pair-code':{
      if(panel!=='link'||!lastPair||lastPair.expiresAt<=Date.now())throw Error('Create a new pairing code.');
      const code=lastPair.code;clipboard.writeText(code);if(clipTimer)clearTimeout(clipTimer);
      clipTimer=setTimeout(()=>{if(clipboard.readText()===code)clipboard.clear();clipTimer=null;},60000);clipTimer.unref();return true;
    }
    case 'clear-browsing-data':{
      const answer=await dialog.showMessageBox(window,{type:'warning',title:'Clear website data?',message:'Sign out of all websites and remove their cookies, cache and local storage?',detail:'Your shared library and paired devices will be kept.',buttons:['Cancel','Clear website data'],defaultId:0,cancelId:0,noLink:true});
      if(answer.response===1){for(const id of [...tabs.keys()])closeTab(id);await webSession.clearStorageData();await webSession.clearCache();}break;
    }
    default:throw Error('Unknown action.');
  }
  layout();emit();return publicState();
}
function setWorkspace(page){if(![null,'home','studio','magic','writing'].includes(page))throw Error('Unknown workspace page.');hidePairCode();if(page===null||page==='home')panel=page;else{panel='workspace';workspacePage=page;}layout();emit();}
async function navigate(input){const url=navigationInput(input);hidePairCode();if(!url){panel='home';layout();emit();return;}const t=current();if(!t)newTab(url);else{await t.scriptsReady;await scripts.refresh();t.loading=true;t.hasDocument=false;panel=null;layout();emit();await t.view.webContents.loadURL(url).catch(()=>{});}layout();emit();}
async function exportFile(filename,body){if(typeof body!=='string'||Buffer.byteLength(body)>13_000_000)throw Error('Export must be text under 13 MB.');const name=String(filename||'Voodoo-export.txt').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,160);const result=await dialog.showSaveDialog(window,{title:'Export Voodoo file',defaultPath:name});if(result.canceled)throw Error('Export cancelled.');await fs.writeFile(result.filePath,body,'utf8');return true;}
async function reviewScripts(items,kind){const special=['download','clipboard','tab'].includes(kind),message=special?'Userscript '+kind+' request':kind==='manual'?'Activate this script on the website?':'Allow automatic script activation?';const detail=items.map(s=>{if(special)return s.name+'\n'+s.code;const m=require('../renderer/mobile/studio/engine.js').metadata(s.code);return s.name+'\nSites: '+[...m.matches,...m.includes].join(', ')+'\nGrants: '+m.grants.join(', ')+'\nNetwork: '+(m.fields.connect||[]).join(', ')+'\nDependencies: '+[...(m.fields.require||[]),...(m.fields.resource||[])].join(', ');}).join('\n\n');const r=await dialog.showMessageBox(window,{type:'question',title:'Voodoo script permissions',message,detail:(kind==='manual'?'The website reloads once. Unsaved website edits may be lost.\n\n':'')+detail.slice(0,18000),buttons:['Cancel',kind==='manual'?'Activate':'Allow'],defaultId:0,cancelId:0,noLink:true});return r.response===1;}
async function shutdown() {
  if(quitting)return;quitting=true;hidePairCode();discovery?.cancel();
  try{await link?.stop();}catch{}
  for(const id of [...tabs.keys()])closeTab(id);
  window?.destroy();app.quit();
}
if(!app.requestSingleInstanceLock())app.quit();else{
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
app.whenReady().then(async()=>{
  await protocol.handle('voodoo',async request=>{
    try{
      const url=new URL(request.url);
      if(url.host!=='app'||request.method!=='GET'||url.search) return new Response('Not found',{status:404});
      const relative=decodeURIComponent(url.pathname).replace(/^\//,'');
      if(!relative||relative.includes('\\')||relative.split('/').some(x=>x==='..'||x==='.')||relative.includes('\0'))return new Response('Not found',{status:404});
      const file=path.resolve(rendererRoot,relative);
      if(!file.startsWith(rendererRoot+path.sep))return new Response('Not found',{status:404});
      const internal=relative.startsWith('mobile/');let policy=CSP;
      if(internal)policy=policy.replace("style-src 'self'","style-src 'self' 'unsafe-inline'").replace("frame-src 'self'","frame-src 'none'").replace("connect-src 'none'","connect-src 'self'");
      if(relative==='mobile/studio/index.html')policy=policy.replace("script-src 'self'","script-src 'self' 'unsafe-eval'");
      return new Response(await fs.readFile(file),{headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Security-Policy':policy,'X-Content-Type-Options':'nosniff'}});
    }catch{return new Response('Not found',{status:404});}
  });
  store=new ProtectedStore(path.join(app.getPath('userData'),'library.vault'),safeStorage);await store.init();
  link=createLink({loadState:()=>store.snapshot(),saveState:state=>store.save(state),onChange:()=>emit()});
  const workspaceStore=new ProtectedStore(path.join(app.getPath('userData'),'workspace.vault'),safeStorage,32*1024*1024);await workspaceStore.init();let scriptFingerprint='';
  workspace=new Workspace(workspaceStore,{review:reviewScripts,onChange:async()=>{const fingerprint=JSON.stringify([workspace.scripts().map(s=>[s.id,s.code,s.enabled]),workspace.get('options')?.scripts]);if(fingerprint!==scriptFingerprint){scriptFingerprint=fingerprint;await scripts?.refresh();}emit();}});
  scripts=new Scripts(workspace,{review:reviewScripts,clipboard,closeTab,openTab:(url,activate)=>{const previous=active;const id=newTab(url);if(!activate&&previous)select(previous);return id;},notify:(title,message)=>dialog.showMessageBox(window,{type:'info',title,message,buttons:['Dismiss']}),download:async(name,r)=>{if(r.status<200||r.status>=300)throw Error('Download HTTP '+r.status);const result=await dialog.showSaveDialog(window,{title:'Save script download',defaultPath:String(name||'download').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,160)});if(result.canceled)throw Error('Download cancelled.');await fs.writeFile(result.filePath,Buffer.from(r.base64,'base64'));return true;}});
  discovery=new Discovery();
  studioHost=createHost({workspace,scripts,discovery,current,navigate,route:setWorkspace,openTab:newTab,tabCount:()=>tabs.size,exportFile,addBookmark:async pin=>{if(!pin)return link.items().filter(x=>x.kind==='bookmark').slice(0,60).map((x,i)=>({id:randomUUID(),title:x.title.slice(0,120)||new URL(x.url).hostname,url:x.url,group:'favorites',lat:25+i%6*5,lon:i*53%320-160}));if(!link.items().some(x=>x.kind==='bookmark'&&x.url===pin.url))await link.add(newItem('bookmark',{title:pin.title,url:pin.url}));return true;}});
  webSession=session.fromPartition('persist:voodoo-web');
  webSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  webSession.setPermissionCheckHandler(()=>false);
  webSession.webRequest.onBeforeRequest({urls:['http://*/*','file://*/*','voodoo://*/*']},(_details,callback)=>callback({cancel:true}));
  webSession.on('will-download',(_event,item)=>{item.setSaveDialogOptions({title:'Save download',defaultPath:path.basename(item.getFilename())});});
  window=new BrowserWindow({width:1280,height:850,minWidth:800,minHeight:600,backgroundColor:'#090a0e',title:'Voodoo Browser',show:!testMode,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,devTools:!app.isPackaged}});
  window.removeMenu();window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.on('resize',layout);window.on('close',event=>{if(!quitting){event.preventDefault();void shutdown();}});
  ipcMain.handle('voodoo:action',act);
  await window.loadURL(APP_URL);emit();
}).catch(error=>{dialog.showErrorBox('Voodoo could not start',String(error.message||'Startup failed'));app.quit();});
app.on('window-all-closed',()=>{if(!quitting)void shutdown();});
app.on('before-quit',event=>{if(!quitting&&window){event.preventDefault();void shutdown();}});
}
