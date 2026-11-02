(function(root){
  'use strict';
  const uid=()=>crypto.randomUUID(), copy=x=>JSON.parse(JSON.stringify(x));
  function skills(items=[]){
    if(!Array.isArray(items)||items.length>100)throw Error('Keep up to 100 skills.');
    const ids=new Set();return items.map(s=>{
      if(!s||typeof s.id!=='string'||!s.id||s.id.length>80||ids.has(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>120||typeof s.instructions!=='string'||s.instructions.length>20000)throw Error('Invalid skill. Use a name up to 120 characters and instructions up to 20,000.');
      ids.add(s.id);return {...s,name:s.name.trim()};
    });
  }
  function draft(s){if(!s)return {id:uid(),name:'',instructions:''};if(typeof s.id!=='string'||!s.id||s.id.length>80||typeof s.name!=='string'||s.name.length>120||typeof s.instructions!=='string'||s.instructions.length>20000)throw Error('Invalid skill draft.');return copy(s);}
  function normalize(state){state.skills=skills(state.skills);state.skillDraft=draft(state.skillDraft);if(!state.skills.some(s=>s.id===state.activeSkillId))state.activeSkillId=null;return state;}
  function prompt(state){const skill=state.skills?.find(s=>s.id===state.activeSkillId);return skill?'\nUser-selected skill: '+skill.name+'\n'+skill.instructions:'';}
  function mount({getState,persist,schedule}){
    const $=id=>document.getElementById(id),state=()=>getState();normalize(state());
    const editor=document.createElement('div');editor.id='script-editor';const section=$('scripts');for(const child of [...section.children].slice(1))editor.append(child);
    const nav=document.createElement('div');nav.className='workspace-modes';nav.innerHTML='<button id="script-mode" type="button">Script editor</button><button id="skill-mode" type="button">Skill editor</button>';
    const pane=document.createElement('div');pane.id='skill-editor';pane.hidden=true;pane.innerHTML='<p>Keep reusable instructions with your workbench. AI connections will be added separately.</p><div id="saved-skills"></div><div class="row wrap"><button id="new-skill">New skill</button><button id="import-skill">Import</button><button id="export-skill">Export</button></div><label for="skill-name">Skill name</label><input id="skill-name" maxlength="120"><label for="skill-instructions">Instructions</label><textarea id="skill-instructions" rows="16" maxlength="20000"></textarea><div class="row wrap"><button id="save-skill" class="primary">Save skill</button><button id="delete-skill" class="danger">Delete skill</button></div><p id="skill-status" role="status"></p><input id="skill-file" type="file" accept=".json,application/json" hidden>';
    section.append(nav,editor,pane);
    const fail=e=>{$('skill-status').textContent=e.message;};
    const modes=skill=>{editor.hidden=skill;pane.hidden=!skill;$('script-mode').classList.toggle('active',!skill);$('skill-mode').classList.toggle('active',skill);};
    const renderDraft=()=>{$('skill-name').value=state().skillDraft.name;$('skill-instructions').value=state().skillDraft.instructions;};
    const render=()=>{$('saved-skills').replaceChildren();for(const s of state().skills){const b=document.createElement('button');b.textContent=s.name;b.onclick=()=>{state().skillDraft=copy(s);renderDraft();modes(true);schedule();};$('saved-skills').append(b);}};
    const read=()=>{state().skillDraft={...state().skillDraft,name:$('skill-name').value,instructions:$('skill-instructions').value};schedule();};
    $('script-mode').onclick=()=>modes(false);$('skill-mode').onclick=()=>modes(true);$('skill-name').oninput=read;$('skill-instructions').oninput=read;
    $('new-skill').onclick=()=>{state().skillDraft=draft();renderDraft();schedule();};
    let writing=false;
    $('save-skill').onclick=async()=>{if(writing)return;writing=true;let previous;try{read();const submitted=skills([copy(state().skillDraft)])[0];previous=state().skills;state().skills=skills([...previous.filter(s=>s.id!==submitted.id),submitted]);await persist();render();$('skill-status').textContent='Skill saved.';}catch(e){if(previous)state().skills=previous;render();fail(e);}finally{writing=false;}};
    $('delete-skill').onclick=async()=>{if(writing||!confirm('Delete this saved skill?'))return;writing=true;const previous=state().skills;try{state().skills=previous.filter(s=>s.id!==state().skillDraft.id);await persist();state().skillDraft=draft();renderDraft();render();schedule();}catch(e){state().skills=previous;render();fail(e);}finally{writing=false;}};
    $('export-skill').onclick=()=>{try{read();const skill=skills([state().skillDraft])[0];Host.call('export-file',{filename:'Voodoo-skill.json',text:JSON.stringify({format:'voodoo-skill',version:1,skill},null,2)}).catch(fail);}catch(e){fail(e);}};
    $('import-skill').onclick=()=>$('skill-file').click();$('skill-file').onchange=async()=>{try{const file=$('skill-file').files[0];if(!file)return;if(file.size>100000)throw Error('Choose a skill under 100 KB.');const data=JSON.parse(await file.text());if(data.format!=='voodoo-skill'||data.version!==1)throw Error('Unsupported skill file.');state().skillDraft=skills([{...data.skill,id:uid()}])[0];renderDraft();schedule();$('skill-status').textContent='Imported as a draft. Review before saving.';}catch(e){fail(e);}finally{$('skill-file').value='';}};
    modes(false);renderDraft();render();return {render,stopVoice(){}};
  }
  const api={skills,draft,normalize,mount};root.VoodooWorkspace=api;if(typeof module==='object')module.exports=api;
})(globalThis);
