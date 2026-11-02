const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const C=require('../renderer/mobile/workbench/core.js');
const assets=path.join(__dirname,'../renderer/mobile/workbench');

test('writing opens, edits and exports legacy data after the Suno section is removed',async()=>{
  const saved=C.initialState(),song=saved.songs[0];
  song.lyrics='Keep this approved bar\nA second line';
  C.toggleLock(song,'Keep this approved bar');
  song.style='Sparse drums';song.exclude='Vocal chops';
  saved.presets=[{id:'legacy-preset',name:'Saved direction',style:song.style,exclude:song.exclude}];
  song.attempts=[{id:'legacy-attempt',at:C.now(),style:song.style,exclude:song.exclude,lyrics:song.lyrics,result:'Keep the delivery',url:'https://suno.com/song/legacy',rating:'keep'}];
  C.snapshot(song,'Approved version');
  const legacy=JSON.parse(JSON.stringify(saved)),calls=[],exports=[];
  let stored=JSON.parse(JSON.stringify(saved));
  const dom=new JSDOM(fs.readFileSync(path.join(assets,'writing.html'),'utf8'),{url:'https://appassets.androidplatform.net/assets/workbench/writing.html',runScripts:'outside-only'});
  const w=dom.window,$=id=>w.document.getElementById(id);
  w.Host={call:async(op,args={})=>{
    calls.push(op);
    if(op==='get-store'){assert.equal(args.key,C.KEY);return JSON.parse(JSON.stringify(stored));}
    if(op==='put-store'){assert.equal(args.key,C.KEY);stored=JSON.parse(JSON.stringify(args.value));return true;}
    if(op==='export-file'){exports.push(args);return 'saved';}
    throw Error('Unexpected native operation: '+op);
  }};
  try{
    for(const file of ['native.js','core.js','app.js'])w.eval(fs.readFileSync(path.join(assets,file),'utf8'));
    for(let i=0;i<50&&!w.WorkbenchApp;i++)await new Promise(r=>setTimeout(r,10));
    assert.ok(w.WorkbenchApp,'the page finishes initialization');
    assert.equal($('error-banner').hidden,true);
    assert.deepEqual([...w.document.querySelectorAll('[data-tab]')].map(b=>b.dataset.tab),['write','versions','rules']);
    assert.equal($('tab-suno'),null);
    $('lyrics').value='Keep this approved bar\nAn edited second line';
    $('lyrics').dispatchEvent(new w.Event('input'));
    await w.WorkbenchApp.flush();
    assert.equal(stored.songs[0].lyrics,$('lyrics').value);
    for(const section of ['versions','rules','write']){
      w.document.querySelector('[data-tab="'+section+'"]').click();
      assert.equal($('tab-'+section).hidden,false);
    }
    $('export-backup').click();
    const backup=C.parseArchive(exports.at(-1).text);
    assert.equal(backup.songs[0].style,legacy.songs[0].style);
    assert.equal(backup.songs[0].exclude,legacy.songs[0].exclude);
    assert.deepEqual(backup.songs[0].locks,legacy.songs[0].locks);
    assert.deepEqual(backup.songs[0].attempts,legacy.songs[0].attempts);
    assert.deepEqual(backup.presets,legacy.presets);
    assert.equal(backup.songs[0].history[0].lyrics,legacy.songs[0].history[0].lyrics);
    assert.equal(calls.some(op=>op.includes('suno')||op.includes('loop')),false);
  }finally{w.close();}
});
