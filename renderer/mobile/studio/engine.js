(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.VoodooEngine=api;})(globalThis,function(){
  'use strict';
  const blocked='appassets.androidplatform.net';
  function metadata(code){
    const header=code.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
    if(!header)throw Error('Add a userscript header with @name and @match.');
    const fields=Object.create(null);for(const m of header[1].matchAll(/^\s*\/\/[ \t]*@([\w-]+)(?:[ \t]+([^\r\n]*))?/gm))(fields[m[1]]??=[]).push((m[2]||'').trim());
    const matches=fields.match||[],includes=fields.include||[];if(!matches.length&&!includes.length)throw Error('Add at least one @match or @include URL pattern.');
    for(const p of [...matches,...(fields['exclude-match']||[])])pattern(p);
    for(const p of [...includes,...(fields.exclude||[])])glob(p);
    const runAt=fields['run-at']?.[0]||'document-idle';if(!['document-start','document-body','document-end','document-idle'].includes(runAt))throw Error('Unsupported @run-at.');
    return {name:fields.name?.[0]||'Untitled script',namespace:fields.namespace?.[0]||'',version:fields.version?.[0]||'',description:fields.description?.[0]||'',matches,includes,excludes:fields['exclude-match']||[],excludeGlobs:fields.exclude||[],grants:fields.grant||[],noframes:!!fields.noframes,runAt,fields};
  }
  function glob(p){if(p.length>2048)throw Error('Include/exclude pattern too long.');if(p.startsWith('/')&&p.endsWith('/')&&p.length>1)return new RegExp(p.slice(1,-1));return new RegExp('^'+p.split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$');}
  const apis=new Set('addStyle addElement getValue setValue deleteValue listValues getValues setValues deleteValues addValueChangeListener removeValueChangeListener xmlhttpRequest getResourceText getResourceURL download setClipboard registerMenuCommand unregisterMenuCommand notification info log openInTab'.split(' '));
  function diagnostics(meta){const issues=meta.grants.filter(g=>g!=='none'&&!apis.has(g.replace(/^GM[_.]/,'').replace('xmlHttpRequest','xmlhttpRequest'))).map(g=>'Unsupported grant: '+g);if(meta.grants.includes('none')&&meta.grants.length>1)issues.push('@grant none cannot be combined with other grants.');for(const f of ['unwrap','webRequest','sandbox'])if(meta.fields[f])issues.push('Unsupported execution directive: @'+f);return issues;}
  function pattern(value){
    if(value==='<all_urls>')return /^https?:\/\//;
    const m=value.match(/^(https?|\*):\/\/(\*|\*\.[A-Za-z0-9.-]+|[A-Za-z0-9.-]+|localhost)(\/[^\s]*)$/);
    if(!m)throw Error('Invalid @match: '+value);
    const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const scheme=m[1]==='*'?'https?':m[1],host=m[2]==='*'?'[^/]+':m[2].startsWith('*.')?'(?:[^/]+\\.)?'+esc(m[2].slice(2).toLowerCase()):esc(m[2].toLowerCase());
    return new RegExp('^'+scheme+'://'+host+'(?::[0-9]+)?'+m[3].split('*').map(esc).join('.*')+'$');
  }
  function matches(meta,url){try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.hostname.replace(/\.$/,'')===blocked)return false;const target=u.href.split('#')[0];return (meta.matches.some(p=>pattern(p).test(target))||meta.includes.some(p=>glob(p).test(target)))&&!meta.excludes.some(p=>pattern(p).test(target))&&!meta.excludeGlobs.some(p=>glob(p).test(target));}catch{return false;}}
  function validate(code){if(typeof code!=='string'||code.length>200000)throw Error('Scripts must be under 200 KB.');const meta=metadata(code);new Function(code);return meta;}
  function extractCode(text){const all=[...text.matchAll(/```(?:javascript|js|userscript)?\s*\n([\s\S]*?)```/g)];return all.find(m=>m[1].includes('==UserScript=='))?.[1]?.trim()||null;}
  function cleanUrl(input){try{const u=new URL(input);for(const k of [...u.searchParams.keys()])if(/^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i.test(k))u.searchParams.delete(k);return u.href;}catch{return input;}}
  return {metadata,pattern,glob,matches,validate,diagnostics,extractCode,cleanUrl};
});
