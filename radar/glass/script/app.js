// RADAR // ANOMALY — app.js
// Communicates exclusively through radar.trap.lol/api/relay (CORS proxy + auth).
// All user-visible strings are escaped before DOM injection. No innerHTML with raw data.

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const REQUIRED_CONFIG_KEYS = ['proxy', 'trackers', 'torbox', 'engineLimits'];
const MAX_MAGNET_LEN = 4096;

// ── State ────────────────────────────────────────────────────────────────────

let CONFIG        = null;
let PROXY_SECRET  = '';
let TORBOX_KEY    = '';
let globalData    = [];
let currentFilter = 'all';
let _scanning     = false;
let _vaulting     = false;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $authOverlay       = document.getElementById('authOverlay');
const $mainInterface     = document.getElementById('mainInterface');
const $resultsGrid       = document.getElementById('resultsGrid');
const $searchInput       = document.getElementById('searchInput');
const $sortSelect        = document.getElementById('sortSelect');
const $filterBtns        = document.querySelectorAll('.filter-btn');
const $authForm          = document.getElementById('authForm');
const $searchBtn         = document.getElementById('searchBtn');
const $vaultBtn          = document.getElementById('vaultBtn');
const $authBtn           = document.getElementById('authBtn');

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
  const mb = bytes / 1_048_576;
  return `${mb.toFixed(0)} MB`;
}

function setGridMsg(html, cls = '') {
  $resultsGrid.innerHTML = `<div class="grid-msg${cls ? ' ' + cls : ''}">${html}</div>`;
}

function setBusy(isBusy, $btn, label, busyLabel) {
  $btn.disabled = isBusy;
  $btn.textContent = isBusy ? busyLabel : label;
  $btn.classList.toggle('btn--busy', isBusy);
}

// ── Toast / feedback ─────────────────────────────────────────────────────────

let _toastTimer = null;
function toast(msg, type = 'ok') {
  let $t = document.getElementById('radar-toast');
  if (!$t) {
    $t = document.createElement('div');
    $t.id = 'radar-toast';
    document.body.appendChild($t);
  }
  $t.textContent = msg;
  $t.className = `radar-toast radar-toast--${type} radar-toast--show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => $t.classList.remove('radar-toast--show'), 3000);
}

// ── Config validation ────────────────────────────────────────────────────────

function validateConfig(cfg) {
  for (const key of REQUIRED_CONFIG_KEYS) {
    if (!cfg[key]) throw new Error(`CONFIG CORRUPT: missing "${key}" block.`);
  }
  if (!cfg.proxy?.url)                        throw new Error('CONFIG CORRUPT: proxy.url missing.');
  if (!cfg.trackers?.primary?.searchEndpoint) throw new Error('CONFIG CORRUPT: trackers.primary.searchEndpoint missing.');
  if (!cfg.torbox?.baseUrl)                   throw new Error('CONFIG CORRUPT: torbox.baseUrl missing.');
  if (!Number.isFinite(cfg.engineLimits?.maxPayloadHashes)) throw new Error('CONFIG CORRUPT: engineLimits.maxPayloadHashes invalid.');
}

// ── Proxy fetch wrapper ───────────────────────────────────────────────────────

async function relayFetch(targetUrl, opts = {}) {
  const headers = {
    'Authorization': `Bearer ${PROXY_SECRET}`,
    'X-Target-Url':  targetUrl,
    ...(opts.targetAuth ? { 'X-Target-Auth': opts.targetAuth } : {}),
    ...(opts.headers ?? {}),
  };

  const fetchOpts = {
    method:  opts.method ?? 'GET',
    headers,
    signal:  opts.signal ?? null,
  };

  if (opts.body) {
    fetchOpts.body = opts.body;
  }

  const res = await fetch(CONFIG.proxy.url, fetchOpts);

  if (res.status === 401) throw new Error('PROXY REJECTED: invalid proxy secret.');
  if (res.status === 403) throw new Error('PROXY REJECTED: access forbidden.');
  if (res.status === 502 || res.status === 503) throw new Error('RELAY OFFLINE: proxy cannot reach target.');
  if (!res.ok) throw new Error(`RELAY ERROR: HTTP ${res.status}.`);

  return res;
}

// ── Boot ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
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
  }
});

// ── Auth ─────────────────────────────────────────────────────────────────────

$authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!CONFIG) { toast('System not ready — config missing.', 'err'); return; }

  const proxyKey  = document.getElementById('proxyKeyInput').value.trim();
  const torboxKey = document.getElementById('torboxKeyInput').value.trim();

  if (!proxyKey || !torboxKey) {
    toast('Both keys required.', 'err');
    return;
  }

  PROXY_SECRET = proxyKey;
  TORBOX_KEY   = torboxKey;

  $authOverlay.classList.remove('active');
  $mainInterface.classList.remove('hidden');
  $searchInput.focus();
});

// ── Event listeners ───────────────────────────────────────────────────────────

$searchBtn.addEventListener('click', executeScan);
$vaultBtn.addEventListener('click', accessVault);

$searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') executeScan();
});

$sortSelect.addEventListener('change', renderGrid);

$filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    $filterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderGrid();
  });
});

// ── Scan ─────────────────────────────────────────────────────────────────────

async function executeScan() {
  if (_scanning) return;
  const query = $searchInput.value.trim();
  if (!query) { toast('Enter a target designation.', 'warn'); return; }

  _scanning = true;
  setBusy(true, $searchBtn, 'HUNT', 'SCANNING…');
  setGridMsg('[ PROBING THE DARKNET… ]');

  try {
    // 1 — Query tracker via relay
    const trackerUrl = `${CONFIG.trackers.primary.searchEndpoint}${encodeURIComponent(query)}`;
    const trackerRes = await relayFetch(trackerUrl);
    const rawResults = await trackerRes.json();

    if (!Array.isArray(rawResults) || rawResults.length === 0 || rawResults[0]?.id === '0') {
      setGridMsg('[ GHOST TOWN. NOTHING FOUND. ]', ' grid-msg--muted');
      return;
    }

    // 2 — Normalise
    const items = rawResults
      .filter((r) => r.info_hash && r.info_hash !== '0'.repeat(40) && /^[0-9a-fA-F]{40}$/.test(r.info_hash))
      .map((item) => {
        const resMatch   = item.name.match(/(2160p|4k|1080p|720p|480p)/i);
        const rawRes     = resMatch ? resMatch[0].toLowerCase() : 'unknown';
        const resolution = rawRes === '4k' ? '2160p' : rawRes;
        const seeders    = parseInt(item.seeders, 10)  || 0;
        const leechers   = parseInt(item.leechers, 10) || 0;
        const size       = parseInt(item.size, 10)     || 0;

        const magnetUrl = [
          `magnet:?xt=urn:btih:${item.info_hash}`,
          `&dn=${encodeURIComponent(item.name)}`,
          CONFIG.trackers.magnetAppend ?? '',
        ].join('');

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

    // 3 — TorBox cache check
    try {
      const hashes   = globalData.map((i) => i.infoHash).join(',');
      const cacheRes = await relayFetch(
        `${CONFIG.torbox.baseUrl}/checkcached?hash=${hashes}&format=list`,
        { targetAuth: TORBOX_KEY }
      );
      const cacheData = await cacheRes.json();
      if (cacheData?.success && cacheData?.data) {
        const cacheMap = cacheData.data;
        globalData.forEach((item) => { item.cached = !!cacheMap[item.infoHash]; });
      }
    } catch (cacheErr) {
      console.warn('[radar] TorBox cache check failed:', cacheErr.message);
      // Non-fatal — proceed without cache status
    }

    renderGrid();
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

// ── Render grid ───────────────────────────────────────────────────────────────

function renderGrid() {
  if (!globalData.length) return;

  let display = globalData.filter((item) => {
    if (currentFilter === 'cached') return item.cached;
    if (currentFilter === '4k')     return item.resolution === '2160p';
    if (currentFilter === '1080p')  return item.resolution === '1080p';
    return true;
  });

  const sort = $sortSelect.value;
  display.sort((a, b) => {
    if (sort === 'seeders') return b.seeders - a.seeders;
    if (sort === 'size')    return b.size - a.size;
    if (sort === 'quality') return b.qualityScore - a.qualityScore;
    return 0;
  });

  if (display.length === 0) {
    setGridMsg('[ NO RESULTS MATCH CURRENT FILTER. ]', ' grid-msg--muted');
    return;
  }

  $resultsGrid.innerHTML = '';
  const frag = document.createDocumentFragment();

  display.forEach((item) => {
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
      <span class="badge seed">S: ${esc(String(item.seeders))} / L: ${esc(String(item.leechers))}</span>
      ${item.cached ? '<span class="badge cached-badge">CACHED</span>' : ''}
    `;

    const actionRow = document.createElement('div');
    actionRow.className = 'action-row';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-btn';
    copyBtn.textContent = 'COPY MAGNET';
    copyBtn.addEventListener('click', () => copyMagnet(item.magnetUrl));

    const igniteBtn = document.createElement('button');
    igniteBtn.className = 'action-btn primary';
    igniteBtn.textContent = item.cached ? 'STREAM (CACHED)' : 'IGNITE ENGINE';
    igniteBtn.addEventListener('click', () => ignitePayload(item.magnetUrl, igniteBtn));

    actionRow.append(copyBtn, igniteBtn);
    card.append(titleEl, badgeRow, actionRow);
    frag.appendChild(card);
  });

  $resultsGrid.appendChild(frag);
}

// ── Vault ─────────────────────────────────────────────────────────────────────

async function accessVault() {
  if (_vaulting) return;
  _vaulting = true;
  setBusy(true, $vaultBtn, 'STRIP VAULT', 'DECRYPTING…');
  setGridMsg('[ DECRYPTING VAULT CONTENTS… ]');

  try {
    const res  = await relayFetch(`${CONFIG.torbox.baseUrl}/mylist`, { targetAuth: TORBOX_KEY });
    const body = await res.json();

    if (!body?.data || !Array.isArray(body.data)) {
      setGridMsg('[ VAULT EMPTY OR UNREADABLE. ]', ' grid-msg--muted');
      return;
    }

    if (body.data.length === 0) {
      setGridMsg('[ VAULT IS EMPTY. ]', ' grid-msg--muted');
      return;
    }

    $resultsGrid.innerHTML = '';
    const frag = document.createDocumentFragment();

    body.data.forEach((item) => {
      const isReady   = !!item.download_finished;
      const progress  = typeof item.progress === 'number' ? (item.progress * 100).toFixed(1) : '?';
      const card      = document.createElement('div');
      card.className  = `card${isReady ? ' cached' : ''}`;

      const titleEl = document.createElement('div');
      titleEl.className = 'card-title';
      titleEl.textContent = item.name ?? 'Unknown';

      const badgeRow = document.createElement('div');
      badgeRow.className = 'badge-row';
      badgeRow.innerHTML = `
        <span class="badge size">${esc(fmtBytes(item.size ?? 0))}</span>
        <span class="badge seed">${isReady ? 'PRIMED' : `EXTRACTING ${esc(progress)}%`}</span>
      `;

      const actionRow = document.createElement('div');
      actionRow.className = 'action-row';

      if (isReady) {
        const pullBtn = document.createElement('button');
        pullBtn.className = 'action-btn primary';
        pullBtn.textContent = 'PULL DIRECT LINK';
        pullBtn.addEventListener('click', () => getLink(item.id, 0, pullBtn));
        actionRow.appendChild(pullBtn);
      } else {
        const waitBtn = document.createElement('button');
        waitBtn.className = 'action-btn';
        waitBtn.textContent = 'AWAITING MASS…';
        waitBtn.disabled = true;
        actionRow.appendChild(waitBtn);
      }

      card.append(titleEl, badgeRow, actionRow);
      frag.appendChild(card);
    });

    $resultsGrid.appendChild(frag);
  } catch (err) {
    console.error('[radar] vault error:', err);
    setGridMsg(`[ VAULT BREACH FAILED: ${esc(err.message)} ]`, ' grid-msg--error');
  } finally {
    _vaulting = false;
    setBusy(false, $vaultBtn, 'STRIP VAULT', 'DECRYPTING…');
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function copyMagnet(magnetUrl) {
  if (!magnetUrl || magnetUrl.length > MAX_MAGNET_LEN) {
    toast('Invalid magnet link.', 'err');
    return;
  }
  try {
    await navigator.clipboard.writeText(magnetUrl);
    toast('[ MAGNET SECURED — CLIPBOARD LOADED. ]', 'ok');
  } catch {
    toast('Clipboard write failed — copy manually.', 'err');
  }
}

async function ignitePayload(magnetUrl, $btn) {
  if (!magnetUrl || magnetUrl.length > MAX_MAGNET_LEN) {
    toast('Invalid magnet link.', 'err');
    return;
  }

  const origText = $btn.textContent;
  $btn.disabled  = true;
  $btn.textContent = 'IGNITING…';

  try {
    const fd = new FormData();
    fd.append('magnet', magnetUrl);

    const res = await relayFetch(`${CONFIG.torbox.baseUrl}/createtorrent`, {
      method:     'POST',
      targetAuth: TORBOX_KEY,
      body:       fd,
    });

    const body = await res.json().catch(() => ({}));
    if (body?.success === false) {
      throw new Error(body?.detail ?? 'TorBox rejected payload.');
    }

    toast('[ PAYLOAD INJECTED — TORBOX ENGINE IGNITED. ]', 'ok');
    $btn.textContent = 'IGNITED ✓';
    setTimeout(() => { $btn.textContent = origText; $btn.disabled = false; }, 4000);
    return;
  } catch (err) {
    console.error('[radar] ignite error:', err);
    toast(`[ IGNITION FAILED: ${err.message} ]`, 'err');
  }

  $btn.textContent = origText;
  $btn.disabled    = false;
}

async function getLink(torrentId, fileId, $btn) {
  const origText   = $btn.textContent;
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

    // Show the link in a dismissable overlay within the card
    await navigator.clipboard.writeText(link).catch(() => {});

    const $overlay = document.createElement('div');
    $overlay.className = 'link-reveal';
    $overlay.innerHTML = `
      <p class="link-reveal__label">DIRECT LINK — COPIED TO CLIPBOARD</p>
      <a class="link-reveal__url" href="${esc(link)}" target="_blank" rel="noopener noreferrer nofollow">${esc(link)}</a>
      <button class="action-btn link-reveal__close">DISMISS</button>
    `;
    $overlay.querySelector('.link-reveal__close').addEventListener('click', () => $overlay.remove());

    const $card = $btn.closest('.card');
    $card.appendChild($overlay);

    toast('[ DIRECT LINK STRIPPED — CLIPBOARD LOADED. ]', 'ok');
  } catch (err) {
    console.error('[radar] getLink error:', err);
    toast(`[ LINK EXTRACTION FAILED: ${err.message} ]`, 'err');
  } finally {
    $btn.textContent = origText;
    $btn.disabled    = false;
  }
}
