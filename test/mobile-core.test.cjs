const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../renderer/mobile/workbench/core.js');
test('phrase matching uses word boundaries, punctuation and common suffixes',()=>{
  assert.equal(C.phraseIn('A paper—crown on the shelf.','paper crown'),true);
  assert.equal(C.phraseIn('He walks straight home.','walk'),true);
  assert.equal(C.phraseIn('Walking straight home.','walk'),true);
  assert.equal(C.phraseIn('A walkway through town.','walk'),false);
});
test('locked bars survive paste, deletion and history restoration',()=>{
  const s=C.newSong();s.lyrics='Keep this exact bar.\nA second line.';C.toggleLock(s,'Keep this exact bar.');
  assert.equal(C.setLyrics(s,'Changed bar.\nA second line.').ok,false);
  assert.equal(s.lyrics,'Keep this exact bar.\nA second line.');
  assert.equal(C.setLyrics(s,'Keep this exact bar.\nA different second line.').ok,true);
  assert.equal(C.restore(s,{lyrics:'Older draft'}).ok,false);
  C.snapshot(s,'Approved');s.lyrics+='\nAnother line.';const lockCopy=C.copy(s.locks);
  assert.equal(C.restore(s,s.history[0]).ok,true);assert.deepEqual(s.locks,lockCopy);
  assert.equal(s.history[0].label,'Before restore');
});
test('duplicate approved bars preserve their count',()=>{
  const s=C.newSong();s.lyrics='Same approved bar\nSame approved bar';C.toggleLock(s,'Same approved bar');
  assert.equal(C.setLyrics(s,'Same approved bar').ok,false);
});
test('cross-song reuse is reported and intentional hook repeats are not',()=>{
  const state=C.initialState(),s=state.songs[0];s.lyrics='[Hook]\nI left the rent inside your drawer\nI left the rent inside your drawer';
  assert.equal(C.analyze(s,state).issues.filter(i=>i.type==='repeat').length,0);
  const other=C.newSong('Other song');other.lyrics='I left the rent inside your drawer';state.songs.push(other);
  assert.equal(C.analyze(s,state).issues.filter(i=>i.type==='reused').length,2);
});
test('backups preserve locks, versions, attempts and rules',()=>{
  const state=C.initialState(),s=state.songs[0];s.lyrics='My approved line';C.toggleLock(s,s.lyrics);C.snapshot(s,'First take');
  s.attempts.push({id:'a',at:C.now(),style:'Sparse drums',exclude:'Fast fills',lyrics:s.lyrics,result:'Keep the delivery',url:'https://suno.com/song/example',rating:'keep'});
  state.settings.blocked=['paper crown'];const parsed=C.parseArchive(JSON.stringify(state));
  assert.equal(parsed.songs[0].history[0].lyrics,s.lyrics);assert.deepEqual(parsed.songs[0].locks,s.locks);assert.equal(parsed.songs[0].attempts[0].rating,'keep');assert.deepEqual(parsed.settings.blocked,['paper crown']);
  C.mergeArchive(state,parsed);assert.equal(state.songs.length,2);assert.notEqual(state.songs[0].id,state.songs[1].id);
});
test('malformed imports cannot silently remove locks or crash state',()=>{
  const state=C.initialState();state.songs[0].lyrics='One line';state.songs[0].locks=[{text:'Missing line',count:1}];
  assert.throws(()=>C.parseArchive(JSON.stringify(state)),/lock/);
  assert.throws(()=>C.parseArchive('{broken'),/valid JSON/);
  assert.throws(()=>C.parseArchive(JSON.stringify({schema:99,songs:[]})),/supported/);
  const clean=C.initialState();clean.songs[0].history={};assert.throws(()=>C.parseArchive(JSON.stringify(clean)),/history/);
});
test('snapshots are deduplicated and bounded',()=>{
  const s=C.newSong();assert.equal(C.snapshot(s,'one'),true);assert.equal(C.snapshot(s,'same'),false);
  for(let i=0;i<60;i++){s.lyrics='Line '+i;C.snapshot(s,'Take '+i);}assert.equal(s.history.length,40);assert.equal(s.history[0].lyrics,'Line 59');
});
