/**
 * social.js — Social Feed, Compose, Feed Export, and Living World for The Underdark.
 *
 * Owns:
 *   - Social sidebar (character list)
 *   - Hot feed + per-character feed rendering
 *   - Post list renderer with likes, comments, DM wiring
 *   - Compose Post modal
 *   - Feed Export (JSON download)
 *   - Living World stream (LLM auto-post loop)
 *
 * Call initSocial(ctx, deps) once from initUI() after DOM is ready.
 * Returns { renderSocialFeed, renderHotFeed, renderSocialSidebar, openSocialFeed,
 *           openComposeModal, startLivingWorld, pauseLivingWorld }.
 */

import { qs, qsa, esc, debounce } from './shared-utils.js?v=4';
import { state, saveState } from './state.js?v=2';
import { resolveImageUrl } from './storage.js?v=3';
import { buildPayload, streamCompletion, fetchCompletion } from './llm-engine.js?v=16';
import { getApiKey } from '/hub/glass/script/modules/llm-auth.js?v=3';
import { getAllFeedPosts, saveLocalPost } from './gallery.js?v=1';
import { buildImagePrompt, generateImage, generateImagePromptWithLLM } from './image-engine.js?v=1';

export function initSocial(ctx, {
    lucideRefresh,
    showToast,
    switchSidebarTab,
    loadCharacterCard,
    renderChats,
    renderAll,
    switchChat,
    newChat,
    relativeTime,
    isEmoji,
    getAvatarUrl,
    getAvatarUrlSync,
    openGalleryModal,
}) {
    const $chatArena = qs('#chat-arena');
    const $feedArena = qs('#feed-arena');
    const $feedList  = qs('#social-feed-container');

    // Assign to ctx so image-studio and other sections can reference $feedArena
    ctx.$chatArena = $chatArena;
    ctx.$feedArena = $feedArena;

    qs('#feed-back-btn')?.addEventListener('click', () => {
        switchSidebarTab('chats');
    });

    qs('#feed-hot-btn')?.addEventListener('click', () => openHotFeed());

    qs('#feed-add-post-btn')?.addEventListener('click', () => {
        const charId = (ctx.feedMode !== 'hot') ? ctx.feedMode : (ctx.galleryCharId || state.characters[0]?.id || null);
        openComposeModal(charId);
    });

    function mergeLocalPostsFromDisk() {
        try {
            const raw = localStorage.getItem('underdark_v4');
            if (!raw) return;
            const disk = JSON.parse(raw);
            const diskPosts = disk?.socialData?.localPosts || {};
            if (!state.socialData) state.socialData = {};
            if (!state.socialData.localPosts) state.socialData.localPosts = {};
            Object.entries(diskPosts).forEach(([cid, arr]) => {
                if (!Array.isArray(arr)) return;
                if (!state.socialData.localPosts[cid]) state.socialData.localPosts[cid] = [];
                const existing = new Set(state.socialData.localPosts[cid].map(p => p.id));
                arr.forEach(p => { if (p.id && !existing.has(p.id)) state.socialData.localPosts[cid].push(p); });
            });
        } catch { /* non-critical */ }
    }

    function renderSocialSidebar() {
        mergeLocalPostsFromDisk();
        const $list = qs('#social-char-list');
        if (!$list) return;

        if (!state.characters.length) {
            $list.innerHTML = `<div style="padding:16px;text-align:center;font-size:.75rem;color:var(--text-muted);opacity:.4">No characters yet.</div>`;
            return;
        }

        $list.innerHTML = state.characters.map(c => {
            const rawAv = c.avatar_path || state.loadedCharacters[c.id]?.avatar;
            const av = getAvatarUrlSync(c.id, rawAv) || rawAv;
            const postCount = getAllFeedPosts(c.id, ctx.permanentFeedPosts).length;
            const isActive = ctx.feedMode === c.id;
            const avHtml = av && !isEmoji(av)
                ? `<div class="social-char-item__avatar" style="background-image:url('${esc(av)}')"></div>`
                : `<div class="social-char-item__avatar">${av || '👤'}</div>`;
            return `
            <div class="social-char-item ${isActive ? 'active' : ''}" data-id="${esc(c.id)}">
                ${avHtml}
                <div class="social-char-item__info">
                    <span class="social-char-item__name">${esc(c.name)}</span>
                    <span class="social-char-item__posts">${postCount} post${postCount !== 1 ? 's' : ''}</span>
                </div>
            </div>`;
        }).join('');

        // IDB async patch
        state.characters.forEach(async c => {
            const rawAv = c.avatar_path || state.loadedCharacters[c.id]?.avatar;
            if (rawAv?.startsWith('idb:')) {
                const url = await getAvatarUrl(c.id, rawAv).catch(() => null);
                if (url) {
                    const $av = qs(`.social-char-item[data-id="${c.id}"] .social-char-item__avatar`, $list);
                    if ($av) { $av.style.backgroundImage = `url(${url})`; $av.textContent = ''; }
                }
            }
        });

        qsa('.social-char-item', $list).forEach(el => {
            el.addEventListener('click', () => {
                openSocialFeed(el.dataset.id);
                qs('#social-hot-btn')?.classList.remove('active');
            });
        });
    }

    qs('#social-hot-btn')?.addEventListener('click', () => {
        qs('#social-hot-btn')?.classList.add('active');
        qsa('.social-char-item').forEach(el => el.classList.remove('active'));
        openHotFeed();
    });

    function openHotFeed() {
        ctx.feedMode = 'hot';
        ctx.galleryCharId = null;
        const $name    = qs('#feed-user-name');
        const $tagline = qs('#feed-char-tagline');
        const $avEl    = qs('#feed-char-avatar');
        if ($name)    $name.textContent    = 'Hot Feed';
        if ($tagline) $tagline.textContent = 'All characters';
        if ($avEl) { $avEl.style.backgroundImage = ''; $avEl.textContent = '🔥'; }
        const $hotBtn  = qs('#feed-hot-btn');
        if ($hotBtn) $hotBtn.hidden = true;
        renderHotFeed();
        renderFeedSidebar(null);
    }

    async function renderHotFeed() {
        if (!$feedList) return;
        const allPosts = [];
        for (const c of state.characters) {
            const posts = getAllFeedPosts(c.id, ctx.permanentFeedPosts);
            const meta  = c;
            const char  = state.loadedCharacters[c.id];
            posts.forEach((p, i) => allPosts.push({ ...p, charId: c.id, meta, char, postIdx: p.postIdx ?? i }));
        }
        if (!allPosts.length) {
            $feedList.innerHTML = `
                <div class="feed-empty">
                    <i data-lucide="image-off"></i>
                    <h3>No Posts Yet</h3>
                    <p>Add images to your characters' galleries, or compose a post.</p>
                </div>`;
            lucideRefresh($feedList);
            return;
        }
        allPosts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        await _renderPostList(allPosts);
    }

    function getFeedLikes(charId) {
        if (!state.socialData[charId]) state.socialData[charId] = {};
        return state.socialData[charId]._likes || {};
    }
    function toggleFeedLike(charId, postId) {
        if (!state.socialData[charId]) state.socialData[charId] = {};
        if (!state.socialData[charId]._likes) state.socialData[charId]._likes = {};
        const liked = !!state.socialData[charId]._likes[postId];
        state.socialData[charId]._likes[postId] = !liked;
        saveState();
        return !liked;
    }

    function openSocialFeed(id) {
        ctx.feedMode = id;
        ctx.galleryCharId = id;
        if ($chatArena) $chatArena.hidden = true;
        if ($feedArena) $feedArena.hidden = false;
        const char = state.loadedCharacters[id];
        const meta = state.characters.find(c => c.id === id);
        const charName = char?.name || meta?.name || 'Unknown';
        const charTagline = meta?.tagline || char?.description?.slice(0, 60) || '';
        const rawAv = meta?.avatar_path || char?.avatar;
        const av = getAvatarUrlSync(id, rawAv) || rawAv;

        const $name    = qs('#feed-user-name');
        const $tagline = qs('#feed-char-tagline');
        const $avEl    = qs('#feed-char-avatar');
        if ($name)    $name.textContent    = charName;
        if ($tagline) $tagline.textContent = charTagline;
        if ($avEl) {
            if (av && !isEmoji(av)) { $avEl.style.backgroundImage = `url(${av})`; $avEl.textContent = ''; }
            else { $avEl.style.backgroundImage = ''; $avEl.textContent = av || '👤'; }
            if (rawAv?.startsWith('idb:')) {
                getAvatarUrl(id, rawAv).then(url => {
                    if (url && $avEl) { $avEl.style.backgroundImage = `url(${url})`; $avEl.textContent = ''; }
                });
            }
        }

        const $hotBtn = qs('#feed-hot-btn');
        if ($hotBtn) $hotBtn.hidden = false;
        qsa('.social-char-item').forEach(el => el.classList.toggle('active', el.dataset.id === id));
        qs('#social-hot-btn')?.classList.remove('active');

        renderSocialFeed(id);
        renderFeedSidebar(id);
    }

    async function renderSocialFeed(id) {
        if (!$feedList) return;
        mergeLocalPostsFromDisk();
        const char = state.loadedCharacters[id];
        const meta = state.characters.find(c => c.id === id);
        const charName = char?.name || meta?.name || 'Unknown';
        const allPosts = getAllFeedPosts(id, ctx.permanentFeedPosts);

        if (!allPosts.length) {
            $feedList.innerHTML = `
                <div class="feed-empty">
                    <i data-lucide="image-off"></i>
                    <h3>No Posts Yet</h3>
                    <p>Compose a post as ${esc(charName)}, or add images via the gallery.</p>
                    <button class="btn btn--accent btn--sm" id="feed-empty-compose">Compose Post</button>
                </div>`;
            qs('#feed-empty-compose', $feedList)?.addEventListener('click', () => openComposeModal(id));
            lucideRefresh($feedList);
            return;
        }

        const posts = allPosts.map((p, i) => ({ ...p, charId: id, meta, char, postIdx: p.postIdx ?? i }));
        posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        await _renderPostList(posts);
    }

    async function _renderPostList(posts) {
        if (!$feedList) return;

        const resolved = await Promise.all(posts.map(async p => {
            if (p.type === 'text' || !p.src) return p;
            const src = await resolveImageUrl(p.src).catch(() => null);
            return src ? { ...p, src } : null;
        }));
        const posts_ = resolved.filter(p => p && (p.type === 'text' || p.src));
        if (!posts_.length) {
            $feedList.innerHTML = `<div class="feed-empty"><i data-lucide="image-off"></i><h3>No Posts Yet</h3><p>Images saved to a character's gallery will appear here.</p></div>`;
            lucideRefresh($feedList);
            return;
        }

        const FALLBACK_CAPTIONS = [
            'Signal caught. Feeling something tonight. 💠',
            'Static and signal. #TheUnderdark',
            'The city never sleeps. Neither do I.',
            'Another day in the dark.',
            'Running on fumes and spite. ✦',
            'Fragment recovered.',
            'Stay sharp. Stay alive.',
            'Connection lost. Searching…',
            'Found something worth keeping.',
            'Between the static — clarity. ✦',
        ];

        const seedLike = (charId, postId) => {
            let h = 0;
            for (let k = 0; k < postId.length; k++) h = (h * 31 + postId.charCodeAt(k)) & 0xffffffff;
            return 47 + (Math.abs(h) % 400);
        };

        $feedList.innerHTML = posts_.map(p => {
            const { charId, meta, char, src, type, postIdx: i, id: postId, caption: postCaption, permanent, timestamp } = p;
            const charName = char?.name || meta?.name || 'Unknown';
            const rawAv    = meta?.avatar_path || char?.avatar;
            const av       = getAvatarUrlSync(charId, rawAv) || rawAv;
            const likes    = getFeedLikes(charId);
            const isLiked  = !!likes[postId];
            const base     = seedLike(charId, postId);
            const likeCount = base + (isLiked ? 1 : 0);
            const caption  = postCaption || FALLBACK_CAPTIONS[(charId.charCodeAt(0) + i) % FALLBACK_CAPTIONS.length];
            const commentKey = postId;
            const comments = (state.socialData[charId]?.[commentKey] || []).filter(c => c.role !== undefined);

            let mediaHtml = '';
            if (type === 'text') {
                mediaHtml = '';
            } else if (!src) {
                mediaHtml = `<div class="feed-post__media"><div class="feed-post__media-empty"><i data-lucide="image-off"></i></div></div>`;
            } else if (isEmoji(src)) {
                mediaHtml = `<div class="feed-post__media"><div class="feed-post__media-emoji">${src}</div></div>`;
            } else {
                mediaHtml = `<div class="feed-post__media"><img src="${esc(src)}" class="feed-post__media-img" loading="lazy" alt="Post by ${esc(charName)}"></div>`;
            }

            const avHtml    = av && !isEmoji(av) ? `style="background-image:url('${esc(av)}')"` : '';
            const avContent = av && !isEmoji(av) ? '' : (av || '👤');
            const draftBadge = '';
            const charWorld  = char?.world || meta?.world || '';
            const locationStr = [charWorld, 'The Underdark'].filter(Boolean).join(' / ');

            const visibleComments = comments.slice(-4);
            const hiddenCount = comments.length - visibleComments.length;
            const commentsHtml = `
                ${hiddenCount > 0 ? `<button class="feed-comments__view-more" data-char-id="${esc(charId)}" data-post-id="${esc(commentKey)}">View ${hiddenCount} earlier…</button>` : ''}
                ${visibleComments.map(c => {
                    if (c.role === 'system') return `<div class="feed-comment feed-comment--system"><span class="feed-comment__text">${esc(c.content)}</span></div>`;
                    const isBot  = c.role === 'bot';
                    const isUser = c.role === 'user';
                    const cName   = isUser ? (state.config.userName || 'You') : esc(charName);
                    const cAvAttr = isBot && av && !isEmoji(av) ? `style="background-image:url('${esc(av)}')"` : '';
                    const cAvText = isUser ? '👤' : (av && !isEmoji(av) ? '' : (av || '👤'));
                    return `
                    <div class="feed-comment ${isBot ? 'feed-comment--bot' : 'feed-comment--user'}">
                        <div class="feed-comment__avatar" ${cAvAttr}>${cAvText}</div>
                        <div class="feed-comment__body">
                            <span class="feed-comment__author">${esc(cName)}</span>
                            <span class="feed-comment__text">${esc(c.content)}</span>
                        </div>
                    </div>`;
                }).join('')}`;

            return `
            <article class="feed-post${type === 'text' ? ' feed-post--text' : ''}" data-post-id="${esc(postId)}" data-post-idx="${i}" data-char-id="${esc(charId)}">
                <header class="feed-post__header">
                    <div class="feed-post__header-avatar" ${avHtml}>${avContent}</div>
                    <div class="feed-post__header-info">
                        <span class="feed-post__header-name">${esc(charName)}</span>
                        <span class="feed-post__header-sub">${esc(locationStr)}</span>
                    </div>
                    <button class="feed-post__header-dm btn-icon btn-icon--small" data-dm-char="${esc(charId)}" title="Open DM with ${esc(charName)}"><i data-lucide="message-circle"></i></button>
                </header>
                ${mediaHtml}
                ${type !== 'text' && src ? `<div class="feed-post__redo-row"><button class="feed-post__redo-btn btn btn--ghost btn--sm" data-redo-char="${esc(charId)}" data-redo-caption="${esc(caption)}" data-redo-post="${esc(postId)}" title="Regenerate image"><i data-lucide="refresh-cw"></i> Redo</button></div>` : ''}
                <div class="feed-post__toolbar">
                    <button class="feed-post__act-btn feed-post__act-btn--like ${isLiked ? 'liked' : ''}" data-like-char="${esc(charId)}" data-like-id="${esc(postId)}">
                        <i data-lucide="heart"></i>
                    </button>
                    <span class="feed-post__act-count">${likeCount.toLocaleString()}</span>
                    <button class="feed-post__act-btn" style="margin-left:4px"><i data-lucide="message-circle"></i></button>
                    <span class="feed-post__spacer"></span>
                    <span class="feed-post__time">${relativeTime(timestamp || (Date.now() - 1000 * 60 * (60 + i * 47)))}</span>
                </div>
                <div class="feed-post__body">
                    <div class="feed-post__caption"><strong>${esc(charName)}</strong> ${esc(caption)}</div>
                    <div class="feed-comments" data-comments-for="${esc(charId)}-${esc(commentKey)}">${commentsHtml}</div>
                </div>
                <div class="feed-post__comment-row">
                    <div class="feed-comment-user-avatar">👤</div>
                    <input type="text" class="feed-post__comment-input" placeholder="Add a comment…" data-char-id="${esc(charId)}" data-post-id="${esc(commentKey)}">
                    <button class="feed-post__comment-submit" data-char-id="${esc(charId)}" data-post-id="${esc(commentKey)}" disabled>Post</button>
                </div>
            </article>`;
        }).join('');

        qsa('.feed-post__act-btn--like', $feedList).forEach($btn => {
            $btn.addEventListener('click', () => {
                const cId    = $btn.dataset.likeChar;
                const postId = $btn.dataset.likeId;
                const nowLiked = toggleFeedLike(cId, postId);
                $btn.classList.toggle('liked', nowLiked);
                const $cnt = $btn.nextElementSibling;
                if ($cnt) {
                    const base = seedLike(cId, postId);
                    $cnt.textContent = (base + (nowLiked ? 1 : 0)).toLocaleString();
                }
            });
        });

        qsa('.feed-post__header-dm', $feedList).forEach($btn => {
            $btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const cId = $btn.dataset.dmChar;
                await loadCharacterCard(cId).catch(() => {});
                const existing = state.reality?.chats.find(c => c.type === 'dm' && c.botIds.length === 1 && c.botIds[0] === cId);
                if (existing) switchChat(existing.id); else newChat('dm', [cId]);
                switchSidebarTab('chats');
                renderChats();
                renderAll();
            });
        });

        qsa('.feed-post__comment-input', $feedList).forEach($input => {
            const $btn = qs(`.feed-post__comment-submit[data-char-id="${$input.dataset.charId}"][data-post-id="${$input.dataset.postId}"]`, $feedList);
            $input.oninput   = () => { if ($btn) $btn.disabled = !$input.value.trim(); };
            $input.onkeydown = e  => { if (e.key === 'Enter' && $btn && !$btn.disabled) $btn.click(); };
        });

        qsa('.feed-post__comment-submit', $feedList).forEach($btn => {
            $btn.onclick = async () => {
                const charId  = $btn.dataset.charId;
                const postId  = $btn.dataset.postId;
                const $input  = qs(`.feed-post__comment-input[data-char-id="${charId}"][data-post-id="${postId}"]`, $feedList);
                const text = $input?.value.trim();
                if (!text) return;
                $btn.disabled = true;
                if ($input) $input.value = '';
                const cMeta = state.characters.find(c => c.id === charId);
                const cChar = state.loadedCharacters[charId];
                const cName = cChar?.name || cMeta?.name || 'Unknown';
                const cRawAv = cMeta?.avatar_path || cChar?.avatar;
                const cAv = getAvatarUrlSync(charId, cRawAv) || cRawAv;
                const $commentsEl = qs(`[data-comments-for="${charId}-${postId}"]`, $feedList);
                if ($commentsEl) {
                    $commentsEl.insertAdjacentHTML('beforeend', `
                        <div class="feed-comment feed-comment--typing" id="typing-${charId}-${postId}">
                            <div class="feed-comment__avatar" ${cAv && !isEmoji(cAv) ? `style="background-image:url('${esc(cAv)}')"` : ''}>${cAv && !isEmoji(cAv) ? '' : (cAv || '👤')}</div>
                            <div class="feed-comment__body">
                                <span class="feed-comment__author">${esc(cName)}</span>
                                <span class="feed-comment__text">typing…</span>
                            </div>
                        </div>`);
                }
                await submitSocialComment(charId, postId, text);
            };
        });

        qsa('.feed-post__redo-btn', $feedList).forEach($btn => {
            $btn.addEventListener('click', () => openImageRedoModal($btn.dataset.redoChar, $btn.dataset.redoCaption, $btn.dataset.redoPost));
        });

        lucideRefresh($feedList);
    }

    // ── Image Redo Modal ──────────────────────────────────────────────────────
    // Three quick questions to guide the regeneration, then fires LLM prompt
    // generation + image generation for the same character.
    function openImageRedoModal(charId, existingCaption, postId) {
        const char     = state.loadedCharacters[charId];
        const meta     = state.characters.find(c => c.id === charId);
        const charName = char?.name || meta?.name || 'Unknown';

        const rawAv   = meta?.avatar_path || char?.avatar;
        const av      = getAvatarUrlSync(charId, rawAv) || rawAv;
        const avStyle = av && !isEmoji(av) ? `style="background-image:url('${esc(av)}')"` : '';
        const avText  = av && !isEmoji(av) ? '' : (av || '👤');
        const charWorld = char?.world || meta?.world || 'The Underdark';

        const $modal = document.createElement('div');
        $modal.className = 'modal';
        $modal.innerHTML = `
            <div class="modal__backdrop"></div>
            <div class="redo-modal">
                <button class="redo-modal__close" id="redo-modal-close"><i data-lucide="x"></i></button>

                <div class="redo-modal__hero">
                    <div class="redo-modal__avatar" ${avStyle}>${avText}</div>
                    <div class="redo-modal__hero-info">
                        <span class="redo-modal__char-name">${esc(charName)}</span>
                        <span class="redo-modal__char-world">${esc(charWorld)}</span>
                    </div>
                    <div class="redo-modal__hero-label"><i data-lucide="refresh-cw"></i> Regenerate</div>
                </div>

                <div class="redo-modal__body">
                    <div class="redo-modal__field">
                        <div class="redo-modal__field-label"><i data-lucide="sunset"></i> Mood / Vibe</div>
                        <input id="redo-q-mood" class="redo-modal__input" placeholder="melancholic, fierce, serene, tender…">
                        <div class="redo-modal__chips">
                            ${['Melancholic','Fierce','Serene','Playful','Dark','Romantic'].map(v =>
                                `<button class="redo-chip" data-target="redo-q-mood" data-val="${v.toLowerCase()}">${v}</button>`
                            ).join('')}
                        </div>
                    </div>

                    <div class="redo-modal__field">
                        <div class="redo-modal__field-label"><i data-lucide="map-pin"></i> Setting</div>
                        <input id="redo-q-env" class="redo-modal__input" placeholder="rainy rooftop, candlelit room, forest…">
                        <div class="redo-modal__chips">
                            ${['Rooftop','Forest','Bedroom','City Alley','Dungeon','Onsen'].map(v =>
                                `<button class="redo-chip" data-target="redo-q-env" data-val="${v.toLowerCase()}">${v}</button>`
                            ).join('')}
                        </div>
                    </div>

                    <div class="redo-modal__field">
                        <div class="redo-modal__field-label"><i data-lucide="sliders-horizontal"></i> Direction <span class="redo-modal__optional">optional</span></div>
                        <input id="redo-q-hint" class="redo-modal__input" placeholder="close-up portrait, action pose, more dramatic…">
                        <div class="redo-modal__chips">
                            ${['Portrait','Full body','Action pose','Cinematic','Rear view','Low angle'].map(v =>
                                `<button class="redo-chip" data-target="redo-q-hint" data-val="${v.toLowerCase()}">${v}</button>`
                            ).join('')}
                        </div>
                    </div>

                    <div class="redo-modal__field">
                        <div class="redo-modal__field-label"><i data-lucide="palette"></i> Art Style</div>
                        <div class="redo-modal__style-grid">
                            ${[
                                { id: 'photorealistic', label: 'Photorealistic', icon: '📷' },
                                { id: 'anime',          label: 'Anime',          icon: '🎌' },
                                { id: 'stylized',       label: 'Stylized',       icon: '✦' },
                                { id: 'realistic',      label: 'Realistic',      icon: '🎨' },
                            ].map(s => `
                                <button class="redo-style-btn" data-style="${s.id}">
                                    <span class="redo-style-btn__icon">${s.icon}</span>
                                    <span class="redo-style-btn__label">${s.label}</span>
                                </button>`
                            ).join('')}
                        </div>
                        <input type="hidden" id="redo-q-style" value="">
                    </div>

                    <label class="redo-modal__nsfw-row">
                        <span class="redo-modal__nsfw-toggle">
                            <input type="checkbox" id="redo-q-nsfw" class="redo-modal__nsfw-check">
                            <span class="redo-modal__nsfw-slider"></span>
                        </span>
                        <span class="redo-modal__nsfw-label">Allow NSFW</span>
                        <span class="redo-modal__nsfw-hint">Model picks appropriately</span>
                    </label>
                </div>

                <div class="redo-modal__footer">
                    <button class="btn btn--ghost btn--sm" id="redo-modal-cancel">Cancel</button>
                    <button class="btn btn--accent" id="redo-modal-go"><i data-lucide="sparkles"></i> Generate Image</button>
                </div>
            </div>`;

        document.body.appendChild($modal);
        lucideRefresh($modal);
        qs('#redo-q-mood', $modal)?.focus();

        // Style button selection
        qsa('.redo-style-btn', $modal).forEach($sb => {
            $sb.addEventListener('click', () => {
                const val = $sb.dataset.style;
                const $hidden = qs('#redo-q-style', $modal);
                const already = $hidden?.value === val;
                if ($hidden) $hidden.value = already ? '' : val;
                qsa('.redo-style-btn', $modal).forEach(b => b.classList.toggle('redo-style-btn--active', !already && b.dataset.style === val));
            });
        });

        // Chip clicks fill/toggle the associated input
        qsa('.redo-chip', $modal).forEach($chip => {
            $chip.addEventListener('click', () => {
                const $inp = qs(`#${$chip.dataset.target}`, $modal);
                if (!$inp) return;
                const val = $chip.dataset.val;
                $inp.value = $inp.value === val ? '' : val;
                qsa(`.redo-chip[data-target="${$chip.dataset.target}"]`, $modal)
                    .forEach(c => c.classList.toggle('redo-chip--active', c.dataset.val === $inp.value));
            });
        });

        const close = () => $modal.remove();
        qs('#redo-modal-close', $modal)?.addEventListener('click', close);
        qs('#redo-modal-cancel', $modal)?.addEventListener('click', close);
        qs('.modal__backdrop', $modal)?.addEventListener('click', close);

        qs('#redo-modal-go', $modal)?.addEventListener('click', async () => {
            const mood        = qs('#redo-q-mood', $modal)?.value.trim()  || '';
            const env         = qs('#redo-q-env', $modal)?.value.trim()   || '';
            const hint        = qs('#redo-q-hint', $modal)?.value.trim()  || '';
            const artStyle    = qs('#redo-q-style', $modal)?.value        || '';
            const includeNsfw = qs('#redo-q-nsfw', $modal)?.checked       || false;

            const $goBtn = qs('#redo-modal-go', $modal);
            if ($goBtn) { $goBtn.disabled = true; $goBtn.innerHTML = '<i data-lucide="loader-circle"></i> Generating…'; lucideRefresh($goBtn); }

            // Map art style selection to prompt keyword + preferred model
            const styleMap = {
                photorealistic: { keyword: 'photorealistic photography, 8k, hyperrealistic', models: { sfw: ['hidream','flux-schnell'], nsfw: ['nano-banana','hidream'] } },
                anime:          { keyword: 'anime style illustration, detailed anime art',   models: { sfw: ['hidream','flux-schnell'], nsfw: ['SDXL-ArliMix-v1','bagel'] } },
                stylized:       { keyword: 'stylized digital art, painterly, concept art',   models: { sfw: ['hidream','flux-schnell'], nsfw: ['bagel','nano-banana'] } },
                realistic:      { keyword: 'realistic digital painting, lifelike, detailed',  models: { sfw: ['hidream','flux-schnell'], nsfw: ['nano-banana','hidream'] } },
            };
            const styleEntry  = styleMap[artStyle] || null;
            const styleKw     = styleEntry?.keyword || '';
            const pick1       = (arr) => arr[Math.floor(Math.random() * arr.length)];
            const modelPool   = styleEntry
                ? (includeNsfw ? styleEntry.models.nsfw : styleEntry.models.sfw)
                : (includeNsfw ? ['nano-banana','bagel','SDXL-ArliMix-v1'] : ['flux-schnell','hidream']);

            const userHint = [
                mood && `Mood: ${mood}`,
                env  && `Setting: ${env}`,
                hint,
                styleKw && `Art style: ${styleKw}`,
            ].filter(Boolean).join('. ');

            try {
                const { positive, negative } = await generateImagePromptWithLLM({
                    charId,
                    userHint,
                    scene: styleKw ? { style: styleKw } : {},
                    includeNsfw,
                    withNegative: true,
                    historyDepth: 0,
                });

                const model      = pick1(modelPool);
                const imgDataUrl = await generateImage({ model, prompt: positive, negativePrompt: negative, size: '1024x1024' });
                if (!imgDataUrl) throw new Error('No image returned.');

                // Replace the image in the existing post element if it's still in the DOM
                if (postId) {
                    const $article = qs(`[data-post-id="${postId}"]`, $feedList);
                    const $img = $article?.querySelector('.feed-post__media-img');
                    if ($img) {
                        $img.src = imgDataUrl;
                        // Also update localStorage so the new src persists
                        const lp = state.socialData?.localPosts?.[charId];
                        if (lp) {
                            const entry = lp.find(p => `local-${charId}-${p.id || ''}` === postId || p.id === postId);
                            if (entry) entry.src = imgDataUrl;
                            saveState();
                        }
                        close();
                        showToast('Image replaced.', 'info', 1800);
                        return;
                    }
                }

                // Fallback: save as new post if article not found
                saveLocalPost(charId, { type: 'image', src: imgDataUrl, caption: existingCaption || '' });

                if (ctx.feedMode === 'hot') renderHotFeed();
                else if (ctx.feedMode === charId) renderSocialFeed(charId);
                renderSocialSidebar();
                close();
                showToast(`New image posted for ${charName}.`, 'info', 2000);
            } catch (err) {
                showToast(`Failed: ${err.message || 'unknown error'}`, 'error', 3500);
                if ($goBtn) { $goBtn.disabled = false; $goBtn.innerHTML = '<i data-lucide="image"></i> Generate'; lucideRefresh($goBtn); }
            }
        });
    }

    function renderFeedSidebar(charId) {
        const $pc = qs('#feed-profile-card');
        const $sg = qs('#feed-suggested');

        if (!charId) {
            if ($pc) $pc.innerHTML = `
                <div class="feed-suggested__label">All Characters</div>
                ${state.characters.map(c => {
                    const rawAv = c.avatar_path || state.loadedCharacters[c.id]?.avatar;
                    const av = getAvatarUrlSync(c.id, rawAv) || rawAv;
                    const postCount = getAllFeedPosts(c.id, ctx.permanentFeedPosts).length;
                    const avHtml = av && !isEmoji(av)
                        ? `<div class="feed-suggested-item__avatar" style="background-image:url('${esc(av)}')"></div>`
                        : `<div class="feed-suggested-item__avatar">${av || '👤'}</div>`;
                    return `<div class="feed-suggested-item" data-id="${esc(c.id)}">
                        ${avHtml}
                        <div class="feed-suggested-item__info">
                            <span class="feed-suggested-item__name">${esc(c.name)}</span>
                            <span class="feed-suggested-item__sub">${postCount} post${postCount !== 1 ? 's' : ''}</span>
                        </div>
                    </div>`;
                }).join('')}`;
            if ($sg) $sg.innerHTML = '';
            qsa('.feed-suggested-item', $pc).forEach(el => {
                el.addEventListener('click', () => openSocialFeed(el.dataset.id));
            });
            return;
        }

        const meta = state.characters.find(c => c.id === charId);
        const char = state.loadedCharacters[charId];
        if (!meta && !char) { if ($pc) $pc.innerHTML = ''; return; }

        const charName = char?.name || meta?.name || 'Unknown';
        const rawAv = meta?.avatar_path || char?.avatar;
        const av = getAvatarUrlSync(charId, rawAv) || rawAv;
        const postCount = getAllFeedPosts(charId, ctx.permanentFeedPosts).length;
        const likeCount = Object.values(getFeedLikes(charId)).filter(Boolean).length;
        const bio = char?.description?.slice(0, 120) || meta?.tagline || '';

        const avHtml = av && !isEmoji(av)
            ? `<div class="feed-profile-card__avatar" style="background-image:url('${esc(av)}')"></div>`
            : `<div class="feed-profile-card__avatar">${av || '👤'}</div>`;

        if ($pc) $pc.innerHTML = `
            <div class="feed-profile-card__header">
                ${avHtml}
                <div>
                    <span class="feed-profile-card__name">${esc(charName)}</span>
                    <span class="feed-profile-card__handle">@${esc(charName.toLowerCase().replace(/\s+/g, '_'))}</span>
                </div>
            </div>
            <div class="feed-profile-card__stats">
                <div class="feed-profile-stat">
                    <span class="feed-profile-stat__val">${postCount}</span>
                    <span class="feed-profile-stat__label">Posts</span>
                </div>
                <div class="feed-profile-stat">
                    <span class="feed-profile-stat__val">${likeCount}</span>
                    <span class="feed-profile-stat__label">Liked</span>
                </div>
                <div class="feed-profile-stat">
                    <span class="feed-profile-stat__val">${state.reality?.chats.filter(c => c.botIds.includes(charId)).length || 0}</span>
                    <span class="feed-profile-stat__label">Threads</span>
                </div>
            </div>
            ${bio ? `<div class="feed-profile-card__bio">${esc(bio)}</div>` : ''}
            <button class="btn btn--accent btn--sm feed-profile-card__chat-btn" data-dm="${esc(charId)}">
                <i data-lucide="message-circle"></i> Open DM
            </button>`;

        qs('.feed-profile-card__chat-btn', $pc)?.addEventListener('click', async () => {
            await loadCharacterCard(charId).catch(() => {});
            const existing = state.reality?.chats.find(c => c.type === 'dm' && c.botIds.length === 1 && c.botIds[0] === charId);
            if (existing) switchChat(existing.id); else newChat('dm', [charId]);
            switchSidebarTab('chats');
            renderChats();
            renderAll();
        });

        const others = state.characters.filter(c => c.id !== charId);
        if ($sg) $sg.innerHTML = others.length ? `
            <div class="feed-suggested__label">More Characters</div>
            ${others.map(c => {
                const rAv = c.avatar_path || state.loadedCharacters[c.id]?.avatar;
                const a = getAvatarUrlSync(c.id, rAv) || rAv;
                const posts = getAllFeedPosts(c.id, ctx.permanentFeedPosts).length;
                const aHtml = a && !isEmoji(a)
                    ? `<div class="feed-suggested-item__avatar" style="background-image:url('${esc(a)}')"></div>`
                    : `<div class="feed-suggested-item__avatar">${a || '👤'}</div>`;
                return `<div class="feed-suggested-item" data-id="${esc(c.id)}">
                    ${aHtml}
                    <div class="feed-suggested-item__info">
                        <span class="feed-suggested-item__name">${esc(c.name)}</span>
                        <span class="feed-suggested-item__sub">${posts} post${posts !== 1 ? 's' : ''}</span>
                    </div>
                </div>`;
            }).join('')}` : '';

        qsa('.feed-suggested-item', $sg).forEach(el => {
            el.addEventListener('click', () => openSocialFeed(el.dataset.id));
        });

        lucideRefresh($pc);
    }

    async function submitSocialComment(charId, postId, text) {
        if (!state.socialData[charId]) state.socialData[charId] = {};
        if (!state.socialData[charId][postId]) state.socialData[charId][postId] = [];

        state.socialData[charId][postId].push({ role: 'user', content: text, timestamp: Date.now() });
        saveState();

        const responsiveness = state.config?.charOverrides?.[charId]?.ext?.responsiveness ?? 70;
        if (Math.random() * 100 > responsiveness) {
            state.socialData[charId][postId].push({ role: 'system', content: '— no reply —', timestamp: Date.now() });
            saveState();
            return;
        }

        showToast('Character is typing...', 'info', 1000);
        const char = state.loadedCharacters[charId];
        await new Promise(r => setTimeout(r, 1200 + Math.random() * 2000));

        try {
            const _worldScenario = state.reality?.worldConfig?.scenario || '';
            const payload = buildPayload({
                character:  { ...char, id: charId },
                history:    [{ role: 'user', content: `[SOCIAL MEDIA COMMENT ON YOUR POST]\nUser commented: "${text}"\n\nReply briefly as a social media comment. Keep it in character but short (1-3 sentences max).` }],
                lore:       state.lorebooks,
                config:     { ...state.config, stream: true, ...(_worldScenario ? { _worldScenario } : {}) },
                isGroup:    false,
                sessionId:  `social-${charId}-${postId}`
            });

            await new Promise((resolve) => {
                streamCompletion(
                    payload,
                    (_delta, _full) => {},
                    (finalText) => {
                        const clean = finalText.trim().replace(/^["']|["']$/g, '');
                        if (clean) {
                            state.socialData[charId][postId].push({ role: 'bot', content: clean, timestamp: Date.now() });
                            saveState();
                            renderSocialFeed(charId);
                            showToast(`${char.name} replied to your comment!`);
                        }
                        resolve();
                    },
                    (err) => { console.error('[social] Reply failed:', err); resolve(); }
                );
            });
        } catch (err) {
            console.error('[social] Reply failed:', err);
        }
    }

    // ── Compose Post Modal ────────────────────────────────────────────────────
    let _composeType = 'text';

    function openComposeModal(charId) {
        const modal = qs('#modal-compose-post');
        if (!modal) return;

        const $sel = qs('#compose-modal-char-select', modal);
        if ($sel) {
            $sel.innerHTML = state.characters.map(c => {
                const n = state.loadedCharacters[c.id]?.name || c.name;
                return `<option value="${esc(c.id)}" ${c.id === charId ? 'selected' : ''}>${esc(n)}</option>`;
            }).join('');
        }

        const updateCharDisplay = (id) => {
            const meta = state.characters.find(c => c.id === id);
            const char = state.loadedCharacters[id];
            const name = char?.name || meta?.name || '—';
            const rawAv = meta?.avatar_path || char?.avatar;
            const av = getAvatarUrlSync(id, rawAv) || rawAv;
            const $av = qs('#compose-modal-avatar', modal);
            const $nm = qs('#compose-modal-char-name', modal);
            if ($av) {
                if (av && !isEmoji(av)) { $av.style.backgroundImage = `url(${av})`; $av.textContent = ''; }
                else { $av.style.backgroundImage = ''; $av.textContent = av || '👤'; }
            }
            if ($nm) $nm.textContent = name;
        };
        updateCharDisplay(charId || state.characters[0]?.id);

        if ($sel) $sel.addEventListener('change', () => updateCharDisplay($sel.value));

        _composeType = 'text';
        qsa('.compose-modal__type-tab', modal).forEach(tab => {
            tab.classList.toggle('active', tab.dataset.composeType === 'text');
            tab.onclick = () => {
                _composeType = tab.dataset.composeType;
                qsa('.compose-modal__type-tab', modal).forEach(t => t.classList.toggle('active', t === tab));
                const $imgRow = qs('#compose-modal-image-row', modal);
                if ($imgRow) $imgRow.hidden = _composeType !== 'image';
            };
        });

        const $urlInput = qs('#compose-modal-image-url', modal);
        const $preview  = qs('#compose-modal-image-preview', modal);
        const $prevImg  = qs('#compose-modal-preview-img', modal);
        if ($urlInput) {
            $urlInput.oninput = debounce(() => {
                const url = $urlInput.value.trim();
                if ($prevImg) $prevImg.src = url;
                if ($preview) $preview.hidden = !url;
            }, 400);
        }

        const $caption = qs('#compose-modal-caption', modal);
        if ($caption) $caption.value = '';
        if ($urlInput) $urlInput.value = '';
        if ($preview) $preview.hidden = true;
        const $imgRow = qs('#compose-modal-image-row', modal);
        if ($imgRow) $imgRow.hidden = true;

        modal.hidden = false;
        lucideRefresh(modal);
        $caption?.focus();

        const $submit = qs('#compose-modal-submit', modal);
        const $cancel = qs('#compose-modal-cancel', modal);
        const $close  = qs('#compose-modal-close', modal);
        const $bd     = qs('.modal__backdrop', modal);

        const cleanup = () => { modal.hidden = true; };
        const doSubmit = () => {
            const selCharId = $sel?.value || charId;
            const caption = ($caption?.value || '').trim();
            const imgUrl  = _composeType === 'image' ? ($urlInput?.value || '').trim() : null;
            if (!caption && !imgUrl) { showToast('Write something first.', 'warn'); return; }

            saveLocalPost(selCharId, {
                type: _composeType === 'image' && imgUrl ? 'image' : 'text',
                src: imgUrl || null,
                caption: caption || null,
            });

            cleanup();
            if (ctx.feedMode === selCharId) renderSocialFeed(selCharId);
            else if (ctx.feedMode === 'hot') renderHotFeed();
            renderSocialSidebar();
            showToast('Post saved locally.');
        };

        $submit?.addEventListener('click', doSubmit, { once: true });
        $cancel?.addEventListener('click', cleanup, { once: true });
        $close?.addEventListener('click', cleanup, { once: true });
        $bd?.addEventListener('click', cleanup, { once: true });
    }

    // ── Feed Export ───────────────────────────────────────────────────────────
    qs('#feed-export-btn')?.addEventListener('click', () => {
        const localPosts = state.socialData?.localPosts || {};
        const posts = [];
        for (const [charId, arr] of Object.entries(localPosts)) {
            arr.forEach(p => {
                if (p.src && p.src.startsWith('idb:')) return;
                posts.push({
                    id: p.id,
                    charId,
                    type: p.type || 'text',
                    src: p.src || null,
                    caption: p.caption || null,
                    timestamp: p.timestamp || Date.now(),
                    permanent: true,
                });
            });
        }
        if (!posts.length) { showToast('No local posts to export.', 'warn'); return; }
        const out = {
            _meta: {
                exported_at: new Date().toISOString(),
                note: 'Merge these into data/feed.json posts[] and push to git for permanent visibility.',
            },
            posts,
        };
        const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `feed-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported ${posts.length} post${posts.length !== 1 ? 's' : ''}.`);
    });

    // ── Living World Stream ───────────────────────────────────────────────────
    function lwUpdateUI() {
        const $bar   = qs('#lw-stream-bar');
        const $start = qs('#lw-start-btn');
        const $feedLw = qs('#feed-lw-btn');
        if ($bar)   $bar.hidden   = !ctx.streamActive;
        if ($start) {
            $start.classList.toggle('active', ctx.streamActive);
            $start.innerHTML = ctx.streamActive
                ? `<i data-lucide="pause-circle"></i> Pause World`
                : `<i data-lucide="radio"></i> Living World`;
            lucideRefresh($start);
        }
        if ($feedLw) {
            $feedLw.classList.toggle('active', ctx.streamActive);
            $feedLw.innerHTML = ctx.streamActive
                ? `<i data-lucide="pause-circle"></i> Pause`
                : `<i data-lucide="radio"></i> Live`;
            lucideRefresh($feedLw);
        }
    }

    async function lwGeneratePost() {
        if (!state.characters.length || !getApiKey()) return;
        // Inverse-count weighting: characters with fewer posts post more frequently
        const weights = state.characters.map(c =>
            1 / (getAllFeedPosts(c.id, ctx.permanentFeedPosts).length + 1)
        );
        const total = weights.reduce((s, w) => s + w, 0);
        let r = Math.random() * total;
        let pick = state.characters[state.characters.length - 1];
        for (let i = 0; i < state.characters.length; i++) {
            r -= weights[i];
            if (r <= 0) { pick = state.characters[i]; break; }
        }
        const charId  = pick.id;
        const char    = state.loadedCharacters[charId];
        const meta    = pick;
        const charName = char?.name || meta?.name || 'Unknown';
        const scenario = state.reality?.worldConfig?.scenario || '';
        const recentPosts = getAllFeedPosts(charId, ctx.permanentFeedPosts).slice(0, 3).map(p => p.caption).filter(Boolean).join('\n- ');

        // Build a distilled character context from the card for the system prompt
        const desc        = (char?.description || '').slice(0, 400);
        const personality = (char?.personality  || '').slice(0, 300);
        const ext         = char?.extensions?.underdark || {};
        const voice       = ext.voiceTone       ? `Voice: ${ext.voiceTone.slice(0, 120)}` : '';
        const speech      = ext.speechPatterns  ? `Speech: ${ext.speechPatterns.slice(0, 120)}` : '';
        const charScenario = (char?.scenario    || '').slice(0, 200);

        const systemLines = [
            `You are ${charName}. Write exactly as this character — not as a narrator describing them.`,
            desc        && `Character: ${desc}`,
            personality && `Personality: ${personality}`,
            voice       && voice,
            speech      && speech,
            charScenario && `Current setting: ${charScenario}`,
            scenario    && `World context: ${scenario.slice(0, 200)}`,
        ].filter(Boolean).join('\n\n');

        const userLines = [
            `Write a short, in-character social media post (1–3 sentences) as ${charName}.`,
            `No hashtags. No quotes around the post. No "Post:" prefix. Just the post text.`,
            `Be specific and evocative — rooted in this character's voice, world, and current state of mind.`,
            recentPosts && `Recent posts (do not repeat or echo these):\n- ${recentPosts}`,
        ].filter(Boolean).join('\n');

        try {
            const { text } = await fetchCompletion({
                messages: [
                    { role: 'system', content: systemLines },
                    { role: 'user',   content: userLines },
                ],
                model: state.config?.model || 'claude-haiku-4-5-20251001',
                max_tokens: 140,
                apiKey: getApiKey(),
            });

            if (!text?.trim() || !ctx.streamActive) return;

            // Strip any "Post:" / "Name:" prefix the model may prepend despite instructions
            const clean = text.trim()
                .replace(/^(post|reply|update|status)\s*:\s*/i, '')
                .replace(/^["']|["']$/g, '')
                .trim();
            if (!clean) return;

            // ~15% chance of generating an image post alongside the caption
            const doImage = Math.random() < 0.15;

            if (doImage) {
                // Text post saves immediately so the feed has content while image generates
                saveLocalPost(charId, { type: 'text', src: null, caption: clean });
                renderSocialSidebar();
                try {
                    // Lazy-load presets once, cache on ctx
                    if (!ctx._lwPresets) {
                        const r = await fetch('./data/rp-gen-presets.json');
                        ctx._lwPresets = await r.json();
                    }
                    const presets = ctx._lwPresets;
                    const pick1 = (arr) => arr[Math.floor(Math.random() * arr.length)];

                    // Pull all scene entries flat from all groups
                    const allSceneEntries = (presets.scenes?.groups || []).flatMap(g => g.entries || []);
                    // Pick a random scene preset and use its fields as the scene object
                    const scenePreset = pick1(allSceneEntries);
                    // Also pick a random mood preset and merge it
                    const moodPreset  = pick1(presets.mood_presets?.entries || [{ fields: {} }]);
                    const scene = { ...(moodPreset.fields || {}), ...(scenePreset?.fields || {}) };

                    // Build a "don't repeat" hint from the character's recent image post captions
                    const recentImgCaptions = getAllFeedPosts(charId, ctx.permanentFeedPosts)
                        .filter(p => p.type === 'image' && p.caption)
                        .slice(-4)
                        .map(p => p.caption)
                        .join('; ');
                    const userHint = [
                        `Scene context: ${scenePreset?.label || ''}, ${moodPreset?.label || ''}`,
                        recentImgCaptions && `Avoid repeating these recent scenes: ${recentImgCaptions}`,
                        `Caption written for this post: "${clean}"`,
                    ].filter(Boolean).join('. ');

                    const includeNsfw = Math.random() < 0.5;
                    const { positive, negative } = await generateImagePromptWithLLM({
                        charId,
                        userHint,
                        scene,
                        includeNsfw,
                        withNegative: true,
                        historyDepth: 0,
                    });

                    const nsfwModels = ['nano-banana', 'bagel', 'SDXL-ArliMix-v1'];
                    const sfwModels  = ['flux-schnell', 'hidream'];
                    const model      = pick1(includeNsfw ? nsfwModels : sfwModels);

                    const imgDataUrl = await generateImage({ model, prompt: positive, negativePrompt: negative, size: '1024x1024' });
                    if (imgDataUrl && ctx.streamActive) {
                        saveLocalPost(charId, { type: 'image', src: imgDataUrl, caption: clean });
                        if (ctx.feedMode === 'hot') renderHotFeed();
                        else if (ctx.feedMode === charId) renderSocialFeed(charId);
                        renderSocialSidebar();
                    }
                } catch (_) { /* image gen failed — text post already saved */ }
                return;
            }

            saveLocalPost(charId, { type: 'text', src: null, caption: clean });

            if ($feedList && !$feedList.hidden) {
                const av       = getAvatarUrlSync(charId, meta?.avatar_path || char?.avatar) || meta?.avatar_path || char?.avatar;
                const avHtml   = av && !isEmoji(av) ? `style="background-image:url('${esc(av)}')"` : '';
                const avTxt    = av && !isEmoji(av) ? '' : (av || '👤');
                const id       = `lw-${charId}-${Date.now()}`;
                const article  = document.createElement('article');
                article.className = 'feed-post feed-post--text feed-post--lw-new';
                article.dataset.postId  = id;
                article.dataset.charId  = charId;
                article.innerHTML = `
                    <header class="feed-post__header">
                        <div class="feed-post__header-avatar" ${avHtml}>${avTxt}</div>
                        <div class="feed-post__header-info">
                            <span class="feed-post__header-name">${esc(charName)}</span>
                            <span class="feed-post__header-sub">just now</span>
                        </div>
                        <span class="feed-post__lw-badge"><i data-lucide="radio"></i></span>
                    </header>
                    <div class="feed-post__body">
                        <div class="feed-post__caption"><strong>${esc(charName)}</strong> <span class="lw-typing-text"></span><span class="lw-cursor">▌</span></div>
                    </div>`;

                $feedList.prepend(article);
                lucideRefresh(article);

                const $text   = qs('.lw-typing-text', article);
                const $cursor = qs('.lw-cursor', article);
                const chars   = [...clean];
                let i = 0;
                const type = () => {
                    if (i < chars.length) {
                        $text.textContent += chars[i++];
                        setTimeout(type, 18 + Math.random() * 22);
                    } else {
                        if ($cursor) $cursor.remove();
                        article.classList.remove('feed-post--lw-new');
                        setTimeout(() => {
                            if (ctx.feedMode === 'hot') renderHotFeed();
                            else if (ctx.feedMode === charId) renderSocialFeed(charId);
                            renderSocialSidebar();
                        }, 1000);
                    }
                };
                setTimeout(type, 200);
            } else {
                renderSocialSidebar();
            }
        } catch (_) { /* silently skip on error */ }
    }

    function lwScheduleNext() {
        if (!ctx.streamActive) return;
        const jitter = (Math.random() * 0.4 + 0.8);
        ctx.streamTimer = setTimeout(async () => {
            if (!ctx.streamActive) return;
            await lwGeneratePost();
            lwScheduleNext();
        }, ctx.streamSpeed * 1000 * jitter);
    }

    function startLivingWorld() {
        if (!state.characters.length) { showToast('Add characters first.', 'warn'); return; }
        if (!getApiKey()) { showToast('API key required for Living World.', 'warn'); return; }
        ctx.streamActive = true;
        lwUpdateUI();
        switchSidebarTab('social');
        showToast('Living World started — characters are posting.', 'info', 2500);
        lwScheduleNext();
    }

    function pauseLivingWorld() {
        ctx.streamActive = false;
        if (ctx.streamTimer) { clearTimeout(ctx.streamTimer); ctx.streamTimer = null; }
        lwUpdateUI();
        showToast('Living World paused.', 'info', 1500);
    }

    // ── Manual image post request ─────────────────────────────────────────────
    // Picks a random character, randomly decides SFW/NSFW, uses the LLM to
    // write a detailed character-accurate image prompt, then generates the image.
    async function lwRequestImagePost() {
        if (!state.characters.length) { showToast('No characters loaded.', 'warn'); return; }
        if (!getApiKey())             { showToast('API key required.', 'warn'); return; }

        const $btn = qs('#feed-req-image-btn');
        if ($btn) { $btn.disabled = true; $btn.innerHTML = '<i data-lucide="loader-circle"></i> Generating…'; lucideRefresh($btn); }

        try {
            // Random character — weighted by inverse post count same as LW
            const weights = state.characters.map(c =>
                1 / (getAllFeedPosts(c.id, ctx.permanentFeedPosts).length + 1)
            );
            const total = weights.reduce((s, w) => s + w, 0);
            let r = Math.random() * total;
            let pick = state.characters[state.characters.length - 1];
            for (let i = 0; i < state.characters.length; i++) {
                r -= weights[i];
                if (r <= 0) { pick = state.characters[i]; break; }
            }
            const charId   = pick.id;
            const char     = state.loadedCharacters[charId];
            const charName = char?.name || pick.name || 'Unknown';

            // 50/50 SFW vs NSFW
            const includeNsfw = Math.random() < 0.5;

            showToast(`Generating image for ${charName}…`, 'info', 3000);

            // Lazy-load presets, pick a random scene + mood for variety
            if (!ctx._lwPresets) {
                const r = await fetch('./data/rp-gen-presets.json');
                ctx._lwPresets = await r.json();
            }
            const _p1 = (arr) => arr[Math.floor(Math.random() * arr.length)];
            const _allScenes = (ctx._lwPresets.scenes?.groups || []).flatMap(g => g.entries || []);
            const _scenePreset = _p1(_allScenes);
            const _moodPreset  = _p1(ctx._lwPresets.mood_presets?.entries || [{ fields: {} }]);
            const _scene = { ...(_moodPreset.fields || {}), ...(_scenePreset?.fields || {}) };

            const _recentImgCaptions = getAllFeedPosts(charId, ctx.permanentFeedPosts)
                .filter(p => p.type === 'image' && p.caption).slice(-4).map(p => p.caption).join('; ');
            const _userHint = [
                `Scene: ${_scenePreset?.label || ''}, ${_moodPreset?.label || ''}`,
                _recentImgCaptions && `Avoid repeating these recent scenes: ${_recentImgCaptions}`,
            ].filter(Boolean).join('. ');

            // LLM writes a detailed, character-accurate image prompt
            const { positive, negative } = await generateImagePromptWithLLM({
                charId,
                userHint: _userHint,
                scene: _scene,
                includeNsfw,
                withNegative: true,
                historyDepth: 0,
            });

            // Pick model: NSFW-capable models when allowed, flux-schnell for SFW
            const nsfwModels  = ['nano-banana', 'bagel', 'SDXL-ArliMix-v1'];
            const sfwModels   = ['flux-schnell', 'hidream'];
            const modelPool   = includeNsfw ? nsfwModels : sfwModels;
            const model       = modelPool[Math.floor(Math.random() * modelPool.length)];

            const imgDataUrl  = await generateImage({ model, prompt: positive, negativePrompt: negative, size: '1024x1024' });
            if (!imgDataUrl) throw new Error('No image returned.');

            saveLocalPost(charId, { type: 'image', src: imgDataUrl, caption: '' });

            if (ctx.feedMode === 'hot') renderHotFeed();
            else if (ctx.feedMode === charId) renderSocialFeed(charId);
            renderSocialSidebar();
            showToast(`${charName} posted an image.`, 'info', 2000);
        } catch (err) {
            showToast(`Image failed: ${err.message || 'unknown error'}`, 'error', 3500);
        } finally {
            if ($btn) { $btn.disabled = false; $btn.innerHTML = '<i data-lucide="image"></i> Image'; lucideRefresh($btn); }
        }
    }

    qs('#lw-start-btn')?.addEventListener('click', () => {
        if (ctx.streamActive) pauseLivingWorld(); else startLivingWorld();
    });
    qs('#feed-lw-btn')?.addEventListener('click', () => {
        if (ctx.streamActive) pauseLivingWorld(); else startLivingWorld();
    });
    qs('#feed-req-image-btn')?.addEventListener('click', () => lwRequestImagePost());
    qs('#lw-pause-btn')?.addEventListener('click', pauseLivingWorld);
    qs('#lw-speed-select')?.addEventListener('change', e => {
        ctx.streamSpeed = parseInt(e.target.value, 10) || 30;
    });

    return {
        renderSocialFeed,
        renderHotFeed,
        renderSocialSidebar,
        openSocialFeed,
        openHotFeed,
        openComposeModal,
        startLivingWorld,
        pauseLivingWorld,
    };
}
