'use strict';
const { randomUUID } = require('node:crypto');
const APP_URL = 'voodoo://app/index.html';
const MAX_TABS = 12;

function websiteUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw Error('Enter a shorter HTTPS address.');
  let u;
  try { u = new URL(value); } catch { throw Error('Enter a valid HTTPS address.'); }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) throw Error('Only HTTPS websites without embedded credentials are supported.');
  return u.href;
}
function navigationInput(value) {
  if (typeof value !== 'string' || value.length > 2048) throw Error('Enter a shorter address or search.');
  const text = value.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return websiteUrl(text.replace(/^http:/i,'https:'));
  if (/^[a-z][a-z\d+.-]*:/i.test(text)) throw Error('This address type is not supported.');
  if (!/\s/.test(text) && /^(localhost|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:[/?#]|$)/i.test(text)) return websiteUrl('https://'+text);
  return 'https://duckduckgo.com/?q='+encodeURIComponent(text);
}
function text(value, max, label) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw Error('Invalid '+label+'.');
  return value;
}
function newItem(kind, values) {
  const item = { id: randomUUID(), kind, title:text(values.title || (kind==='note'?'Untitled note':'Shared page'),200,'title'), createdAt:Date.now() };
  if (kind === 'note') item.body=text(values.body,20000,'note');
  else item.url=websiteUrl(values.url);
  return item;
}
function trustedSender(event, window) {
  try { return !!window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === APP_URL; }
  catch { return false; }
}
module.exports={APP_URL,MAX_TABS,websiteUrl,navigationInput,newItem,trustedSender,text};
