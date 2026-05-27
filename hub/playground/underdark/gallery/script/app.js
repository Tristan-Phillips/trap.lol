/**
 * app.js — Underdark Image Vault
 * Self-contained page. Reads underdark_chars_v4 + underdark_db (IDB) directly.
 * No dependency on the main underdark app or glass/ modules.
 */

'use strict';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IDB — inline (no import, standalone page)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let _db = null;
function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('underdark_db', 1);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        };
        req.onsuccess = e => { _db = e.target.result; resolve(_db); };
        req.onerror   = e => reject(e.target.error);
    });
}
async function idbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction('blobs', 'readonly').objectStore('blobs').get(key);
        req.onsuccess = e => resolve(e.target.result ?? null);
        req.onerror   = e => reject(e.target.error);
    });
}
async function idbDelete(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction('blobs', 'readwrite').objectStore('blobs').delete(key);
        req.onsuccess = () => resolve();
        req.onerror   = e => reject(e.target.error);
    });
}
function isIdbRef(str) { return typeof str === 'string' && str.startsWith('idb:img:'); }
function idbRefId(str) { return str.replace(/^idb:img:/, ''); }
async function resolveUrl(ref) {
    if (!ref) return null;
    if (isIdbRef(ref)) return idbGet(`img:${idbRefId(ref)}`).catch(() => null);
    return ref;
}
function isDataUrl(str) { return typeof str === 'string' && str.startsWith('data:'); }

// Proxy wallhaven CDN URLs through our backend to bypass hotlink restrictions
function whProxyUrl(raw) {
    if (!raw || raw.startsWith('data:') || raw.startsWith('idb:') || raw.startsWith('blob:')) return raw;
    if (raw.includes('wallhaven.cc') || raw.includes('whvn.cc')) {
        return `https://wallhaven.trap.lol/img?url=${encodeURIComponent(raw)}`;
    }
    return raw;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const qs  = (sel, ctx = document) => ctx.querySelector(sel);
const qsa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function slug(s) { return String(s || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''); }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const S = {
    // Raw data
    chars: [],          // { id, name, avatarRef, galleryRefs[], galleryMeta{} }
    // Flat list of all resolved items
    items: [],          // { url, ref, charId, charName, idx, ts }
    // Filter / view state
    view:         'grid',
    sort:         'newest',
    filterChar:   '',   // charId or ''
    filterTags:   new Set(),
    search:       '',
    // Lightbox
    lbItems:      [],   // filtered + sorted items visible in current render
    lbIndex:      0,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PERSISTENCE — read/write underdark_chars_v4
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function readStorage() {
    try {
        const raw = localStorage.getItem('underdark_chars_v4');
        if (!raw) return null;
        return JSON.parse(raw);
    } catch { return null; }
}
function writeStorage(data) {
    try { localStorage.setItem('underdark_chars_v4', JSON.stringify(data)); } catch { /* storage full */ }
}
function getCharData() {
    const data = readStorage();
    if (!data) return [];
    const roster = data.characters || [];
    const loaded = data.loadedCharacters || {};
    return roster.map(meta => {
        const char    = loaded[String(meta.id)] || {};
        const ext     = char.extensions?.underdark || {};
        const extGallery = ext.gallery || [];
        // wh_char_gallery entries: [{url, thumb}] objects (or legacy strings)
        // Use thumb as the display ref so images always load without auth issues
        const { entries: whEntries, urls: whUrls } = getWhEntries(String(meta.id));
        const whThumbRefs = whEntries.map(e => whProxyUrl(e.thumb));
        // Map proxied thumb ref → proxied full-res URL (for lightbox full-res loading)
        const whFullMap = new Map(whEntries.map(e => [whProxyUrl(e.thumb), whProxyUrl(e.url)]));
        // Deduplicate — only include wh thumbs not already in extGallery
        const merged = [...new Set([...extGallery, ...whThumbRefs.filter(t => !extGallery.includes(t))])];
        return {
            id:          String(meta.id),
            name:        char.name || meta.name || 'Unknown',
            avatarRef:   meta.avatar_path || null,
            galleryRefs: merged,
            galleryMeta: ext.galleryMeta  || {},
            videoRefs:   ext.videoGallery || [],
            _whUrls:     whUrls,   // full URLs, used by saveGallery filter
            _whFullMap:  whFullMap, // thumb→fullUrl map for lightbox
        };
    });
}
function saveVideoRefs(charId, videoRefs) {
    const data = readStorage();
    if (!data) return;
    if (!data.loadedCharacters) data.loadedCharacters = {};
    if (!data.loadedCharacters[charId]) data.loadedCharacters[charId] = {};
    const char = data.loadedCharacters[charId];
    if (!char.extensions)           char.extensions = {};
    if (!char.extensions.underdark) char.extensions.underdark = {};
    char.extensions.underdark.videoGallery = videoRefs;
    writeStorage(data);
}
// Returns { urls: Set<string>, entries: [{url, thumb}] } for wh_char_gallery entries
// Handles both legacy string entries and new {url, thumb, wallId} objects
function getWhEntries(charId) {
    try {
        const store = JSON.parse(localStorage.getItem('wh_char_gallery') || '{}');
        const raw = store[String(charId)] || [];
        const entries = raw.map(e => typeof e === 'string' ? { url: e, thumb: e } : { url: e.url, thumb: e.thumb || e.url });
        return { urls: new Set(entries.map(e => e.url)), entries };
    } catch { return { urls: new Set(), entries: [] }; }
}
function getWhUrls(charId) { return getWhEntries(charId).urls; }
function saveGallery(charId, galleryRefs, galleryMeta) {
    const data = readStorage();
    if (!data) return;
    const char = (data.loadedCharacters || {})[charId];
    if (!char) return;
    if (!char.extensions)           char.extensions = {};
    if (!char.extensions.underdark) char.extensions.underdark = {};
    // Exclude wh_char_gallery refs (both full URLs and thumb URLs) so ext.gallery stays underdark-native only
    const { urls: whUrls, entries: whEntries } = getWhEntries(charId);
    // Include both raw and proxied thumb URLs in the exclusion set
    const whThumbs = new Set(whEntries.flatMap(e => [e.thumb, whProxyUrl(e.thumb)]));
    char.extensions.underdark.gallery     = galleryRefs.filter(r => !whUrls.has(r) && !whThumbs.has(r));
    char.extensions.underdark.galleryMeta = galleryMeta;
    writeStorage(data);
}
function saveAvatar(charId, ref) {
    const data = readStorage();
    if (!data) return;
    const rosterEntry = (data.characters || []).find(c => String(c.id) === charId);
    if (rosterEntry) rosterEntry.avatar_path = ref;
    const char = (data.loadedCharacters || {})[charId];
    if (char) char.avatar_path = ref;
    writeStorage(data);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VAULT SYNC — hydrate wh_char_gallery from backend before first render
// Needed when gallery opens before the wallhaven app tab has run syncFromVault.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GALLERY_PROXY_BASE = 'https://wallhaven.trap.lol';

async function syncVaultToGallery() {
    const vaultId = localStorage.getItem('wh_vault_id') || '';
    if (!vaultId) return;
    try {
        const r = await fetch(`${GALLERY_PROXY_BASE}/vault/${vaultId}/data`);
        if (!r.ok) return;
        const data = await r.json();
        const assignments = data.assignments || [];
        if (!assignments.length) return;

        let store;
        try { store = JSON.parse(localStorage.getItem('wh_char_gallery') || '{}'); } catch { store = {}; }
        let changed = false;
        assignments.forEach(e => {
            const cid = String(e.charId);
            if (!Array.isArray(store[cid])) store[cid] = [];
            const alreadyStored = store[cid].some(x => (typeof x === 'string' ? x : x.url) === e.fullUrl);
            if (!alreadyStored) {
                store[cid].push({ url: e.fullUrl, thumb: e.thumbUrl, wallId: e.wallId });
                changed = true;
            }
        });
        if (changed) localStorage.setItem('wh_char_gallery', JSON.stringify(store));
    } catch { /* non-critical, gallery still renders without vault data */ }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API GALLERY SYNC — fetch non-hidden images from api.trap.lol for each char
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MEDIA_API_BASE = 'https://api.trap.lol';

// Returns array of {thumbnail, medium, original} for a char — non-hidden only.
// Falls back to [] on any error (public endpoint, no auth needed).
async function fetchApiGallery(charId) {
    try {
        const r = await fetch(`${MEDIA_API_BASE}/pallet/data/gallery/${encodeURIComponent(charId)}.json`);
        if (!r.ok) return [];
        const items = await r.json();
        return Array.isArray(items) ? items : [];
    } catch { return []; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BOOT — load all images
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function boot() {
    showLoading(true);
    await syncVaultToGallery();
    S.chars = getCharData();
    populateCharTarget();
    buildCharRoster();

    const allItems = [];
    const baseTs = Date.now();
    let seqOffset = 0;
    await Promise.all(S.chars.map(async (ch, chIdx) => {
        // Fetch API gallery in parallel with local data
        const apiItems = await fetchApiGallery(ch.id);

        // Build a set of all URLs already known locally (to deduplicate)
        const knownUrls = new Set([
            ch.avatarRef,
            ...ch.galleryRefs,
            // also include resolved wh proxy variants
            ...[...ch._whFullMap?.values() || []],
        ].filter(Boolean));

        // Deduplicate: if avatarRef appears in galleryRefs, don't show it twice
        const galleryOnly = ch.galleryRefs.filter(r => r !== ch.avatarRef);
        const allRefs = [ch.avatarRef, ...galleryOnly].filter(Boolean);
        await Promise.all(allRefs.map(async (ref, i) => {
            const url = await resolveUrl(ref);
            if (!url) return;
            const isAvatar = ref === ch.avatarRef;
            const localOffset = seqOffset++;
            // For wallhaven items, fullUrl is the proxied full-res; otherwise same as url
            const fullUrl = ch._whFullMap?.get(ref) || ch._whFullMap?.get(url) || url;
            allItems.push({
                url,
                fullUrl,
                ref,
                type:     'image',
                charId:   ch.id,
                charName: ch.name,
                charIdx:  chIdx,
                idx:      i,
                isAvatar,
                ts:       baseTs - chIdx * 10000 - localOffset,
                tags:     ch.galleryMeta[ref]?.tags || [],
                source:   'local',
            });
        }));

        // Add API images not already present locally
        for (const item of apiItems) {
            const displayUrl = item.medium || item.original || item.thumbnail;
            const fullUrl    = item.original || item.medium || item.thumbnail;
            const thumbUrl   = item.thumbnail || displayUrl;
            if (!displayUrl) continue;
            // Skip if the URL (or its thumbnail) is already known locally
            if (knownUrls.has(displayUrl) || knownUrls.has(fullUrl) || knownUrls.has(thumbUrl)) continue;
            knownUrls.add(displayUrl);
            allItems.push({
                url:      displayUrl,
                fullUrl:  fullUrl,
                ref:      displayUrl,
                type:     'image',
                charId:   ch.id,
                charName: ch.name,
                charIdx:  chIdx,
                idx:      seqOffset,
                isAvatar: false,
                ts:       baseTs - chIdx * 10000 - seqOffset++,
                tags:     [],
                source:   'api',
            });
        }

        // Add videos
        ch.videoRefs.forEach((ref, i) => {
            allItems.push({
                url:     ref,
                ref,
                type:    'video',
                charId:  ch.id,
                charName: ch.name,
                charIdx: chIdx,
                idx:     allRefs.length + i,
                isAvatar: false,
                ts:      baseTs - chIdx * 10000 - seqOffset++,
                tags:    [],
                source:  'local',
            });
        });
    }));

    S.items = allItems;
    buildTagRoster();
    updateStats();
    showLoading(false);

    // Apply ?char=id URL param to pre-filter to a specific character
    const _bootChar = new URLSearchParams(location.search).get('char');
    if (_bootChar && S.chars.find(c => c.id === _bootChar)) {
        S.filterChar = _bootChar;
        // Highlight the chip once the roster has rendered
        requestAnimationFrame(() => {
            qsa('.char-chip').forEach(b => b.classList.toggle('char-chip--active', b.dataset.charId === _bootChar));
            const count = qs('#char-filter-count');
            if (count) count.textContent = '1 active';
        });
    }

    render();
}

function showLoading(on) {
    qs('#vault-loading').hidden = !on;
    qs('#vault-grid').hidden    = on;
    qs('#vault-timeline').hidden = on;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SIDEBAR — character roster + tag roster
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function buildCharRoster() {
    const $roster = qs('#char-roster');
    if (!$roster) return;

    const items = [];
    for (const ch of S.chars) {
        const count = [ch.avatarRef, ...ch.galleryRefs, ...ch.videoRefs].filter(Boolean).length;
        if (!count) continue;
        let avatarUrl = null;
        if (ch.avatarRef) avatarUrl = await resolveUrl(ch.avatarRef);
        items.push({ ch, count, avatarUrl });
    }

    if (!items.length) {
        $roster.innerHTML = `<div class="char-roster__empty">No characters with images</div>`;
        return;
    }

    $roster.innerHTML = items.map(({ ch, count, avatarUrl }) => `
        <button class="char-chip${S.filterChar === ch.id ? ' char-chip--active' : ''}" data-char-id="${esc(ch.id)}">
            <div class="char-chip__avatar">
                ${avatarUrl
                    ? `<img src="${esc(avatarUrl)}" alt="${esc(ch.name)}" class="char-chip__img">`
                    : `<span class="char-chip__initial">${esc(ch.name.slice(0, 1))}</span>`}
            </div>
            <span class="char-chip__name">${esc(ch.name)}</span>
            <span class="char-chip__count">${count}</span>
        </button>`).join('');

    qsa('.char-chip', $roster).forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.charId;
            S.filterChar = S.filterChar === id ? '' : id;
            qsa('.char-chip', $roster).forEach(b => b.classList.toggle('char-chip--active', b.dataset.charId === S.filterChar));
            qs('#char-filter-count').textContent = S.filterChar ? '1 active' : '';
            render();
        });
    });
}

function buildTagRoster() {
    const allTags = [...new Set(S.items.flatMap(it => it.tags))].sort();
    const $section = qs('#tag-section');
    const $roster  = qs('#tag-roster');
    if (!allTags.length || !$section || !$roster) { if ($section) $section.hidden = true; return; }
    $section.hidden = false;
    $roster.innerHTML = allTags.map(t => `
        <button class="tag-chip${S.filterTags.has(t) ? ' tag-chip--active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>
    `).join('');
    qsa('.tag-chip', $roster).forEach(btn => {
        btn.addEventListener('click', () => {
            const tag = btn.dataset.tag;
            if (S.filterTags.has(tag)) S.filterTags.delete(tag); else S.filterTags.add(tag);
            btn.classList.toggle('tag-chip--active', S.filterTags.has(tag));
            render();
        });
    });
}

function populateCharTarget() {
    const $sel = qs('#vault-char-target');
    if (!$sel) return;
    S.chars.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch.id;
        opt.textContent = ch.name;
        $sel.appendChild(opt);
    });
}

function updateStats() {
    const total = S.items.length;
    const chars = new Set(S.items.map(it => it.charId)).size;
    qs('#stat-total').textContent = `${total} image${total !== 1 ? 's' : ''}`;
    qs('#stat-chars').textContent = `${chars} character${chars !== 1 ? 's' : ''}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILTER + SORT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getFilteredItems() {
    let items = S.items.slice();

    if (S.filterChar)      items = items.filter(it => it.charId === S.filterChar);
    if (S.filterTags.size) items = items.filter(it => [...S.filterTags].every(t => it.tags.includes(t)));
    if (S.search) {
        const q = S.search.toLowerCase();
        items = items.filter(it => it.charName.toLowerCase().includes(q));
    }

    if (S.sort === 'newest')    items.sort((a, b) => b.ts - a.ts);
    else if (S.sort === 'oldest') items.sort((a, b) => a.ts - b.ts);
    else if (S.sort === 'character') items.sort((a, b) => a.charIdx - b.charIdx || a.idx - b.idx);

    return items;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RENDER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function render() {
    const filtered = getFilteredItems();
    S.lbItems = filtered;

    const $empty   = qs('#vault-empty');
    const $noRes   = qs('#vault-no-results');
    const $grid    = qs('#vault-grid');
    const $tl      = qs('#vault-timeline');

    // Edge cases
    if (!S.items.length) {
        $empty.hidden = false; $noRes.hidden = true;
        $grid.hidden = true; $tl.hidden = true;
        return;
    }
    $empty.hidden = true;

    if (!filtered.length) {
        $noRes.hidden = false; $grid.hidden = true; $tl.hidden = true;
        return;
    }
    $noRes.hidden = true;

    if (S.view === 'timeline') {
        $grid.hidden = true; $tl.hidden = false;
        renderTimeline(filtered, $tl);
    } else {
        $tl.hidden = true; $grid.hidden = false;
        $grid.className = `vault-grid vault-grid--${S.view}`;
        renderGrid(filtered, $grid);
    }
}

function renderGrid(items, $grid) {
    $grid.innerHTML = '';
    items.forEach((item, i) => {
        const $tile = document.createElement('div');
        const isVideo = item.type === 'video';
        $tile.className = `vault-tile${item.isAvatar ? ' vault-tile--avatar' : ''}${isVideo ? ' vault-tile--video' : ''}`;
        $tile.dataset.i = i;

        const tagHtml = item.tags.length
            ? item.tags.map(t => `<span class="vault-tile__tag">${esc(t)}</span>`).join('')
            : '';
        $tile.innerHTML = `
            <div class="vault-tile__img-wrap">
                ${isVideo
                    ? `<div class="vault-tile__video-thumb"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>`
                    : `<img src="${esc(item.url)}" alt="${esc(item.charName)}" class="vault-tile__img" loading="lazy" draggable="false">`}
                ${item.isAvatar ? '<div class="vault-tile__avatar-badge"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>' : ''}
                <div class="vault-tile__overlay">
                    <div class="vault-tile__char-label">${esc(item.charName)}</div>
                    ${tagHtml ? `<div class="vault-tile__tags">${tagHtml}</div>` : ''}
                    <div class="vault-tile__actions">
                        <button class="vault-tile__btn" data-action="open" title="${isVideo ? 'Play' : 'Open'}"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg></button>
                        <button class="vault-tile__btn" data-action="dl" title="Download"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg></button>
                        ${!item.isAvatar && item.source !== 'api' ? `<button class="vault-tile__btn vault-tile__btn--del" data-action="del" title="Delete"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>` : ''}
                    </div>
                </div>
            </div>`;
        if (!isVideo) $tile.querySelector('.vault-tile__img').addEventListener('error', () => { $tile.style.display = 'none'; });

        $tile.querySelector('[data-action="open"]').addEventListener('click', e => { e.stopPropagation(); openLightbox(i); });
        $tile.querySelector('[data-action="dl"]').addEventListener('click',   e => { e.stopPropagation(); downloadItem(item); });
        const $del = $tile.querySelector('[data-action="del"]');
        if ($del) $del.addEventListener('click', e => { e.stopPropagation(); deleteItem(item); });
        $tile.querySelector('.vault-tile__img-wrap').addEventListener('click', () => openLightbox(i));

        $grid.appendChild($tile);
    });
}

function renderTimeline(items, $tl) {
    // Group by charId preserving sort order
    const groups = new Map();
    items.forEach(item => {
        if (!groups.has(item.charId)) groups.set(item.charId, []);
        groups.get(item.charId).push(item);
    });

    $tl.innerHTML = '';
    for (const [charId, charItems] of groups) {
        const ch = S.chars.find(c => c.id === charId);
        if (!ch) continue;

        const $section = document.createElement('div');
        $section.className = 'vault-tl-section';
        $section.innerHTML = `
            <div class="vault-tl-header">
                <div class="vault-tl-header__name">${esc(ch.name)}</div>
                <div class="vault-tl-header__count">${charItems.length} item${charItems.length !== 1 ? 's' : ''}</div>
            </div>
            <div class="vault-tl-row"></div>`;

        const $row = $section.querySelector('.vault-tl-row');
        const baseIdx = items.indexOf(charItems[0]);
        charItems.forEach((item, localI) => {
            const $tile = document.createElement('div');
            const isVideo = item.type === 'video';
            $tile.className = `vault-tl-tile${item.isAvatar ? ' vault-tl-tile--avatar' : ''}${isVideo ? ' vault-tl-tile--video' : ''}`;
            $tile.innerHTML = isVideo
                ? `<div class="vault-tile__video-thumb"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>`
                : `<img src="${esc(item.url)}" alt="${esc(item.charName)}" class="vault-tl-tile__img" loading="lazy" onerror="this.closest('.vault-tl-tile').style.display='none'">`;
            $tile.addEventListener('click', () => openLightbox(baseIdx + localI));
            $row.appendChild($tile);
        });

        $tl.appendChild($section);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIGHTBOX TRANSFORM ENGINE (zoom / pan / rotate)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const LBT = { scale: 1, tx: 0, ty: 0, rot: 0 };
const LBT_MIN = 0.25, LBT_MAX = 8;
let _zoomPillTimer = null;

function lbtApply(transition = true) {
    const $img = qs('#lb-img');
    if (!$img) return;
    if (transition) { $img.classList.remove('lb-no-transition'); }
    else            { $img.classList.add('lb-no-transition'); }
    $img.style.transform = `translate(${LBT.tx}px, ${LBT.ty}px) rotate(${LBT.rot}deg) scale(${LBT.scale})`;
    lbtShowZoomPill();
    const $hint = qs('#lb-kb-hint');
    if ($hint) {
        $hint.textContent = LBT.scale > 1
            ? '← → ↑ ↓ pan · 0 reset · Esc close'
            : '← → navigate · R rotate · Esc close';
    }
}

function lbtReset(transition = true) {
    LBT.scale = 1; LBT.tx = 0; LBT.ty = 0; LBT.rot = 0;
    lbtApply(transition);
}

function lbtShowZoomPill() {
    const $pill = qs('#lb-zoom-pill');
    if (!$pill) return;
    $pill.textContent = `${Math.round(LBT.scale * 100)}%${LBT.rot ? ` · ${LBT.rot}°` : ''}`;
    $pill.classList.add('lb-zoom-pill--visible');
    clearTimeout(_zoomPillTimer);
    _zoomPillTimer = setTimeout(() => $pill.classList.remove('lb-zoom-pill--visible'), 1800);
}

function lbtZoomAt(delta, cx, cy) {
    // cx/cy are coordinates relative to the img-wrap element
    const $wrap = qs('#lb-img-wrap');
    const rect  = $wrap.getBoundingClientRect();
    const px = cx - rect.left - rect.width  / 2;
    const py = cy - rect.top  - rect.height / 2;

    const newScale = Math.min(LBT_MAX, Math.max(LBT_MIN, LBT.scale * delta));
    const ratio = newScale / LBT.scale;
    LBT.tx = px + (LBT.tx - px) * ratio;
    LBT.ty = py + (LBT.ty - py) * ratio;
    LBT.scale = newScale;
    lbtApply(false);
}

function lbtClampPan() {
    // When scale <= 1 snap back to center
    if (LBT.scale <= 1) { LBT.tx = 0; LBT.ty = 0; }
}

// ── Wheel zoom ──
function _onWheel(e) {
    if (qs('#vault-lb').hidden) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    lbtZoomAt(factor, e.clientX, e.clientY);
}

// ── Drag pan ──
let _drag = { active: false, sx: 0, sy: 0, tx0: 0, ty0: 0 };
function _onMouseDown(e) {
    if (e.button !== 0) return;
    _drag.active = true;
    _drag.sx = e.clientX; _drag.sy = e.clientY;
    _drag.tx0 = LBT.tx;   _drag.ty0 = LBT.ty;
    qs('#lb-img-wrap').classList.add('lb-dragging');
    qs('#lb-img').classList.add('lb-no-transition');
}
function _onMouseMove(e) {
    if (!_drag.active) return;
    LBT.tx = _drag.tx0 + (e.clientX - _drag.sx);
    LBT.ty = _drag.ty0 + (e.clientY - _drag.sy);
    lbtApply(false);
}
function _onMouseUp() {
    if (!_drag.active) return;
    _drag.active = false;
    qs('#lb-img-wrap').classList.remove('lb-dragging');
    lbtClampPan();
    lbtApply(true);
}

// ── Pinch zoom ──
let _pinch = { active: false, dist0: 0, scale0: 1, cx: 0, cy: 0 };
function _pinchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
}
function _onTouchStart(e) {
    if (e.touches.length === 2) {
        _pinch.active = true;
        _pinch.dist0  = _pinchDist(e.touches);
        _pinch.scale0 = LBT.scale;
        _pinch.cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        _pinch.cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
}
function _onTouchMove(e) {
    if (_pinch.active && e.touches.length === 2) {
        e.preventDefault();
        const dist = _pinchDist(e.touches);
        const newScale = Math.min(LBT_MAX, Math.max(LBT_MIN, _pinch.scale0 * (dist / _pinch.dist0)));
        const ratio = newScale / LBT.scale;
        const $wrap = qs('#lb-img-wrap');
        const rect  = $wrap.getBoundingClientRect();
        const px = _pinch.cx - rect.left - rect.width  / 2;
        const py = _pinch.cy - rect.top  - rect.height / 2;
        LBT.tx = px + (LBT.tx - px) * ratio;
        LBT.ty = py + (LBT.ty - py) * ratio;
        LBT.scale = newScale;
        lbtApply(false);
    }
}
function _onTouchEnd() {
    if (_pinch.active) {
        _pinch.active = false;
        lbtClampPan();
        lbtApply(true);
    }
}

// ── Double-click reset ──
function _onDblClick() { lbtReset(true); }

// Wire transform events once (called from wire())
function wireTransform() {
    const $wrap = qs('#lb-img-wrap');
    $wrap.addEventListener('wheel',      _onWheel,    { passive: false });
    $wrap.addEventListener('mousedown',  _onMouseDown);
    document.addEventListener('mousemove', _onMouseMove);
    document.addEventListener('mouseup',   _onMouseUp);
    $wrap.addEventListener('touchstart',  _onTouchStart, { passive: true });
    $wrap.addEventListener('touchmove',   _onTouchMove,  { passive: false });
    $wrap.addEventListener('touchend',    _onTouchEnd,   { passive: true });
    $wrap.addEventListener('dblclick',    _onDblClick);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIGHTBOX
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let _lbLoadToken = 0;

function openLightbox(idx) {
    S.lbIndex = Math.max(0, Math.min(S.lbItems.length - 1, idx));
    qs('#vault-lb').hidden = false;
    document.body.classList.add('lb-open');
    lbtReset(false); // reset transform without animation on open
    renderLightbox();
}
function closeLightbox() {
    ++_lbLoadToken; // cancel any in-flight full-res preload
    const $vid = qs('#lb-vid');
    if ($vid) { $vid.pause(); $vid.src = ''; }
    qs('#vault-lb').hidden = true;
    document.body.classList.remove('lb-open');
    _drag.active = false;
    _pinch.active = false;
}
function renderLightbox() {
    const item = S.lbItems[S.lbIndex];
    if (!item) return;
    lbtReset(false);
    const $wrap = qs('#lb-img-wrap');
    // Swap between img and video based on item type
    let $img = qs('#lb-img');
    let $vid = qs('#lb-vid');
    if (item.type === 'video') {
        if ($img) $img.style.display = 'none';
        if (!$vid) {
            $vid = document.createElement('video');
            $vid.id = 'lb-vid'; $vid.className = 'vault-lb__img';
            $vid.controls = true; $vid.autoplay = false; $vid.loop = true;
            $wrap.insertBefore($vid, $wrap.firstChild);
        }
        $vid.style.display = '';
        $vid.src = item.url;
    } else {
        if ($vid) { $vid.pause(); $vid.src = ''; $vid.style.display = 'none'; }
        if ($img) $img.style.display = '';
        $img = $img || qs('#lb-img');
        $img.onerror = null;
        // Load thumbnail immediately, then swap to full-res if different
        const thumbUrl = item.url;
        const fullUrl  = item.fullUrl || item.url;
        $img.src = thumbUrl;
        $img.classList.toggle('vault-lb__img--loading', thumbUrl !== fullUrl);
        if (thumbUrl !== fullUrl) {
            const token = ++_lbLoadToken;
            const preload = new Image();
            preload.onload = () => {
                if (token !== _lbLoadToken) return; // navigated away
                $img.src = fullUrl;
                $img.classList.remove('vault-lb__img--loading');
            };
            preload.onerror = () => $img.classList.remove('vault-lb__img--loading');
            preload.src = fullUrl;
        }
        $img.onerror = () => {
            $img.classList.remove('vault-lb__img--loading');
            const dir = S.lbIndex < S.lbItems.length - 1 ? 1 : -1;
            const next = S.lbIndex + dir;
            if (next >= 0 && next < S.lbItems.length) { S.lbIndex = next; renderLightbox(); }
            else closeLightbox();
        };
    }
    const $ti = qs('#lb-tag-input');
    if ($ti) $ti.value = '';

    qs('#lb-counter').textContent = `${S.lbIndex + 1} / ${S.lbItems.length}`;
    qs('#lb-char-pill').textContent = item.charName;
    qs('#lb-prev').disabled = S.lbIndex <= 0;
    qs('#lb-next').disabled = S.lbIndex >= S.lbItems.length - 1;

    const $setAv = qs('#lb-set-avatar');
    $setAv.disabled = item.isAvatar;
    $setAv.title = item.isAvatar ? 'Already the avatar' : 'Set as character avatar';

    const $del = qs('#lb-delete');
    $del.disabled = item.isAvatar;
    $del.title = item.isAvatar ? 'Cannot delete avatar image' : 'Remove from gallery';

    renderLbTags(item);
}
function renderLbTags(item) {
    const $tags = qs('#lb-tags');
    $tags.innerHTML = item.tags.map(t =>
        `<span class="lb-tag">${esc(t)}<button class="lb-tag__rm" data-rmtag="${esc(t)}">×</button></span>`
    ).join('');
    qsa('.lb-tag__rm', $tags).forEach(btn => {
        btn.addEventListener('click', () => removeTagFromItem(item, btn.dataset.rmtag));
    });
}

function lbNav(dir) {
    const next = S.lbIndex + dir;
    if (next < 0 || next >= S.lbItems.length) return;
    S.lbIndex = next;
    renderLightbox();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ACTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function downloadItem(item) {
    const a = document.createElement('a');
    a.href = item.url;
    a.download = `${slug(item.charName)}-${String(item.idx + 1).padStart(3, '0')}.png`;
    a.click();
}

async function deleteItem(item) {
    if (item.isAvatar) { showToast('Cannot delete the avatar image — change avatar first', 'warn'); return; }
    if (item.source === 'api') { showToast('API images are managed from the admin panel', 'warn'); return; }
    const label = item.type === 'video' ? 'video' : 'image';
    if (!confirm(`Remove this ${label} from ${item.charName}'s gallery?`)) return;

    const ch = S.chars.find(c => c.id === item.charId);
    if (!ch) return;

    if (item.type === 'video') {
        const vidIdx = ch.videoRefs.indexOf(item.ref);
        if (vidIdx === -1) return;
        ch.videoRefs.splice(vidIdx, 1);
        saveVideoRefs(ch.id, ch.videoRefs);
    } else {
        const idx = ch.galleryRefs.indexOf(item.ref);
        if (idx === -1) return;
        if (isIdbRef(item.ref)) await idbDelete(`img:${idbRefId(item.ref)}`).catch(() => {});
        if (ch.galleryMeta[item.ref]) delete ch.galleryMeta[item.ref];
        ch.galleryRefs.splice(idx, 1);
        // Remove from wh_char_gallery if it was a wallhaven-assigned ref (match by thumb or full URL)
        try {
            const whKey = 'wh_char_gallery';
            let whStore; try { whStore = JSON.parse(localStorage.getItem(whKey) || '{}'); } catch { whStore = {}; }
            if (Array.isArray(whStore[ch.id])) {
                whStore[ch.id] = whStore[ch.id].filter(e => {
                    if (typeof e === 'string') return e !== item.ref && whProxyUrl(e) !== item.ref;
                    const tProxy = whProxyUrl(e.thumb);
                    return e.thumb !== item.ref && tProxy !== item.ref && e.url !== item.ref;
                });
                if (!whStore[ch.id].length) delete whStore[ch.id];
                localStorage.setItem(whKey, JSON.stringify(whStore));
            }
        } catch { /* ignore */ }
        // saveGallery filters wh URLs automatically — pass the full merged refs
        saveGallery(ch.id, ch.galleryRefs, ch.galleryMeta);
    }

    // Remove from S.items and re-render
    const siIdx = S.items.findIndex(it => it.ref === item.ref && it.charId === item.charId);
    if (siIdx !== -1) S.items.splice(siIdx, 1);
    updateStats();
    render();
    if (!S.lbItems.length) { closeLightbox(); }
    else {
        S.lbIndex = Math.min(S.lbIndex, S.lbItems.length - 1);
        renderLightbox();
    }
    showToast('Image removed', 'success');
}

function setAsAvatar(item) {
    if (item.isAvatar) return;
    const ch = S.chars.find(c => c.id === item.charId);
    if (!ch) return;

    // Move old avatar into gallery front, move this ref to avatar
    if (ch.avatarRef) {
        const oldIdx = ch.galleryRefs.indexOf(ch.avatarRef);
        if (oldIdx === -1) ch.galleryRefs.unshift(ch.avatarRef);
    }
    const thisIdx = ch.galleryRefs.indexOf(item.ref);
    if (thisIdx !== -1) ch.galleryRefs.splice(thisIdx, 1);
    ch.avatarRef = item.ref;

    saveGallery(ch.id, ch.galleryRefs, ch.galleryMeta);
    saveAvatar(ch.id, item.ref);

    // Update S.items flags
    S.items.forEach(it => {
        if (it.charId === item.charId) it.isAvatar = (it.ref === item.ref);
    });

    render();
    if (!qs('#vault-lb').hidden) {
        S.lbItems = getFilteredItems();
        // Re-find the same image by ref so the index stays on the correct item
        const newIdx = S.lbItems.findIndex(it => it.ref === item.ref && it.charId === item.charId);
        S.lbIndex = newIdx !== -1 ? newIdx : Math.min(S.lbIndex, S.lbItems.length - 1);
        renderLightbox();
    }
    showToast(`Avatar updated for ${item.charName}`, 'success');
}

function addTagToItem(item, tag) {
    if (!tag) return;
    const clean = tag.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 20);
    if (!clean) return;
    const ch = S.chars.find(c => c.id === item.charId);
    if (!ch) return;
    if (!ch.galleryMeta[item.ref]) ch.galleryMeta[item.ref] = { tags: [] };
    if (!ch.galleryMeta[item.ref].tags.includes(clean)) {
        ch.galleryMeta[item.ref].tags.push(clean);
        item.tags = ch.galleryMeta[item.ref].tags;
        saveGallery(ch.id, ch.galleryRefs, ch.galleryMeta);
        buildTagRoster();
        renderLbTags(item);
    }
}

function removeTagFromItem(item, tag) {
    const ch = S.chars.find(c => c.id === item.charId);
    if (!ch || !ch.galleryMeta[item.ref]) return;
    ch.galleryMeta[item.ref].tags = ch.galleryMeta[item.ref].tags.filter(t => t !== tag);
    item.tags = ch.galleryMeta[item.ref].tags;
    saveGallery(ch.id, ch.galleryRefs, ch.galleryMeta);
    buildTagRoster();
    renderLbTags(item);
}

async function addImageToChar(charId, dataUrlOrRef) {
    if (!charId) { showToast('Select a character first', 'warn'); return; }
    const ch = S.chars.find(c => c.id === charId);
    if (!ch) return;

    let ref = dataUrlOrRef;
    if (isDataUrl(dataUrlOrRef)) {
        // Mirror what gallery.js does — save to IDB
        const blobId = `gallery-${charId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        try {
            const db = await openDB();
            await new Promise((resolve, reject) => {
                const req = db.transaction('blobs', 'readwrite').objectStore('blobs').put(dataUrlOrRef, `img:${blobId}`);
                req.onsuccess = () => resolve();
                req.onerror   = e => reject(e.target.error);
            });
            ref = `idb:img:${blobId}`;
        } catch { ref = dataUrlOrRef; }
    }

    if (!ch.galleryRefs.includes(ref)) {
        ch.galleryRefs.push(ref);
        saveGallery(ch.id, ch.galleryRefs, ch.galleryMeta);
        const url = await resolveUrl(ref);
        if (url) {
            S.items.push({ url, ref, charId: ch.id, charName: ch.name, charIdx: S.chars.indexOf(ch), idx: ch.galleryRefs.length - 1, isAvatar: false, ts: Date.now(), tags: [] });
            updateStats();
            render();
        }
        showToast('Image added', 'success');
    } else {
        showToast('Already in gallery', 'info');
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOAST
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function showToast(msg, type = 'info') {
    const $c = qs('#vault-toasts');
    const $t = document.createElement('div');
    $t.className = `vault-toast vault-toast--${type}`;
    $t.textContent = msg;
    $c.appendChild($t);
    requestAnimationFrame(() => $t.classList.add('vault-toast--in'));
    setTimeout(() => { $t.classList.remove('vault-toast--in'); setTimeout(() => $t.remove(), 300); }, 3000);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EVENT WIRING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function wire() {
    // View switcher
    qsa('.vv-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            S.view = btn.dataset.view;
            qsa('.vv-btn').forEach(b => b.classList.toggle('active', b === btn));
            render();
        });
    });

    // Sort
    qs('#vault-sort').addEventListener('change', e => {
        S.sort = e.target.value;
        render();
    });

    // Search
    const $search = qs('#vault-search');
    const $clearBtn = qs('#vault-search-clear');
    $search.addEventListener('input', () => {
        S.search = $search.value;
        $clearBtn.hidden = !$search.value;
        render();
    });
    $clearBtn.addEventListener('click', () => {
        $search.value = ''; S.search = ''; $clearBtn.hidden = true;
        render();
    });

    // Clear all filters
    qs('#clear-all-filters')?.addEventListener('click', () => {
        S.filterChar = ''; S.filterTags.clear(); S.search = '';
        qs('#vault-search').value = '';
        qs('#vault-search-clear').hidden = true;
        qs('#char-filter-count').textContent = '';
        qsa('.char-chip').forEach(b => b.classList.remove('char-chip--active'));
        qsa('.tag-chip').forEach(b => b.classList.remove('tag-chip--active'));
        render();
    });

    // Lightbox nav
    qs('#lb-close').addEventListener('click', closeLightbox);
    qs('#lb-backdrop').addEventListener('click', closeLightbox);
    qs('#lb-prev').addEventListener('click', () => lbNav(-1));
    qs('#lb-next').addEventListener('click', () => lbNav(1));

    qs('#lb-rotate').addEventListener('click', () => {
        LBT.rot = (LBT.rot + 90) % 360; lbtApply(true);
    });
    qs('#lb-zoom-reset').addEventListener('click', () => lbtReset(true));
    qs('#lb-download').addEventListener('click', () => {
        const item = S.lbItems[S.lbIndex];
        if (item) downloadItem(item);
    });
    qs('#lb-set-avatar').addEventListener('click', () => {
        const item = S.lbItems[S.lbIndex];
        if (item) setAsAvatar(item);
    });
    qs('#lb-delete').addEventListener('click', () => {
        const item = S.lbItems[S.lbIndex];
        if (item) deleteItem(item);
    });
    // Inline tag input
    const $tagInput   = qs('#lb-tag-input');
    const $tagConfirm = qs('#lb-tag-confirm');
    function commitTag() {
        const item = S.lbItems[S.lbIndex];
        if (!item) return;
        const val = $tagInput.value.trim();
        if (val) addTagToItem(item, val);
        $tagInput.value = '';
    }
    $tagConfirm.addEventListener('click', commitTag);
    $tagInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commitTag(); }
        e.stopPropagation(); // prevent lightbox keyboard shortcuts while typing
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        // Guard: only act when lightbox is open and no text input is focused
        if (qs('#vault-lb').hidden) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'Escape') {
            // Escape resets zoom first if zoomed, then closes
            if (LBT.scale !== 1 || LBT.rot !== 0) { lbtReset(true); return; }
            closeLightbox(); return;
        }
        if (e.key === 'ArrowLeft' || ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey)) {
            if (LBT.scale <= 1) { lbNav(-1); return; }
            // Zoomed in: pan instead
            LBT.tx += 60; lbtClampPan(); lbtApply(true); return;
        }
        if (e.key === 'ArrowRight' || (e.key === 'd' && !e.shiftKey && !e.ctrlKey && !e.metaKey) || (e.key === 'D' && !e.shiftKey && !e.ctrlKey && !e.metaKey)) {
            if (LBT.scale <= 1) { lbNav(1); return; }
            LBT.tx -= 60; lbtClampPan(); lbtApply(true); return;
        }
        if (e.key === 'ArrowUp') {
            if (LBT.scale > 1) { LBT.ty += 60; lbtApply(true); } return;
        }
        if (e.key === 'ArrowDown') {
            if (LBT.scale > 1) { LBT.ty -= 60; lbtApply(true); } return;
        }
        if (e.key === '+' || e.key === '=') {
            const $wrap = qs('#lb-img-wrap'); const rect = $wrap.getBoundingClientRect();
            lbtZoomAt(1.2, rect.left + rect.width / 2, rect.top + rect.height / 2); return;
        }
        if (e.key === '-') {
            const $wrap = qs('#lb-img-wrap'); const rect = $wrap.getBoundingClientRect();
            lbtZoomAt(1 / 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2); return;
        }
        if (e.key === '0') { lbtReset(true); return; }
        if (e.key === 'r' || e.key === 'R') {
            LBT.rot = (LBT.rot + 90) % 360; lbtApply(true); return;
        }
        if ((e.key === 'D' || e.key === 'd') && e.shiftKey) {
            const item = S.lbItems[S.lbIndex]; if (item) downloadItem(item);
            return;
        }
    });

    // Touch swipe on lightbox (single-finger only — pinch is handled by wireTransform)
    let _sx = 0, _swipeActive = false;
    qs('#vault-lb').addEventListener('touchstart', e => {
        if (e.touches.length !== 1) { _swipeActive = false; return; }
        _sx = e.touches[0].clientX;
        _swipeActive = true;
    }, { passive: true });
    qs('#vault-lb').addEventListener('touchend', e => {
        if (!_swipeActive || LBT.scale > 1) return; // don't swipe-navigate when zoomed
        const dx = e.changedTouches[0].clientX - _sx;
        if (Math.abs(dx) > 50) lbNav(dx < 0 ? 1 : -1);
        _swipeActive = false;
    }, { passive: true });

    // File upload (sidebar add zone)
    const $zone = qs('#vault-add-zone');
    const $fileInput = qs('#vault-file-input');
    $zone.addEventListener('click', () => $fileInput.click());
    $zone.addEventListener('dragover', e => { e.preventDefault(); $zone.classList.add('vault-add-zone--drag'); });
    $zone.addEventListener('dragleave', () => $zone.classList.remove('vault-add-zone--drag'));
    $zone.addEventListener('drop', e => {
        e.preventDefault(); $zone.classList.remove('vault-add-zone--drag');
        handleFiles([...e.dataTransfer.files]);
    });
    $fileInput.addEventListener('change', e => {
        handleFiles([...e.target.files]);
        e.target.value = '';
    });

    // URL add
    qs('#vault-url-add').addEventListener('click', () => {
        const $input = qs('#vault-url-input');
        const url = $input.value.trim();
        if (!url) return;
        try { new URL(url); } catch { showToast('Invalid URL', 'error'); return; }
        const charId = qs('#vault-char-target').value;
        addImageToChar(charId, url);
        $input.value = '';
    });
    qs('#vault-url-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') qs('#vault-url-add').click();
    });
}

async function handleFiles(files) {
    const charId = qs('#vault-char-target').value;
    if (!charId) { showToast('Select a character first', 'warn'); return; }
    let added = 0;
    for (const file of files) {
        if (!file.type.startsWith('image/')) { showToast(`${file.name}: not an image`, 'error'); continue; }
        if (file.size > 10 * 1024 * 1024)    { showToast(`${file.name} exceeds 10 MB`, 'error'); continue; }
        const dataUrl = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload  = ev => res(ev.target.result);
            r.onerror = ()  => rej();
            r.readAsDataURL(file);
        }).catch(() => null);
        if (!dataUrl) continue;
        await addImageToChar(charId, dataUrl);
        added++;
    }
    if (added) showToast(`${added} image${added !== 1 ? 's' : ''} added`, 'success');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CROSS-TAB SYNC — live-reload when wallhaven assigns images in another tab
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let _syncDebounce = null;
window.addEventListener('storage', e => {
    if (e.key !== 'wh_char_gallery' && e.key !== 'underdark_chars_v4') return;
    clearTimeout(_syncDebounce);
    _syncDebounce = setTimeout(async () => {
        // Reload char data and merge new items without full page refresh
        const fresh = getCharData();
        fresh.forEach(freshCh => {
            const existing = S.chars.find(c => c.id === freshCh.id);
            if (!existing) return;
            const newRefs = freshCh.galleryRefs.filter(r => !existing.galleryRefs.includes(r));
            if (!newRefs.length) return;
            existing.galleryRefs = freshCh.galleryRefs;
            // Resolve and push new items
            newRefs.forEach(async ref => {
                const url = await resolveUrl(ref);
                if (!url) return;
                S.items.push({
                    url, ref, type: 'image',
                    charId: existing.id, charName: existing.name,
                    charIdx: S.chars.indexOf(existing),
                    idx: existing.galleryRefs.length,
                    isAvatar: false,
                    ts: Date.now(),
                    tags: [],
                });
                updateStats();
                render();
            });
        });
    }, 400);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
wire();
wireTransform();
boot();
