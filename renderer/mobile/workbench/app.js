(function () {
  'use strict';
  const C=globalThis.WorkbenchCore;
  const api=globalThis.browser||globalThis.chrome;
  const extension=!!(api?.runtime?.id&&api.storage?.local);
  const $=id=>document.getElementById(id);
  const E=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  let state, mode='editor',saveTimer,analysisTimer,toastTimer,pendingImport,viewVersion,loadedRevision=0,saveQueue=Promise.resolve(),dirty=false,storageFailed=false,changeNumber=0,recoveryBlocked=false;
  const portableKey=C.KEY;
  function song(){return state.songs.find(s=>s.id===state.activeId)||state.songs[0];}
  function date(s){const d=new Date(s);return Number.isNaN(d.getTime())?'Saved':d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
  function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?6500:3500);}
  function banner(message){$('error-banner').textContent=message;$('error-banner').hidden=!message;}
  async function readStore(){if(extension)return (await api.storage.local.get(portableKey))[portableKey]||null;const raw=localStorage.getItem(portableKey);return raw?JSON.parse(raw):null;}
  async function writeStore(value){if(extension)await api.storage.local.set({[portableKey]:value});else localStorage.setItem(portableKey,JSON.stringify(value));}
  function save(){clearTimeout(saveTimer);changeNumber++;dirty=true;$('save-status').textContent='Saving…';saveTimer=setTimeout(()=>flush(),260);}
  function flush(){
    clearTimeout(saveTimer);
    saveQueue=saveQueue.catch(()=>{}).then(async()=>{
      if(!dirty)return true;
      try{
        if(recoveryBlocked)throw new Error('The original saved data needs recovery. Export this open draft before repairing browser storage.');
        const previous=await readStore();
        if((previous?._revision||0)!==loadedRevision){throw new Error('This workbench changed in another tab. Export your current work, then reload this tab before editing.');}
        const data=C.copy(state),savedChange=changeNumber;data._revision=loadedRevision+1;
        if(JSON.stringify(data).length>4500000)throw new Error('Your workbench is near its storage limit. Export a backup, then remove older sessions.');
        await writeStore(data);loadedRevision=data._revision;dirty=changeNumber!==savedChange;storageFailed=false;$('save-status').textContent=dirty?'Saving…':'Saved on this device';banner('');if(dirty){clearTimeout(saveTimer);saveTimer=setTimeout(()=>flush(),0);}return true;
      }catch(e){storageFailed=true;$('save-status').textContent='Not saved — export backup';banner(e.message+' Your current work is still open. Use Export backup to keep a copy.');return false;}
    });return saveQueue;
  }
  function touch(){song().updatedAt=C.now();save();}
  function switchTab(id){document.querySelectorAll('[data-tab]').forEach(b=>{const yes=b.dataset.tab===id;b.classList.toggle('active',yes);if(yes)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});document.querySelectorAll('.tab-panel').forEach(p=>p.hidden=p.id!=='tab-'+id);if(id==='versions')renderVersions();if(id==='rules')renderRules();}
  function renderSongs(){
    const query=$('search-songs').value.toLowerCase();$('song-count').textContent=String(state.songs.length).padStart(2,'0');$('song-list').replaceChildren();$('mobile-song').replaceChildren();
    state.songs.forEach(s=>{
      const option=E('option','',s.title||'Untitled session');option.value=s.id;$('mobile-song').append(option);
      if(!s.title.toLowerCase().includes(query))return;
      const b=E('button','song-button'+(s.id===state.activeId?' active':''));b.type='button';b.dataset.songId=s.id;b.setAttribute('aria-pressed',String(s.id===state.activeId));b.append(E('strong','',s.title||'Untitled session'),E('small','',C.tokens(s.lyrics).length+' words · '+date(s.updatedAt)));b.addEventListener('click',()=>selectSong(s.id));$('song-list').append(b);
    });$('mobile-song').value=state.activeId;
  }
  function selectSong(id){if(id===state.activeId)return;C.snapshot(song(),'Session checkpoint');state.activeId=id;save();render();}
  function render(){const s=song();$('song-title').value=s.title;$('song-bpm').value=s.bpm;$('lyrics').value=s.lyrics;$('song-notes').value=s.notes;$('song-references').value=s.references;renderSongs();renderAnalysis();renderVersions();renderRules();}
  function renderAnalysis(){
    const s=song(),a=C.analyze(s,state);$('word-count').textContent=a.words+' words';$('bar-count').textContent=a.bars;$('locked-count').textContent=a.locked;$('flag-count').textContent=a.issues.length;$('lock-caption').textContent=a.locked?a.locked+' approved '+(a.locked===1?'bar is':'bars are')+' protected.':'Lock approved bars in Line view.';
    $('checks-list').replaceChildren();
    if(!a.issues.length){const p=E('div','empty-check');p.append(E('strong','',a.bars?'No rule matches found.':'Room for the first line.'),E('span','',a.bars?'Read it out loud. A clean check is a starting point.':'Write a few bars, then check them against your rules.'));$('checks-list').append(p);}
    a.issues.forEach(i=>{const b=E('button','check-item');b.append(E('span','issue-label','Line '+i.line+' / '+({blocked:'Phrase rule',reused:'Reused line',repeat:'Repetition',cadence:'Cadence',review:'Review'}[i.type])),E('strong','',i.message),E('p','',i.text));b.addEventListener('click',()=>focusLine(i.line));$('checks-list').append(b);});
    $('line-view').replaceChildren();
    if(!a.rows.length)$('line-view').append(E('div','empty-state','Write a few bars in Editor, then lock the ones you want to keep.'));
    a.rows.forEach(r=>{
      if(r.section===true){$('line-view').append(E('div','section-row',r.text));return;}
      const row=E('div','line-row'+(r.locked?' locked':''));row.dataset.line=String(r.index+1);const words=E('div');words.append(E('div','line-text',r.text),E('div','line-meta','~'+r.syllables+' syllables · '+r.words+' words'+(r.issues.length?' · '+r.issues.length+' flags':'')));
      const button=E('button','lock-button',r.locked?'Unlock':'Lock');button.setAttribute('aria-label',(r.locked?'Unlock':'Lock')+' line '+(r.index+1));button.setAttribute('aria-pressed',String(r.locked));button.addEventListener('click',()=>{C.toggleLock(s,r.text);touch();renderAnalysis();toast(r.locked?'Bar unlocked.':'Approved bar protected.');});row.append(E('span','line-no',String(r.index+1).padStart(2,'0')),words,button);$('line-view').append(row);
    });
  }
  function focusLine(n){setMode('editor');const ta=$('lyrics');const lines=ta.value.split('\n');const start=lines.slice(0,n-1).reduce((a,s)=>a+s.length+1,0);ta.focus();ta.setSelectionRange(start,start+(lines[n-1]||'').length);ta.scrollTop=Math.max(0,(n-4)*30);}
  function setMode(value){mode=value;const edit=mode==='editor';$('lyrics').hidden=!edit;$('line-view').hidden=edit;for(const id of ['editor','line']){$(id+'-mode').classList.toggle('active',id===mode);$(id+'-mode').setAttribute('aria-pressed',String(id===mode));}if(!edit)renderAnalysis();}
  function renderVersions(){const s=song();$('history-count').textContent=s.history.length;$('versions-list').replaceChildren();if(!s.history.length){const empty=E('div','empty-state');empty.append(E('strong','','Your first take starts here.'),E('span','','Save a named version when you have something worth keeping.'));$('versions-list').append(empty);return;}s.history.forEach(v=>{const card=E('article','version-card'),body=E('div');body.append(E('strong','',v.label),E('p','',date(v.at)+' · '+C.tokens(v.lyrics).length+' words · '+v.locks.reduce((a,x)=>a+x.count,0)+' locked'));const b=E('button','secondary','View version');b.addEventListener('click',()=>{viewVersion=v;$('version-dialog-title').textContent=v.label;$('version-dialog-date').textContent=date(v.at);$('version-preview').value=v.lyrics;$('version-preview-style').textContent=v.style?'Style: '+v.style:'No style saved with this version.';$('version-dialog').showModal();});card.append(body,b);$('versions-list').append(card);});}
  function renderRules(){$('writing-rules').value=state.settings.rules;$('blocked-phrases').value=state.settings.blocked.join('\n');$('rule-count').textContent=state.settings.blocked.length+' phrase rules';}
  async function askName(title,value){return new Promise(resolve=>{const d=$('name-dialog');$('name-dialog-title').textContent=title;$('name-input').value=value||'';d.returnValue='cancel';const closed=()=>{d.removeEventListener('close',closed);resolve(d.returnValue==='save'?$('name-input').value.trim():null);};d.addEventListener('close',closed);d.showModal();$('name-input').focus();$('name-input').select();});}
  async function createSong(){const title=await askName('New session','');if(title===null)return;if(state.songs.length>=100){toast('Export and remove an older session before adding more.',true);return;}C.snapshot(song(),'Session checkpoint');const s=C.newSong(title||'Untitled session');state.songs.unshift(s);state.activeId=s.id;save();render();switchTab('write');$('lyrics').focus();}
  async function saveVersion(){const label=await askName('Save a version','Take '+String(song().history.length+1).padStart(2,'0'));if(label===null)return;const added=C.snapshot(song(),label||'Saved version');save();renderVersions();toast(added?'Version saved.':'This draft already matches the newest version.');}
  async function clipboard(text,label){if(!text.trim()){toast('Nothing to copy yet.');return;}try{await navigator.clipboard.writeText(text);toast(label+' copied.');}catch{const ta=E('textarea');ta.value=text;ta.style.position='fixed';ta.style.top='0';ta.style.left='0';ta.style.opacity='0';document.body.append(ta);ta.select();let ok=false;try{ok=document.execCommand('copy');}catch{}ta.remove();toast(ok?label+' copied.':'Copy unavailable here. Use Export song or open this file in your browser.',!ok);}}
  function download(filename,text,type='application/json'){if(globalThis.VoodooDownload){globalThis.VoodooDownload(filename,text,type).catch(e=>toast(e.message,true));return;}const url=URL.createObjectURL(new Blob([text],{type}));const a=E('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  function exportBackup(){const data={...C.copy(state),exportedAt:C.now()};download('4GAuteau-backup-'+C.now().slice(0,10)+'.json',JSON.stringify(data,null,2));toast('Backup exported. Keep it before changing browsers.');}
  function exportSong(){const s=song(),name=s.title.replace(/[^a-z0-9-_]+/gi,'-').slice(0,70)||'session';download(name+'.txt','4GAUTEAU / '+s.title+'\nBPM: '+s.bpm+'\n\nLYRICS\n'+s.lyrics+'\n\nSTYLE\n'+s.style+'\n\nEXCLUDE STYLES\n'+s.exclude+'\n\nNOTES\n'+s.notes+'\n\nREFERENCES\n'+s.references,'text/plain;charset=utf-8');}
  function bind(){
    $('name-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('name-dialog').close('save');}});
    document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
    $('new-song').onclick=createSong;$('mobile-new').onclick=createSong;$('mobile-song').onchange=e=>selectSong(e.target.value);$('search-songs').oninput=renderSongs;
    $('song-title').oninput=e=>{song().title=e.target.value;touch();renderSongs();};$('song-title').onblur=()=>{if(!song().title.trim()){song().title='Untitled session';$('song-title').value=song().title;touch();renderSongs();}};
    $('song-bpm').onchange=e=>{song().bpm=Math.max(30,Math.min(300,Number(e.target.value)||72));e.target.value=song().bpm;touch();};
    $('lyrics').addEventListener('input',e=>{const ta=e.target,pos=ta.selectionStart,result=C.setLyrics(song(),ta.value);if(!result.ok){ta.value=song().lyrics;ta.setSelectionRange(Math.min(pos,ta.value.length),Math.min(pos,ta.value.length));toast(result.reason,true);return;}touch();clearTimeout(analysisTimer);analysisTimer=setTimeout(renderAnalysis,180);});
    for(const [id,key] of [['song-notes','notes'],['song-references','references']])$(id).addEventListener('input',e=>{song()[key]=e.target.value;touch();});
    $('editor-mode').onclick=()=>setMode('editor');$('line-mode').onclick=()=>setMode('line');$('check-lyrics').onclick=()=>{renderAnalysis();toast('Checked against your saved rules.');};
    $('save-version').onclick=saveVersion;$('version-save-2').onclick=saveVersion;$('copy-lyrics').onclick=()=>clipboard(song().lyrics,'Lyrics');$('copy-handoff').onclick=()=>clipboard(C.handoff(song(),state),'Writing brief');$('download-song').onclick=exportSong;
    $('close-version').onclick=()=>$('version-dialog').close();$('restore-version').onclick=()=>{if(!viewVersion)return;const result=C.restore(song(),viewVersion);if(!result.ok){toast(result.reason,true);return;}$('version-dialog').close();touch();render();toast('Version restored. Your previous draft is in history.');};
    $('duplicate-song').onclick=()=>{if(state.songs.length>=100){toast('Session limit reached.',true);return;}const s=C.copy(song());s.id=C.uid();s.title=(s.title+' — copy').slice(0,160);s.createdAt=C.now();s.updatedAt=C.now();state.songs.unshift(s);state.activeId=s.id;save();render();toast('Session duplicated.');};
    $('delete-song').onclick=()=>{if(!confirm('Delete “'+song().title+'” and its saved versions? Export a backup first if you want to keep it.'))return;state.songs=state.songs.filter(s=>s.id!==song().id);if(!state.songs.length)state.songs.push(C.newSong());state.activeId=state.songs[0].id;save();render();switchTab('write');toast('Session deleted.');};
    $('writing-rules').oninput=e=>{state.settings.rules=e.target.value;save();};
    $('save-rules').onclick=()=>{const phrases=[...new Set($('blocked-phrases').value.split('\n').map(x=>x.trim()).filter(Boolean))];if(phrases.length>1000||phrases.some(x=>x.length>160)){toast('Use up to 1,000 phrases, each under 160 characters.',true);return;}state.settings.blocked=phrases;save();renderRules();renderAnalysis();toast('Phrase rules saved.');};
    $('add-phrase-button').onclick=()=>{const p=$('add-phrase').value.trim();if(!p)return;if(state.settings.blocked.length>=1000){toast('Phrase list is full.',true);return;}if(!state.settings.blocked.some(x=>C.normalize(x)===C.normalize(p)))state.settings.blocked.push(p);$('add-phrase').value='';save();renderRules();renderAnalysis();toast('Phrase added.');};$('add-phrase').onkeydown=e=>{if(e.key==='Enter')$('add-phrase-button').click();};
    for(const id of ['export-backup','export-backup-2'])$(id).onclick=exportBackup;for(const id of ['import-backup','import-backup-2'])$(id).onclick=()=>$('import-file').click();
    $('import-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>4500000)throw new Error('Use a backup smaller than 4.5 MB.');pendingImport=C.parseArchive(await file.text());$('import-summary').textContent=pendingImport.songs.length+' sessions and '+pendingImport.presets.length+' presets found.';$('import-settings').checked=false;$('import-dialog').showModal();}catch(error){toast(error.message,true);}e.target.value='';};
    $('cancel-import').onclick=()=>{pendingImport=null;$('import-dialog').close();};$('confirm-import').onclick=()=>{try{if(!pendingImport)return;const candidate=C.copy(state);const n=C.mergeArchive(candidate,pendingImport,$('import-settings').checked);if(JSON.stringify(candidate).length>4500000)throw new Error('Combined backup is too large. Export and remove older sessions first.');state=candidate;pendingImport=null;$('import-dialog').close();save();render();toast(n+' sessions imported as new copies.');}catch(error){toast(error.message,true);}};
    window.addEventListener('beforeunload',e=>{if(dirty||storageFailed){e.preventDefault();e.returnValue='';}});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){C.snapshot(song(),'Session checkpoint');save();flush();}});
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveVersion();}});
  }
  async function init(){
    let loadError='';
    try{const existing=await readStore();loadedRevision=existing?._revision||0;state=existing?C.parseArchive(JSON.stringify(existing)):C.initialState();}
    catch(e){state=C.initialState();loadError='Saved data could not be opened: '+e.message+' Your existing stored data has not been replaced.';storageFailed=true;recoveryBlocked=true;}
    bind();render();$('save-status').textContent=storageFailed?'Storage needs attention':'Saved on this device';
    if(loadError)banner(loadError);else {save();await flush();}
    if(!extension&&location.protocol==='file:')banner('Portable file: use Export full backup regularly. Some phone browsers do not retain storage for local files.');
    globalThis.WorkbenchApp={getState:()=>C.copy(state),flush,extension};
  }
  init().catch(e=>{banner('Could not open Workbench: '+e.message);$('save-status').textContent='Could not open';});
})();
