'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const renderer = path.join(__dirname, '../renderer');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(renderer, 'app.js'), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));
const item = (kind, title, extra = {}) => ({id: '123e4567-e89b-42d3-a456-426614174000', kind, title, createdAt: 1793220000000, ...extra});

async function fixture(overrides = {}, handlers = {}) {
  const dom = new JSDOM(html, {url: 'https://voodoo.test/index.html', runScripts: 'outside-only'});
  const w = dom.window, calls = [];
  let current = {tabs: [{id: 'tab-one', title: 'Example', url: 'https://example.com', canGoBack: false, canGoForward: false}], activeTabId: 'tab-one', panel: 'home', items: [], link: {running: false, addresses: [], peers: []}, version: '0.1.0', ...overrides};
  let update, focusAddress;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.voodoo = {
    onState(fn) { update = fn; return () => {}; },
    onFocusAddress(fn) { focusAddress = fn; return () => {}; },
    async invoke(action, payload) {
      calls.push({action, payload});
      if (action === 'state') return JSON.parse(JSON.stringify(current));
      if (handlers[action]) return handlers[action](payload, current);
      if (action === 'panel') current.panel = payload.name;
      return {ok: true};
    }
  };
  w.eval(script); await tick();
  return {dom, w, calls, $: (id) => w.document.getElementById(id), state: () => current, focusAddress: () => focusAddress(), set(next) { current = {...current, ...next}; update(JSON.parse(JSON.stringify(current))); }};
}

test('address focus from an external browser tab selects the current URL without navigating', async () => {
  const f = await fixture({panel: null});
  try {
    f.focusAddress();
    assert.equal(f.w.document.activeElement, f.$('address'));
    assert.equal(f.$('address').selectionStart, 0);
    assert.equal(f.$('address').selectionEnd, 'https://example.com'.length);
    assert.equal(f.calls.some((call) => call.action === 'navigate'), false);
  } finally { f.dom.window.close(); }
});

test('received titles and note content remain text and cannot execute markup', async () => {
  const title = '<img src=x onerror="window.compromised=true">';
  const f = await fixture({panel: 'library', items: [item('note', title, {body: '<script>window.compromised=true</script>'})]});
  try {
    assert.equal(f.$('library-items').querySelector('img,script'), null);
    assert.equal(f.$('library-items').querySelector('h3').textContent, title);
    f.$('library-items').querySelector('button').click();
    assert.equal(f.$('read-note-body').textContent, '<script>window.compromised=true</script>');
    assert.equal(f.w.compromised, undefined);
  } finally { f.dom.window.close(); }
});

test('a received tab stays in the inbox until the user opens it', async () => {
  const received = item('tab', 'From my phone', {url: 'https://example.com/received'});
  const f = await fixture({panel: 'library'});
  try {
    f.set({items: [received]}); await tick();
    assert.equal(f.calls.some((call) => ['open-item', 'navigate', 'new-tab'].includes(call.action)), false);
    f.$('library-items').querySelector('button').click(); await tick();
    assert.equal(f.calls.find((call) => call.action === 'open-item').payload.id, received.id);
  } finally { f.dom.window.close(); }
});

test('failed note saving preserves the unsaved title and body', async () => {
  const f = await fixture({panel: 'library'}, {'add-note': async () => { throw new Error('Disk unavailable'); }});
  try {
    f.$('new-note').click(); f.$('note-title').value = 'Keep my draft'; f.$('note-body').value = 'These words must survive.';
    f.$('note-form').dispatchEvent(new f.w.Event('submit', {cancelable: true})); await tick();
    assert.equal(f.$('note-title').value, 'Keep my draft');
    assert.equal(f.$('note-body').value, 'These words must survive.');
    assert.equal(f.$('note-dialog').open, true);
    assert.equal(f.$('save-note').disabled, false);
    assert.match(f.$('notice-text').textContent, /Disk unavailable/);
  } finally { f.dom.window.close(); }
});

test('pairing is explicit and a pending secret is removed when leaving Device link', async () => {
  const code = 'voodoo-pair:v1:' + Buffer.from(JSON.stringify({pairId: 'a'.repeat(32), key: 'private-fixture-key'})).toString('base64');
  const f = await fixture({panel: 'link', link: {running: true, addresses: ['192.168.1.20'], peers: []}}, {'link-pair': async () => ({code, expiresAt: Date.now() + 300000})});
  try {
    assert.equal(f.calls.some((call) => call.action === 'link-pair'), false);
    assert.equal(f.$('pair-code').value, '');
    f.$('pair-form').dispatchEvent(new f.w.Event('submit', {cancelable: true})); await tick();
    assert.equal(f.$('pair-code').value, code);
    assert.equal(f.$('pair-result').hidden, false);
    f.$('brand-home').click(); await tick();
    assert.equal(f.$('pair-code').value, '');
    assert.equal(f.$('pair-result').hidden, true);
    assert.equal(f.w.document.body.textContent.includes('private-fixture-key'), false);
  } finally { f.dom.window.close(); }
});

test('revocation requires an explicit confirmation and does not remove saved items', async () => {
  const existing = item('bookmark', 'Keep me', {url: 'https://example.com'});
  const f = await fixture({panel: 'link', items: [existing], link: {running: true, addresses: ['192.168.1.20'], peers: [{id: 'a'.repeat(32), name: 'My phone', active: true}]}});
  try {
    f.$('peers').querySelector('button').click(); await tick();
    assert.equal(f.calls.some((call) => call.action === 'link-revoke'), false);
    f.$('confirm-cancel').click(); await tick();
    assert.equal(f.calls.some((call) => call.action === 'link-revoke'), false);
    f.$('peers').querySelector('button').click(); f.$('confirm-accept').click(); await tick();
    assert.equal(f.calls.filter((call) => call.action === 'link-revoke').length, 1);
    assert.equal(f.state().items.length, 1);
  } finally { f.dom.window.close(); }
});
