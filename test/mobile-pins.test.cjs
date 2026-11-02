const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),P=require('../renderer/mobile/pins.js');const root=path.join(__dirname,'../renderer/mobile');const tick=()=>new Promise(r=>setTimeout(r,20));
const sample=()=>({id:'pin-1',title:'Music',url:'https://example.com/create',group:'pink',lat:35,lon:-70});
test('pin backups retain workspace and position and reject unsafe or malformed entries',()=>{const pin=sample();assert.deepEqual(P.validate([pin]),[pin]);for(const patch of [{url:'http://example.com'},{url:'javascript:alert(1)'},{url:'https://key@example.com'},{url:'https://APPASSETS.ANDROIDPLATFORM.NET/assets/home.html'},{group:'unknown'},{lat:NaN},{lat:86},{lon:-181},{id:''}])assert.throws(()=>P.validate([{...pin,...patch}]));assert.throws(()=>P.validate([pin,pin]));assert.throws(()=>P.validate(Array(61).fill(pin)));assert.equal(P.validate([{...pin,icon:'https://tracker.test/image.png'}])[0].icon,undefined);});

test('Favorites backups preserve their fifth group and only the four custom names can change',()=>{
 const favorite={...sample(),group:'favorites'};assert.deepEqual(P.validate([favorite]),[favorite]);
 assert.equal(P.workspaceNames({gold:'  Archive  '}).gold,'Archive');assert.equal(P.workspaceNames({}).favorites,'Favorites');
 assert.throws(()=>P.workspaceNames({favorites:'Rename'}));assert.throws(()=>P.workspaceNames({gold:' '}));assert.throws(()=>P.workspaceNames({cyan:'x'.repeat(21)}));
});

test('Favorites load, add, open, filter and remain after refresh; search clears on focus',async()=>{
 const f=await fixture();f.$('favorite-add').click();assert.equal(f.$('pin-group').value,'favorites');
 f.$('pin-title').value='Favorite';f.$('pin-url').value='https://favorite.example';f.$('pin-form').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await tick();
 assert.equal(f.data.pins[1].group,'favorites');assert.match(f.$('favorites').textContent,/Favorite/);f.$('favorites').querySelector('button').click();await tick();assert.equal(f.calls.at(-1).a.pinId,'pin-2');
 f.$('favorites-all').click();await tick();assert.equal(f.data.active,'favorites');f.w.VoodooHome.setActive(true);await tick();assert.match(f.$('favorites').textContent,/Favorite/);
 f.$('search').value='old query';f.$('search').dispatchEvent(new f.w.Event('focus'));assert.equal(f.$('search').value,'');f.dom.window.close();
});
async function fixture(recentSites=[]){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'home.html'),'utf8'),{url:'https://appassets.androidplatform.net/assets/home.html',runScripts:'outside-only'}),w=dom.window,data={pins:[sample()],names:{...P.names},active:'all',recentSites},calls=[],globeCalls=[];let callbacks;
 w.matchMedia=()=>({matches:false});w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.Host={call:async(op,a={})=>{calls.push({op,a});if(op==='pins')return structuredClone(data);if(op==='recent-sites')return structuredClone(data.recentSites);if(op==='get-store')return {};if(op==='set-workspace'){data.active=a.group;return true;}if(op==='pin-site'){const pin={...a,id:'pin-'+(data.pins.length+1),lat:0,lon:0};data.pins.push(pin);return pin;}if(op==='update-pin'){const p=data.pins.find(p=>p.id===a.pin.id);Object.assign(p,a.pin);return p;}if(op==='delete-pin'){data.pins=data.pins.filter(p=>p.id!==a.pinId);return true;}if(op==='rename-workspaces'){data.names=a.names;return true;}if(op==='open-workspace')return {opened:data.pins.length,remaining:0};return true;}};
 w.VoodooGlobe={create:async(_,options)=>{callbacks=options;return {setPins:(pins,id)=>globeCalls.push({pins,id}),select:()=>{},move:()=>{},rotate:()=>{},setActive:()=>{}};}};
 w.eval(fs.readFileSync(path.join(root,'pins.js'),'utf8'));w.eval(fs.readFileSync(path.join(root,'home.js'),'utf8'));await tick();return {dom,w,data,calls,globeCalls,callbacks,$:id=>w.document.getElementById(id)};
}
test('homepage filters persisted pins, opens by ID, and never treats pin titles as markup',async()=>{const f=await fixture();f.data.pins[0].title='<img src=x onerror=alert(1)>';await f.w.VoodooHome.refreshPins();await tick();assert.equal(f.$('pin-list').querySelectorAll('img').length,0);assert.match(f.$('pin-list').textContent,/<img/);f.$('pin-list').querySelector('.pin-open').click();await tick();assert.equal(f.calls.find(c=>c.op==='open-pin').a.pinId,'pin-1');[...f.$('workspace-filters').children].find(b=>b.textContent==='Build').click();await tick();assert.equal(f.data.active,'green');assert.match(f.$('pin-list').textContent,/favorite spot/);assert.equal(f.$('open-workspace').disabled,true);f.dom.window.close();});
test('new pins, custom names, and moving a pin on the globe persist through the bridge',async()=>{const f=await fixture();f.$('add-pin').click();f.$('pin-title').value='Code';f.$('pin-url').value='https://example.org';f.$('pin-group').value='green';f.$('pin-form').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await tick();assert.equal(f.data.pins.length,2);assert.equal(f.data.pins[1].group,'green');assert.equal(f.$('pin-dialog').open,false);assert.ok(f.globeCalls.some(c=>c.id==='pin-2'));f.$('rename').click();f.$('name-green').value='Coding';f.$('names-form').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await tick();assert.equal(f.data.names.green,'Coding');await f.callbacks.onMove('pin-2',42,-15);assert.equal(f.data.pins[1].lat,42);assert.equal(f.data.pins[1].lon,-15);f.dom.window.close();});
test('failed pin saves leave the dialog and draft available',async()=>{const f=await fixture();const call=f.w.Host.call;f.w.Host.call=async(op,a)=>{if(op==='pin-site')throw Error('Could not save pins.');return call(op,a);};f.$('add-pin').click();f.$('pin-title').value='Unsaved';f.$('pin-url').value='https://example.org';f.$('pin-form').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await tick();assert.equal(f.$('pin-dialog').open,true);assert.equal(f.$('pin-title').value,'Unsaved');assert.equal(f.$('save-pin').disabled,false);assert.match(f.$('pin-error').textContent,/Could not save/);f.dom.window.close();});

test('recent sites start empty without app shortcuts and refresh when home becomes active',async()=>{
 const f=await fixture();
 assert.equal(f.$('recent-status').textContent,'Sites you visit will appear here.');
 assert.equal(f.$('recent-sites').children.length,0);
 assert.equal(f.w.document.querySelector('.quick-links'),null);
 assert.equal(f.$('ai'),null);assert.equal(f.$('write'),null);
 f.data.recentSites=[{url:'https://example.org/latest',title:'Latest visit'}];
 f.w.VoodooHome.setActive(false);await tick();assert.equal(f.$('recent-sites').children.length,0);
 f.w.VoodooHome.setActive(true);await tick();
 assert.equal(f.$('recent-sites').querySelector('strong').textContent,'Latest visit');
 assert.equal(f.$('recent-status').hidden,true);
 assert.equal(f.$('recent-sites').getAttribute('aria-busy'),'false');
 f.dom.window.close();
});

test('recent titles render as text, remote icons are ignored, and clicking navigates the current tab',async()=>{
 const title='<img src=x onerror=alert(1)>';
 const f=await fixture([{url:'https://example.org/latest',title,icon:'https://tracker.example/icon.png'}]);
 const card=f.$('recent-sites').querySelector('button');
 assert.equal(card.querySelector('strong').textContent,title);
 assert.equal(card.querySelectorAll('img').length,0);
 assert.equal(card.querySelector('.favicon-letter').textContent,'E');
 card.click();await tick();
 const navigation=f.calls.filter(c=>c.op==='navigate');
 assert.equal(navigation.length,1);assert.equal(navigation[0].a.text,'https://example.org/latest');
 assert.equal(f.calls.filter(c=>c.op==='open-url').length,0);
 f.dom.window.close();
});

test('recent cards reject unsafe URLs, keep the newest visit per host, and cap at six',async()=>{
 const bad=['http://old.example','javascript:alert(1)','file:///tmp/data','https://key:secret@example.org','https://appassets.androidplatform.net/assets/home.html','https://appassets.androidplatform.net./assets/home.html'];
 const f=await fixture([...bad.map(url=>({url,title:'Unsafe'})),{url:'https://same.example/new',title:'Newest'},{url:'https://same.example/old',title:'Older'},...Array.from({length:8},(_,i)=>({url:'https://site'+i+'.example/page',title:'Site '+i}))]);
 const cards=[...f.$('recent-sites').children];assert.equal(cards.length,6);
 assert.equal(cards[0].querySelector('strong').textContent,'Newest');
 assert.equal(f.$('recent-sites').textContent.includes('Unsafe'),false);
 assert.equal(f.$('recent-sites').textContent.includes('Older'),false);
 assert.equal(cards[5].querySelector('strong').textContent,'Site 4');
 f.dom.window.close();
});

test('embedded PNG favicons render with a local initial fallback for decoding failures',async()=>{
 const icon='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j61kAAAAASUVORK5CYII=';
 const f=await fixture([{url:'https://example.org',title:'Example',icon}]);
 const image=f.$('recent-sites').querySelector('img');assert.ok(image);assert.equal(image.src,icon);
 image.dispatchEvent(new f.w.Event('error'));
 assert.equal(f.$('recent-sites').querySelector('img'),null);
 assert.equal(f.$('recent-sites').querySelector('.favicon-letter').textContent,'E');
 f.dom.window.close();
});

test('failed recent-site refresh retains working cards and exposes a retry',async()=>{
 const f=await fixture([{url:'https://example.org',title:'Example'}]),call=f.w.Host.call;
 f.w.Host.call=async(op,a)=>{if(op==='recent-sites')throw Error('Read failed');return call(op,a);};
 await f.w.VoodooHome.refreshRecentSites();
 assert.match(f.$('recent-status').textContent,/Couldn’t load recent sites/);
 assert.equal(f.$('recent-retry').hidden,false);assert.equal(f.$('recent-sites').children.length,1);
 assert.equal(f.$('recent-sites').getAttribute('aria-busy'),'false');
 f.w.Host.call=call;f.data.recentSites=[];f.$('recent-retry').click();await tick();
 assert.equal(f.$('recent-retry').hidden,true);assert.equal(f.$('recent-sites').children.length,0);
 assert.equal(f.$('recent-status').textContent,'Sites you visit will appear here.');
 f.dom.window.close();
});
