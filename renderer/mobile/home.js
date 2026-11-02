document.addEventListener('DOMContentLoaded',()=>{
  'use strict';
  const $=id=>document.getElementById(id),P=VoodooPins,fail=e=>$('status').textContent=e.message||String(e),run=fn=>()=>Promise.resolve().then(fn).catch(fail);
  let state={pins:[],names:P.names,active:'all'},selected=null,editing=null,moving=null,globe=null,serial=0,recentSerial=0,active=true,rotating=!matchMedia('(prefers-reduced-motion: reduce)').matches;
  const visible=()=>state.pins.filter(p=>state.active==='all'||p.group===state.active);
  const dot=group=>{const d=document.createElement('span');d.className='pin-dot';d.style.background=P.colors[group];return d;};
  function recentSites(value){
    if(!Array.isArray(value))throw Error('Recent sites are unavailable.');
    const sites=[],seen=new Set();
    for(const item of value){
      if(!item||typeof item.url!=='string'||item.url.length>4096)continue;
      let url;try{url=new URL(P.url(item.url));}catch{continue;}
      const host=url.hostname.replace(/\.$/,'');
      if(host==='appassets.androidplatform.net'||seen.has(host))continue;
      seen.add(host);sites.push({url:url.href,host,title:typeof item.title==='string'&&item.title.trim()?item.title.trim().slice(0,120):host.replace(/^www\./,''),icon:typeof item.icon==='string'&&item.icon.length<50000&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(item.icon)?item.icon:null});
      if(sites.length===6)break;
    }
    return sites;
  }
  function renderRecent(sites){
    const list=$('recent-sites');list.replaceChildren();
    for(const site of sites){
      const card=document.createElement('button');card.type='button';card.className='recent-card';card.setAttribute('aria-label','Open '+site.title+' — '+site.host);
      const fallback=document.createElement('span');fallback.className='recent-favicon favicon-letter';fallback.textContent=site.host.replace(/^www\./,'')[0].toUpperCase();fallback.setAttribute('aria-hidden','true');
      if(site.icon){const icon=document.createElement('img');icon.className='recent-favicon';icon.src=site.icon;icon.alt='';icon.onerror=()=>icon.replaceWith(fallback);card.append(icon);}else card.append(fallback);
      const text=document.createElement('span');text.className='recent-text';const title=document.createElement('strong');title.textContent=site.title;const host=document.createElement('small');host.textContent=site.host.replace(/^www\./,'');text.append(title,host);card.append(text);
      card.onclick=run(()=>Host.call('navigate',{text:site.url}));list.append(card);
    }
    $('recent-status').hidden=sites.length>0;$('recent-status').textContent=sites.length?'':'Sites you visit will appear here.';
  }
  async function refreshRecentSites(){
    const request=++recentSerial,list=$('recent-sites');list.setAttribute('aria-busy','true');$('recent-retry').hidden=true;
    if(!list.children.length){$('recent-status').hidden=false;$('recent-status').textContent='Loading recent sites…';}
    try{const sites=recentSites(await Host.call('recent-sites'));if(request!==recentSerial)return;renderRecent(sites);}
    catch{if(request!==recentSerial)return;$('recent-status').hidden=false;$('recent-status').textContent='Couldn’t load recent sites. Try again.';$('recent-retry').hidden=false;}
    finally{if(request===recentSerial)list.setAttribute('aria-busy','false');}
  }
  function renderFavorites(){
    const list=$('favorites');list.replaceChildren();
    const favorites=state.pins.filter(pin=>pin.group==='favorites');
    for(const pin of favorites.slice(0,6)){
      const card=document.createElement('button');card.className='recent-card';card.type='button';
      const label=document.createElement('strong');label.textContent=pin.title;card.append(dot('favorites'),label);
      card.onclick=run(()=>Host.call('open-pin',{pinId:pin.id}));list.append(card);
    }
    list.setAttribute('aria-busy','false');$('favorites-retry').hidden=true;$('favorites-status').hidden=!!favorites.length;
    $('favorites-status').textContent=favorites.length?'':'Add a favorite to keep it here.';
  }
  async function refreshFavorites(){
    $('favorites').setAttribute('aria-busy','true');
    try{await refresh();}catch(e){$('favorites').setAttribute('aria-busy','false');$('favorites-status').hidden=false;$('favorites-status').textContent='Could not load favorites. Try again.';$('favorites-retry').hidden=false;throw e;}
  }
  function render(){renderFavorites();
    $('workspace-filters').replaceChildren();for(const group of ['all',...P.groups]){const b=document.createElement('button');b.textContent=group==='all'?'All pins':state.names[group];if(group!=='all')b.prepend(dot(group));b.classList.toggle('active',state.active===group);b.setAttribute('aria-pressed',String(state.active===group));b.onclick=run(async()=>{await Host.call('set-workspace',{group});selected=null;cancelMove();await refresh();});$('workspace-filters').append(b);}
    $('pin-list').replaceChildren();const list=visible();$('open-workspace').disabled=!list.length;
    if(!list.length){const empty=document.createElement('p');empty.className='workspace-empty';empty.textContent='Your next favorite spot belongs here. Open a site and tap ＋ in the pin bar, or add one below.';$('pin-list').append(empty);}
    for(const pin of list){const row=document.createElement('div');row.className='pin-card';row.classList.toggle('selected',selected===pin.id);row.dataset.pin=pin.id;
      const open=document.createElement('button');open.className='pin-open';open.setAttribute('aria-label','Open '+pin.title);open.append(dot(pin.group));
      if(pin.icon?.startsWith('data:image/png;base64,')){const img=document.createElement('img');img.src=pin.icon;img.alt='';open.append(img);}else{const icon=document.createElement('span');icon.className='favicon-letter';icon.textContent=new URL(pin.url).hostname[0].toUpperCase();open.append(icon);}
      const label=document.createElement('span');label.className='pin-name';label.textContent=pin.title;const small=document.createElement('small');small.textContent=new URL(pin.url).hostname+' · '+state.names[pin.group];label.append(small);open.append(label);open.onclick=run(()=>Host.call('open-pin',{pinId:pin.id}));
      const more=document.createElement('button');more.textContent='···';more.className='pin-more';more.setAttribute('aria-label','Edit '+pin.title);more.onclick=()=>edit(pin);row.append(open,more);$('pin-list').append(row);
    }
  }
  async function refresh(newId){const request=++serial;const data=await Host.call('pins');if(request!==serial)return;state={pins:P.validate(data.pins),names:P.workspaceNames(data.names),active:['all',...P.groups].includes(data.active)?data.active:'all'};if(selected&&!state.pins.some(p=>p.id===selected))selected=null;render();globe?.setPins(visible(),newId);globe?.select(selected);}
  function edit(pin){editing=pin?.id||null;$('pin-dialog-title').textContent=pin?'Edit pin':'Pin a site';$('pin-title').value=pin?.title||'';$('pin-url').value=pin?.url||'';$('pin-url').disabled=!!pin;$('pin-url-label').hidden=!!pin;$('pin-error').textContent='';$('pin-group').replaceChildren();for(const group of P.groups){const o=document.createElement('option');o.value=group;o.textContent=state.names[group];$('pin-group').append(o);}$('pin-group').value=pin?.group||(state.active==='all'?'cyan':state.active);$('move-pin').hidden=!pin||!globe;$('remove-pin').hidden=!pin;$('pin-dialog').showModal();}
  function cancelMove(){moving=null;globe?.move(null);$('cancel-move').hidden=true;$('globe-caption').textContent=globe?'Drag to turn. Tap a pin to find its site.':'Your pins are available in the list.';}
  $('search').addEventListener('focus',()=>{$('search').value='';});
  $('favorite-add').onclick=()=>{edit(null);$('pin-group').value='favorites';};
  $('favorites-retry').onclick=run(refreshFavorites);
  $('favorites-all').onclick=run(async()=>{await Host.call('set-workspace',{group:'favorites'});await refresh();$('workspace-title').scrollIntoView({behavior:'smooth',block:'start'});});
  $('search-form').onsubmit=e=>{e.preventDefault();Host.call('navigate',{text:$('search').value}).catch(fail);};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('recent-retry').onclick=refreshRecentSites;
  $('add-pin').onclick=()=>edit(null);
  $('pin-form').onsubmit=async e=>{e.preventDefault();$('save-pin').disabled=true;try{const pin={title:$('pin-title').value.trim(),group:$('pin-group').value};if(!pin.title)throw Error('Give the pin a name.');let result;if(editing)result=await Host.call('update-pin',{pin:{...pin,id:editing}});else result=await Host.call('pin-site',{...pin,url:P.url($('pin-url').value)});$('pin-dialog').close();selected=result.id;await refresh(result.id);$('status').textContent='Pin saved.';}catch(e){$('pin-error').textContent=e.message;}finally{$('save-pin').disabled=false;}};
  $('remove-pin').onclick=run(async()=>{await Host.call('delete-pin',{pinId:editing});$('pin-dialog').close();cancelMove();await refresh();$('status').textContent='Unpinned. Its bookmark is still saved.';});
  $('move-pin').onclick=()=>{moving=editing;globe?.move(moving);$('pin-dialog').close();$('cancel-move').hidden=false;$('globe-caption').textContent='Turn the globe, then tap where this pin should go.';$('globe').scrollIntoView({behavior:'smooth',block:'center'});};
  $('cancel-move').onclick=cancelMove;
  $('rotate').textContent=rotating?'Pause rotation':'Rotate globe';$('rotate').setAttribute('aria-pressed',String(rotating));$('rotate').onclick=()=>{rotating=!rotating;globe?.rotate(rotating);$('rotate').textContent=rotating?'Pause rotation':'Rotate globe';$('rotate').setAttribute('aria-pressed',String(rotating));};
  $('open-workspace').onclick=run(async()=>{const r=await Host.call('open-workspace',{group:state.active});$('status').textContent=r.opened+' sites opened'+(r.remaining?'; '+r.remaining+' need space in the tab bar.':'.');});
  $('rename').onclick=()=>{$('name-fields').replaceChildren();for(const group of P.groups.filter(g=>g!=='favorites')){const label=document.createElement('label');label.textContent=group[0].toUpperCase()+group.slice(1);label.prepend(dot(group));const input=document.createElement('input');input.id='name-'+group;input.value=state.names[group];input.maxLength=20;input.required=true;label.append(input);$('name-fields').append(label);}$('names-error').textContent='';$('names-dialog').showModal();};
  $('names-form').onsubmit=async e=>{e.preventDefault();try{const names={favorites:'Favorites'};for(const group of P.groups.filter(g=>g!=='favorites')){names[group]=$('name-'+group).value.trim();if(!names[group])throw Error('Give each workspace a name.');}await Host.call('rename-workspaces',{names});$('names-dialog').close();await refresh();}catch(e){$('names-error').textContent=e.message;}};
  addEventListener('hashchange',()=>{if(['#favorites','#saved'].includes(location.hash))refreshFavorites().then(()=>$('workspace-title').scrollIntoView({block:'start'})).catch(fail);});
  globalThis.VoodooHome={refreshPins:id=>refresh(id).catch(fail),refreshRecentSites,setActive:value=>{active=value;globe?.setActive(value);if(value){refreshFavorites().catch(fail);refreshRecentSites();}}};
  refreshFavorites().catch(fail);
  refreshRecentSites();
  Host.call('get-store',{key:'options'}).then(o=>{if(o?.homeImage?.startsWith('data:image/'))$('home-image').src=o.homeImage;}).catch(fail);
  VoodooGlobe.create($('globe'),{onSelect:id=>{selected=id;render();globe?.select(id);const pin=state.pins.find(p=>p.id===id);$('globe-caption').textContent=pin?pin.title+' · '+state.names[pin.group]:'';},onMove:async(id,lat,lon)=>{try{await Host.call('update-pin',{pin:{id,lat,lon}});cancelMove();await refresh(id);$('status').textContent='Pin placed.';}catch(e){fail(e);}}}).then(instance=>{globe=instance;globe.setPins(visible());globe.setActive(active);globe.rotate(rotating);}).catch(()=>{const img=document.createElement('img');img.src='../assets/voodoo-globe.png';img.alt='Embroidered Voodoo globe';img.className='globe-fallback';$('globe').prepend(img);$('rotate').hidden=true;cancelMove();});
});
