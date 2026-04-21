// RADAR // ANOMALY — app.js
// All relay calls go through radar.trap.lol/api/relay.
// Keys are stored in a 30-day encrypted cookie using XOR+base64 (obfuscation, not crypto).
// All user-visible strings use .textContent or esc() before innerHTML injection.

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const REQUIRED_CONFIG_KEYS  = ['proxy', 'trackers', 'torbox', 'engineLimits'];
const MAX_MAGNET_LEN        = 8192;
const PAGE_SIZE             = 20;
const HISTORY_MAX           = 10;
const VAULT_POLL_SECS       = 30;
const COOKIE_NAME           = 'radar_session';
const COOKIE_DAYS           = 30;
const COOKIE_SALT           = 'RADAR_ANOMALY_2026';

// ── State ────────────────────────────────────────────────────────────────────

let CONFIG        = null;
let PROXY_SECRET  = '';
let TORBOX_KEY    = '';

let globalData    = [];   // all normalised results from last scan
let displayData   = [];   // filtered + sorted slice for current view
let pageOffset    = 0;    // how many cards are currently rendered
let currentFilter = 'all';
let minSeeders    = 1;
let currentView   = 'search'; // 'search' | 'vault'

let _scanning  = false;
let _vaulting  = false;
let _vaultTimer = null;
let _vaultSecs  = 0;

// Search history — persisted in localStorage (no secrets, just query strings)
let searchHistory = [];

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $authOverlay      = document.getElementById('authOverlay');
const $mainInterface    = document.getElementById('mainInterface');
const $resultsGrid      = document.getElementById('resultsGrid');
const $searchInput      = document.getElementById('searchInput');
const $sortSelect       = document.getElementById('sortSelect');
const $filterBtns       = document.querySelectorAll('.filter-btn');
const $authForm         = document.getElementById('authForm');
const $searchBtn        = document.getElementById('searchBtn');
const $vaultBtn         = document.getElementById('vaultBtn');
const $lockBtn          = document.getElementById('lockBtn');
const $rememberCheck    = document.getElementById('rememberCheck');
const $authWarning      = document.getElementById('authWarning');
const $statusBar        = document.getElementById('statusBar');
const $statusCount      = document.getElementById('statusCount');
const $statusCached     = document.getElementById('statusCached');
const $statusShowing    = document.getElementById('statusShowing');
const $copyAllBtn       = document.getElementById('copyAllBtn');
const $loadMoreWrap     = document.getElementById('loadMoreWrap');
const $loadMoreBtn      = document.getElementById('loadMoreBtn');
const $loadMoreCount    = document.getElementById('loadMoreCount');
const $vaultControls    = document.getElementById('vaultControls');
const $vaultRefreshBtn  = document.getElementById('vaultRefreshBtn');
const $vaultCountdown   = document.getElementById('vaultCountdown');
const $historyDropdown  = document.getElementById('historyDropdown');
const $minSeedersSlider = document.getElementById('minSeedersSlider');
const $minSeedersVal    = document.getElementById('minSeedersVal');

// ── Utility ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function fmtBytes(bytes) {
  const gb = bytes / 1_073_741_824;
  if (gb >= 0.1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1_048_576).toFixed(0)} MB`;
}

function setGridMsg(html, cls = '') {
  $resultsGrid.innerHTML = `<div class="grid-msg${cls ? ' ' + cls : ''}">${html}</div>`;
}

function setBusy(isBusy, $btn, label, busyLabel) {
  $btn.disabled = isBusy;
  $btn.textContent = isBusy ? busyLabel : label;
  $btn.classList.toggle('btn--busy', isBusy);
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let _toastTimer = null;
function toast(msg, type = 'ok', duration = 3000) {
  let $t = document.getElementById('radar-toast');
  if (!$t) {
    $t = document.createElement('div');
    $t.id = 'radar-toast';
    document.body.appendChild($t);
  }
  $t.textContent = msg;
  $t.className = `radar-toast radar-toast--${type} radar-toast--show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => $t.classList.remove('radar-toast--show'), duration);
}

// ── Cookie auth ───────────────────────────────────────────────────────────────
// XOR+base64 obfuscation — keeps keys out of plain-text cookies.
// Not cryptographically secure; provides basic obfuscation for convenience.

function _xor(str, key) {
  return Array.from(str).map((c, i) =>
    String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(i % key.length))
  ).join('');
}

function cookiePack(obj) {
  const bytes = new TextEncoder().encode(_xor(JSON.stringify(obj), COOKIE_SALT));
  return btoa(String.fromCharCode(...bytes));
}

function cookieUnpack(raw) {
  try {
    const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    return JSON.parse(_xor(new TextDecoder().decode(bytes), COOKIE_SALT));
  } catch {
    return null;
  }
}

function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Strict`;
}

function getCookie(name) {
  const match = document.cookie.split('; ').find(r => r.startsWith(name + '='));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

function deleteCookie(name) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Strict`;
}

function saveSession(proxySecret, torboxKey) {
  const packed = cookiePack({ p: proxySecret, t: torboxKey, ts: Date.now() });
  setCookie(COOKIE_NAME, packed, COOKIE_DAYS);
}

function loadSession() {
  const raw = getCookie(COOKIE_NAME);
  if (!raw) return null;
  const data = cookieUnpack(raw);
  if (!data?.p || !data?.t) return null;
  return { proxySecret: data.p, torboxKey: data.t };
}

function clearSession() {
  deleteCookie(COOKIE_NAME);
}

// ── Config validation ─────────────────────────────────────────────────────────

function validateConfig(cfg) {
  for (const key of REQUIRED_CONFIG_KEYS) {
    if (!cfg[key]) throw new Error(`CONFIG CORRUPT: missing "${key}" block.`);
  }
  if (!cfg.proxy?.url)                        throw new Error('CONFIG CORRUPT: proxy.url missing.');
  if (!cfg.trackers?.primary?.searchEndpoint) throw new Error('CONFIG CORRUPT: trackers.primary.searchEndpoint missing.');
  if (!cfg.torbox?.baseUrl)                   throw new Error('CONFIG CORRUPT: torbox.baseUrl missing.');
  if (!Number.isFinite(cfg.engineLimits?.maxPayloadHashes)) throw new Error('CONFIG CORRUPT: engineLimits.maxPayloadHashes invalid.');
}

// ── Relay fetch ───────────────────────────────────────────────────────────────

async function relayFetch(targetUrl, opts = {}) {
  const headers = {
    'Authorization': `Bearer ${PROXY_SECRET}`,
    'X-Target-Url':  targetUrl,
    ...(opts.targetAuth ? { 'X-Target-Auth': opts.targetAuth } : {}),
    ...(opts.headers ?? {}),
  };

  const fetchOpts = {
    method: opts.method ?? 'GET',
    headers,
    signal: opts.signal ?? null,
  };

  if (opts.body) fetchOpts.body = opts.body;

  const res = await fetch(CONFIG.proxy.url, fetchOpts);

  if (res.status === 401) throw new Error('PROXY REJECTED: invalid proxy secret.');
  if (res.status === 403) throw new Error('PROXY REJECTED: access forbidden.');
  if (res.status === 502 || res.status === 503) throw new Error('RELAY OFFLINE: proxy cannot reach target.');
  if (!res.ok) throw new Error(`RELAY ERROR: HTTP ${res.status}.`);

  return res;
}

// ── Search history ────────────────────────────────────────────────────────────

function loadHistory() {
  try { searchHistory = JSON.parse(localStorage.getItem('radar_history') ?? '[]'); }
  catch { searchHistory = []; }
  if (!Array.isArray(searchHistory)) searchHistory = [];
}

function saveHistory() {
  localStorage.setItem('radar_history', JSON.stringify(searchHistory.slice(0, HISTORY_MAX)));
}

function pushHistory(query) {
  searchHistory = [query, ...searchHistory.filter(q => q !== query)].slice(0, HISTORY_MAX);
  saveHistory();
}

function renderHistoryDropdown() {
  if (!searchHistory.length) { $historyDropdown.classList.add('hidden'); return; }
  $historyDropdown.innerHTML = '';
  searchHistory.forEach(q => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.textContent = q;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      $searchInput.value = q;
      $historyDropdown.classList.add('hidden');
      executeScan();
    });
    $historyDropdown.appendChild(el);
  });
  $historyDropdown.classList.remove('hidden');
}

// ── Boot ──────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
  // Load config
  try {
    const res = await fetch('glass/data/config.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = await res.json();
    validateConfig(cfg);
    CONFIG = cfg;
  } catch (e) {
    $authForm.innerHTML = `
      <h2 class="glitch-text" data-text="FATAL ERROR">FATAL ERROR</h2>
      <p class="warning-text">FAILED TO LOAD CONFIG: ${esc(e.message)}</p>`;
    return;
  }

  loadHistory();

  // Auto-login from cookie
  const saved = loadSession();
  if (saved) {
    PROXY_SECRET = saved.proxySecret;
    TORBOX_KEY   = saved.torboxKey;
    unlockInterface();
    toast('[ SESSION RESTORED — UPLINK ACTIVE. ]', 'ok');
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────────

$authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!CONFIG) { toast('System not ready — config missing.', 'err'); return; }

  const proxyKey  = document.getElementById('proxyKeyInput').value.trim();
  const torboxKey = document.getElementById('torboxKeyInput').value.trim();

  if (!proxyKey || !torboxKey) { toast('Both keys required.', 'err'); return; }

  PROXY_SECRET = proxyKey;
  TORBOX_KEY   = torboxKey;

  if ($rememberCheck.checked) {
    saveSession(proxyKey, torboxKey);
    $authWarning.textContent = 'Keys encrypted and stored for 30 days.';
  } else {
    $authWarning.textContent = 'Keys reside in volatile memory. Close tab and they burn.';
  }

  unlockInterface();
});

function unlockInterface() {
  $authOverlay.classList.remove('active');
  $mainInterface.classList.remove('hidden');
  $searchInput.focus();
}

$lockBtn.addEventListener('click', () => {
  clearSession();
  PROXY_SECRET = '';
  TORBOX_KEY   = '';
  stopVaultPoll();
  $mainInterface.classList.add('hidden');
  $authOverlay.classList.add('active');
  document.getElementById('proxyKeyInput').value = '';
  document.getElementById('torboxKeyInput').value = '';
  toast('[ SESSION LOCKED. KEYS PURGED. ]', 'warn', 4000);
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if ($authOverlay.classList.contains('active')) return;

  // '/' — focus search (if not already in an input)
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    $searchInput.focus();
    $searchInput.select();
    return;
  }

  // Escape — blur search / close history dropdown
  if (e.key === 'Escape') {
    $historyDropdown.classList.add('hidden');
    $searchInput.blur();
    return;
  }
});

// ── Search input events ───────────────────────────────────────────────────────

$searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { $historyDropdown.classList.add('hidden'); executeScan(); }
  if (e.key === 'Escape') { $historyDropdown.classList.add('hidden'); $searchInput.blur(); }
});

$searchInput.addEventListener('focus', () => {
  if (searchHistory.length) renderHistoryDropdown();
});

$searchInput.addEventListener('blur', () => {
  // Small delay so mousedown on history item fires first
  setTimeout(() => $historyDropdown.classList.add('hidden'), 150);
});

$searchInput.addEventListener('input', () => {
  if (!$searchInput.value.trim()) renderHistoryDropdown();
  else $historyDropdown.classList.add('hidden');
});

// ── Control events ────────────────────────────────────────────────────────────

$searchBtn.addEventListener('click', executeScan);
$vaultBtn.addEventListener('click', accessVault);

$sortSelect.addEventListener('change', () => { pageOffset = 0; applyFilterSort(); renderGrid(); });

$filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    $filterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    pageOffset = 0;
    applyFilterSort();
    renderGrid();
  });
});

$minSeedersSlider.addEventListener('input', () => {
  minSeeders = parseInt($minSeedersSlider.value, 10);
  $minSeedersVal.textContent = minSeeders;
  pageOffset = 0;
  applyFilterSort();
  renderGrid();
});

$loadMoreBtn.addEventListener('click', () => {
  pageOffset += PAGE_SIZE;
  renderGrid(true);
});

$copyAllBtn.addEventListener('click', copyAllMagnets);

$vaultRefreshBtn.addEventListener('click', () => {
  stopVaultPoll();
  accessVault();
});

// ── Filter + Sort (non-mutating, populates displayData) ───────────────────────

function applyFilterSort() {
  if (currentView !== 'search') return;
  displayData = globalData.filter((item) => {
    if (item.seeders < minSeeders)         return false;
    if (currentFilter === 'cached')        return item.cached;
    if (currentFilter === '4k')            return item.resolution === '2160p';
    if (currentFilter === '1080p')         return item.resolution === '1080p';
    if (currentFilter === '720p')          return item.resolution === '720p';
    return true;
  });

  const sort = $sortSelect.value;
  displayData.sort((a, b) => {
    if (sort === 'seeders') return b.seeders - a.seeders;
    if (sort === 'size')    return b.size - a.size;
    if (sort === 'quality') return b.qualityScore - a.qualityScore;
    return 0;
  });
}

// ── Scan ─────────────────────────────────────────────────────────────────────

async function executeScan() {
  if (_scanning) return;
  const query = $searchInput.value.trim();
  if (!query) { toast('Enter a target designation.', 'warn'); return; }

  stopVaultPoll();
  currentView = 'search';
  _scanning   = true;
  pageOffset  = 0;
  setBusy(true, $searchBtn, 'HUNT', 'SCANNING…');
  $vaultControls.classList.add('hidden');
  $statusBar.classList.add('hidden');
  $loadMoreWrap.classList.add('hidden');
  setGridMsg('[ PROBING THE DARKNET… ]');

  try {
    const trackerUrl = `${CONFIG.trackers.primary.searchEndpoint}${encodeURIComponent(query)}`;
    const trackerRes = await relayFetch(trackerUrl);
    const rawResults = await trackerRes.json();

    if (!Array.isArray(rawResults) || rawResults.length === 0 || rawResults[0]?.id === '0') {
      setGridMsg('[ GHOST TOWN. NOTHING FOUND. ]', ' grid-msg--muted');
      return;
    }

    const items = rawResults
      .filter((r) => r.info_hash && /^[0-9a-fA-F]{40}$/.test(r.info_hash))
      .map((item) => {
        const resMatch   = item.name.match(/(2160p|4k|1080p|720p|480p)/i);
        const rawRes     = resMatch ? resMatch[0].toLowerCase() : 'unknown';
        const resolution = rawRes === '4k' ? '2160p' : rawRes;
        const seeders    = parseInt(item.seeders, 10)  || 0;
        const leechers   = parseInt(item.leechers, 10) || 0;
        const size       = parseInt(item.size, 10)     || 0;
        const magnetUrl  = `magnet:?xt=urn:btih:${item.info_hash}&dn=${encodeURIComponent(item.name)}${CONFIG.trackers.magnetAppend ?? ''}`;

        return {
          title:        item.name,
          infoHash:     item.info_hash.toLowerCase(),
          magnetUrl,
          seeders,
          leechers,
          size,
          resolution,
          qualityScore: calcQuality(seeders, resolution),
          cached:       false,
        };
      })
      .filter((item) => item.seeders > 0)
      .sort((a, b) => b.seeders - a.seeders)
      .slice(0, CONFIG.engineLimits.maxPayloadHashes);

    if (items.length === 0) {
      setGridMsg('[ ALL TARGETS DEAD. NO SEEDERS. ]', ' grid-msg--muted');
      return;
    }

    globalData = items;
    pushHistory(query);

    // TorBox cache check (non-fatal)
    try {
      const hashes   = globalData.map((i) => i.infoHash).join(',');
      const cacheRes = await relayFetch(
        `${CONFIG.torbox.baseUrl}/checkcached?hash=${hashes}&format=list`,
        { targetAuth: TORBOX_KEY }
      );
      const cacheData = await cacheRes.json();
      if (cacheData?.success && cacheData?.data) {
        const cm = cacheData.data;
        globalData.forEach((item) => { item.cached = !!cm[item.infoHash]; });
      }
    } catch (cacheErr) {
      console.warn('[radar] cache check failed:', cacheErr.message);
    }

    applyFilterSort();
    renderGrid();
    updateStatusBar();
  } catch (err) {
    console.error('[radar] scan error:', err);
    setGridMsg(`[ SCAN FAILED: ${esc(err.message)} ]`, ' grid-msg--error');
  } finally {
    _scanning = false;
    setBusy(false, $searchBtn, 'HUNT', 'SCANNING…');
  }
}

function calcQuality(seeders, res) {
  let score = seeders;
  if (res === '2160p') score *= 1.5;
  else if (res === '1080p') score *= 1.2;
  return score;
}

// ── Status bar ────────────────────────────────────────────────────────────────

function updateStatusBar() {
  const total   = globalData.length;
  const cached  = globalData.filter(i => i.cached).length;
  const visible = Math.min(pageOffset + PAGE_SIZE, displayData.length);

  $statusCount.textContent   = `${total} TARGETS`;
  $statusCached.textContent  = `${cached} CACHED`;
  $statusShowing.textContent = `SHOWING ${Math.min(visible, displayData.length)} / ${displayData.length}`;
  $statusBar.classList.remove('hidden');
}

// ── Render grid ───────────────────────────────────────────────────────────────

function renderGrid(append = false) {
  if (currentView !== 'search') return;

  if (displayData.length === 0) {
    setGridMsg('[ NO RESULTS MATCH CURRENT FILTERS. ]', ' grid-msg--muted');
    $loadMoreWrap.classList.add('hidden');
    $statusBar.classList.add('hidden');
    return;
  }

  const page = displayData.slice(pageOffset, pageOffset + PAGE_SIZE);

  if (!append) {
    $resultsGrid.innerHTML = '';
  }

  const frag = document.createDocumentFragment();

  page.forEach((item) => {
    const card = document.createElement('div');
    card.className = `card${item.cached ? ' cached' : ''}`;

    const titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    titleEl.textContent = item.title;

    const badgeRow = document.createElement('div');
    badgeRow.className = 'badge-row';
    badgeRow.innerHTML = `
      <span class="badge res">${esc(item.resolution.toUpperCase())}</span>
      <span class="badge size">${esc(fmtBytes(item.size))}</span>
      <span class="badge seed">↑${esc(String(item.seeders))} ↓${esc(String(item.leechers))}</span>
      ${item.cached ? '<span class="badge cached-badge">⚡ CACHED</span>' : ''}
    `;

    const actionRow = document.createElement('div');
    actionRow.className = 'action-row';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-btn';
    copyBtn.textContent = 'COPY MAGNET';
    copyBtn.addEventListener('click', () => copyMagnet(item.magnetUrl, copyBtn));

    const igniteBtn = document.createElement('button');
    igniteBtn.className = 'action-btn primary';
    igniteBtn.textContent = item.cached ? '⚡ STREAM (CACHED)' : 'IGNITE ENGINE';
    igniteBtn.addEventListener('click', () => ignitePayload(item.magnetUrl, igniteBtn));

    actionRow.append(copyBtn, igniteBtn);
    card.append(titleEl, badgeRow, actionRow);
    frag.appendChild(card);
  });

  $resultsGrid.appendChild(frag);

  // Load more
  const rendered = pageOffset + PAGE_SIZE;
  if (rendered < displayData.length) {
    const remaining = displayData.length - rendered;
    $loadMoreCount.textContent = `${remaining} more`;
    $loadMoreWrap.classList.remove('hidden');
  } else {
    $loadMoreWrap.classList.add('hidden');
  }

  updateStatusBar();
}

// ── Vault ─────────────────────────────────────────────────────────────────────

async function accessVault() {
  if (_vaulting) return;
  _vaulting   = true;
  currentView = 'vault';
  pageOffset  = 0;
  setBusy(true, $vaultBtn, 'STRIP VAULT', 'DECRYPTING…');
  $statusBar.classList.add('hidden');
  $loadMoreWrap.classList.add('hidden');
  setGridMsg('[ DECRYPTING VAULT CONTENTS… ]');

  try {
    const res  = await relayFetch(`${CONFIG.torbox.baseUrl}/mylist`, { targetAuth: TORBOX_KEY });
    const body = await res.json();

    if (!body?.data || !Array.isArray(body.data) || body.data.length === 0) {
      setGridMsg('[ VAULT EMPTY. ]', ' grid-msg--muted');
      scheduleVaultPoll();
      return;
    }

    renderVault(body.data);
    scheduleVaultPoll();
  } catch (err) {
    console.error('[radar] vault error:', err);
    setGridMsg(`[ VAULT BREACH FAILED: ${esc(err.message)} ]`, ' grid-msg--error');
  } finally {
    _vaulting = false;
    setBusy(false, $vaultBtn, 'STRIP VAULT', 'DECRYPTING…');
  }
}

function renderVault(items) {
  $resultsGrid.innerHTML = '';
  const frag = document.createDocumentFragment();

  items.forEach((item) => {
    const isReady   = !!item.download_finished;
    const progress  = typeof item.progress === 'number' ? (item.progress * 100).toFixed(1) : '?';
    const eta       = item.eta ? ` · ETA ${fmtEta(item.eta)}` : '';
    const ratio     = typeof item.ratio === 'number' ? ` · R:${item.ratio.toFixed(2)}` : '';

    const card = document.createElement('div');
    card.className = `card${isReady ? ' cached' : ''}`;

    const titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    titleEl.textContent = item.name ?? 'Unknown';

    const badgeRow = document.createElement('div');
    badgeRow.className = 'badge-row';
    badgeRow.innerHTML = `
      <span class="badge size">${esc(fmtBytes(item.size ?? 0))}</span>
      <span class="badge seed${isReady ? '' : ' badge--progress'}">${isReady ? '✓ PRIMED' : `${esc(progress)}%${esc(eta)}`}</span>
      ${ratio ? `<span class="badge">${esc(ratio.trim())}</span>` : ''}
    `;

    const actionRow = document.createElement('div');
    actionRow.className = 'action-row';

    if (isReady) {
      const pullBtn = document.createElement('button');
      pullBtn.className = 'action-btn primary';
      pullBtn.textContent = 'PULL DIRECT LINK';
      pullBtn.addEventListener('click', () => getLink(item.id, 0, pullBtn, card));
      actionRow.appendChild(pullBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'action-btn action-btn--danger';
      delBtn.textContent = 'DELETE';
      delBtn.addEventListener('click', () => deleteVaultItem(item.id, delBtn, card));
      actionRow.appendChild(delBtn);
    } else {
      const waitBtn = document.createElement('button');
      waitBtn.className = 'action-btn';
      waitBtn.textContent = 'EXTRACTING…';
      waitBtn.disabled = true;
      actionRow.appendChild(waitBtn);
    }

    card.append(titleEl, badgeRow, actionRow);
    frag.appendChild(card);
  });

  $resultsGrid.appendChild(frag);
  $vaultControls.classList.remove('hidden');
}

function fmtEta(secs) {
  if (!Number.isFinite(secs) || secs <= 0) return '?';
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs/60)}m`;
  return `${Math.floor(secs/3600)}h${Math.floor((secs%3600)/60)}m`;
}

// ── Vault poll ────────────────────────────────────────────────────────────────

function scheduleVaultPoll() {
  stopVaultPoll();
  _vaultSecs = VAULT_POLL_SECS;
  $vaultCountdown.textContent = `Auto-refresh in ${_vaultSecs}s`;
  _vaultTimer = setInterval(() => {
    _vaultSecs--;
    if (_vaultSecs <= 0) {
      stopVaultPoll();
      accessVault();
    } else {
      $vaultCountdown.textContent = `Auto-refresh in ${_vaultSecs}s`;
    }
  }, 1000);
}

function stopVaultPoll() {
  clearInterval(_vaultTimer);
  _vaultTimer = null;
  $vaultCountdown.textContent = '';
  $vaultControls.classList.add('hidden');
}

// ── Copy all magnets ──────────────────────────────────────────────────────────

async function copyAllMagnets() {
  if (!displayData.length) { toast('Nothing to copy.', 'warn'); return; }
  const magnets = displayData.map(i => i.magnetUrl).join('\n');
  try {
    await navigator.clipboard.writeText(magnets);
    toast(`[ ${displayData.length} MAGNETS SECURED — CLIPBOARD LOADED. ]`, 'ok');
  } catch {
    toast('Clipboard write failed.', 'err');
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function copyMagnet(magnetUrl, $btn) {
  if (!magnetUrl || magnetUrl.length > MAX_MAGNET_LEN) { toast('Invalid magnet link.', 'err'); return; }
  const orig = $btn.textContent;
  try {
    await navigator.clipboard.writeText(magnetUrl);
    $btn.textContent = 'COPIED ✓';
    toast('[ MAGNET SECURED. ]', 'ok');
    setTimeout(() => { $btn.textContent = orig; }, 2000);
  } catch {
    toast('Clipboard write failed.', 'err');
  }
}

async function ignitePayload(magnetUrl, $btn) {
  if (!magnetUrl || magnetUrl.length > MAX_MAGNET_LEN) { toast('Invalid magnet link.', 'err'); return; }

  const orig = $btn.textContent;
  $btn.disabled = true;
  $btn.textContent = 'IGNITING…';

  try {
    const fd = new FormData();
    fd.append('magnet', magnetUrl);

    const res  = await relayFetch(`${CONFIG.torbox.baseUrl}/createtorrent`, {
      method: 'POST', targetAuth: TORBOX_KEY, body: fd,
    });
    const body = await res.json().catch(() => ({}));

    if (body?.success === false) throw new Error(body?.detail ?? 'TorBox rejected payload.');

    toast('[ PAYLOAD INJECTED — ENGINE IGNITED. ]', 'ok');
    $btn.textContent = 'IGNITED ✓';
    setTimeout(() => { $btn.textContent = orig; $btn.disabled = false; }, 4000);
    return;
  } catch (err) {
    console.error('[radar] ignite error:', err);
    toast(`[ IGNITION FAILED: ${err.message} ]`, 'err');
  }

  $btn.textContent = orig;
  $btn.disabled    = false;
}

async function getLink(torrentId, fileId, $btn, $card) {
  const orig = $btn.textContent;
  $btn.disabled    = true;
  $btn.textContent = 'PULLING…';

  try {
    const res  = await relayFetch(
      `${CONFIG.torbox.baseUrl}/requestdl?token=${encodeURIComponent(torrentId)}&file_id=${encodeURIComponent(fileId)}`,
      { targetAuth: TORBOX_KEY }
    );
    const body = await res.json();
    if (!body?.data) throw new Error('No download link in response.');

    const link = body.data;
    await navigator.clipboard.writeText(link).catch(() => {});

    // Remove any existing reveal panel before adding a new one
    $card.querySelector('.link-reveal')?.remove();

    const $overlay = document.createElement('div');
    $overlay.className = 'link-reveal';

    const $label = document.createElement('p');
    $label.className = 'link-reveal__label';
    $label.textContent = 'DIRECT LINK — COPIED TO CLIPBOARD';

    const $a = document.createElement('a');
    $a.className  = 'link-reveal__url';
    $a.href       = link;
    $a.target     = '_blank';
    $a.rel        = 'noopener noreferrer nofollow';
    $a.textContent = link;

    const $close = document.createElement('button');
    $close.className   = 'action-btn link-reveal__close';
    $close.textContent = 'DISMISS';
    $close.addEventListener('click', () => $overlay.remove());

    $overlay.append($label, $a, $close);
    $card.appendChild($overlay);

    toast('[ DIRECT LINK STRIPPED — CLIPBOARD LOADED. ]', 'ok');
  } catch (err) {
    console.error('[radar] getLink error:', err);
    toast(`[ LINK EXTRACTION FAILED: ${err.message} ]`, 'err');
  } finally {
    $btn.textContent = orig;
    $btn.disabled    = false;
  }
}

async function deleteVaultItem(torrentId, $btn, $card) {
  if (!confirm('Delete this torrent from TorBox vault?')) return;

  const orig = $btn.textContent;
  $btn.disabled    = true;
  $btn.textContent = 'DELETING…';

  try {
    const fd = new FormData();
    fd.append('torrent_id', torrentId);
    fd.append('operation',  'delete');

    await relayFetch(`${CONFIG.torbox.baseUrl}/controltorrent`, {
      method: 'POST', targetAuth: TORBOX_KEY, body: fd,
    });

    $card.style.transition = 'opacity 0.4s';
    $card.style.opacity    = '0';
    setTimeout(() => $card.remove(), 400);
    toast('[ TORRENT EXPUNGED FROM VAULT. ]', 'ok');
  } catch (err) {
    console.error('[radar] delete error:', err);
    toast(`[ DELETE FAILED: ${err.message} ]`, 'err');
    $btn.textContent = orig;
    $btn.disabled    = false;
  }
}
