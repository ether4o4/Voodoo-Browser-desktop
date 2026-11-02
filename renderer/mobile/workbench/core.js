(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkbenchCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '1.0.0';
  const KEY = 'fourgauteau.workbench.v1';
  const DEFAULT_BLOCKED = [
    'neon', 'glow', 'glowing', 'city lights', 'lights blur', 'blurred lights',
    'headlights', 'taillights', 'skyline', 'moonlight', 'starlight', 'streetlights',
    'shadows dancing', 'silhouette', 'reflection in the mirror', 'mirror staring back',
    'midnight sky', 'hum', 'humming', 'buzz', 'buzzing', 'echo', 'echoes', 'whisper',
    'whispers', 'static', 'static in my head', 'ringing', 'sirens calling', 'hear the voices',
    'demons', 'inner demons', 'fighting demons', 'haunted', 'ghosts of my past',
    'scars run deep', 'broken soul', 'damaged heart', 'cold heart', 'heart of ice',
    'numb the pain', 'drowning in my thoughts', 'lost myself', 'losing myself',
    'obsidian', 'velvet darkness', 'crimson tears', 'shattered pieces', 'fractured soul',
    'abyss', 'void', 'chaos inside', 'darkness calling', 'drowning in the dark',
    'storm inside me', 'hurricane in my mind'
  ];
  const FILLER = ['charge it to the game', 'cut too deep', 'through the pain',
    'nothing was the same', 'nothing left to lose', 'against the world',
    'keep it real', 'fake friends', 'ride or die', 'through it all'];
  const WRITING_RULES = 'Sound first, but not nonsense. Meaning present, but not explained. Specific images instead of abstract declarations. Physical consequences instead of generic flexes. Contradictions instead of emotional summaries. Conversation instead of perfect sentences. Vary sentence shape and density. Ration heavy thoughts. Keep humor in observations. Preserve approved lines exactly. Avoid filler and reused lines from my other songs.';
  const PRESETS = [
    {id:'slow-pocket', name:'Slow pocket', style:'Slow melodic trap, 72 BPM, deep sustained saturated 808s, sparse percussion, restrained snare, spacious minor-key keys, warm filtered synth pads, intimate low-register male vocal, conversational phrasing, understated doubles, compact room reverb, minimal arrangement, clear space around each vocal phrase.', exclude:'Rapid percussion fills, busy hi-hats, bright pop melodies, acoustic strumming, exaggerated vocal runs'},
    {id:'low-filter', name:'Close & filtered', style:'Sparse melodic trap, 68 BPM, rounded sub bass with long sustain, soft minor-key chords, dry restrained drums, close low-register male vocal with a rounded low-pass tone, short dense room reverb tucked directly behind the lead, tight vocal doubling, softened consonants, spacious phrasing, intimate delivery.', exclude:'Long delay repeats, wide layered choirs, harsh treble, busy percussion, prominent acoustic guitars'},
    {id:'grit-melody', name:'Grit & melody', style:'Southern melodic trap, 76 BPM, heavy sustained 808s, sparse piano motif, minimal drum pattern, raw textured male vocal, elastic sung-rap phrasing, confident conversational delivery, compact hook, occasional low doubles, restrained reverb, deliberate pauses, direct emotional detail.', exclude:'Fast drum rolls, glossy pop chorus, exaggerated vocal runs, acoustic strumming'}
  ];
  function uid() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); }
  function now() { return new Date().toISOString(); }
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function normalize(t) { return String(t || '').normalize('NFKC').toLowerCase().replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim(); }
  function tokens(t) { return normalize(t).split(/\s+/).filter(Boolean); }
  function countLines(lyrics, text) { return String(lyrics).replace(/\r/g, '').split('\n').filter(x => x === text).length; }
  function newSong(title = 'Untitled session') { return {id:uid(), title, lyrics:'', style:'', exclude:'', bpm:72, notes:'', references:'', locks:[], history:[], attempts:[], createdAt:now(), updatedAt:now()}; }
  function initialState() { const s=newSong(); return {schema:1, version:VERSION, songs:[s], activeId:s.id, settings:{blocked:DEFAULT_BLOCKED.slice(), rules:WRITING_RULES}, presets:copy(PRESETS)}; }
  function isSection(line) { return /^\s*\[[^\]]+\]\s*$/.test(line); }
  function syllables(word) {
    let s=normalize(word).replace(/[^a-z]/g, '');
    if(!s) return 0;
    if(s.length<=3) return 1;
    s=s.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/,'').replace(/^y/,'');
    return Math.max(1,(s.match(/[aeiouy]{1,2}/g)||[]).length);
  }
  function phraseIn(text, phrase) {
    const a=normalize(text), b=normalize(phrase);
    if(!b) return false;
    if((' '+a+' ').includes(' '+b+' ')) return true;
    // Match grammatical suffixes on one-word rules without matching inside unrelated words.
    if(b.includes(' ')) return false;
    const roots=new Set([b,b+'s',b+'es',b+'ed',b+'ing',b+'y']);
    if(b.endsWith('e')) { roots.add(b.slice(0,-1)+'ing'); roots.add(b+'d'); }
    if(b.length>2 && /[aeiou][bcdfghjklmnpqrstvwxz]$/.test(b)) { roots.add(b+b.at(-1)+'ing'); roots.add(b+b.at(-1)+'ed'); }
    return tokens(text).some(t=>roots.has(t.replace(/'s$/,'')));
  }
  function lockViolation(song, nextLyrics) {
    return (song.locks||[]).find(l=>countLines(nextLyrics,l.text)<l.count) || null;
  }
  function setLyrics(song, next) {
    if(next.length>60000) return {ok:false,reason:'This session is limited to 60,000 lyric characters.'};
    const bad=lockViolation(song,next);
    if(bad) return {ok:false,reason:'That edit changes a locked bar. Unlock it in Line view first.',line:bad.text};
    song.lyrics=next.replace(/\r/g,''); song.updatedAt=now(); return {ok:true};
  }
  function toggleLock(song, text) {
    const index=song.locks.findIndex(l=>l.text===text);
    if(index>=0) song.locks.splice(index,1);
    else if(text.trim()&&!isSection(text)) song.locks.push({text,count:countLines(song.lyrics,text)});
    song.updatedAt=now();
  }
  function snapshot(song, label='Saved version') {
    const v={id:uid(),label:label.slice(0,100),at:now(),title:song.title,lyrics:song.lyrics,style:song.style,exclude:song.exclude,bpm:song.bpm,notes:song.notes,references:song.references,locks:copy(song.locks)};
    const previous=song.history[0];
    const same=previous&&['title','lyrics','style','exclude','bpm','notes','references'].every(k=>previous[k]===v[k])&&JSON.stringify(previous.locks)===JSON.stringify(v.locks);
    if(same) return false;
    song.history.unshift(v); song.history=song.history.slice(0,40); return true;
  }
  function restore(song, version) {
    const bad=lockViolation(song,version.lyrics);
    if(bad) return {ok:false,reason:'This version changes a currently locked bar. Unlock that bar before restoring.'};
    snapshot(song,'Before restore');
    // Current locks remain authoritative; restoring a version never quietly unlocks a bar.
    for(const key of ['title','lyrics','style','exclude','bpm','notes','references']) song[key]=version[key];
    song.updatedAt=now(); return {ok:true};
  }
  function analyze(song, state) {
    const lines=song.lyrics.replace(/\r/g,'').split('\n');
    const issues=[], rows=[], seen=new Map(); let section='';
    const recycled=new Map();
    for(const other of state.songs) if(other.id!==song.id) for(const line of other.lyrics.split('\n')) {
      const n=normalize(line); if(tokens(line).length>=5&&!isSection(line)) { if(!recycled.has(n)) recycled.set(n,[]); recycled.get(n).push(other.title); }
    }
    lines.forEach((text,index)=>{
      if(isSection(text)) {section=text.trim().slice(1,-1);rows.push({index,text,section:true}); return;}
      if(!text.trim()) return;
      const row={index,text,words:tokens(text).length,syllables:tokens(text).reduce((a,t)=>a+syllables(t),0),locked:song.locks.some(l=>l.text===text),issues:[],section};
      const add=(type,message)=>{const issue={type,message,line:index+1,text};row.issues.push(issue);issues.push(issue);};
      const blocked=state.settings.blocked.filter(p=>phraseIn(text,p));
      if(blocked.length) add('blocked','Matches '+blocked.length+' blocked '+(blocked.length===1?'phrase':'phrases')+'.');
      if(FILLER.some(p=>phraseIn(text,p))) add('review','Familiar phrasing: try a specific action, object, or consequence.');
      const n=normalize(text);
      if(recycled.has(n)) add('reused','Also in '+[...new Set(recycled.get(n))].slice(0,3).join(', ')+'.');
      if(seen.has(n)&&!/(hook|chorus|refrain)/i.test(section)) add('repeat','Repeats line '+seen.get(n)+'. Keep it if the repetition is intentional.');
      else seen.set(n,index+1);
      rows.push(row);
    });
    const lyricRows=rows.filter(r=>!r.section);
    for(let i=1;i<lyricRows.length;i++) {
      const prev=lyricRows[i-1],r=lyricRows[i];
      if(prev.section===r.section&&r.syllables>=prev.syllables+7) {
        const issue={type:'cadence',line:r.index+1,text:r.text,message:'About '+(r.syllables-prev.syllables)+' more syllables than the previous line. Try a pause or split; check against your delivery.'};
        r.issues.push(issue);issues.push(issue);
      }
    }
    const total=lyricRows.reduce((a,r)=>a+r.words,0);
    return {rows,issues,words:total,bars:lyricRows.length,locked:song.locks.reduce((a,l)=>a+l.count,0),blocked:issues.filter(i=>i.type==='blocked').length};
  }
  function handoff(song,state) {
    const locked=song.locks.map(x=>x.text).join('\n')||'(None yet)';
    return 'SONG: '+song.title+'\n\nWRITING RULES\n'+state.settings.rules+'\n\nDO NOT USE\n'+state.settings.blocked.join(', ')+'\n\nLOCKED BARS — KEEP EXACTLY\n'+locked+'\n\nCONTEXT & REFERENCES\n'+song.references+'\n'+song.notes+'\n\nSTYLE\n'+song.style+'\n\nEXCLUDE STYLES\n'+song.exclude+'\n\nLYRICS\n'+song.lyrics+'\n\nTASK\nRevise only the unlocked material I identify. Give meaningful wording with natural cadence. Do not recycle lines from other songs. Return the complete revision and preserve every locked bar exactly.';
  }
  function stringField(x, field, max, fallback='') {
    if(x[field]===undefined) return fallback;
    if(typeof x[field]!=='string'||x[field].length>max) throw new Error('Invalid '+field+' in backup.');
    return x[field];
  }
  function cleanSong(x) {
    if(!x||typeof x!=='object'||Array.isArray(x)) throw new Error('Invalid song in backup.');
    const song=newSong(stringField(x,'title',160,'Imported session'));
    song.id=stringField(x,'id',120,song.id);
    for(const key of ['lyrics','style','exclude','notes','references']) song[key]=stringField(x,key,key==='lyrics'?60000:20000);
    song.bpm=Number(x.bpm)||72; if(song.bpm<30||song.bpm>300) throw new Error('BPM must be between 30 and 300.');
    for(const key of ['createdAt','updatedAt']) song[key]=stringField(x,key,50,song[key]);
    if(x.locks!==undefined&&!Array.isArray(x.locks)) throw new Error('Invalid locks in backup.');
    song.locks=(x.locks||[]).map(l=>{
      const text=stringField(l,'text',60000);
      if(!text.trim()||text.includes('\n')||!Number.isInteger(l.count)||l.count<1||countLines(song.lyrics,text)<l.count) throw new Error('A backup lock does not match its lyrics.');
      return {text,count:l.count};
    });
    if(new Set(song.locks.map(x=>x.text)).size!==song.locks.length) throw new Error('Duplicate lock in backup.');
    if(x.history!==undefined&&!Array.isArray(x.history)) throw new Error('Invalid version history.');
    song.history=(x.history||[]).slice(0,40).map(v=>{
      const clean=cleanSong({...v,history:[],attempts:[]});
      delete clean.history;delete clean.attempts;
      return {...clean,label:stringField(v,'label',100,'Saved version'),at:stringField(v,'at',50,now())};
    });
    if(x.attempts!==undefined&&!Array.isArray(x.attempts)) throw new Error('Invalid attempt history.');
    song.attempts=(x.attempts||[]).slice(0,100).map(a=>({id:stringField(a,'id',120,uid()),at:stringField(a,'at',50,now()),style:stringField(a,'style',20000),lyrics:stringField(a,'lyrics',60000),exclude:stringField(a,'exclude',20000),result:stringField(a,'result',6000),url:stringField(a,'url',2000),rating:['keep','revise','pass'].includes(a.rating)?a.rating:'revise'}));
    return song;
  }
  function parseArchive(raw) {
    if(typeof raw!=='string'||raw.length>4500000) throw new Error('Use a JSON backup smaller than 4.5 MB.');
    let x;try{x=JSON.parse(raw);}catch{throw new Error('That file is not a valid JSON backup.');}
    if(x.schema!==1||!Array.isArray(x.songs)||x.songs.length>100) throw new Error('This is not a supported Workbench backup.');
    const songs=x.songs.map(cleanSong);
    if(new Set(songs.map(s=>s.id)).size!==songs.length) throw new Error('Duplicate song identifiers in backup.');
    const defaults=initialState();
    const blocked=x.settings?.blocked??defaults.settings.blocked;
    if(!Array.isArray(blocked)||blocked.length>1000||blocked.some(p=>typeof p!=='string'||p.length>160)) throw new Error('Invalid phrase rules in backup.');
    const settings={blocked:[...new Set(blocked.filter(x=>x.trim()))],rules:stringField(x.settings||{},'rules',20000,WRITING_RULES)};
    if(x.presets!==undefined&&(!Array.isArray(x.presets)||x.presets.length>100)) throw new Error('Invalid presets in backup.');
    const presets=(x.presets||defaults.presets).map(p=>({id:stringField(p,'id',120,uid()),name:stringField(p,'name',100,'Imported preset'),style:stringField(p,'style',20000),exclude:stringField(p,'exclude',20000)}));
    if(!songs.length) songs.push(newSong());
    return {schema:1,version:VERSION,songs,settings,presets,activeId:songs.some(s=>s.id===x.activeId)?x.activeId:songs[0].id};
  }
  function mergeArchive(state, imported, includeSettings=false) {
    if(state.songs.length+imported.songs.length>100) throw new Error('Keep no more than 100 sessions in one workbench.');
    const copies=imported.songs.map(s=>({...copy(s),id:uid()}));
    state.songs.push(...copies);state.activeId=copies[0].id;
    for(const p of imported.presets) if(!state.presets.some(s=>s.name===p.name&&s.style===p.style)) {if(state.presets.length<100)state.presets.push({...p,id:uid()});}
    if(includeSettings)state.settings=copy(imported.settings);
    return copies.length;
  }
  return {VERSION,KEY,DEFAULT_BLOCKED,WRITING_RULES,PRESETS,uid,now,copy,normalize,tokens,newSong,initialState,isSection,syllables,phraseIn,lockViolation,setLyrics,toggleLock,snapshot,restore,analyze,handoff,parseArchive,mergeArchive};
});
