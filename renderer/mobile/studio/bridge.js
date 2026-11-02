(function(){
  'use strict';
  const api=parent!==window?parent.voodoo:null;
  globalThis.Host={call(op,args={}){if(!api)return Promise.reject(Error('Open this workspace inside Voodoo Browser.'));return api.invoke('studio',{...args,op});}};
  addEventListener('DOMContentLoaded',()=>{document.querySelectorAll('a[href]').forEach(a=>{a.addEventListener('click',e=>{e.preventDefault();const href=a.getAttribute('href');Host.call(href.includes('home.html')?'open-home':'navigate',href.includes('home.html')?{}:{text:a.href}).catch(error=>{const out=document.getElementById('status');if(out){out.hidden=false;out.textContent=error.message;}});});});});
})();
