'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.voodoo;
  let state = {tabs: [], activeTabId: null, panel: 'home', items: [], link: {running: false, addresses: [], peers: []}, version: '0.1.0'};
  let filter = 'all', pairExpires = 0, pairTimer = null, noticeTimer = null, busyPair = false;
  let lastError = '', confirmResolve = null, currentPairId = null;
  const emptyItems = {all: ['Your space starts here.', 'Save a favorite while browsing, write a note, or send a tab to fill your library.'], bookmark: ['Make yourself at home.', 'Open a website and use the star beside the address bar to save it here.'], note: ['A place for your next idea.', 'Save a note snapshot to keep it with you on a paired device.'], tab: ['Nothing waiting just yet.', 'Use Send tab on either device. Pages arrive here and open only when you choose.']};

  function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
  function activeTab() { return state.tabs.find((tab) => tab.id === state.activeTabId); }
  function domain(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
  function dateLabel(timestamp) { const date = new Date(timestamp); return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : ''; }
  function notice(message, error = false) {
    if (!message) return;
    clearTimeout(noticeTimer); $('notice-text').textContent = String(message).slice(0, 700); $('notice').classList.toggle('error', error); $('notice').hidden = false;
    noticeTimer = setTimeout(() => { $('notice').hidden = true; }, error ? 15000 : 7000);
  }
  async function invoke(action, payload) {
    if (!api) throw new Error('The desktop connection is unavailable. Reopen Voodoo.');
    const result = await api.invoke(action, payload);
    if (action !== 'state' && result && result.error) throw new Error(result.error);
    return result;
  }
  async function refresh() { const next = await invoke('state'); if (next) render(next); }
  async function run(action, payload, success) {
    try { const result = await invoke(action, payload); await refresh(); if (success) notice(success); return result; }
    catch (error) { notice(error.message || 'That action could not be completed.', true); return undefined; }
  }
  function showPanel(panel) { if (panel !== 'link') clearPair(); return run('panel', {name: panel}); }
  function clearPair() {
    clearInterval(pairTimer); pairTimer = null; pairExpires = 0; currentPairId = null;
    $('pair-code').value = ''; $('pair-result').hidden = true; $('pair-expiry').textContent = '';
  }
  function updatePairExpiry() {
    const remaining = pairExpires - Date.now();
    if (remaining <= 0) { clearPair(); notice('That pairing code expired. Create a new one if you still need it.'); return; }
    $('pair-expiry').textContent = 'Expires in ' + Math.ceil(remaining / 60000) + ' min';
  }
  function decodePairId(code) { try { return JSON.parse(atob(code.slice('voodoo-pair:v1:'.length))).pairId; } catch { return null; } }

  function renderTabs() {
    const scroller = $('tabs'), scroll = scroller.scrollLeft;
    scroller.replaceChildren();
    for (const tab of state.tabs) {
      const row = el('div', 'browser-tab' + (tab.id === state.activeTabId ? ' active' : '') + (tab.loading ? ' loading' : ''));
      const select = el('button', 'tab-select'); select.type = 'button'; select.setAttribute('role', 'tab'); select.setAttribute('aria-selected', String(tab.id === state.activeTabId));
      select.title = tab.title || tab.url || 'New tab'; select.append(el('span', 'tab-symbol', tab.loading ? '◌' : '◇'), el('span', 'tab-title', tab.title || domain(tab.url) || 'New tab'));
      select.addEventListener('click', () => { clearPair(); run('select-tab', {id: tab.id}); });
      const close = el('button', 'tab-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close ' + (tab.title || 'tab')); close.title = 'Close tab'; close.addEventListener('click', () => run('close-tab', {id: tab.id}));
      row.append(select, close); scroller.append(row);
    }
    scroller.scrollLeft = scroll;
  }
  function renderFavorites() {
    const container = $('home-favorites'); container.replaceChildren();
    const favorites = state.items.filter((item) => item.kind === 'bookmark').slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
    if (!favorites.length) {
      const empty = el('div', 'favorites-empty'), copy = el('div'); copy.append(el('strong', '', 'Your favorites belong here.'), el('p', '', 'Visit a website and tap the star beside the address bar. Pair your phone to take these places with you.'));
      empty.append(el('span', 'empty-symbol', '☆'), copy); container.append(empty); return;
    }
    for (const item of favorites) {
      const button = el('button', 'favorite-card'), label = el('span', 'favorite-label'); button.title = item.url;
      label.append(el('strong', '', item.title || domain(item.url)), el('small', '', domain(item.url)));
      button.append(el('span', 'favorite-icon', (item.title || domain(item.url) || 'V').charAt(0).toUpperCase()), label);
      button.addEventListener('click', () => run('open-item', {id: item.id})); container.append(button);
    }
  }
  function readNote(item) {
    $('read-note-title').textContent = item.title || 'Untitled note'; $('read-note-date').textContent = 'Snapshot saved ' + dateLabel(item.createdAt); $('read-note-body').textContent = item.body || '';
    $('read-note-dialog').showModal();
  }
  function renderLibrary() {
    const query = $('library-search').value.trim().toLocaleLowerCase();
    const items = state.items.filter((item) => (filter === 'all' || item.kind === filter) && (!query || [item.title, item.url, item.body].some((value) => String(value || '').toLocaleLowerCase().includes(query)))).slice().sort((a, b) => b.createdAt - a.createdAt);
    const list = $('library-items'); list.replaceChildren();
    if (!items.length) {
      const empty = el('div', 'library-empty'), text = query ? ['No matching items.', 'Try another title, website, or phrase.'] : emptyItems[filter];
      empty.append(el('span', 'empty-symbol', filter === 'tab' ? '⇄' : filter === 'note' ? '✎' : '◇'), el('h2', '', text[0]), el('p', '', text[1])); list.append(empty); return;
    }
    for (const item of items) {
      const card = el('article', 'library-card ' + item.kind), top = el('div', 'library-card-top');
      top.append(el('span', 'kind-label', item.kind === 'bookmark' ? 'Favorite' : item.kind === 'note' ? 'Note snapshot' : 'Tab inbox'), el('span', 'item-date', dateLabel(item.createdAt)));
      card.append(top, el('h3', '', item.title || (item.kind === 'note' ? 'Untitled note' : domain(item.url))), el('p', '', item.kind === 'note' ? item.body : item.url));
      const open = el('button', 'text-button', item.kind === 'note' ? 'Read note →' : 'Open page ↗');
      open.addEventListener('click', () => item.kind === 'note' ? readNote(item) : run('open-item', {id: item.id})); card.append(open); list.append(card);
    }
  }
  function renderLink() {
    const link = state.link || {}, running = Boolean(link.running), addresses = Array.isArray(link.addresses) ? link.addresses : [], peers = Array.isArray(link.peers) ? link.peers : [];
    $('connection-title').textContent = running ? 'Ready on this network' : 'Your link is off';
    $('connection-description').textContent = running ? 'Open Device link on your phone and choose Sync now.' : 'Start it when you want to connect your phone.';
    $('toggle-link').textContent = running ? 'Stop link' : 'Start local link';
    $('toggle-link').className = running ? 'secondary-button' : 'primary-button';
    const select = $('link-address'), previous = select.value; select.replaceChildren();
    for (const entry of addresses) {
      const address = typeof entry === 'string' ? entry : entry.address;
      if (!address) continue; const option = el('option', '', address); option.value = address; select.append(option);
    }
    if (!select.options.length) { const option = el('option', '', running ? 'No private network address available' : 'Start the link to see available addresses'); option.value = ''; select.append(option); }
    else if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    select.disabled = !running || !select.value;
    $('address-help').textContent = running && !select.value ? 'Connect your PC and phone to the same Wi-Fi or phone hotspot, then restart the link.' : 'Choose the address on the network shared with your phone.';
    $('create-pair-code').disabled = !running || !select.value || busyPair;
    const list = $('peers'); list.replaceChildren();
    if (!peers.length) list.append(el('p', 'peer-empty', 'No paired devices yet. Your phone will appear here after it accepts a pairing code.'));
    for (const peer of peers) {
      const row = el('div', 'peer'), details = el('div', 'peer-details');
      details.append(el('strong', '', peer.name || 'Phone'), el('small', '', peer.active ? 'Paired · sync from the phone' : 'Waiting for pairing'));
      const revoke = el('button', 'text-button', 'Unpair'); revoke.addEventListener('click', async () => {
        const accepted = await confirm('Unpair ' + (peer.name || 'this device') + '?', 'This device will lose access to the link. Items already saved on either device will remain.');
        if (accepted) { clearPair(); await run('link-revoke', {id: peer.id}, 'Device unpaired.'); }
      });
      row.append(el('span', 'peer-symbol', '▯'), details, revoke); list.append(row);
      if (currentPairId === peer.id && peer.active) { clearPair(); notice('Your phone is paired. Use Sync now on the phone to exchange saved items.'); }
    }
    if (!running) clearPair();
    $('library-guidance').textContent = peers.some((peer) => peer.active) ? 'Use Sync now on your paired phone to exchange these items. Received tabs open only when you choose.' : 'Items stay on this PC until you pair a phone and sync. Received tabs open only when you choose.';
  }
  function render(next) {
    if (!next || typeof next !== 'object') return;
    const oldPanel = state.panel; state = {...state, ...next, tabs: Array.isArray(next.tabs) ? next.tabs : state.tabs, items: Array.isArray(next.items) ? next.items : state.items};
    if (oldPanel === 'link' && state.panel !== 'link') clearPair();
    const panel = ['home', 'library', 'link', 'settings'].includes(state.panel) ? state.panel : null;
    $('workspace').hidden = panel === null;
    for (const name of ['home', 'library', 'link', 'settings']) $('panel-' + name).hidden = name !== panel;
    document.querySelectorAll('.workspace-nav [data-panel]').forEach((button) => { if (button.dataset.panel === panel) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    const tab = activeTab();
    if (document.activeElement !== $('address')) $('address').value = tab && /^https?:\/\//.test(tab.url || '') ? tab.url : '';
    $('back').disabled = !tab?.canGoBack; $('forward').disabled = !tab?.canGoForward; $('reload').disabled = !tab;
    const shareable = Boolean(tab && /^https:\/\//.test(tab.url || ''));
    $('bookmark').disabled = !shareable; $('send-tab').disabled = !shareable; $('return-page').hidden = !panel || !tab || !/^https?:\/\//.test(tab.url || '');
    $('library-count').textContent = String(state.items.length);
    const running = Boolean(state.link?.running); $('link-status-label').textContent = running ? 'Local link on' : 'Link off'; $('link-status').querySelector('.status-dot').classList.toggle('running', running);
    $('home-version').textContent = 'PREVIEW ' + state.version; $('settings-version').textContent = state.version;
    renderTabs(); renderFavorites(); renderLibrary(); renderLink();
    if (state.error && state.error !== lastError) notice(state.error, true); lastError = state.error || '';
  }
  function confirm(title, message) {
    if (confirmResolve) confirmResolve(false);
    $('confirm-title').textContent = title; $('confirm-message').textContent = message; $('confirm-dialog').showModal();
    return new Promise((resolve) => { confirmResolve = resolve; });
  }
  function resolveConfirm(value) { const resolve = confirmResolve; confirmResolve = null; $('confirm-dialog').close(); resolve?.(value); }

  $('brand-home').addEventListener('click', () => showPanel('home'));
  $('new-tab').addEventListener('click', () => { clearPair(); run('new-tab'); });
  for (const action of ['back', 'forward', 'reload']) $(action).addEventListener('click', () => run(action));
  for (const button of document.querySelectorAll('[data-panel]')) button.addEventListener('click', () => showPanel(button.dataset.panel));
  $('return-page').addEventListener('click', () => showPanel(null));
  $('address-form').addEventListener('submit', (event) => { event.preventDefault(); const url = $('address').value.trim(); if (url) { clearPair(); run('navigate', {url}); $('address').blur(); } });
  $('address').addEventListener('focus', () => $('address').select());
  $('home-search').addEventListener('submit', (event) => { event.preventDefault(); const url = $('home-search-input').value.trim(); if (url) run('navigate', {url}); });
  $('bookmark').addEventListener('click', () => run('bookmark', undefined, 'Saved to your shared favorites.'));
  $('send-tab').addEventListener('click', () => run('send-tab', undefined, 'Added to the shared tab inbox. Sync from your phone to receive it.'));
  $('notice-close').addEventListener('click', () => { clearTimeout(noticeTimer); $('notice').hidden = true; });
  $('library-search').addEventListener('input', renderLibrary);
  for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
    filter = button.dataset.filter; for (const other of document.querySelectorAll('[data-filter]')) { const selected = other === button; other.classList.toggle('active', selected); other.setAttribute('aria-selected', String(selected)); } renderLibrary();
  });
  $('new-note').addEventListener('click', () => { $('note-dialog').showModal(); $('note-title').focus(); });
  for (const id of ['close-note', 'cancel-note']) $(id).addEventListener('click', () => $('note-dialog').close());
  $('note-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const title = $('note-title').value.trim(), body = $('note-body').value;
    if (!title || !body.trim()) { notice('Add a title and a note before saving.', true); return; }
    $('save-note').disabled = true;
    try { await invoke('add-note', {title, body}); $('note-title').value = ''; $('note-body').value = ''; $('note-dialog').close(); await refresh(); notice('Note snapshot saved.'); }
    catch (error) { notice(error.message, true); }
    finally { $('save-note').disabled = false; }
  });
  for (const id of ['close-read-note', 'done-read-note']) $(id).addEventListener('click', () => $('read-note-dialog').close());
  $('toggle-link').addEventListener('click', () => { if (state.link?.running) clearPair(); run(state.link?.running ? 'link-stop' : 'link-start'); });
  $('pair-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (busyPair) return;
    const address = $('link-address').value, name = $('peer-name').value.trim(); if (!address || !name) return;
    busyPair = true; $('create-pair-code').disabled = true; clearPair();
    try {
      const result = await invoke('link-pair', {address, name});
      if (!result || typeof result.code !== 'string' || !Number.isFinite(result.expiresAt)) throw new Error('The pairing code could not be created.');
      await refresh();
      if (state.panel !== 'link' || !state.link?.running) return;
      $('pair-code').value = result.code; pairExpires = result.expiresAt; currentPairId = decodePairId(result.code); $('pair-result').hidden = false;
      updatePairExpiry(); pairTimer = setInterval(updatePairExpiry, 1000);
    } catch (error) { notice(error.message, true); }
    finally { busyPair = false; renderLink(); }
  });
  $('copy-pair-code').addEventListener('click', () => run('copy-pair-code', undefined, 'Pairing code copied. The clipboard clears after one minute if it is unchanged.'));
  $('hide-pair-code').addEventListener('click', clearPair);
  $('clear-browsing-data').addEventListener('click', () => run('clear-browsing-data'));
  $('confirm-accept').addEventListener('click', () => resolveConfirm(true)); $('confirm-cancel').addEventListener('click', () => resolveConfirm(false));
  $('confirm-dialog').addEventListener('cancel', () => { const resolve = confirmResolve; confirmResolve = null; resolve?.(false); });
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); $('address').focus(); $('address').select(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 't') { event.preventDefault(); clearPair(); run('new-tab'); }
  });
  window.addEventListener('beforeunload', () => { clearInterval(pairTimer); clearTimeout(noticeTimer); });
  if (api) {
    api.onState(render);
    api.onFocusAddress?.(() => { $('address').focus(); $('address').select(); });
    refresh().catch((error) => notice(error.message, true));
  }
  else { render(state); notice('Open Voodoo from the desktop app to use browser and device-link controls.', true); }
})();
