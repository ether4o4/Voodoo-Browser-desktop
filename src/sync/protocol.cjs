'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const MAX_ITEMS = 1000;
const MAX_ITEMS_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 1536 * 1024;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER - 1;
const PAIR_PREFIX = 'voodoo-pair:v1:';
const hex32 = /^[a-f0-9]{32}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function fail() { throw new Error('Invalid sync data.'); }
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  return value;
}
function exact(value, keys) {
  object(value);
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail();
}
function text(value, max) { if (typeof value !== 'string' || value.length > max || !value.isWellFormed()) fail(); return value; }
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail();
  return value;
}
function base64(value, bytes, max = MAX_BODY_BYTES) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail();
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value || (bytes !== undefined && decoded.length !== bytes) || decoded.length > max) fail();
  return decoded;
}
function privateIPv4(address, allowLoopback = false) {
  if (typeof address !== 'string' || net.isIPv4(address) === false || net.isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (allowLoopback && a === 127);
}
function safeUrl(value) {
  text(value, 2048);
  // Keep the original URL, so Java and JS agree exactly on immutable contents.
  if (!/^https:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value) || /%(?![0-9a-f]{2})/i.test(value)) fail();
  let url;
  try { url = new URL(value); } catch { fail(); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || (url.port && Number(url.port) < 1)) fail();
  const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1] || '';
  if (!/^[a-z0-9.:[\]-]+$/i.test(authority)) fail();
  if (url.hostname.startsWith('[')) {
    if (net.isIP(url.hostname.slice(1, -1)) !== 6) fail();
  } else if (url.hostname.length > 253 || url.hostname.replace(/\.$/, '').split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) fail();
  // URLs can themselves carry sign-in/reset tokens. Keep opaque fragments and
  // credential-like query parameters out of the shared library, too.
  if (url.hash) throw new Error('Remove the URL fragment before sharing this page.');
  for (const field of url.search.slice(1).split('&')) {
    let name = field.split('=', 1)[0].replace(/\+/g, ' ');
    for (let i = 0; i < 3 && name.includes('%'); i++) {
      try { name = decodeURIComponent(name); } catch { fail(); }
    }
    if (name.includes('%')) fail();
    name = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/(token|password|passwd|secret|apikey|authorization|session|oauth|signature|credential)/.test(name) || /^(code|key|auth|sig|jwt|csrf|xsrf|accesskey|clientkey|privatekey|publickey|authcode|verificationcode)$/.test(name)) throw new Error('This URL may contain a sign-in secret. Choose an ordinary page URL before sharing.');
  }
  return value;
}
function item(value) {
  object(value);
  if (value.kind === 'note') exact(value, ['id', 'kind', 'title', 'body', 'createdAt']);
  else if (value.kind === 'bookmark' || value.kind === 'tab') exact(value, ['id', 'kind', 'title', 'url', 'createdAt']);
  else fail();
  if (typeof value.id !== 'string' || !uuid.test(value.id)) fail();
  const result = { id: value.id, kind: value.kind, title: text(value.title, 200) };
  if (value.kind === 'note') result.body = text(value.body, 20000);
  else result.url = safeUrl(value.url);
  result.createdAt = integer(value.createdAt);
  return result;
}
function items(values) {
  if (!Array.isArray(values) || values.length > MAX_ITEMS) fail();
  const result = [], seen = new Set();
  for (const value of values) {
    const clean = item(value);
    if (seen.has(clean.id)) fail();
    seen.add(clean.id);
    result.push(clean);
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_ITEMS_BYTES) fail();
  return result;
}
function merge(existing, incoming) {
  const result = items(existing), additions = items(incoming);
  const byId = new Map(result.map(value => [value.id, value]));
  for (const value of additions) {
    const previous = byId.get(value.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(value)) throw new Error('Conflicting shared item.');
    if (!previous) { byId.set(value.id, value); result.push(value); }
  }
  return items(result);
}
function request(value) {
  exact(value, ['v', 'requestId', 'seq', 'op', 'name', 'items']);
  if (value.v !== 1 || !hex32.test(value.requestId) || !['pair', 'sync'].includes(value.op)) fail();
  text(value.name, 80);
  if (!value.name.trim()) fail();
  return { v: 1, requestId: value.requestId, seq: integer(value.seq, 1, MAX_SEQUENCE), op: value.op, name: value.name, items: items(value.items) };
}
function response(value) {
  exact(value, ['v', 'requestId', 'seq', 'items']);
  if (value.v !== 1 || !hex32.test(value.requestId)) fail();
  return { v: 1, requestId: value.requestId, seq: integer(value.seq, 1, MAX_SEQUENCE), items: items(value.items) };
}
function envelope(value) {
  exact(value, ['v', 'pairId', 'nonce', 'data']);
  if (value.v !== 1 || typeof value.pairId !== 'string' || !hex32.test(value.pairId)) fail();
  const nonce = base64(value.nonce, 12);
  const data = base64(value.data, undefined, MAX_BODY_BYTES);
  if (data.length < 16) fail();
  return { nonce, data };
}
function keyBytes(key) {
  if (typeof key === 'string') return base64(key, 32);
  if (!Buffer.isBuffer(key) || key.length !== 32) fail();
  return key;
}
function aad(pairId, direction) {
  if (!hex32.test(pairId) || !['request', 'response'].includes(direction)) fail();
  return Buffer.from('voodoo-sync-v1\n' + pairId + '\n' + direction, 'utf8');
}
function seal(key, pairId, direction, payload, nonce = crypto.randomBytes(12)) {
  if (!Buffer.isBuffer(nonce) || nonce.length !== 12) fail();
  const clean = direction === 'request' ? request(payload) : response(payload);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(key), nonce);
  cipher.setAAD(aad(pairId, direction));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(clean), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, pairId, nonce: nonce.toString('base64'), data: ciphertext.toString('base64') };
}
function open(key, value, direction) {
  const { nonce, data } = envelope(value);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(key), nonce);
  decipher.setAAD(aad(value.pairId, direction));
  decipher.setAuthTag(data.subarray(-16));
  const raw = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  if (raw.length > MAX_ITEMS_BYTES + 1024) fail();
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  const valueDecoded = JSON.parse(decoded);
  return direction === 'request' ? request(valueDecoded) : response(valueDecoded);
}
function pairCode(value, { allowLoopback = false } = {}) {
  exact(value, ['v', 'url', 'fingerprint', 'pairId', 'key', 'expiresAt']);
  if (value.v !== 1 || !hex32.test(value.pairId) || !/^[a-f0-9]{64}$/.test(value.fingerprint)) fail();
  base64(value.key, 32);
  integer(value.expiresAt);
  let url;
  try { url = new URL(value.url); } catch { fail(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.pathname !== '/' || !privateIPv4(url.hostname, allowLoopback) || !url.port) fail();
  if (value.url !== 'https://' + url.hostname + ':' + url.port) fail();
  return value;
}
function encodePair(value, options) { return PAIR_PREFIX + Buffer.from(JSON.stringify(pairCode(value, options)), 'utf8').toString('base64'); }
function decodePair(code, options) {
  if (typeof code !== 'string' || code.length > 4096 || !code.startsWith(PAIR_PREFIX)) fail();
  const raw = base64(code.slice(PAIR_PREFIX.length), undefined, 2048);
  return pairCode(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)), options);
}

module.exports = { MAX_ITEMS, MAX_ITEMS_BYTES, MAX_BODY_BYTES, MAX_SEQUENCE, PAIR_PREFIX, privateIPv4, safeUrl, item, items, merge, request, response, envelope, seal, open, encodePair, decodePair };
