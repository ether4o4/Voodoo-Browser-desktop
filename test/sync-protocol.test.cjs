'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const P = require('../src/sync/protocol.cjs');
const vector = require('../src/sync/vector.json');

const note = () => ({ id: crypto.randomUUID(), kind: 'note', title: 'Draft', body: 'Keep my words.', createdAt: Date.now() });

test('AES-GCM known-answer request interoperates with the Android fixture', () => {
  assert.deepEqual(P.seal(Buffer.from(vector.key, 'base64'), vector.pairId, 'request', vector.payload, Buffer.from(vector.nonce, 'base64')), vector.envelope);
  assert.deepEqual(P.open(vector.key, vector.envelope, 'request'), vector.payload);
});
test('wrong keys, tampering, and response/request reflection fail authentication', () => {
  assert.throws(() => P.open(crypto.randomBytes(32), vector.envelope, 'request'));
  assert.throws(() => P.open(vector.key, vector.envelope, 'response'));
  const changed = structuredClone(vector.envelope), raw = Buffer.from(changed.data, 'base64');
  raw[3] ^= 1; changed.data = raw.toString('base64');
  assert.throws(() => P.open(vector.key, changed, 'request'));
  assert.throws(() => P.open(vector.key, { ...vector.envelope, pairId: 'f'.repeat(32) }, 'request'));
});
test('strict envelopes reject unknown fields and malformed/noncanonical encodings', () => {
  assert.throws(() => P.open(vector.key, { ...vector.envelope, token: 'never accepted' }, 'request'));
  assert.throws(() => P.open(vector.key, { ...vector.envelope, nonce: vector.envelope.nonce + ' ' }, 'request'));
  assert.throws(() => P.open(vector.key, { ...vector.envelope, nonce: Buffer.alloc(11).toString('base64') }, 'request'));
  assert.throws(() => P.open(vector.key, { ...vector.envelope, data: 'AA==' }, 'request'));
});
test('shared records reject credentials, unsafe URLs, unsupported types and oversized data', () => {
  const value = note();
  assert.throws(() => P.item({ ...value, apiKey: 'should never enter sync' }));
  assert.throws(() => P.item({ ...value, kind: 'cookie' }));
  assert.throws(() => P.item({ ...value, body: 'x'.repeat(20001) }));
  for (const url of ['http://example.com', 'javascript:alert(1)', 'file:///C:/secret', 'https://user:password@example.com', 'https://example.com\\@evil.test', 'https://example.com/with space']) {
    assert.throws(() => P.item({ id: value.id, kind: 'tab', title: '', url, createdAt: 1 }));
  }
  assert.throws(() => P.item({ ...value, createdAt: 1.5 }));
  assert.throws(() => P.items(Array.from({ length: 1001 }, note)));
  assert.throws(() => P.items(Array.from({ length: 60 }, () => ({ ...note(), body: 'a'.repeat(20000) }))));
});
test('immutable merge keeps both notes and rejects conflicting IDs without replacing originals', () => {
  const first = note(), second = note();
  assert.deepEqual(P.merge([first], [second, { createdAt: first.createdAt, body: first.body, title: first.title, kind: first.kind, id: first.id }]), [first, second]);
  assert.throws(() => P.merge([first], [{ ...first, body: 'Overwrite' }]));
  assert.equal(first.body, 'Keep my words.');
  assert.throws(() => P.items([first, first]));
});
test('pairing rejects public/DNS/credential URLs and reserves loopback for explicit tests', () => {
  const base = { v: 1, url: 'https://192.168.1.10:45443', fingerprint: 'a'.repeat(64), pairId: vector.pairId, key: vector.key, expiresAt: Date.now() + 300000 };
  assert.deepEqual(P.decodePair(P.encodePair(base)), base);
  for (const url of ['https://example.com:45443', 'https://8.8.8.8:45443', 'http://192.168.1.10:45443', 'https://127.0.0.1:45443', 'https://192.168.1.10:45443/path', 'https://192.168.1.10:45443?key=x', 'https://user@192.168.1.10:45443']) assert.throws(() => P.encodePair({ ...base, url }));
  assert.equal(P.privateIPv4('172.16.0.1'), true);
  assert.equal(P.privateIPv4('172.32.0.1'), false);
  assert.equal(P.privateIPv4('192.168.01.1'), false);
});
test('request and response schemas reject replay-counter edge cases and additional properties', () => {
  for (const seq of [0, -1, 1.1, Number.MAX_SAFE_INTEGER, '1']) assert.throws(() => P.request({ ...vector.payload, seq }));
  assert.throws(() => P.request({ ...vector.payload, cookies: [] }));
  assert.throws(() => P.request({ ...vector.payload, name: '' }));
  assert.throws(() => P.response({ v: 1, requestId: vector.payload.requestId, seq: 1, items: [], extra: true }));
});
test('shared URLs refuse sign-in query secrets, encoded keys and opaque fragments', () => {
  for (const path of ['?access_token=secret', '?code=secret', '?api-key=secret', '?x-amz-signature=secret', '?%74oken=secret', '?%2574oken=secret', '?%252574oken=secret', '?%25252574oken=secret', '#access_token=secret', '#opaque-secret', '#/callback?code=secret']) {
    assert.throws(() => P.safeUrl('https://example.com/' + path));
  }
  assert.equal(P.safeUrl('https://example.com/search?q=music&page=2'), 'https://example.com/search?q=music&page=2');
  assert.throws(() => P.safeUrl('https://bad_host.example/'));
  assert.throws(() => P.safeUrl('https://example.com/%broken'));
  assert.throws(() => P.item({ ...note(), body: '\ud800' }));
});
