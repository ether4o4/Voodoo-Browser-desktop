(function(){
  'use strict';const $=id=>document.getElementById(id),E=VoodooEngine;let view='discover',records=[],shown=0,generation=0,selected=null,mode='saved',target=null;
  const fail=e=>{$('status').textContent=e.message||String(e);};
  const host=(op,args)=>Host.call(op,args);
  function pick(next){mode=next;for(const item of ['saved','automatic','manual'])$(item+'-mode').checked=item===mode;$('activate').disabled=mode!=='manual'||!selected||selected.issues.length>0||!target?.url||!E.matches(selected.metadata,target.url);}
  function card(record,saved){const el=document.createElement('article');el.className='magic-card';const title=document.createElement('strong'),desc=document.createElement('p'),button=document.createElement('button');title.textContent=record.name;desc.textContent=saved?(record.enabled?'Automatic':record.activation==='manual'?'Manual · click Activate':'Saved only'):record.description;button.textContent='Script options';button.onclick=()=>open(record,saved).catch(fail);el.append(title,desc,button);return el;}
  function more(){for(const record of records.slice(shown,shown+20))$('results').append(card(record,view==='saved'));shown+=20;$('more').hidden=shown>=records.length;}
  async function load(next=view,refresh=false){
    const turn=++generation;view=next;selected=null;await host('discovery-cancel');$('results').replaceChildren();$('more').hidden=true;$('status').textContent=next==='saved'?'Loading saved scripts…':next==='commands'?'Loading commands…':'Searching Greasy Fork…';
    for(const id of ['discover','saved','commands'])$(id).setAttribute('aria-pressed',String(id===next));
    try{
      target=await host('context').catch(()=>null);if(turn!==generation)return;$('target').textContent=target?.url?'Magic scripts · '+new URL(target.url).hostname:'Magic scripts';
      if(next==='commands'){const status=await host('script-status');if(turn!==generation)return;for(const command of status.menus){const b=document.createElement('button');b.textContent=command.name;b.onclick=()=>host('script-menu',command).catch(fail);$('results').append(b);}$('status').textContent=status.menus.length?'Choose a script command.':'No active script commands. Activate a script that registers a command first.';return;}
      const data=next==='saved'?{records:(await host('get-store',{key:'studio'}))?.scripts||[]}:await host('discovery-list',{refresh});if(turn!==generation)return;records=data.records;shown=0;more();$('status').textContent=records.length+' '+(next==='saved'?'saved scripts.':'scripts found. Searching never installs or runs code.');
    }catch(e){if(turn===generation)fail(e);}
  }
  async function open(record,saved){
    const turn=++generation;$('status').textContent='Loading script options…';
    const result=saved?{script:record,code:record.code,metadata:E.metadata(record.code),issues:E.diagnostics(E.metadata(record.code))}:await host('discovery-code',{id:record.id});if(turn!==generation)return;
    selected=result;$('script-title').textContent=result.metadata.name;$('description').textContent=result.metadata.description;$('source').textContent=result.code;$('permissions').textContent='Sites: '+[...result.metadata.matches,...result.metadata.includes].join(', ')+'\nExcludes: '+[...result.metadata.excludes,...result.metadata.excludeGlobs].join(', ')+'\nGrants: '+result.metadata.grants.join(', ')+'\nNetwork: '+(result.metadata.fields.connect||[]).join(', ')+'\nDependencies: '+[...(result.metadata.fields.require||[]),...(result.metadata.fields.resource||[])].join(', ');$('compatibility').textContent=result.issues.length?'Compatibility: '+result.issues.join('; '):'Supported userscript APIs. Code runs in its own isolated world.';$('choice-status').textContent='';pick(record.enabled?'automatic':saved&&record.activation==='manual'?'manual':'saved');$('options').showModal();$('status').textContent='Review the source and permissions before saving.';
  }
  async function save(activate){
    if(!selected)return;$('save').disabled=true;$('activate').disabled=true;
    try{const script=await host('discovery-save',{scriptId:selected.script?.id,code:selected.code,sourceId:selected.record?.id,mode});if(activate)await host('run-script',{script});$('options').close();if(!activate){await load('saved');$('status').textContent=mode==='automatic'?'Saved for automatic activation. Reload the website once to use it here.':mode==='manual'?'Saved for manual activation. Select this script and click Activate whenever needed.':'Saved to scripts. Kept inactive.';}}
    catch(e){$('choice-status').textContent=e.message;}
    finally{$('save').disabled=false;pick(mode);}
  }
  for(const item of ['saved','automatic','manual'])$(item+'-mode').onchange=()=>pick(item);
  $('choice').onsubmit=e=>{e.preventDefault();save(false);};$('activate').onclick=()=>save(true);$('cancel').onclick=()=>$('options').close();$('more').onclick=more;
  $('discover').onclick=()=>load('discover');$('saved').onclick=()=>load('saved');$('commands').onclick=()=>load('commands');$('refresh').onclick=()=>load(view,true);
  $('back-site').onclick=()=>host('return-to-site').catch(fail);$('workbench').onclick=()=>host('open-workbench').catch(fail);
  addEventListener('voodoo:show',()=>load(view));addEventListener('voodoo:hide',()=>{generation++;host('discovery-cancel').catch(()=>{});$('options').close();});
  load();
})();
