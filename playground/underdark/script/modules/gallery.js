/**
 * gallery.js — Gallery, Lightbox, and Social Post storage for The Underdark.
 *
 * Owns:
 *   - Character image gallery (data helpers, strip, modal, tags, export)
 *   - Video gallery (strip + modal)
 *   - Lightbox (open, render, nav, set-avatar, remove)
 *   - _saveLocalPost / _removeLocalPostBySrc (social post persistence)
 *   - getAllFeedPosts (unified post list: permanent + local)
 *
 * Call initGallery(deps) once from initUI() after the DOM is ready.
 * Exports data helpers consumed by social.js, image-studio, and ui.js directly.
 */

import { qs, qsa, esc } from './shared-utils.js?v=4';
import { state, saveState } from './state.js?v=2';
import { resolveImageUrl, saveImageBlob, deleteImageBlob, isIdbImageRef, idbImageRefId, isDataUrl } from './storage.js?v=3';

// ── Lightbox state ────────────────────────────────────────────────────────────
let lbImages = [];
let lbRefs   = [];
let lbIndex  = 0;

// ── Gallery data helpers ──────────────────────────────────────────────────────

export function getCharGallery(id) {
    return state.loadedCharacters[id]?.extensions?.underdark?.gallery || [];
}

export function getAllGalleryImages(id) {
    const meta  = state.characters.find(c => c.id === id);
    const extra = getCharGallery(id);
    return [meta?.avatar_path, ...extra].filter(Boolean);
}

/**
 * Unified post list for a character — merges permanent feed.json posts and
 * locally composed/generated posts. Gallery images are NOT included here;
 * they serve the lightbox/gallery-strip only.
 */
export function getAllFeedPosts(charId, permanentFeedPosts) {
    const seen = new Set();
    const result = [];

    (permanentFeedPosts || []).filter(p => p.charId === charId).forEach((p, i) => {
        const id = p.id || `perm-${charId}-${i}`;
        if (seen.has(id)) return;
        seen.add(id);
        result.push({ ...p, id, permanent: true, postIdx: result.length });
    });

    const localPosts = state.socialData?.localPosts?.[charId] || [];
    localPosts.forEach((p, i) => {
        const id = p.id || `local-${charId}-${i}`;
        if (seen.has(id)) return;
        seen.add(id);
        result.push({ ...p, id, permanent: false, postIdx: result.length });
    });

    return result;
}

export function ensureGalleryStore(id) {
    const char = state.loadedCharacters[id];
    if (!char) return null;
    if (!char.extensions)                    char.extensions = {};
    if (!char.extensions.underdark)          char.extensions.underdark = {};
    if (!char.extensions.underdark.gallery)      char.extensions.underdark.gallery = [];
    if (!char.extensions.underdark.galleryMeta)  char.extensions.underdark.galleryMeta = {};
    if (!char.extensions.underdark.videoGallery) char.extensions.underdark.videoGallery = [];
    return char;
}

function _getGalleryMeta(id, ref) {
    const char = ensureGalleryStore(id);
    if (!char) return { tags: [] };
    return char.extensions.underdark.galleryMeta[ref] || { tags: [] };
}

function _setGalleryMeta(id, ref, patch) {
    const char = ensureGalleryStore(id);
    if (!char) return;
    const existing = char.extensions.underdark.galleryMeta[ref] || { tags: [] };
    char.extensions.underdark.galleryMeta[ref] = { ...existing, ...patch };
    saveState();
}

// ── Social post helpers (called by addToGallery and renderGalleryModal) ────────

export function saveLocalPost(charId, { type, src, caption }) {
    if (!state.socialData.localPosts) state.socialData.localPosts = {};
    if (!state.socialData.localPosts[charId]) state.socialData.localPosts[charId] = [];
    const id = `local-${charId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    state.socialData.localPosts[charId].push({
        id, charId, type, src: src || null, caption: caption || null,
        timestamp: Date.now(), permanent: false,
    });
    saveState();
    return id;
}

export function removeLocalPostBySrc(charId, src) {
    const posts = state.socialData?.localPosts?.[charId];
    if (!posts) return;
    const idx = posts.findIndex(p => p.src === src);
    if (idx !== -1) { posts.splice(idx, 1); saveState(); }
}

// ── addToGallery ──────────────────────────────────────────────────────────────

export async function addToGallery(charId, dataUrl, { caption = null } = {}) {
    const charObj = ensureGalleryStore(charId);
    if (!charObj) return null;
    const gallery = charObj.extensions.underdark.gallery;
    if (gallery.includes(dataUrl)) return dataUrl;

    let stored;
    if (isDataUrl(dataUrl)) {
        const blobId = `gallery-${charId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const ref = await saveImageBlob(blobId, dataUrl).catch(() => null);
        stored = ref || dataUrl;
    } else {
        stored = dataUrl;
    }

    gallery.push(stored);

    const existingPost = (state.socialData?.localPosts?.[charId] || []).find(p => p.src === stored);
    if (!existingPost) saveLocalPost(charId, { type: 'image', src: stored, caption });

    saveState();
    return stored;
}

// ── Video gallery helpers ──────────────────────────────────────────────────────

export function addToVideoGallery(charId, videoUrl) {
    if (!charId || !videoUrl) return;
    const charObj = ensureGalleryStore(charId);
    if (!charObj) return;
    const vg = charObj.extensions.underdark.videoGallery;
    if (!vg.includes(videoUrl)) { vg.push(videoUrl); saveState(); }
}

export async function renderVideoStrip(id, { lucideRefresh, openVideoGalleryModal }) {
    const $wrap  = qs('#video-strip-wrap');
    const $strip = qs('#video-strip');
    if (!$wrap || !$strip) return;
    const charObj = ensureGalleryStore(id);
    const vids = charObj?.extensions?.underdark?.videoGallery || [];
    if (!vids.length) { $wrap.hidden = true; return; }
    $wrap.hidden = false;
    const last4 = vids.slice(-4).reverse();
    $strip.innerHTML = last4.map((url, i) => `
        <div class="video-strip-item" data-vi="${vids.length - 1 - i}" title="Play video">
            <div class="video-strip-item__thumb">
                <i data-lucide="clapperboard"></i>
                <span class="video-strip-item__num">${vids.length - i}</span>
            </div>
        </div>`).join('');
    qsa('.video-strip-item', $strip).forEach(el => {
        el.onclick = () => openVideoGalleryModal(id, parseInt(el.dataset.vi));
    });
    lucideRefresh($strip);
}

export function openVideoGalleryModal(id, startIdx = null, { lucideRefresh, renderVideoGalleryModal: _render }) {
    const meta = state.characters.find(c => c.id === id);
    const $t = qs('#vgallery-title');
    if ($t) $t.textContent = meta?.name || 'Character';
    _render(id, startIdx);
    qs('#modal-video-gallery').hidden = false;
    lucideRefresh(qs('#modal-video-gallery'));
}

// ── Gallery strip (profile tab) ───────────────────────────────────────────────

export async function renderGalleryStrip(id, { lucideRefresh, openGalleryModal: _openGM, openLightbox: _openLB }) {
    const $strip = qs('#gallery-strip');
    if (!$strip) return;
    const allRefs = getAllGalleryImages(id);

    if (!allRefs.length) {
        $strip.innerHTML = `
            <div class="gallery-feed-empty">
                <i data-lucide="camera"></i>
                <p>No data-shards shared yet.</p>
            </div>`;
        lucideRefresh($strip);
        return;
    }

    const resolvedUrls = await Promise.all(allRefs.map(ref => resolveImageUrl(ref)));

    $strip.innerHTML = resolvedUrls.map((src, i) =>
        src ? `<div class="gallery-feed-item" data-gi="${i}">
             <img src="${src}" loading="lazy" class="gallery-feed-img">
             ${i === 0 ? '<div class="gallery-feed-badge"><i data-lucide="star"></i></div>' : ''}
         </div>` : ''
    ).join('') + `
        <div class="gallery-feed-item gallery-feed-item--add" id="gallery-strip-add">
            <i data-lucide="plus"></i>
        </div>`;

    qsa('.gallery-feed-item:not(.gallery-feed-item--add)', $strip).forEach($t => {
        const idx = parseInt($t.dataset.gi);
        $t.addEventListener('click', () => _openLB(id, idx));
    });
    qs('#gallery-strip-add', $strip)?.addEventListener('click', () => _openGM(id));
    lucideRefresh($strip);
}

// ── Gallery modal (manage / add / remove) ─────────────────────────────────────

export function openGalleryModal(id, ctx, { lucideRefresh, renderGalleryModal: _renderGM }) {
    ctx.galleryCharId = id;
    const char = state.loadedCharacters[id];
    const meta = state.characters.find(c => c.id === id);
    const $gcn = qs('#gallery-char-name');
    if ($gcn) $gcn.textContent = char?.name || meta?.name || 'Gallery';
    _renderGM(id);
    qs('#modal-gallery').hidden = false;
    lucideRefresh(qs('#modal-gallery'));
}

// ── initGallery — wire all gallery/lightbox event listeners ──────────────────
export function initGallery(ctx, { lucideRefresh, showToast, confirm, renderRoster }) {
    // ── Video gallery modal (self-contained, no render dependency needed externally)
    function _renderVideoGalleryModal(id, playIdx = null) {
        const charObj = ensureGalleryStore(id);
        const vids = charObj?.extensions?.underdark?.videoGallery || [];
        const $count = qs('#vgallery-count');
        if ($count) $count.textContent = vids.length ? `${vids.length} video${vids.length !== 1 ? 's' : ''}` : '';

        const $grid    = qs('#vgallery-grid');
        const $player  = qs('#vgallery-player');
        const $videoEl = qs('#vgallery-video-el');

        if (!vids.length) {
            if ($grid) $grid.innerHTML = `<div class="gallery-empty"><i data-lucide="clapperboard"></i><span>No videos saved yet</span><p>Generate a video then click "Save to Gallery".</p></div>`;
            lucideRefresh($grid);
            if ($player) $player.hidden = true;
            return;
        }

        if (playIdx !== null && vids[playIdx]) {
            if ($grid) $grid.hidden = true;
            if ($player) $player.hidden = false;
            if ($videoEl) { $videoEl.src = vids[playIdx]; $videoEl.play().catch(() => {}); }
            qs('#vgallery-player-close')?.addEventListener('click', () => _renderVideoGalleryModal(id), { once: true });
            qs('#vgallery-player-dl')?.addEventListener('click', () => {
                const a = document.createElement('a');
                a.href = vids[playIdx];
                a.download = `underdark-video-${playIdx + 1}.mp4`;
                a.click();
            }, { once: true });
            qs('#vgallery-player-del')?.addEventListener('click', async () => {
                const ok = await confirm('Delete Video', 'Remove this video from the gallery?');
                if (!ok) return;
                vids.splice(playIdx, 1);
                saveState();
                _renderVideoStripInternal(id);
                _renderVideoGalleryModal(id);
            }, { once: true });
            return;
        }

        if ($player) $player.hidden = true;
        if ($grid) $grid.hidden = false;
        $grid.innerHTML = vids.map((url, i) => `
            <div class="vgallery-item" data-vgi="${i}">
                <div class="vgallery-item__thumb">
                    <i data-lucide="clapperboard"></i>
                    <span class="vgallery-item__num">${i + 1}</span>
                </div>
                <div class="gallery-item__overlay">
                    <button class="gallery-item__btn" data-play="${i}" title="Play"><i data-lucide="play"></i></button>
                    <button class="gallery-item__btn gallery-item__btn--dl" data-vdl="${i}" title="Download"><i data-lucide="download"></i></button>
                    <button class="gallery-item__btn gallery-item__btn--del" data-vdel="${i}" title="Delete"><i data-lucide="trash-2"></i></button>
                </div>
            </div>`).join('');

        qsa('[data-play]', $grid).forEach(btn => btn.onclick = () => _renderVideoGalleryModal(id, parseInt(btn.dataset.play)));
        qsa('[data-vdl]', $grid).forEach(btn => btn.onclick = () => {
            const i = parseInt(btn.dataset.vdl);
            const a = document.createElement('a');
            a.href = vids[i];
            a.download = `underdark-video-${i + 1}.mp4`;
            a.click();
        });
        qsa('[data-vdel]', $grid).forEach(btn => btn.onclick = async () => {
            const i = parseInt(btn.dataset.vdel);
            const ok = await confirm('Delete Video', 'Remove this video from the gallery?');
            if (!ok) return;
            vids.splice(i, 1);
            saveState();
            _renderVideoStripInternal(id);
            _renderVideoGalleryModal(id);
        });
        lucideRefresh($grid);
    }

    async function _renderVideoStripInternal(id) {
        const $wrap  = qs('#video-strip-wrap');
        const $strip = qs('#video-strip');
        if (!$wrap || !$strip) return;
        const charObj = ensureGalleryStore(id);
        const vids = charObj?.extensions?.underdark?.videoGallery || [];
        if (!vids.length) { $wrap.hidden = true; return; }
        $wrap.hidden = false;
        const last4 = vids.slice(-4).reverse();
        $strip.innerHTML = last4.map((url, i) => `
            <div class="video-strip-item" data-vi="${vids.length - 1 - i}" title="Play video">
                <div class="video-strip-item__thumb">
                    <i data-lucide="clapperboard"></i>
                    <span class="video-strip-item__num">${vids.length - i}</span>
                </div>
            </div>`).join('');
        qsa('.video-strip-item', $strip).forEach(el => {
            el.onclick = () => { _openVideoGalleryModal(id, parseInt(el.dataset.vi)); };
        });
        lucideRefresh($strip);
    }

    function _openVideoGalleryModal(id, startIdx = null) {
        const meta = state.characters.find(c => c.id === id);
        const $t = qs('#vgallery-title');
        if ($t) $t.textContent = meta?.name || 'Character';
        _renderVideoGalleryModal(id, startIdx);
        qs('#modal-video-gallery').hidden = false;
        lucideRefresh(qs('#modal-video-gallery'));
    }

    // ── Gallery modal renderer ────────────────────────────────────────────────
    async function _renderGalleryModal(id, tagFilter = null) {
        const $grid   = qs('#gallery-grid');
        if (!$grid) return;
        const allRefs = getAllGalleryImages(id);
        const meta    = state.characters.find(c => c.id === id);
        const charObj = ensureGalleryStore(id);

        const $title = qs('#gallery-title');
        if ($title) $title.textContent = meta?.name || 'Character';

        const $count = qs('#gallery-count');
        if ($count) $count.textContent = allRefs.length ? `${allRefs.length} image${allRefs.length !== 1 ? 's' : ''}` : '';

        const allTags = [...new Set(allRefs.flatMap(ref =>
            charObj?.extensions?.underdark?.galleryMeta?.[ref]?.tags || []
        ))].sort();

        let $filterBar = qs('#gallery-tag-filter');
        if (!$filterBar) {
            $filterBar = document.createElement('div');
            $filterBar.id = 'gallery-tag-filter';
            $filterBar.className = 'gallery-tag-filter';
            $grid.parentElement.insertBefore($filterBar, $grid);
        }
        if (allTags.length) {
            $filterBar.innerHTML = `
                <span class="gallery-tag-filter__label">Filter:</span>
                <button class="gallery-tag-chip gallery-tag-chip--filter${!tagFilter ? ' gallery-tag-chip--active' : ''}" data-filter="">All</button>
                ${allTags.map(t => `<button class="gallery-tag-chip gallery-tag-chip--filter${tagFilter === t ? ' gallery-tag-chip--active' : ''}" data-filter="${esc(t)}">${esc(t)}</button>`).join('')}`;
            $filterBar.hidden = false;
            qsa('[data-filter]', $filterBar).forEach(btn => {
                btn.onclick = () => _renderGalleryModal(id, btn.dataset.filter || null);
            });
        } else {
            $filterBar.hidden = true;
        }

        if (!allRefs.length) {
            $grid.innerHTML = `
                <div class="gallery-empty">
                    <i data-lucide="camera"></i>
                    <span>No images yet</span>
                    <p>Add images using the URL field or file upload below.</p>
                </div>`;
            lucideRefresh($grid);
            return;
        }

        const filteredRefs = tagFilter
            ? allRefs.filter(ref => {
                const tags = charObj?.extensions?.underdark?.galleryMeta?.[ref]?.tags || [];
                return tags.includes(tagFilter);
            })
            : allRefs;

        if (!filteredRefs.length) {
            $grid.innerHTML = `
                <div class="gallery-empty">
                    <i data-lucide="tag"></i>
                    <span>No images tagged "${esc(tagFilter)}"</span>
                </div>`;
            lucideRefresh($grid);
            return;
        }

        const resolvedUrls = await Promise.all(filteredRefs.map(ref => resolveImageUrl(ref)));

        $grid.innerHTML = resolvedUrls.map((src, i) => {
            if (!src) return '';
            const ref     = filteredRefs[i];
            const origIdx = allRefs.indexOf(ref);
            const isCover = origIdx === 0;
            const tags    = charObj?.extensions?.underdark?.galleryMeta?.[ref]?.tags || [];
            const tagHtml = `
                <div class="gallery-item__tags">
                    ${tags.map(t => `<span class="gallery-tag-chip gallery-tag-chip--item" data-rmtag="${esc(t)}" data-ref="${esc(ref)}">${esc(t)}<span class="gallery-tag-chip__x">×</span></span>`).join('')}
                    <button class="gallery-tag-chip gallery-tag-chip--add" data-addtag data-ref="${esc(ref)}" title="Add tag"><i data-lucide="plus" style="width:10px;height:10px;"></i></button>
                </div>`;
            return `
            <div class="gallery-item${isCover ? ' gallery-item--cover' : ''}" data-gi="${origIdx}" data-ref="${esc(ref)}">
                <img src="${esc(src)}" alt="Image ${origIdx + 1}" loading="lazy" class="gallery-item__img">
                ${isCover ? `<span class="gallery-item__badge">Avatar</span>` : ''}
                ${tagHtml}
                <div class="gallery-item__overlay">
                    <button class="gallery-item__btn" data-lb="${origIdx}" title="Expand"><i data-lucide="expand"></i></button>
                    <button class="gallery-item__btn gallery-item__btn--dl" data-dl="${i}" title="Download"><i data-lucide="download"></i></button>
                    ${isCover ? `<button class="gallery-item__btn gallery-item__btn--set" data-set-cover="-1" title="Already profile picture" disabled><i data-lucide="star"></i></button>` : `<button class="gallery-item__btn gallery-item__btn--set" data-set-cover="${origIdx - 1}" title="Set as profile picture"><i data-lucide="user-check"></i></button>`}
                    ${!isCover ? `<button class="gallery-item__btn gallery-item__btn--del" data-del="${origIdx - 1}" title="Remove"><i data-lucide="trash-2"></i></button>` : ''}
                </div>
            </div>`;
        }).join('');

        qsa('[data-lb]', $grid).forEach(btn => btn.onclick = () => _openLightbox(ctx.galleryCharId, parseInt(btn.dataset.lb)));
        qsa('[data-set-cover]', $grid).forEach(btn => btn.onclick = () => {
            const idx     = parseInt(btn.dataset.setCover);
            const gallery = charObj.extensions.underdark.gallery;
            const ref     = gallery[idx];
            if (meta && ref) {
                if (meta.avatar_path) gallery.unshift(meta.avatar_path);
                gallery.splice(gallery.indexOf(ref), 1);
                meta.avatar_path = ref;
                delete state._avatarCache?.[id];
                saveState();
                renderRoster();
                _renderGalleryStripInternal(id);
                _renderGalleryModal(id);
                showToast('Avatar updated');
            }
        });
        qsa('[data-del]', $grid).forEach(btn => btn.onclick = async () => {
            const idx     = parseInt(btn.dataset.del);
            const gallery = charObj.extensions.underdark.gallery;
            const ref     = gallery[idx];
            if (isIdbImageRef(ref)) await deleteImageBlob(idbImageRefId(ref)).catch(() => {});
            if (charObj.extensions.underdark.galleryMeta) delete charObj.extensions.underdark.galleryMeta[ref];
            gallery.splice(idx, 1);
            removeLocalPostBySrc(id, ref);
            saveState();
            _renderGalleryStripInternal(id);
            _renderGalleryModal(id, tagFilter);
        });
        qsa('[data-dl]', $grid).forEach(btn => btn.onclick = async () => {
            const idx = parseInt(btn.dataset.dl);
            const src = resolvedUrls[idx];
            if (!src) return;
            const a = document.createElement('a');
            a.href = src;
            a.download = `${(meta?.name || 'image').toLowerCase().replace(/\s+/g, '-')}-${String(idx + 1).padStart(3, '0')}.png`;
            a.click();
        });
        qsa('[data-rmtag]', $grid).forEach(chip => chip.onclick = e => {
            e.stopPropagation();
            const tag = chip.dataset.rmtag;
            const ref = chip.dataset.ref;
            const m   = _getGalleryMeta(id, ref);
            m.tags = m.tags.filter(t => t !== tag);
            _setGalleryMeta(id, ref, m);
            _renderGalleryModal(id, tagFilter);
        });
        qsa('[data-addtag]', $grid).forEach(btn => btn.onclick = e => {
            e.stopPropagation();
            const ref  = btn.dataset.ref;
            const $tags = btn.closest('.gallery-item__tags');
            if ($tags.querySelector('.gallery-tag-chip--input')) return;
            const $inp = document.createElement('input');
            $inp.className = 'gallery-tag-chip gallery-tag-chip--input';
            $inp.placeholder = 'tag…';
            $inp.maxLength = 20;
            $tags.insertBefore($inp, btn);
            $inp.focus();
            const commit = () => {
                const val = $inp.value.trim().toLowerCase().replace(/\s+/g, '-');
                if (val) {
                    const m = _getGalleryMeta(id, ref);
                    if (!m.tags.includes(val)) { m.tags.push(val); _setGalleryMeta(id, ref, m); }
                }
                _renderGalleryModal(id, tagFilter);
            };
            $inp.onkeydown = e2 => {
                if (e2.key === 'Enter') { e2.preventDefault(); commit(); }
                if (e2.key === 'Escape') _renderGalleryModal(id, tagFilter);
            };
            $inp.onblur = commit;
        });

        lucideRefresh($grid);
    }

    // ── Gallery strip (self-contained internal version) ───────────────────────
    async function _renderGalleryStripInternal(id) {
        const $strip = qs('#gallery-strip');
        if (!$strip) return;
        const allRefs = getAllGalleryImages(id);

        if (!allRefs.length) {
            $strip.innerHTML = `
                <div class="gallery-feed-empty">
                    <i data-lucide="camera"></i>
                    <p>No data-shards shared yet.</p>
                </div>`;
            lucideRefresh($strip);
            return;
        }

        const resolvedUrls = await Promise.all(allRefs.map(ref => resolveImageUrl(ref)));
        $strip.innerHTML = resolvedUrls.map((src, i) =>
            src ? `<div class="gallery-feed-item" data-gi="${i}">
                 <img src="${src}" loading="lazy" class="gallery-feed-img">
                 ${i === 0 ? '<div class="gallery-feed-badge"><i data-lucide="star"></i></div>' : ''}
             </div>` : ''
        ).join('') + `
            <div class="gallery-feed-item gallery-feed-item--add" id="gallery-strip-add">
                <i data-lucide="plus"></i>
            </div>`;

        qsa('.gallery-feed-item:not(.gallery-feed-item--add)', $strip).forEach($t => {
            const idx = parseInt($t.dataset.gi);
            $t.addEventListener('click', () => _openLightbox(id, idx));
        });
        qs('#gallery-strip-add', $strip)?.addEventListener('click', () => _openGalleryModal(id));
        lucideRefresh($strip);
    }

    function _openGalleryModal(id) {
        ctx.galleryCharId = id;
        const char = state.loadedCharacters[id];
        const meta = state.characters.find(c => c.id === id);
        const $gcn = qs('#gallery-char-name');
        if ($gcn) $gcn.textContent = char?.name || meta?.name || 'Gallery';
        _renderGalleryModal(id);
        qs('#modal-gallery').hidden = false;
        lucideRefresh(qs('#modal-gallery'));
    }

    // ── Lightbox ──────────────────────────────────────────────────────────────
    async function _openLightbox(charId, startIndex) {
        ctx.galleryCharId = charId;
        lbIndex = startIndex;
        const $lb = qs('#lightbox');
        $lb.hidden = false;
        lucideRefresh($lb);
        lbRefs   = getAllGalleryImages(charId);
        lbImages = await Promise.all(lbRefs.map(ref => resolveImageUrl(ref)));
        _renderLightbox(0);
    }

    function _renderLightbox(dir = 0) {
        if (!lbImages.length) return;
        lbIndex = Math.max(0, Math.min(lbImages.length - 1, lbIndex));
        const src  = lbImages[lbIndex];
        const $img = qs('#lb-img');
        if ($img) {
            $img.classList.remove('lb-anim-next', 'lb-anim-prev');
            void $img.offsetWidth;
            if (dir > 0)      $img.classList.add('lb-anim-next');
            else if (dir < 0) $img.classList.add('lb-anim-prev');
            $img.src = src;
        }
        const $idx   = qs('#lb-idx');
        const $total = qs('#lb-total');
        if ($idx)   $idx.textContent   = lbIndex + 1;
        if ($total) $total.textContent = lbImages.length;
        const $cap = qs('#lb-caption');
        if ($cap) $cap.textContent = lbIndex === 0 ? 'Cover Image' : `Image ${lbIndex + 1} of ${lbImages.length}`;
        const $setAv = qs('#lb-set-avatar');
        if ($setAv) $setAv.disabled = (lbIndex === 0);
        const $del = qs('#lb-remove');
        if ($del)  $del.disabled = (lbIndex === 0);
        const $dl = qs('#lb-download');
        if ($dl) $dl.disabled = !src;
        const $prev = qs('#lb-prev');
        const $next = qs('#lb-next');
        if ($prev) $prev.disabled = lbIndex <= 0;
        if ($next) $next.disabled = lbIndex >= lbImages.length - 1;
    }

    qs('#lb-prev')?.addEventListener('click', () => { lbIndex--; _renderLightbox(-1); });
    qs('#lb-next')?.addEventListener('click', () => { lbIndex++; _renderLightbox(1); });
    qs('#lb-close')?.addEventListener('click', () => { qs('#lightbox').hidden = true; });
    qs('.lightbox__backdrop')?.addEventListener('click', () => { qs('#lightbox').hidden = true; });

    qs('#lb-download')?.addEventListener('click', () => {
        const src = lbImages[lbIndex];
        if (!src) return;
        const meta = ctx.galleryCharId ? state.characters.find(c => c.id === ctx.galleryCharId) : null;
        const a = document.createElement('a');
        a.href = src;
        a.download = `${(meta?.name || 'image').toLowerCase().replace(/\s+/g, '-')}-${String(lbIndex + 1).padStart(3, '0')}.png`;
        a.click();
    });

    qs('#lb-set-avatar')?.addEventListener('click', async () => {
        if (!ctx.galleryCharId || lbIndex === 0) return;
        const ref  = lbRefs[lbIndex];
        const meta = state.characters.find(c => c.id === ctx.galleryCharId);
        const char = ensureGalleryStore(ctx.galleryCharId);
        if (!meta || !char) return;
        const gallery = char.extensions.underdark.gallery;
        if (meta.avatar_path) gallery.unshift(meta.avatar_path);
        const idx = gallery.indexOf(ref);
        if (idx !== -1) gallery.splice(idx, 1);
        meta.avatar_path = ref;
        saveState();
        renderRoster();
        _renderGalleryStripInternal(ctx.galleryCharId);
        _renderGalleryModal(ctx.galleryCharId);
        lbRefs   = getAllGalleryImages(ctx.galleryCharId);
        lbImages = await Promise.all(lbRefs.map(r => resolveImageUrl(r)));
        lbIndex  = 0;
        _renderLightbox(0);
        showToast('Cover image updated');
    });

    qs('#lb-remove')?.addEventListener('click', async () => {
        if (!ctx.galleryCharId || lbIndex === 0) return;
        const char = ensureGalleryStore(ctx.galleryCharId);
        if (!char) return;
        const ref = char.extensions.underdark.gallery[lbIndex - 1];
        if (isIdbImageRef(ref)) await deleteImageBlob(idbImageRefId(ref)).catch(() => {});
        char.extensions.underdark.gallery.splice(lbIndex - 1, 1);
        saveState();
        lbRefs   = getAllGalleryImages(ctx.galleryCharId);
        lbImages = await Promise.all(lbRefs.map(r => resolveImageUrl(r)));
        _renderGalleryStripInternal(ctx.galleryCharId);
        _renderGalleryModal(ctx.galleryCharId);
        if (!lbImages.filter(Boolean).length) { qs('#lightbox').hidden = true; return; }
        lbIndex = Math.min(lbIndex, lbImages.length - 1);
        _renderLightbox(0);
        showToast('Image removed');
    });

    document.addEventListener('keydown', e => {
        if (qs('#lightbox')?.hidden === false) {
            if (e.key === 'ArrowLeft')  { lbIndex--; _renderLightbox(-1); }
            if (e.key === 'ArrowRight') { lbIndex++; _renderLightbox(1); }
            if (e.key === 'Escape')     { qs('#lightbox').hidden = true; }
        }
    });

    // ── Gallery modal event wiring ─────────────────────────────────────────────
    qs('#gallery-close')?.addEventListener('click', () => { qs('#modal-gallery').hidden = true; });
    qs('.modal__backdrop', qs('#modal-gallery'))?.addEventListener('click', () => { qs('#modal-gallery').hidden = true; });

    qs('#gallery-add-file')?.addEventListener('click', () => qs('#gallery-file-input').click());
    qs('#gallery-file-input')?.addEventListener('change', async e => {
        const files = [...e.target.files];
        e.target.value = '';
        if (!ctx.galleryCharId) return;
        let added = 0;
        for (const file of files) {
            if (file.size > 10 * 1024 * 1024) { showToast(`${file.name} exceeds 10 MB limit`, 'error'); continue; }
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload  = ev => resolve(ev.target.result);
                reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
                reader.readAsDataURL(file);
            }).catch(err => { showToast(err.message, 'error'); return null; });
            if (!dataUrl) continue;
            await addToGallery(ctx.galleryCharId, dataUrl);
            added++;
        }
        if (added) {
            _renderGalleryStripInternal(ctx.galleryCharId);
            _renderGalleryModal(ctx.galleryCharId);
            showToast(`${added} image${added !== 1 ? 's' : ''} added`);
        }
    });

    qs('#gallery-url-add')?.addEventListener('click', async () => {
        const $input = qs('#gallery-url-input');
        const url = $input?.value.trim();
        if (!url) return;
        try { new URL(url); } catch { showToast('Invalid URL', 'error'); return; }
        if (!ctx.galleryCharId) return;
        await addToGallery(ctx.galleryCharId, url);
        $input.value = '';
        _renderGalleryStripInternal(ctx.galleryCharId);
        _renderGalleryModal(ctx.galleryCharId);
        showToast('Image URL added');
    });
    qs('#gallery-url-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') qs('#gallery-url-add').click();
    });

    qs('#gallery-export-all')?.addEventListener('click', async () => {
        if (!ctx.galleryCharId) return;
        const allRefs = getAllGalleryImages(ctx.galleryCharId);
        if (!allRefs.length) { showToast('No images to export', 'warn'); return; }
        const meta = state.characters.find(c => c.id === ctx.galleryCharId);
        const nameSlug = (meta?.name || 'gallery').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const allImages = await Promise.all(allRefs.map(ref => resolveImageUrl(ref)));
        let count = 0;
        for (let i = 0; i < allImages.length; i++) {
            const src = allImages[i];
            if (!src) continue;
            if (!src.startsWith('data:')) { window.open(src, '_blank', 'noopener'); continue; }
            await new Promise(resolve => {
                const a = document.createElement('a');
                a.href = src;
                a.download = `${nameSlug}-${String(i + 1).padStart(3, '0')}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(resolve, 200);
            });
            count++;
        }
        showToast(`Exported ${count} image${count !== 1 ? 's' : ''}`, 'info', 2500);
    });

    // ── Video gallery modal close ──────────────────────────────────────────────
    qs('#vgallery-close')?.addEventListener('click', () => { qs('#modal-video-gallery').hidden = true; });
    qs('.modal__backdrop', qs('#modal-video-gallery'))?.addEventListener('click', () => { qs('#modal-video-gallery').hidden = true; });

    // Return internal functions that ui.js callers need by reference
    return {
        openLightbox:          _openLightbox,
        openGalleryModal:      _openGalleryModal,
        renderGalleryStrip:    _renderGalleryStripInternal,
        openVideoGalleryModal: _openVideoGalleryModal,
        renderVideoStrip:      _renderVideoStripInternal,
    };
}
