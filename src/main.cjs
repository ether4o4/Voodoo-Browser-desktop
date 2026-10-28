'use strict';
const {app,BrowserWindow,WebContentsView,protocol,session,ipcMain,safeStorage,dialog,clipboard}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {APP_URL,MAX_TABS,websiteUrl,navigationInput,newItem,trustedSender,text}=require('./policy.cjs');
const {ProtectedStore}=require('./store.cjs');
const {createLink}=require('./sync/link.cjs');

protocol.registerSchemesAsPrivileged([{scheme:'voodoo',privileges:{standard:true,secure:true,supportFetchAPI:false,corsEnabled:false}}]);
if(!app.isPackaged && process.env.VOODOO_TEST_PROFILE) app.setPath('userData',path.resolve(process.env.VOODOO_TEST_PROFILE));
const testMode=!app.isPackaged && !!process.env.VOODOO_TEST_PROFILE;
let window,link,store,webSession,active=null,panel='home',quitting=false,lastPair=null,clipTimer=null;
const tabs=new Map();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const rendererRoot=path.join(__dirname,'../renderer');
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";

function current() {return tabs.get(active);}
function publicState(error) {
  const data={tabs:[...tabs.values()].map(t=>({id:t.id,title:t.title,url:t.url,loading:t.loading,canGoBack:!t.view.webContents.isDestroyed()&&t.view.webContents.navigationHistory.canGoBack(),canGoForward:!t.view.webContents.isDestroyed()&&t.view.webContents.navigationHistory.canGoForward()})),activeTabId:active,panel,items:link?link.items():[],link:link?link.status():{running:false,port:45443,addresses:[],peers:[]},version:app.getVersion()};
  if(error)data.error=error;return data;
}
function emit(error) {if(window&&!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send('voodoo:state',publicState(error));}
function layout() {
  if(!window||window.isDestroyed())return;
  const [width,height]=window.getContentSize();
  for(const tab of tabs.values()){tab.view.setVisible(!panel&&tab.id===active);tab.view.setBounds({x:0,y:118,width,height:Math.max(0,height-118)});}
}
function select(id) {if(!tabs.has(id))throw Error('This tab is closed.');hidePairCode();active=id;panel=tabs.get(id).url?null:'home';layout();emit();}
function newTab(url) {
  if(tabs.size>=MAX_TABS)throw Error('Close a tab before opening another (12 tab limit).');
  hidePairCode();
  const view=new WebContentsView({webPreferences:{session:webSession,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,backgroundThrottling:true,spellcheck:true}});
  const tab={id:randomUUID(),title:'New tab',url:'',loading:false,hasDocument:false,failed:false,view};tabs.set(tab.id,tab);window.contentView.addChildView(view);
  const wc=view.webContents;
  const navigation=(event,destination)=>{try{websiteUrl(destination);}catch{event.preventDefault();emit('Blocked an unsupported navigation.');}};
  wc.on('will-navigate',navigation);wc.on('will-redirect',navigation);
  // No website can open tabs without explicit review in this first preview.
  wc.setWindowOpenHandler(()=>{emit('This site tried to open a new window. Open its link in a tab yourself.');return {action:'deny'};});
  wc.on('did-start-navigation',(_event,_url,inPlace,main)=>{if(main&&!inPlace){tab.hasDocument=false;tab.failed=false;tab.loading=true;}});
  wc.on('did-finish-load',()=>{if(!tab.failed){try{tab.url=websiteUrl(wc.getURL());tab.hasDocument=true;}catch{tab.hasDocument=false;}}emit();});
  wc.on('did-start-loading',()=>{tab.loading=true;emit();});
  wc.on('did-stop-loading',()=>{if(wc.getURL()===tab.url&&!wc.isLoadingMainFrame())tab.loading=false;emit();});
  wc.on('did-navigate',(_event,target)=>{tab.url=target;emit();});
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
  if(url){const target=websiteUrl(url);tab.loading=true;panel=null;wc.loadURL(target).catch(()=>{});} else panel='home';
  layout();emit();return tab.id;
}
function closeTab(id) {
  const t=tabs.get(id);if(!t)return;
  tabs.delete(id);window.contentView.removeChildView(t.view);
  if(!t.view.webContents.isDestroyed())t.view.webContents.close();
  if(active===id)active=[...tabs.keys()].at(-1)||null;
  if(!active)panel='home';layout();emit();
}
function hidePairCode(){if(lastPair&&clipboard.readText()===lastPair.code)clipboard.clear();lastPair=null;if(clipTimer){clearTimeout(clipTimer);clipTimer=null;}}
async function act(event,action,payload={}) {
  if(!trustedSender(event,window))throw Error('This page cannot access Voodoo controls.');
  if(quitting)throw Error('Voodoo is closing.');
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||JSON.stringify(payload).length>25000)throw Error('Invalid request.');
  switch(action){
    case 'state': return publicState();
    case 'navigate':{const url=navigationInput(payload.url);hidePairCode();if(!url){panel='home';break;}const t=current();if(!t)newTab(url);else{t.loading=true;t.hasDocument=false;panel=null;layout();await t.view.webContents.loadURL(url).catch(()=>{});}break;}
    case 'new-tab':newTab(payload.url?websiteUrl(payload.url):null);break;
    case 'close-tab':closeTab(payload.id);break;
    case 'select-tab':select(payload.id);break;
    case 'back':if(current()?.view.webContents.navigationHistory.canGoBack())current().view.webContents.navigationHistory.goBack();break;
    case 'forward':if(current()?.view.webContents.navigationHistory.canGoForward())current().view.webContents.navigationHistory.goForward();break;
    case 'reload':current()?.view.webContents.reload();break;
    case 'home':panel='home';hidePairCode();break;
    case 'panel':if(![null,'home','library','link','settings'].includes(payload.name))throw Error('Unknown panel.');panel=payload.name;if(panel!=='link')hidePairCode();break;
    case 'bookmark':case 'send-tab':{const t=current();if(!t?.hasDocument||t.loading)throw Error('Wait for a website to load first.');const url=websiteUrl(t.view.webContents.getURL());await link.add(newItem(action==='bookmark'?'bookmark':'tab',{title:payload.title||t.title,url}));break;}
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
async function shutdown() {
  if(quitting)return;quitting=true;hidePairCode();
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
      if(url.host!=='app'||request.method!=='GET'||url.search||url.hash) return new Response('Not found',{status:404});
      const relative=decodeURIComponent(url.pathname).replace(/^\//,'');
      if(!relative||relative.includes('\\')||relative.split('/').some(x=>x==='..'||x==='.')||relative.includes('\0'))return new Response('Not found',{status:404});
      const file=path.resolve(rendererRoot,relative);
      if(!file.startsWith(rendererRoot+path.sep))return new Response('Not found',{status:404});
      return new Response(await fs.readFile(file),{headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff'}});
    }catch{return new Response('Not found',{status:404});}
  });
  store=new ProtectedStore(path.join(app.getPath('userData'),'library.vault'),safeStorage);await store.init();
  link=createLink({loadState:()=>store.snapshot(),saveState:state=>store.save(state),onChange:()=>emit()});
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
