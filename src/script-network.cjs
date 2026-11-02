'use strict';
const {websiteUrl}=require('./policy.cjs');

function connects(meta,address,page) {
  const u=new URL(websiteUrl(address)),host=u.hostname.toLowerCase().replace(/\.$/,'');
  if(host==='appassets.androidplatform.net')return false;
  return (meta.fields.connect||[]).some(rule=>{let r=rule.toLowerCase().replace(/\.$/,'');if(r==='self')r=new URL(page).hostname.toLowerCase().replace(/\.$/,'');return r==='*'||host===r||host.endsWith('.'+r);});
}
// Native requests without a browser cookie jar. Application credentials never enter this transport.
async function request(details,{allow=websiteUrl,limit=4_000_000,signal,fetchImpl=fetch}={}) {
  let url=websiteUrl(details.url);allow(url);
  const method=String(details.method||'GET').toUpperCase();
  if(!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method))throw Error('Unsupported request method.');
  let headers={};
  for(const [key,value] of Object.entries(details.headers||{})){
    if(!/^[a-z0-9!#$%&'*+.^_`|~-]+$/i.test(key)||/^(cookie2?|proxy-authorization|host|origin|referer|connection|content-length|sec-.+)$/i.test(key)||typeof value!=='string'||/[\r\n]/.test(value))throw Error('Unsupported script request header: '+key);
    if(Object.keys(headers).length>=40||value.length>8192)throw Error('Request headers too large.');headers[key]=value;
  }
  const body=details.data;if(body!==undefined&&(typeof body!=='string'||Buffer.byteLength(body)>1_000_000))throw Error('Request data must be text under 1 MB.');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(Error('Request timed out.')),Math.max(1000,Math.min(Number(details.timeout)||45000,60000)));
  const abort=()=>controller.abort(signal.reason);if(signal){if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});}
  try {
    let response;
    for(let hop=0;hop<6;hop++){
      allow(url);response=await fetchImpl(url,{method,headers,body:['GET','HEAD'].includes(method)?undefined:body,redirect:'manual',credentials:'omit',signal:controller.signal});
      if(![301,302,303,307,308].includes(response.status))break;
      await response.body?.cancel();const next=response.headers.get('location');if(!next||hop===5)throw Error('Too many redirects.');
      // Never replay a POST body across redirects, even to another allowed host.
      if(!['GET','HEAD'].includes(method))throw Error('Redirected script writes are unsupported.');
      const destination=websiteUrl(new URL(next,url).href);
      // Match mobile: script-supplied authentication never crosses an origin redirect.
      if(new URL(destination).origin!==new URL(url).origin)headers={};url=destination;
    }
    const chunks=[];let size=0;
    if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('Response exceeds the download limit.');}
    if(response.body)for await(const chunk of response.body){size+=chunk.length;if(size>limit){controller.abort();throw Error('Response exceeds the download limit.');}chunks.push(Buffer.from(chunk));}
    const bytes=Buffer.concat(chunks),contentType=response.headers.get('content-type')||'application/octet-stream';
    return {status:response.status,statusText:response.statusText,readyState:4,finalUrl:url,responseText:bytes.toString('utf8'),base64:bytes.toString('base64'),contentType,responseHeaders:[...response.headers].filter(([k])=>!/^set-cookie/i.test(k)).map(([k,v])=>k+': '+v).join('\r\n')};
  } finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
module.exports={connects,request};
