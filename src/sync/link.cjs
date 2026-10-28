'use strict';

const https = require('node:https');
const os = require('node:os');
const crypto = require('node:crypto');
const P = require('./protocol.cjs');

const PAIR_LIFETIME_MS = 5 * 60 * 1000;
const MAX_PEERS = 8;
const MAX_PENDING_REQUESTS = 8;

/** All private state is passed to the host's OS-encrypted, atomic store. */
function createLink({ loadState, saveState, onChange = () => {}, testing } = {}) {
  if (typeof loadState !== 'function' || typeof saveState !== 'function') throw new TypeError('A protected store is required.');
  const allowLoopback = testing?.allowLoopback === true;
  const clock = testing?.now || Date.now;
  const listenHost = allowLoopback ? '127.0.0.1' : '0.0.0.0';
  let server = null, port = 45443, generation = 0, queue = Promise.resolve();
  let inflight = 0;
  const sockets = new Set(), rates = new Map();

  function state() {
    const raw = loadState();
    if (!raw || typeof raw !== 'object' || raw.then) throw new Error('Protected store is not ready.');
    const value = structuredClone(raw);
    value.items = P.items(value.items || []);
    value.link ||= { peers: [] };
    value.link.peers ||= [];
    if (!Array.isArray(value.link.peers) || value.link.peers.length > MAX_PEERS) throw new Error('Invalid protected link state.');
    const peerIds = new Set();
    for (const peer of value.link.peers) {
      if (!peer || !/^[a-f0-9]{32}$/.test(peer.id) || peerIds.has(peer.id) || typeof peer.key !== 'string' || peer.key.length !== 44 || Buffer.from(peer.key, 'base64').length !== 32 || Buffer.from(peer.key, 'base64').toString('base64') !== peer.key || typeof peer.active !== 'boolean' || typeof peer.name !== 'string' || !peer.name.trim() || peer.name.length > 80 || !Number.isSafeInteger(peer.expiresAt) || peer.expiresAt < 0 || ![peer.recvSeq, peer.sendSeq].every(n => Number.isSafeInteger(n) && n >= 0 && n <= P.MAX_SEQUENCE)) throw new Error('Invalid protected link state.');
      peerIds.add(peer.id);
    }
    return value;
  }
  function changed() {
    try { Promise.resolve(onChange()).catch(() => {}); } catch { /* Host display failures do not alter committed state. */ }
  }
  function serialized(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }
  async function persist(value) { await saveState(value); changed(); }
  function addresses() {
    const values = Object.values(os.networkInterfaces()).flat().filter(Boolean)
      .filter(value => (value.family === 'IPv4' || value.family === 4) && P.privateIPv4(value.address))
      .map(value => value.address);
    if (allowLoopback) values.push('127.0.0.1');
    return [...new Set(values)];
  }
  function status() {
    return {
      running: Boolean(server?.listening), port, addresses: addresses(),
      peers: state().link.peers.filter(peer => peer.active || peer.expiresAt > clock())
        .map(peer => ({ id: peer.id, name: peer.name, active: peer.active === true }))
    };
  }
  function fingerprint(cert) {
    return crypto.createHash('sha256').update(new crypto.X509Certificate(cert).raw).digest('hex');
  }
  function checkCertificate(tls) {
    const cert = new crypto.X509Certificate(tls.cert);
    const privateKey = crypto.createPrivateKey(tls.privateKey);
    if (Date.parse(cert.validFrom) > clock() || Date.parse(cert.validTo) <= clock()) throw new Error('The link certificate has expired. Create a new pairing profile.');
    if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048 || !cert.checkPrivateKey(privateKey)) throw new Error('Invalid link certificate.');
    return tls;
  }
  async function certificate(value) {
    if (value.link.tls) {
      const cert = new crypto.X509Certificate(value.link.tls.cert);
      if (Date.parse(cert.validTo) <= clock()) {
        if (value.link.peers.some(peer => peer.active)) throw new Error('Remove paired devices, then start the link again to renew its expired certificate.');
        delete value.link.tls;
        value.link.peers = [];
      } else return checkCertificate(value.link.tls);
    }
    const selfsigned = require('selfsigned');
    const issued = await selfsigned.generate([{ name: 'commonName', value: 'Voodoo local device link' }], {
      keyType: 'rsa', keySize: 2048, algorithm: 'sha256',
      notBeforeDate: new Date(clock() - 60000),
      notAfterDate: new Date(clock() + 365 * 24 * 60 * 60 * 1000),
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames: addresses().map(ip => ({ type: 7, ip })) }
      ]
    });
    value.link.tls = { cert: issued.cert, privateKey: issued.private };
    checkCertificate(value.link.tls);
    await persist(value);
    return value.link.tls;
  }
  function deny(res, code = 400) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Connection': 'close', 'X-Content-Type-Options': 'nosniff' });
    res.end('{"error":"Link request rejected."}');
  }
  function allowRate(req) {
    const address = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (!P.privateIPv4(address, allowLoopback)) return false;
    const now = clock();
    for (const [key, value] of rates) if (now - value.start > 60000) rates.delete(key);
    const previous = rates.get(address);
    if (!previous) {
      if (rates.size >= 1024) return false;
      rates.set(address, { start: now, count: 1 });
      return true;
    }
    return ++previous.count <= 60;
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0, settled = false;
      const finish = (error, body) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(body);
      };
      const timer = setTimeout(() => { finish(new Error('Request timeout.')); req.destroy(); }, 10000);
      timer.unref();
      req.on('data', chunk => {
        size += chunk.length;
        if (size > P.MAX_BODY_BYTES) { finish(new Error('Request too large.')); req.destroy(); }
        else chunks.push(chunk);
      });
      req.once('end', () => finish(null, Buffer.concat(chunks)));
      req.once('error', error => finish(error));
      req.once('aborted', () => finish(new Error('Request aborted.')));
      req.once('close', () => { if (!req.complete) finish(new Error('Request closed.')); });
    });
  }
  async function exchange(envelope) {
    P.envelope(envelope);
    const value = state();
    const peer = value.link.peers.find(candidate => candidate.id === envelope.pairId);
    if (!peer?.key) throw new Error('Unknown peer.');
    const request = P.open(peer.key, envelope, 'request');
    if (request.seq <= peer.recvSeq) throw new Error('Replay rejected.');
    if (peer.active ? request.op !== 'sync' : (request.op !== 'pair' || clock() >= peer.expiresAt)) throw new Error('Pairing not available.');
    if (!Number.isSafeInteger(peer.sendSeq) || peer.sendSeq >= P.MAX_SEQUENCE) throw new Error('Re-pair this device.');
    value.items = P.merge(value.items, request.items);
    peer.active = true;
    peer.name = request.name.trim();
    peer.recvSeq = request.seq;
    peer.sendSeq += 1;
    const reply = P.seal(peer.key, peer.id, 'response', { v: 1, requestId: request.requestId, seq: peer.sendSeq, items: value.items });
    // Save counters and merged items together before acknowledging. Save failure
    // leaves the previous snapshot unchanged and nothing is sent to the client.
    await persist(value);
    return reply;
  }
  function handler(token, currentServer) {
    return async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/v1/exchange' || req.headers.origin !== undefined || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) return deny(res);
      if (!allowRate(req) || inflight >= MAX_PENDING_REQUESTS) return deny(res, 429);
      const length = Number(req.headers['content-length']);
      if (req.headers['content-length'] !== undefined && (!Number.isSafeInteger(length) || length < 1 || length > P.MAX_BODY_BYTES)) return deny(res, 413);
      inflight++;
      try {
        const raw = await readBody(req);
        const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
        const reply = await serialized(async () => {
          if (generation !== token || server !== currentServer || !server?.listening) throw new Error('Link stopped.');
          return exchange(input);
        });
        if (!res.destroyed) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Connection': 'close' });
          res.end(JSON.stringify(reply));
        }
      } catch { deny(res); }
      finally { inflight--; }
    };
  }
  async function start({ port: requestedPort = 45443 } = {}) {
    if (!Number.isInteger(requestedPort) || requestedPort < (allowLoopback ? 0 : 1) || requestedPort > 65535) throw new Error('Invalid link port.');
    if (server?.listening) return status();
    const token = ++generation;
    return serialized(async () => {
      if (token !== generation) throw new Error('Link start cancelled.');
      const tls = await certificate(state());
      if (token !== generation) throw new Error('Link start cancelled.');
      const current = https.createServer({ key: tls.privateKey, cert: tls.cert, minVersion: 'TLSv1.2', maxHeaderSize: 8192, handshakeTimeout: 5000 });
      current.on('request', handler(token, current));
      current.maxHeadersCount = 32;
      current.headersTimeout = 5000;
      current.requestTimeout = 10000;
      current.keepAliveTimeout = 1000;
      current.timeout = 10000;
      current.maxConnections = 16;
      current.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
      current.on('timeout', socket => socket.destroy());
      current.on('tlsClientError', () => {});
      current.on('clientError', (_error, socket) => socket.destroy());
      server = current;
      try {
        await new Promise((resolve, reject) => {
          current.once('error', reject);
          current.listen(requestedPort, listenHost, () => { current.removeListener('error', reject); resolve(); });
        });
        if (token !== generation) { current.close(); throw new Error('Link start cancelled.'); }
        port = current.address().port;
        current.on('error', () => { if (server === current) { server = null; changed(); } });
        changed();
        return status();
      } catch (error) {
        if (server === current) server = null;
        current.close();
        throw error;
      }
    });
  }
  async function stop() {
    generation++;
    const current = server;
    server = null;
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    rates.clear();
    if (current) await new Promise(resolve => current.close(() => resolve()));
    await queue;
    changed();
  }
  function pair({ address, name = 'My phone' }) {
    return serialized(async () => {
      if (!server?.listening) throw new Error('Start the device link first.');
      if (!addresses().includes(address) || !P.privateIPv4(address, allowLoopback)) throw new Error('Choose this PC\'s private network address.');
      if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('Enter a device name of at most 80 characters.');
      const value = state(), now = clock();
      // A fresh code replaces expired/unclaimed codes, but never existing peers.
      value.link.peers = value.link.peers.filter(peer => peer.active);
      if (value.link.peers.length >= MAX_PEERS) throw new Error('Remove a paired device before adding another.');
      const peer = { id: crypto.randomBytes(16).toString('hex'), key: crypto.randomBytes(32).toString('base64'), name: name.trim(), active: false, expiresAt: now + PAIR_LIFETIME_MS, recvSeq: 0, sendSeq: 0 };
      const code = P.encodePair({ v: 1, url: 'https://' + address + ':' + port, fingerprint: fingerprint(value.link.tls.cert), pairId: peer.id, key: peer.key, expiresAt: peer.expiresAt }, { allowLoopback });
      value.link.peers.push(peer);
      await persist(value);
      return { code, expiresAt: peer.expiresAt };
    });
  }
  function revoke(pairId) {
    return serialized(async () => {
      if (typeof pairId !== 'string' || !/^[a-f0-9]{32}$/.test(pairId)) throw new Error('Invalid paired device.');
      const value = state();
      value.link.peers = value.link.peers.filter(peer => peer.id !== pairId);
      await persist(value);
      return status();
    });
  }
  function add(value) {
    const clean = P.item(value);
    return serialized(async () => {
      const current = state();
      current.items = P.merge(current.items, [clean]);
      await persist(current);
      return clean;
    });
  }
  return { start, stop, pair, revoke, add, status, items: () => P.items(state().items) };
}

module.exports = { createLink, PAIR_LIFETIME_MS };
