'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const crypto = require('node:crypto');
const tls = require('node:tls');
const { createLink, PAIR_LIFETIME_MS } = require('../src/sync/link.cjs');
const P = require('../src/sync/protocol.cjs');

let cachedTls;
async function fixture(t) {
  let saved = { items: [], ...(cachedTls ? { link: { peers: [], tls: cachedTls } } : {}) };
  let now = Date.now(), failSave = false, writes = 0;
  const link = createLink({
    loadState: () => structuredClone(saved),
    saveState: async value => { if (failSave) throw new Error('Simulated disk full.'); saved = structuredClone(value); writes++; },
    testing: { allowLoopback: true, now: () => now }
  });
  await link.start({ port: 0 });
  cachedTls = structuredClone(saved.link.tls);
  t.after(() => link.stop());
  async function pair() {
    const { code } = await link.pair({ address: '127.0.0.1', name: 'Phone' });
    return P.decodePair(code, { allowLoopback: true });
  }
  function send(pair, payload, options = {}) {
    return post(pair, options.raw ?? P.seal(pair.key, pair.pairId, 'request', payload), saved.link.tls.cert, options);
  }
  return { link, pair, send, saved: () => structuredClone(saved), writes: () => writes, advance: ms => { now += ms; }, failSave: value => { failSave = value; } };
}
function request(op = 'pair', seq = 1, values = []) { return { v: 1, requestId: crypto.randomBytes(16).toString('hex'), seq, op, name: 'My phone', items: values }; }
function note(body) { return { id: crypto.randomUUID(), kind: 'note', title: 'Shared draft', body, createdAt: Date.now() }; }
function post(pair, body, cert, options = {}) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body), url = new URL('/v1/exchange', pair.url);
    const req = https.request(url, {
      method: 'POST', ca: cert, agent: false, minVersion: 'TLSv1.2', timeout: 4000,
      checkServerIdentity(host, peer) {
        const actual = crypto.createHash('sha256').update(peer.raw).digest('hex');
        if (actual !== (options.fingerprint || pair.fingerprint)) return new Error('Certificate pin mismatch.');
        return tls.checkServerIdentity(host, peer);
      },
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw), ...options.headers }
    }, res => {
      let text = '';
      res.on('data', value => { text += value; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      res.on('error', reject);
    });
    req.once('timeout', () => req.destroy(new Error('Timeout.')));
    req.once('error', reject);
    req.end(raw);
  });
}

test('real pinned HTTPS pairs then exchanges two-device library snapshots', async t => {
  const f = await fixture(t), pair = await f.pair(), fromPhone = note('From the phone'), fromDesktop = note('From the PC');
  await f.link.add(fromDesktop);
  const initial = request('pair', 1, [fromPhone]), result = await f.send(pair, initial);
  assert.equal(result.status, 200);
  const reply = P.open(pair.key, result.body, 'response');
  assert.equal(reply.requestId, initial.requestId);
  assert.equal(reply.seq, 1);
  assert.deepEqual(reply.items, [fromDesktop, fromPhone]);
  assert.equal(f.link.status().peers[0].active, true);
  const next = request('sync', 2, reply.items), second = await f.send(pair, next);
  assert.equal(P.open(pair.key, second.body, 'response').seq, 2);
  const publicStatus = JSON.stringify(f.link.status());
  assert.ok(!publicStatus.includes(pair.key));
  assert.ok(!publicStatus.includes('PRIVATE KEY'));
});
test('certificate mismatch and incorrect payload key never synchronize', async t => {
  const f = await fixture(t), pair = await f.pair();
  await assert.rejects(f.send(pair, request(), { fingerprint: '0'.repeat(64) }), /pin mismatch/);
  const invalid = P.seal(crypto.randomBytes(32), pair.pairId, 'request', request());
  assert.equal((await f.send(pair, null, { raw: invalid })).status, 400);
  assert.equal(f.link.status().peers[0].active, false);
});
test('replays and new pairing claims after activation are rejected, including after restart', async t => {
  const f = await fixture(t), pair = await f.pair(), initial = request();
  assert.equal((await f.send(pair, initial)).status, 200);
  assert.equal((await f.send(pair, initial)).status, 400);
  assert.equal((await f.send(pair, request('pair', 2))).status, 400);
  const port = f.link.status().port;
  await f.link.stop();
  await f.link.start({ port });
  assert.equal((await f.send(pair, initial)).status, 400);
  assert.equal((await f.send(pair, request('sync', 2))).status, 200);
});
test('expired codes and revoked peers cannot exchange', async t => {
  const f = await fixture(t), expired = await f.pair();
  f.advance(PAIR_LIFETIME_MS + 1);
  assert.equal((await f.send(expired, request())).status, 400);
  const pair = await f.pair();
  assert.equal((await f.send(pair, request())).status, 200);
  await f.link.revoke(pair.pairId);
  assert.equal((await f.send(pair, request('sync', 2))).status, 400);
  assert.equal(f.link.status().peers.length, 0);
});
test('browser origins and oversized requests are rejected before modifying state', async t => {
  const f = await fixture(t), pair = await f.pair(), writes = f.writes();
  assert.equal((await f.send(pair, request(), { headers: { Origin: 'https://untrusted.example' } })).status, 400);
  assert.equal((await f.send(pair, request(), { headers: { 'Content-Length': P.MAX_BODY_BYTES + 1 } })).status, 413);
  assert.equal(f.writes(), writes);
});
test('disk failure does not acknowledge, activate peer or advance counters', async t => {
  const f = await fixture(t), pair = await f.pair(), initial = request('pair', 1, [note('Not lost')]);
  f.failSave(true);
  assert.equal((await f.send(pair, initial)).status, 400);
  assert.equal(f.saved().link.peers[0].recvSeq, 0);
  assert.equal(f.saved().items.length, 0);
  f.failSave(false);
  assert.equal((await f.send(pair, initial)).status, 200);
});
test('concurrent same-sequence requests are serialized and only one succeeds', async t => {
  const f = await fixture(t), pair = await f.pair();
  const responses = await Promise.all([f.send(pair, request()), f.send(pair, request())]);
  assert.deepEqual(responses.map(value => value.status).sort(), [200, 400]);
  assert.equal(f.saved().link.peers[0].recvSeq, 1);
});
test('conflicting immutable IDs reject the whole merge and preserve existing data', async t => {
  const f = await fixture(t), pair = await f.pair(), original = note('Keep this');
  await f.link.add(original);
  assert.equal((await f.send(pair, request('pair', 1, [{ ...original, body: 'Overwrite' }]))).status, 400);
  assert.deepEqual(f.link.items(), [original]);
  assert.equal(f.saved().link.peers[0].active, false);
});
test('stopping the link closes its listener and needs an explicit restart', async t => {
  const f = await fixture(t), pair = await f.pair();
  await f.link.stop();
  assert.equal(f.link.status().running, false);
  await assert.rejects(f.send(pair, request()), /ECONNREFUSED|ECONNRESET|socket hang up/);
});
test('per-source rate limit bounds repeated LAN requests without revealing rejection causes', async t => {
  const f = await fixture(t), pair = await f.pair(), initial = request();
  assert.equal((await f.send(pair, initial)).status, 200);
  for (let i = 1; i < 60; i++) {
    const reply = await f.send(pair, initial);
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, { error: 'Link request rejected.' });
  }
  assert.equal((await f.send(pair, initial)).status, 429);
  assert.equal(f.saved().link.peers[0].recvSeq, 1);
});
test('an occupied port leaves the second link stopped and recoverable', async t => {
  const f = await fixture(t);
  let saved = { items: [], link: { peers: [], tls: cachedTls } };
  const second = createLink({ loadState: () => saved, saveState: async value => { saved = value; }, testing: { allowLoopback: true } });
  t.after(() => second.stop());
  await assert.rejects(second.start({ port: f.link.status().port }), /EADDRINUSE/);
  assert.equal(second.status().running, false);
  await second.start({ port: 0 });
  assert.equal(second.status().running, true);
});
