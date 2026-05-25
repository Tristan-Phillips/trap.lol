/**
 * image-studio.js — Image Studio, Quick Snapshot, and Style Picker for The Underdark.
 *
 * Owns:
 *   - _runQuickSnapshot (one-click scene capture → LLM prompt → generate → thread inject)
 *   - Image Style Picker (5 aesthetic questions)
 *   - Image Studio full wizard (scene chips, presets, model picker, char info, generation)
 *   - Studio gallery strip + session history
 *   - Studio open/close, studio event wiring
 *
 * Call initImageStudio(ctx, deps) once from initUI() after DOM is ready.
 * Returns { runQuickSnapshot, openImgStudio }.
 */

import { qs, qsa, esc, debounce } from './shared-utils.js?v=4';
import { state, saveState, getCharOverride, setCharOverride, defaultCharOverride, addMessage } from './state.js?v=3';
import { resolveImageUrl, saveImageBlob, isDataUrl } from './storage.js?v=3';
import {
    IMAGE_MODELS, DEFAULT_MODEL, buildImagePrompt,
    generateImagePromptWithLLM, describeSceneWithLLM, generateImage
} from './image-engine.js?v=3';
import { getApiKey } from '/hub/glass/script/modules/llm-auth.js?v=3';
import { addToGallery, ensureGalleryStore, getAllGalleryImages } from './gallery.js?v=2';

export function initImageStudio(ctx, {
    lucideRefresh,
    showToast,
    showPickerModal,
    loadCharacterCard,
    renderGalleryStrip,
    renderHotFeed,
    renderSocialFeed,
    renderRoster,
    getAvatarUrlSync,
    isEmoji,
    getImgModel,
    _injectImageMessage,
    _injectImageMessageInto,
}) {
    // ── Quick Snapshot ────────────────────────────────────────────────────────
    // One-click scene capture — uses LLM to build the best possible prompt from
    // current character data + chat history, then generates immediately.
    // No modal, no configuration. Result goes straight into the chat thread.
    async function _runQuickSnapshot(btn = null) {
        if (btn) {
            if (btn.disabled) return;
            btn.disabled = true;
            const orig = btn.innerHTML;
            btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i>';
            lucideRefresh(btn);
            try {
                await _doSnapshot();
            } finally {
                btn.disabled = false;
                btn.innerHTML = orig;
                lucideRefresh(btn);
            }
        } else {
            await _doSnapshot();
        }
    }

    // ── Image Style Picker (for redo) ─────────────────────────────────────────
    // 5 questions, 3 options each. Each option appends a prompt modifier string.
    // Returns a comma-joined modifier string, or null if cancelled.
    const _STYLE_QUESTIONS = [
        {
            q: 'Film feel',
            opts: [
                { label: 'Polaroid / Vintage',  mod: 'polaroid film grain, vintage photograph, faded colours, light leak' },
                { label: 'Cinematic / Epic',     mod: 'cinematic wide shot, dramatic lighting, film still, anamorphic lens' },
                { label: 'Digital Sharp / Clean',mod: 'clean digital render, sharp focus, vivid colours, no grain' },
            ]
        },
        {
            q: 'Lighting',
            opts: [
                { label: 'Neon / Glow',    mod: 'neon lighting, glowing accents, cyberpunk atmosphere, rim lighting' },
                { label: 'Natural / Soft', mod: 'soft natural light, golden hour, diffused shadows, warm tones' },
                { label: 'Dark / Moody',   mod: 'dark moody lighting, deep shadows, low key, chiaroscuro' },
            ]
        },
        {
            q: 'Composition',
            opts: [
                { label: 'Portrait / Close',   mod: 'portrait composition, face close-up, shallow depth of field, bokeh' },
                { label: 'Landscape / Scene',  mod: 'wide establishing shot, landscape composition, environmental storytelling' },
                { label: 'Action / Dynamic',   mod: 'dynamic composition, motion blur, dramatic angle, action shot' },
            ]
        },
        {
            q: 'Palette / Tone',
            opts: [
                { label: 'Gothic / Dark',   mod: 'gothic palette, deep purples and blacks, desaturated, dark fantasy' },
                { label: 'Warm / Golden',   mod: 'warm golden palette, amber tones, rich warm light, cozy atmosphere' },
                { label: 'Cool / Ethereal', mod: 'cool ethereal palette, blues and silvers, misty, otherworldly glow' },
            ]
        },
        {
            q: 'Texture / Medium',
            opts: [
                { label: 'Painterly / Oil',    mod: 'oil painting style, painterly texture, brushstrokes visible, fine art' },
                { label: 'Photo-Realistic',    mod: 'photorealistic, hyperdetailed, 8k resolution, photographic quality' },
                { label: 'Stylised / Graphic', mod: 'stylised illustration, graphic novel aesthetic, bold lines, flat shading' },
            ]
        },
    ];

    async function _showStylePicker() {
        const modal = qs('#modal-choice-picker');
        if (!modal) return '';

        const selections = [];
        for (let qi = 0; qi < _STYLE_QUESTIONS.length; qi++) {
            const { q, opts } = _STYLE_QUESTIONS[qi];
            const chosen = await showPickerModal(
                `Style (${qi + 1}/${_STYLE_QUESTIONS.length}): ${q}`,
                async () => opts.map(o => o.label)
            );
            if (chosen === null) return null;
            const match = opts.find(o => o.label === chosen);
            if (match) selections.push(match.mod);
        }
        return selections.join(', ');
    }

    // Inject a loading placeholder into the thread and return it.
    // Caller replaces it with the real image when generation completes.
    function _injectImagePlaceholder() {
        const $thread = qs('#message-thread');
        if (!$thread) return null;
        const $el = document.createElement('div');
        $el.className = 'message message--image message--image-loading';
        $el.innerHTML = `
            <div class="message__main">
                <div class="img-loading-block">
                    <div class="img-loading-block__bar-wrap">
                        <div class="img-loading-block__bar"></div>
                    </div>
                    <div class="img-loading-block__label"><i data-lucide="aperture"></i> Generating scene…</div>
                </div>
            </div>`;
        $thread.appendChild($el);
        lucideRefresh($el);
        $thread.scrollTop = $thread.scrollHeight;
        return $el;
    }

    async function _doSnapshot(styleModifiers = '') {
        const charId     = state.activeBotId;
        const nsfwFlag   = state.config.flags?.injectAdult !== false;
        const includeNsfw = nsfwFlag;
        const nsfwLevel  = nsfwFlag ? 'explicit' : 'sfw';

        // Ensure the character card is loaded before building the prompt
        if (charId && !state.loadedCharacters[charId]) {
            await loadCharacterCard(charId).catch(() => null);
        }

        // Show loading placeholder in the thread immediately
        const $placeholder = _injectImagePlaceholder();

        try {
            // Build prompt via LLM — reads char physical sheet + last 8 chat messages
            const basePrompt = await generateImagePromptWithLLM({
                charId,
                userHint: styleModifiers || '',
                scene:        { nsfw: nsfwLevel },
                includeNsfw,
                historyDepth: 8,
            });
            const prompt = styleModifiers ? `${basePrompt}, ${styleModifiers}` : basePrompt;

            const model = getImgModel();

            const { negative } = buildImagePrompt({ charId, scene: { nsfw: nsfwLevel }, includeNsfw, nsfwLevel });
            const dataUrl = await generateImage({ model, prompt, negativePrompt: negative, size: '1024x1024' });

            // Replace placeholder with real image — addMessage persists it to history/IDB
            const persistedMsg = addMessage('image', dataUrl, null, { prompt, model });
            if ($placeholder && $placeholder.parentNode) {
                const $real = document.createElement('div');
                $real.className = 'message message--image';
                $placeholder.parentNode.replaceChild($real, $placeholder);
                _injectImageMessageInto($real, dataUrl, prompt, model, persistedMsg.id);
                const $t = qs('#message-thread'); if ($t) $t.scrollTop = $t.scrollHeight;
            } else {
                _injectImageMessage(dataUrl, prompt, model, persistedMsg.id);
            }

            if (charId) {
                await addToGallery(charId, dataUrl);
                renderGalleryStrip(charId);
                if (ctx.$feedArena && !ctx.$feedArena.hidden) {
                    if (ctx.feedMode === 'hot') renderHotFeed();
                    else if (ctx.feedMode === charId) renderSocialFeed(charId);
                }
            }
            showToast('Scene captured', 'info', 2000);
        } catch (err) {
            $placeholder?.remove();
            throw err;
        }
    }

    // Gallery → open studio instead of the removed modal
    qs('#gallery-gen-new')?.addEventListener('click', () => {
        const cid = ctx.galleryCharId || state.activeBotId;
        qs('#modal-gallery').hidden = true;
        openImgStudio(cid);
    });

    // Toolbar snapshot button
    qs('#btn-quick-snapshot')?.addEventListener('click', function() { _runQuickSnapshot(this).catch(err => showToast(`Snapshot failed: ${err.message}`, 'error', 5000)); });


    // ── Image Studio — full wizard ─────────────────────────────────────────────
    // ctx.studioPresets, ctx.studioWired, ctx.studioCharId declared in ctx above

    // Studio scene state — mirrors _scene shape plus extra fields for
    // the studio-only chip groups (clothingTop, clothingBottom, etc.)
    let _studioScene = {
        nsfw:              'sfw',
        // char tab
        hair:              null,
        expr:              null,
        skinEffects:       new Set(),
        // outfit tab
        clothingState:     null,
        clothing:          null,
        clothingTop:       null,
        clothingBottom:    null,
        clothingFootwear:  null,
        accessories:       new Set(),
        clothingCustom:    '',
        // pose tab
        cam:               null,
        pose:              null,
        bodyFocus:         null,
        partners:          null,
        activity:          null,
        poseCustom:        '',
        activityCustom:    '',
        // scene tab
        env:               null,
        timeOfDay:         null,
        weather:           null,
        mood:              null,
        vibe:              null,
        fantasyFx:         new Set(),
        envCustom:         '',
        // style tab
        style:             'photorealistic photography, 8k',
        colorTone:         null,
        composition:       null,
        quality:           new Set(),
        positive:          '',
        negative:          '',
        // model tab
        size:              '1024x1024',
        seed:              '',
    };

    const _STUDIO_MULTI_GROUPS = new Set(['accessories','quality','skinEffects','fantasyFx']);
    const _studioHistory = []; // session-local [{src, prompt, model, ts}], max 20

    ctx.studioModel = DEFAULT_MODEL;   // set after DEFAULT_MODEL import is resolved

    // ── Reset all scene selections to defaults ────────────────────────────────
    function _resetStudioScene(skipNsfw = false) {
        Object.assign(_studioScene, {
            hair: null, expr: null, clothingState: null, clothing: null,
            clothingTop: null, clothingBottom: null, clothingFootwear: null,
            cam: null, pose: null, bodyFocus: null, partners: null, activity: null,
            env: null, timeOfDay: null, weather: null, mood: null, vibe: null,
            style: 'photorealistic photography, 8k', colorTone: null, composition: null,
            poseCustom: '', activityCustom: '', clothingCustom: '', envCustom: '',
            positive: '', negative: '',
        });
        if (!skipNsfw) _studioScene.nsfw = 'sfw';
        _studioScene.accessories.clear();
        _studioScene.quality.clear();
        _studioScene.skinEffects.clear();
        _studioScene.fantasyFx.clear();
        qs('#img-studio')?.querySelectorAll('.studio-custom-input').forEach(i => { i.hidden = true; i.value = ''; });
        qs('#img-studio')?.querySelectorAll('.studio-preset-card').forEach(c => c.classList.remove('active'));
        qs('#img-studio')?.querySelectorAll('.studio-rel-pill').forEach(c => c.classList.remove('active'));
    }

    // ── Fetch presets JSON once ───────────────────────────────────────────────
    async function _loadStudioPresets() {
        if (ctx.studioPresets) return ctx.studioPresets;
        try {
            const res  = await fetch('https://api.trap.lol/pallet/data/rp-gen-presets.json');
            ctx.studioPresets = await res.json();
        } catch (_) {
            ctx.studioPresets = {};
        }
        return ctx.studioPresets;
    }

    // ── Render a flat chip list into a container ──────────────────────────────
    function _renderChips($container, entries, field, multi = false, customId = null) {
        if (!$container) return;
        $container.innerHTML = '';
        entries.forEach(e => {
            const $c = document.createElement('button');
            $c.className = `studio-chip${multi ? ' studio-chip--multi' : ''}${e.val === '__custom__' ? ' studio-chip--custom' : ''}`;
            $c.dataset.field = field;
            $c.dataset.val   = e.val ?? e.id;
            $c.textContent   = e.label;
            $c.type          = 'button';
            // Sync active state from _studioScene
            if (multi) {
                const set = _studioScene[field];
                if (set instanceof Set && set.has($c.dataset.val)) $c.classList.add('active');
            } else {
                if (_studioScene[field] === $c.dataset.val) $c.classList.add('active');
            }
            $container.appendChild($c);
        });
        // Wire clicks
        $container.addEventListener('click', e => {
            const $chip = e.target.closest('.studio-chip');
            if (!$chip || $chip.dataset.field !== field) return;
            const val = $chip.dataset.val;

            if ($chip.classList.contains('studio-chip--custom') && customId) {
                const $ci = qs(`#${customId}`);
                if ($ci) {
                    const open = $ci.hidden;
                    $ci.hidden = !open;
                    if (open) {
                        _studioScene[field] = '__custom__';
                        $container.querySelectorAll('.studio-chip').forEach(x => x.classList.remove('active'));
                        $chip.classList.add('active');
                        $ci.focus();
                    } else {
                        if (_studioScene[field] === '__custom__') {
                            _studioScene[field] = null;
                            $chip.classList.remove('active');
                        }
                    }
                    _studioRebuildPrompt();
                    return;
                }
            }

            if (multi) {
                const set = _studioScene[field] instanceof Set ? _studioScene[field] : (_studioScene[field] = new Set());
                if (set.has(val)) {
                    set.delete(val);
                    $chip.classList.remove('active');
                } else {
                    set.add(val);
                    $chip.classList.add('active');
                }
            } else {
                const already = _studioScene[field] === val;
                _studioScene[field] = already ? null : val;
                $container.querySelectorAll(`.studio-chip[data-field="${field}"]`).forEach(x => x.classList.remove('active'));
                if (!already) $chip.classList.add('active');
            }
            _studioRebuildPrompt();
            _studioUpdateBadges();
        });
    }

    // ── Render grouped chips (env, activity) ─────────────────────────────────
    function _renderGroupedChips($wrapper, groups, field, customId = null) {
        if (!$wrapper) return;
        $wrapper.innerHTML = '';
        groups.forEach(grp => {
            const $gl  = document.createElement('div');
            $gl.className = 'studio-subgroup';
            $gl.textContent = grp.label;
            $wrapper.appendChild($gl);

            const $chips = document.createElement('div');
            $chips.className = 'studio-chips';
            $chips.style.padding = '0 14px 6px';
            $wrapper.appendChild($chips);
            _renderChips($chips, grp.entries, field, false, customId);
        });
    }

    // ── Render scene preset cards from JSON ───────────────────────────────────
    function _makePresetCard(p, $grid, { noReset = false } = {}) {
        const $c = document.createElement('button');
        $c.className = 'studio-preset-card';
        $c.dataset.presetId = p.id;
        $c.type = 'button';
        $c.innerHTML = `<i data-lucide="${p.icon || 'star'}"></i><span>${esc(p.label)}</span>`;
        $c.addEventListener('click', () => {
            const was = $c.classList.contains('active');
            $grid.querySelectorAll('.studio-preset-card').forEach(x => x.classList.remove('active'));
            if (!was) {
                _applyStudioScenePreset(p, noReset);
                $c.classList.add('active');
            }
            _studioRebuildPrompt();
            _studioUpdateBadges();
            lucideRefresh($c);
        });
        return $c;
    }

    function _renderScenePresetCards() {
        const $grid = qs('#studio-scene-preset-grid');
        if (!$grid || !ctx.studioPresets?.scenes) return;
        $grid.innerHTML = '';
        const scenes = ctx.studioPresets.scenes;
        if (scenes.groups) {
            scenes.groups.forEach(grp => {
                const $lbl = document.createElement('div');
                $lbl.className = 'studio-preset-group-label';
                $lbl.textContent = grp.label;
                $grid.appendChild($lbl);
                const $row = document.createElement('div');
                $row.className = 'studio-preset-group-row';
                grp.entries.forEach(p => $row.appendChild(_makePresetCard(p, $grid)));
                $grid.appendChild($row);
            });
        } else {
            (scenes.entries || []).forEach(p => $grid.appendChild(_makePresetCard(p, $grid)));
        }
        lucideRefresh($grid);
    }

    function _renderMoodPresets() {
        const $grid = qs('#studio-mood-preset-grid');
        if (!$grid || !ctx.studioPresets?.mood_presets?.entries) return;
        $grid.innerHTML = '';
        ctx.studioPresets.mood_presets.entries.forEach(p => $grid.appendChild(_makePresetCard(p, $grid, { noReset: true })));
        lucideRefresh($grid);
    }

    function _renderOutfitPresets() {
        const $grid = qs('#studio-outfit-preset-grid');
        if (!$grid || !ctx.studioPresets?.outfit_presets?.entries) return;
        $grid.innerHTML = '';
        ctx.studioPresets.outfit_presets.entries.forEach(p => $grid.appendChild(_makePresetCard(p, $grid, { noReset: true })));
        lucideRefresh($grid);
    }

    function _renderActivityPresets() {
        const $grid = qs('#studio-activity-preset-grid');
        if (!$grid || !ctx.studioPresets?.activity_presets?.entries) return;
        $grid.innerHTML = '';
        ctx.studioPresets.activity_presets.entries.forEach(p => $grid.appendChild(_makePresetCard(p, $grid, { noReset: true })));
        lucideRefresh($grid);
    }

    function _applyStudioScenePreset(preset, noReset = false) {
        if (!noReset) _resetStudioScene(true);   // skipNsfw — don't touch the NSFW level

        const f = preset.fields || {};
        Object.keys(f).forEach(k => {
            if (k.endsWith('_add')) {
                const realKey = k.slice(0, -4);
                const set = _studioScene[realKey] instanceof Set ? _studioScene[realKey] : (_studioScene[realKey] = new Set());
                (Array.isArray(f[k]) ? f[k] : [f[k]]).forEach(v => set.add(v));
            } else {
                _studioScene[k] = f[k];
            }
        });
        _syncStudioChipsToState();
    }

    // ── Render relationship pills ─────────────────────────────────────────────
    function _renderRelPills() {
        const $c = qs('#studio-rel-pills');
        if (!$c || !ctx.studioPresets?.relationships?.entries) return;
        $c.innerHTML = '';
        ctx.studioPresets.relationships.entries.forEach(r => {
            const $p = document.createElement('button');
            $p.className = 'studio-rel-pill';
            $p.dataset.relId = r.id;
            $p.type = 'button';
            $p.textContent = r.label;
            $p.addEventListener('click', () => {
                const was = $p.classList.contains('active');
                $c.querySelectorAll('.studio-rel-pill').forEach(x => x.classList.remove('active'));
                if (!was) {
                    if (r.vibe)        _studioScene.vibe = r.vibe;
                    if (r.expr)        _studioScene.expr = r.expr;
                    if (r.accessories && String(r.accessories).trim()) {
                        if (!(_studioScene.accessories instanceof Set)) _studioScene.accessories = new Set();
                        _studioScene.accessories.add(String(r.accessories).trim());
                    }
                    $p.classList.add('active');
                    _syncStudioChipsToState();
                    _studioRebuildPrompt();
                    _studioUpdateBadges();
                }
            });
            $c.appendChild($p);
        });
    }

    // ── Render model grid inside studio Model tab ─────────────────────────────
    function _renderStudioModelGrid() {
        const $grid = qs('#studio-model-grid');
        if (!$grid) return;
        const nsfwActive = _studioScene.nsfw !== 'sfw';
        $grid.innerHTML = IMAGE_MODELS.map(m => {
            const tags  = m.tags.map(t => `<span class="studio-model-tag studio-model-tag--${t}">${t}</span>`).join('');
            const sub   = m.sub
                ? `<span class="studio-model-card__sub studio-model-card__sub--included">SUB</span>`
                : `<span class="studio-model-card__sub studio-model-card__sub--credits">CREDITS</span>`;
            const warn  = nsfwActive && !m.nsfw ? ' style="opacity:.55"' : '';
            const active = m.id === ctx.studioModel ? ' active' : '';
            return `<button class="studio-model-card${active}" data-model="${esc(m.id)}" type="button"${warn}>
                <div class="studio-model-card__label">${esc(m.label)}</div>
                <div class="studio-model-card__tags">${tags}</div>
                <div class="studio-model-card__desc">${esc(m.desc)}</div>
                ${sub}
            </button>`;
        }).join('');
        $grid.querySelectorAll('.studio-model-card').forEach($c => {
            $c.addEventListener('click', () => {
                ctx.studioModel = $c.dataset.model;
                $grid.querySelectorAll('.studio-model-card').forEach(x => x.classList.toggle('active', x.dataset.model === ctx.studioModel));
                // Also sync the action-row select
                const $sel = qs('#studio-model-select');
                if ($sel) $sel.value = ctx.studioModel;
            });
        });
        // Also populate action-row select
        const $sel = qs('#studio-model-select');
        if ($sel) {
            $sel.innerHTML = IMAGE_MODELS.map(m =>
                `<option value="${esc(m.id)}"${m.id === ctx.studioModel ? ' selected' : ''}>${esc(m.label)}${m.nsfw ? '' : ' ★'}</option>`
            ).join('');
            $sel.addEventListener('change', () => {
                ctx.studioModel = $sel.value;
                $grid.querySelectorAll('.studio-model-card').forEach(x => x.classList.toggle('active', x.dataset.model === ctx.studioModel));
            });
        }
    }

    // ── Seed charOverride from card.extensions.underdark (mirrors openEditor logic) ──
    // Called before any display path that reads override fields. Safe to call multiple
    // times — user edits stored in _userEdits are always preferred over card defaults.
    function _ensureOverrideSeededFromCard(charId) {
        const card = state.loadedCharacters[charId];
        if (!card) { console.warn('[studio] _ensureOverride: no loaded card for', charId); return; }
        if (!card.extensions?.underdark) { console.warn('[studio] _ensureOverride: no underdark ext on card', charId, Object.keys(card.extensions || {})); return; }

        const ud = card.extensions.underdark;
        const { ext: cardExt, ...cardCore } = ud;
        const coreKeys = new Set(Object.keys(defaultCharOverride()));
        const coreFromCard = {};
        const extFromCard  = { ...(cardExt || {}) };

        for (const [k, v] of Object.entries(cardCore)) {
            if (coreKeys.has(k)) coreFromCard[k] = v;
            else extFromCard[k] = v;
        }

        const stored    = state.config?.charOverrides?.[charId] || {};
        const userEdits = stored._userEdits || {};
        const mergedExt  = { ...extFromCard,  ...(userEdits.ext  || {}) };
        const mergedCore = { ...coreFromCard, ...(userEdits.core || {}) };
        setCharOverride(charId, { ...mergedCore, ext: mergedExt });
    }

    // ── Build character info strip ────────────────────────────────────────────
    async function _renderStudioCharInfo(charId) {
        const $name   = qs('#studio-char-name');
        const $traits = qs('#studio-char-traits');
        const $snip   = qs('#studio-char-scene-snippet');
        const $port   = qs('#studio-char-portrait');
        const $badge  = qs('#studio-char-badge');
        const $badgeName = qs('#studio-char-badge-name');
        const $badgeAv   = qs('#studio-char-avatar-sm');

        if (!charId) {
            if ($name) $name.textContent = 'No character selected';
            if ($traits) $traits.innerHTML = '';
            if ($snip)  $snip.textContent = '';
            if ($badge) $badge.hidden = true;
            return;
        }

        // Ensure card is loaded then seed override from card data — the editor
        // does this on open, but the studio may be opened without ever opening
        // the editor, leaving override fields blank.
        if (!state.loadedCharacters[charId]) {
            await loadCharacterCard(charId).catch(e => console.error('[studio] card load failed:', e));
        }
        _ensureOverrideSeededFromCard(charId);

        const char     = state.loadedCharacters[charId];
        const override = getCharOverride(charId);
        const meta     = state.characters.find(c => c.id === charId);
        const charName = override.nickname || char?.name || meta?.name || 'Character';

        if ($name) $name.textContent = charName;
        if ($badge) { $badge.hidden = false; }
        if ($badgeName) $badgeName.textContent = charName;

        // Portrait — resolve IDB refs before setting src
        const rawAv    = meta?.avatar_path || char?.avatar || '';
        const avatarSrc = rawAv
            ? (getAvatarUrlSync(charId, rawAv) || await resolveImageUrl(rawAv).catch(() => null))
            : null;
        if ($port) {
            $port.src = avatarSrc || '';
            $port.hidden = !avatarSrc;
        }
        if ($badgeAv) {
            $badgeAv.src = avatarSrc || '';
            $badgeAv.hidden = !avatarSrc;
        }

        // Trait chips: hair, eyes, age, species, body type, skin
        if ($traits) {
            const traits = [];
            if (override.hairColor) traits.push({ label: `${override.hairColor}${override.hairStyle ? ' ' + override.hairStyle : ''} hair`, type: '' });
            if (override.eyeColor)  traits.push({ label: `${override.eyeColor} eyes`, type: '' });
            if (override.age)       traits.push({ label: override.age, type: 'gold' });
            if (override.species && override.species.toLowerCase() !== 'human') traits.push({ label: override.species, type: 'gold' });
            if (override.bodyType)  traits.push({ label: override.bodyType, type: '' });
            if (override.skinTone)  traits.push({ label: override.skinTone, type: '' });
            if (override.height)    traits.push({ label: override.height, type: '' });
            $traits.innerHTML = traits.map(t =>
                `<span class="img-studio__char-trait${t.type === 'gold' ? ' img-studio__char-trait--gold' : ''}">${esc(t.label)}</span>`
            ).join('');
        }

        // Scene snippet from last bot message
        if ($snip) {
            const lastBot = [...state.history].reverse().find(m => m.role === 'bot');
            const text = lastBot?.content?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || '';
            $snip.textContent = text ? text + '…' : '';
        }

        // Render the char physical data sheet in the Character tab
        _renderStudioCharFields(charId);
    }

    function _renderStudioCharFields(charId) {
        const $fields = qs('#studio-char-fields');
        if (!$fields) return;
        const override = getCharOverride(charId);
        const PHYS_KEYS = [
            ['species',      'Species'],
            ['gender',       'Gender'],
            ['age',          'Age'],
            ['height',       'Height'],
            ['bodyType',     'Body Type'],
            ['skinTone',     'Skin'],
            ['hairColor',    'Hair Color'],
            ['hairStyle',    'Hair Style'],
            ['eyeColor',     'Eye Color'],
            ['faceShape',    'Face Shape'],
            ['complexion',   'Complexion'],
            ['lipsType',     'Lips'],
            ['distinctiveFeatures', 'Features'],
            ['tattoos',      'Tattoos'],
            ['scarsMarks',   'Scars/Marks'],
            ['styleArchetype','Style'],
            ['outfitDescription','Outfit'],
            ['breastSize',   'Breasts'],
            ['buttocksSize', 'Buttocks'],
        ];
        $fields.innerHTML = PHYS_KEYS.map(([k, label]) => {
            const v = override[k];
            const filled = v && String(v).trim() && String(v).toLowerCase() !== 'n/a';
            return `<div class="studio-char-field-row">
                <span class="studio-char-field-label">${esc(label)}</span>
                <span class="studio-char-field-val${filled ? ' studio-char-field-val--filled' : ' studio-char-field-val--empty'}">${filled ? esc(String(v).trim()) : '—'}</span>
            </div>`;
        }).join('');
    }

    // ── Badge counts on nav tabs ──────────────────────────────────────────────
    function _studioUpdateBadges() {
        const counts = {
            outfit: (['clothingState','clothing','clothingTop','clothingBottom','clothingFootwear'].filter(k => _studioScene[k]).length + _studioScene.accessories.size),
            pose:   (['cam','pose','bodyFocus','partners','activity'].filter(k => _studioScene[k]).length),
            scene:  (['env','timeOfDay','weather','mood','vibe'].filter(k => _studioScene[k]).length + _studioScene.fantasyFx.size),
            style:  (['colorTone','composition'].filter(k => _studioScene[k]).length + _studioScene.quality.size + (_studioScene.style !== 'photorealistic photography, 8k' ? 1 : 0)),
        };
        Object.keys(counts).forEach(tab => {
            const $b = qs(`#studio-badge-${tab}`);
            if (!$b) return;
            if (counts[tab] > 0) {
                $b.textContent = counts[tab];
                $b.hidden = false;
            } else {
                $b.hidden = true;
            }
        });
    }

    // ── Rebuild prompt from studio state ─────────────────────────────────────
    function _studioRebuildPrompt() {
        // Pass all _studioScene fields through as-is — buildImagePrompt handles
        // clothingTop/Bottom/Footwear as native additive fields.
        const merged = {
            nsfw:            _studioScene.nsfw,
            clothingState:   _studioScene.clothingState,
            clothing:        _studioScene.clothing,
            clothingTop:     _studioScene.clothingTop,
            clothingBottom:  _studioScene.clothingBottom,
            clothingFootwear:_studioScene.clothingFootwear,
            clothingCustom:  _studioScene.clothingCustom,
            accessories:     _studioScene.accessories,
            hair:            _studioScene.hair,
            cam:             _studioScene.cam,
            pose:            _studioScene.pose,
            poseCustom:      _studioScene.poseCustom,
            activity:        _studioScene.activity,
            activityCustom:  _studioScene.activityCustom,
            bodyFocus:       _studioScene.bodyFocus,
            partners:        _studioScene.partners,
            expr:            _studioScene.expr,
            skinEffects:     _studioScene.skinEffects,
            env:             _studioScene.env,
            envCustom:       _studioScene.envCustom,
            timeOfDay:       _studioScene.timeOfDay,
            weather:         _studioScene.weather,
            mood:            _studioScene.mood,
            vibe:            _studioScene.vibe,
            fantasyFx:       _studioScene.fantasyFx,
            style:           _studioScene.style,
            colorTone:       _studioScene.colorTone,
            composition:     _studioScene.composition,
            quality:         _studioScene.quality,
            positive:        _studioScene.positive,
            negative:        _studioScene.negative,
        };

        const charId = ctx.studioCharId || state.activeBotId;
        const includeNsfw = _studioScene.nsfw !== 'sfw';
        const { positive, negative } = buildImagePrompt({ charId, scene: merged, includeNsfw, nsfwLevel: _studioScene.nsfw });

        const $ta  = qs('#studio-prompt-ta');
        const $neg = qs('#studio-neg-ta');
        if ($ta)  $ta.value  = positive;
        if ($neg) $neg.value = negative;
    }

    // ── Sync all chip active states to _studioScene ───────────────────────────
    function _syncStudioChipsToState() {
        const $studio = qs('#img-studio');
        if (!$studio) return;
        $studio.querySelectorAll('.studio-chip[data-field]').forEach($c => {
            const field = $c.dataset.field;
            const val   = $c.dataset.val;
            if (!field) return;
            if (_STUDIO_MULTI_GROUPS.has(field)) {
                const s = _studioScene[field];
                $c.classList.toggle('active', s instanceof Set && s.has(val));
            } else {
                $c.classList.toggle('active', _studioScene[field] === val);
            }
        });
        // Sync NSFW pills
        $studio.querySelectorAll('.studio-nsfw-pill').forEach($p => {
            $p.classList.toggle('active', $p.dataset.nsfw === _studioScene.nsfw);
        });
        // Sync homebrew textareas
        const $sp = qs('#studio-positive');
        const $sn = qs('#studio-negative');
        if ($sp) $sp.value = _studioScene.positive;
        if ($sn) $sn.value = _studioScene.negative;
        // Sync size chips
        $studio.querySelectorAll('.studio-chip[data-field="size"]').forEach($c => {
            $c.classList.toggle('active', $c.dataset.val === _studioScene.size);
        });
    }

    // ── Full studio population from presets ───────────────────────────────────
    async function _initStudioPanels() {
        const p = await _loadStudioPresets();
        if (!p) return;

        // Quick tab
        _renderScenePresetCards();
        _renderRelPills();
        _renderMoodPresets();
        _renderOutfitPresets();
        _renderActivityPresets();

        // Char tab
        _renderChips(qs('#studio-hair-chips'),         p.hair?.entries      || [], 'hair');
        _renderChips(qs('#studio-expr-chips'),          p.expressions?.entries || [], 'expr');
        _renderChips(qs('#studio-skineffects-chips'),   p.skin_effects?.entries || [], 'skinEffects', true);

        // Outfit tab
        const clothingGroups = p.clothing?.groups || [];
        const stateGrp   = clothingGroups.find(g => g.id === 'state');
        const typeGrp    = clothingGroups.find(g => g.id === 'type');
        const topGrp     = clothingGroups.find(g => g.id === 'top');
        const bottomGrp  = clothingGroups.find(g => g.id === 'bottom');
        const footwearGrp= clothingGroups.find(g => g.id === 'footwear');
        if (stateGrp)   _renderChips(qs('#studio-clothingstate-chips'),  stateGrp.entries,    'clothingState');
        if (typeGrp)    _renderChips(qs('#studio-clothing-chips'),        typeGrp.entries,     'clothing', false, 'studio-clothing-custom');
        if (topGrp)     _renderChips(qs('#studio-clothingtop-chips'),     topGrp.entries,      'clothingTop');
        if (bottomGrp)  _renderChips(qs('#studio-clothingbottom-chips'),  bottomGrp.entries,   'clothingBottom');
        if (footwearGrp)_renderChips(qs('#studio-footwear-chips'),        footwearGrp.entries, 'clothingFootwear');
        _renderChips(qs('#studio-accessories-chips'), p.accessories?.entries || [], 'accessories', true);

        // Pose tab
        _renderChips(qs('#studio-cam-chips'),        p.camera?.entries    || [], 'cam');
        _renderChips(qs('#studio-pose-chips'),        p.poses?.entries     || [], 'pose', false, 'studio-pose-custom');
        _renderChips(qs('#studio-bodyfocus-chips'),   p.body_focus?.entries || [], 'bodyFocus');
        _renderChips(qs('#studio-partners-chips'),    p.partners?.entries  || [], 'partners');
        _renderGroupedChips(qs('#studio-activity-groups'), p.activities?.groups || [], 'activity', 'studio-activity-custom');

        // Scene tab
        _renderGroupedChips(qs('#studio-env-groups'), p.environments?.groups || [], 'env', 'studio-env-custom');
        _renderChips(qs('#studio-timeofday-chips'),   p.time_of_day?.entries || [], 'timeOfDay');
        _renderChips(qs('#studio-weather-chips'),     p.weather?.entries   || [], 'weather');
        _renderChips(qs('#studio-mood-chips'),        p.lighting?.entries  || [], 'mood');
        _renderChips(qs('#studio-vibe-chips'),        p.vibes?.entries     || [], 'vibe');
        _renderChips(qs('#studio-fantasyfx-chips'),   p.fantasy_fx?.entries || [], 'fantasyFx', true);

        // Style tab
        _renderChips(qs('#studio-style-chips'),       p.art_styles?.entries || [], 'style');
        _renderChips(qs('#studio-colortone-chips'),    p.color_tones?.entries || [], 'colorTone');
        _renderChips(qs('#studio-composition-chips'),  p.compositions?.entries || [], 'composition');
        _renderChips(qs('#studio-quality-chips'),      p.quality_tags?.entries || [], 'quality', true);

        // Model tab
        _renderStudioModelGrid();

        // Size chips (already in HTML, just wire them)
        qs('#img-studio')?.querySelectorAll('.studio-chip[data-field="size"]').forEach($c => {
            $c.addEventListener('click', () => {
                _studioScene.size = $c.dataset.val;
                qs('#img-studio').querySelectorAll('.studio-chip[data-field="size"]').forEach(x => x.classList.toggle('active', x.dataset.val === _studioScene.size));
                const $ss = qs('#studio-size-select');
                if ($ss) $ss.value = _studioScene.size;
            });
        });

        // Custom text inputs
        const customInputs = [
            ['#studio-clothing-custom', 'clothingCustom'],
            ['#studio-pose-custom',     'poseCustom'],
            ['#studio-activity-custom', 'activityCustom'],
            ['#studio-env-custom',      'envCustom'],
        ];
        customInputs.forEach(([sel, key]) => {
            qs(sel)?.addEventListener('input', e => {
                _studioScene[key] = e.target.value;
                _studioRebuildPrompt();
            });
        });

        // Homebrew
        qs('#studio-positive')?.addEventListener('input', e => { _studioScene.positive = e.target.value; });
        qs('#studio-negative')?.addEventListener('input', e => { _studioScene.negative = e.target.value; });

        // Reset
        qs('#studio-reset-btn')?.addEventListener('click', () => {
            _resetStudioScene();
            _syncStudioChipsToState();
            _studioRebuildPrompt();
            _studioUpdateBadges();
            showToast('Studio reset', 'info', 1200);
        });
    }

    // ── Wire studio nav tabs ──────────────────────────────────────────────────
    function _wireStudioNav() {
        qs('#studio-nav')?.addEventListener('click', e => {
            const $btn = e.target.closest('.img-studio__nav-btn');
            if (!$btn) return;
            const tab = $btn.dataset.tab;
            qs('#studio-nav').querySelectorAll('.img-studio__nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
            qs('#img-studio').querySelectorAll('.img-studio__panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
        });

        // NSFW bar
        qs('#studio-nsfw-bar')?.addEventListener('click', e => {
            const $p = e.target.closest('.studio-nsfw-pill');
            if (!$p) return;
            _studioScene.nsfw = $p.dataset.nsfw;
            qs('#studio-nsfw-bar').querySelectorAll('.studio-nsfw-pill').forEach(x => x.classList.remove('active'));
            $p.classList.add('active');
            _studioRebuildPrompt();
            _renderStudioModelGrid();
        });

        // Size select in action row
        qs('#studio-size-select')?.addEventListener('change', e => {
            _studioScene.size = e.target.value;
        });
    }

    // ── Quick capture buttons ─────────────────────────────────────────────────
    function _wireQuickCapture() {
        qs('#studio-quick-capture-grid')?.addEventListener('click', async e => {
            const $btn = e.target.closest('[data-quick]');
            if (!$btn) return;
            const type  = $btn.dataset.quick;
            const charId = state.activeBotId;

            const $ta  = qs('#studio-prompt-ta');
            const origText = $btn.innerHTML;
            $btn.disabled = true;
            $btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Working…';
            lucideRefresh($btn);

            try {
                let prompt = '';
                if (type === 'char_solo') {
                    // Full body, no scene context
                    const merged = { nsfw: _studioScene.nsfw, cam: 'full body shot', style: _studioScene.style || 'photorealistic photography, 8k' };
                    const { positive } = buildImagePrompt({ charId, scene: merged, includeNsfw: _studioScene.nsfw !== 'sfw', nsfwLevel: _studioScene.nsfw, historyDepth: 0 });
                    prompt = positive;
                } else if (type === 'char_face') {
                    const merged = { nsfw: _studioScene.nsfw, cam: 'close-up portrait, face', style: _studioScene.style || 'photorealistic photography, 8k', expr: 'natural, beautiful expression' };
                    const { positive } = buildImagePrompt({ charId, scene: merged, includeNsfw: false, nsfwLevel: 'sfw', historyDepth: 0 });
                    prompt = positive;
                } else if (type === 'scene_now') {
                    // Full scene from current state + history
                    _studioRebuildPrompt();
                    return;
                } else if (type === 'scene_vibe') {
                    // LLM-assisted — reads last messages
                    prompt = await generateImagePromptWithLLM({ charId, userHint: '', scene: _studioScene, includeNsfw: _studioScene.nsfw !== 'sfw', historyDepth: 8 });
                }
                if ($ta && prompt) $ta.value = prompt;
            } catch (err) {
                showToast(`Quick capture failed: ${err.message}`, 'error', 4000);
            } finally {
                $btn.disabled = false;
                $btn.innerHTML = origText;
                lucideRefresh($btn);
            }
        });
    }

    // ── Studio image generation ───────────────────────────────────────────────
    async function _runStudioGeneration() {
        const $genBtn  = qs('#studio-gen-btn');
        const $regen   = qs('#studio-regenerate');
        const $overlay = qs('#studio-gen-overlay');
        const $label   = qs('#studio-gen-label');
        const $wrap    = qs('#studio-img-wrap');
        const $pholder = qs('#studio-placeholder');
        const $img     = qs('#studio-preview-img');
        const $cost    = qs('#studio-cost');

        const prompt = qs('#studio-prompt-ta')?.value.trim();
        if (!prompt) { showToast('Prompt is empty — configure your scene first', 'warn'); return; }

        const negPrompt = qs('#studio-neg-ta')?.value.trim();
        const size   = qs('#studio-size-select')?.value || _studioScene.size || '1024x1024';
        const seedRaw= qs('#studio-seed')?.value;
        const seed   = seedRaw ? parseInt(seedRaw) : undefined;

        if ($genBtn)  { $genBtn.disabled = true;  $genBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Generating…'; lucideRefresh($genBtn); }
        if ($regen)   $regen.disabled = true;
        if ($overlay) $overlay.hidden = false;
        if ($label)   $label.textContent = 'Generating…';
        if ($cost)    $cost.textContent = '';

        try {
            const dataUrl = await generateImage({ model: ctx.studioModel, prompt, negativePrompt: negPrompt, size, seed });
            ctx.studioDataUrl = dataUrl;

            if ($img)    $img.src = dataUrl;
            if ($wrap)   $wrap.hidden = false;
            if ($pholder)$pholder.hidden = true;
            if ($cost)   $cost.textContent = `Model: ${ctx.studioModel}`;
            if ($regen)  $regen.hidden = false;

            // Push to session history
            _studioHistory.unshift({ src: dataUrl, prompt, model: ctx.studioModel, ts: Date.now() });
            if (_studioHistory.length > 20) _studioHistory.pop();
            _renderStudioHistory();

            // Auto-inject into chat thread
            _injectImageMessage(dataUrl, prompt, ctx.studioModel);

            // Auto-save to character gallery
            const charId = state.activeBotId;
            if (charId) {
                await addToGallery(charId, dataUrl);
                renderGalleryStrip(charId);
                _renderStudioGalleryStrip(charId);
                // Refresh social/hot feed if currently visible
                if (ctx.$feedArena && !ctx.$feedArena.hidden) {
                    if (ctx.feedMode === 'hot') renderHotFeed();
                    else if (ctx.feedMode === charId) renderSocialFeed(charId);
                }
                showToast('Image saved to gallery', 'info', 2000);
            }

        } catch (err) {
            showToast(`Generation failed: ${err.message}`, 'error', 5000);
        } finally {
            if ($genBtn) { $genBtn.disabled = false; $genBtn.innerHTML = '<i data-lucide="sparkles"></i> Generate'; lucideRefresh($genBtn); }
            if ($regen)  $regen.disabled = false;
            if ($overlay)$overlay.hidden = true;
        }
    }

    // ── Gallery strip inside studio ───────────────────────────────────────────
    async function _renderStudioGalleryStrip(charId) {
        const $strip = qs('#studio-gallery-strip');
        if (!$strip) return;
        $strip.innerHTML = '';

        if (!charId) {
            $strip.innerHTML = '<span class="img-studio__gallery-empty">No character selected</span>';
            return;
        }

        const co = ensureGalleryStore(charId);
        const gallery = co?.extensions?.underdark?.gallery || [];
        if (!gallery.length) {
            $strip.innerHTML = '<span class="img-studio__gallery-empty">No images yet</span>';
            return;
        }

        // Show last 20 most recent
        const recent = [...gallery].reverse().slice(0, 20);
        for (const ref of recent) {
            const src = await resolveImageUrl(ref).catch(() => null);
            if (!src) continue;
            const $img = document.createElement('img');
            $img.className = 'img-studio__gallery-thumb';
            $img.src = src;
            $img.alt = '';
            $img.title = 'Click to use as base';
            $img.addEventListener('click', () => {
                // Load into preview as current
                ctx.studioDataUrl = src;
                const $pImg = qs('#studio-preview-img');
                const $wrap = qs('#studio-img-wrap');
                const $ph   = qs('#studio-placeholder');
                if ($pImg) $pImg.src = src;
                if ($wrap) $wrap.hidden = false;
                if ($ph)   $ph.hidden = true;
                $strip.querySelectorAll('.img-studio__gallery-thumb').forEach(t => t.classList.remove('active'));
                $img.classList.add('active');
            });
            $strip.appendChild($img);
        }
    }

    // ── Studio generation history (session-local) ─────────────────────────────
    function _renderStudioHistory() {
        const $wrap = qs('#studio-history-wrap');
        const $strip = qs('#studio-history-strip');
        if (!$wrap || !$strip) return;
        if (!_studioHistory.length) { $wrap.hidden = true; return; }
        $wrap.hidden = false;
        $strip.innerHTML = '';
        _studioHistory.forEach((entry, i) => {
            const $item = document.createElement('div');
            $item.className = 'studio-history-item' + (i === 0 ? ' studio-history-item--current' : '');
            $item.title = entry.prompt.slice(0, 100);
            $item.innerHTML = `<img src="${esc(entry.src)}" class="studio-history-thumb" alt="">`;
            $item.addEventListener('click', () => {
                ctx.studioDataUrl = entry.src;
                const $pImg = qs('#studio-preview-img');
                const $wrap2 = qs('#studio-img-wrap');
                const $ph = qs('#studio-placeholder');
                if ($pImg) $pImg.src = entry.src;
                if ($wrap2) $wrap2.hidden = false;
                if ($ph) $ph.hidden = true;
                qs('#studio-prompt-ta').value = entry.prompt;
                $strip.querySelectorAll('.studio-history-item').forEach(t => t.classList.remove('studio-history-item--current'));
                $item.classList.add('studio-history-item--current');
            });
            $strip.appendChild($item);
        });
    }

    // ── Open/close studio ────────────────────────────────────────────────────
    async function openImgStudio(charId = null) {
        const $studio = qs('#img-studio');
        if (!$studio) return;

        const cid = charId || state.activeBotId;

        // Reset scene when the character changes — prevents cross-character contamination
        if (cid && cid !== ctx.studioCharId) {
            _resetStudioScene(true);  // skipNsfw=true so NSFW level is set below
            ctx.studioCharId = cid;
        } else if (!ctx.studioCharId) {
            ctx.studioCharId = cid;
        }

        // Sync NSFW from reality config
        const nsfwFlag = state.config.flags?.injectAdult !== false;
        if (!nsfwFlag) {
            _studioScene.nsfw = 'sfw';
        } else if (_studioScene.nsfw === 'sfw') {
            _studioScene.nsfw = 'explicit';
        }

        // Sync NSFW pill UI
        qs('#studio-nsfw-bar')?.querySelectorAll('.studio-nsfw-pill').forEach($p => {
            $p.classList.toggle('active', $p.dataset.nsfw === _studioScene.nsfw);
        });

        $studio.classList.add('img-studio--open');

        // Lazy-load + populate panels on first open
        if (!ctx.studioPresets) {
            await _initStudioPanels();
        }

        if (!ctx.studioWired) {
            _wireStudioNav();
            _wireQuickCapture();
            ctx.studioWired = true;
        }

        // After panels exist, sync chip visual state to scene (needed after char-change reset)
        _syncStudioChipsToState();

        await _renderStudioCharInfo(cid);
        _renderStudioModelGrid();
        _studioRebuildPrompt();
        _studioUpdateBadges();
        _renderStudioGalleryStrip(cid);

        lucideRefresh($studio);
    }

    function closeImgStudio() {
        const $studio = qs('#img-studio');
        if ($studio) $studio.classList.remove('img-studio--open');
    }

    // ── Studio event bindings ────────────────────────────────────────────────
    qs('#studio-close')?.addEventListener('click', closeImgStudio);
    qs('#studio-quick-gen-btn')?.addEventListener('click', function() { _runQuickSnapshot(this).catch(err => showToast(`Snapshot failed: ${err.message}`, 'error', 5000)); });
    qs('#studio-gen-btn')?.addEventListener('click', _runStudioGeneration);
    qs('#studio-regenerate')?.addEventListener('click', _runStudioGeneration);

    qs('#studio-rebuild-prompt')?.addEventListener('click', _studioRebuildPrompt);

    qs('#studio-ai-prompt')?.addEventListener('click', async () => {
        const $btn = qs('#studio-ai-prompt');
        const $ta  = qs('#studio-prompt-ta');
        const $neg = qs('#studio-negative');
        if (!$btn || !$ta) return;
        const origHtml = $btn.innerHTML;
        $btn.disabled = true;
        $btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i>';
        lucideRefresh($btn);
        try {
            const charId = state.activeBotId;
            const nsfw   = _studioScene.nsfw !== 'sfw';
            const hint   = $ta.value.trim();
            const result = await generateImagePromptWithLLM({
                charId, userHint: hint, scene: _studioScene, includeNsfw: nsfw, historyDepth: 8, withNegative: true
            });
            if (typeof result === 'object' && result.positive) {
                $ta.value = result.positive;
                if ($neg && result.negative) {
                    $neg.value = result.negative;
                    _studioScene.negative = result.negative;
                }
            } else {
                $ta.value = typeof result === 'string' ? result : result.positive || '';
            }
        } catch (err) {
            showToast(`AI prompt failed: ${err.message}`, 'error', 4000);
        } finally {
            $btn.disabled = false;
            $btn.innerHTML = origHtml;
            lucideRefresh($btn);
        }
    });

    // Describe Scene — toggle controls panel
    qs('#studio-describe-scene')?.addEventListener('click', () => {
        const $panel = qs('#studio-describe-controls');
        if (!$panel) return;
        $panel.hidden = !$panel.hidden;
        qs('#studio-describe-scene')?.classList.toggle('active', !$panel.hidden);
    });

    // Describe Scene — Run button fires the LLM
    async function _runDescribeScene() {
        const $btn  = qs('#studio-describe-run');
        const $ta   = qs('#studio-prompt-ta');
        const $negTa= qs('#studio-neg-ta');
        if (!$ta) return;
        const origHtml = $btn?.innerHTML;
        if ($btn) { $btn.disabled = true; $btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> …'; lucideRefresh($btn); }
        try {
            const charId     = ctx.studioCharId || state.activeBotId;
            const nsfw       = _studioScene.nsfw !== 'sfw';
            const charWeight = parseFloat(qs('#studio-char-weight')?.value ?? '0.7');
            const sceneWeight= parseFloat(qs('#studio-scene-weight')?.value ?? '0.5');
            const userHint   = qs('#studio-describe-hint')?.value.trim() || '';
            const { positive, negative } = await describeSceneWithLLM({
                charId, scene: _studioScene, userHint,
                charWeight, sceneWeight,
                includeNsfw: nsfw, historyDepth: 4,
            });
            $ta.value = positive;
            if ($negTa && negative) $negTa.value = negative;
            showToast('Scene described', 'info', 1500);
        } catch (err) {
            showToast(`Describe Scene failed: ${err.message}`, 'error', 4000);
        } finally {
            if ($btn) { $btn.disabled = false; $btn.innerHTML = origHtml; lucideRefresh($btn); }
        }
    }
    qs('#studio-describe-run')?.addEventListener('click', _runDescribeScene);

    // Live slider label updates
    qs('#studio-char-weight')?.addEventListener('input', e => {
        const pct = Math.round(parseFloat(e.target.value) * 100);
        const $lbl = qs('#studio-char-weight-val');
        if ($lbl) $lbl.textContent = `${pct}%`;
    });
    qs('#studio-scene-weight')?.addEventListener('input', e => {
        const pct = Math.round(parseFloat(e.target.value) * 100);
        const $lbl = qs('#studio-scene-weight-val');
        if ($lbl) $lbl.textContent = `${pct}%`;
    });

    qs('#studio-img-set-avatar')?.addEventListener('click', async () => {
        if (!ctx.studioDataUrl) return;
        const cid = state.activeBotId;
        if (!cid) { showToast('No active character', 'warn'); return; }
        const meta = state.characters.find(c => c.id === cid);
        const co   = ensureGalleryStore(cid);
        if (!meta || !co) return;
        const gallery = co.extensions.underdark.gallery;
        if (meta.avatar_path && !gallery.includes(meta.avatar_path)) gallery.unshift(meta.avatar_path);
        const stored = isDataUrl(ctx.studioDataUrl)
            ? await saveImageBlob(`avatar-gen-${cid}-${Date.now()}`, ctx.studioDataUrl).catch(() => ctx.studioDataUrl)
            : ctx.studioDataUrl;
        meta.avatar_path = stored;
        if (!gallery.includes(stored)) gallery.push(stored);
        saveState();
        renderRoster();
        renderGalleryStrip(cid);
        _renderStudioGalleryStrip(cid);
        _renderStudioCharInfo(cid);
        showToast('Avatar updated');
    });

    qs('#studio-img-save-gallery')?.addEventListener('click', async () => {
        if (!ctx.studioDataUrl) return;
        const cid = state.activeBotId;
        if (!cid) { showToast('No active character', 'warn'); return; }
        await addToGallery(cid, ctx.studioDataUrl);
        renderGalleryStrip(cid);
        _renderStudioGalleryStrip(cid);
        if (ctx.$feedArena && !ctx.$feedArena.hidden) {
            if (ctx.feedMode === 'hot') renderHotFeed();
            else if (ctx.feedMode === cid) renderSocialFeed(cid);
        }
        showToast('Saved to gallery', 'info', 1800);
    });

    qs('#studio-img-download')?.addEventListener('click', () => {
        if (!ctx.studioDataUrl) return;
        const a    = document.createElement('a');
        a.href     = ctx.studioDataUrl;
        a.download = `underdark-studio-${Date.now()}.png`;
        a.click();
    });

    qs('#studio-img-send-chat')?.addEventListener('click', () => {
        if (!ctx.studioDataUrl) return;
        const $ta = qs('#studio-prompt-ta');
        _injectImageMessage(ctx.studioDataUrl, $ta?.value.trim() || '', ctx.studioModel);
        showToast('Sent to chat thread', 'info', 1600);
    });

    // Open studio from header button
    qs('#btn-img-studio')?.addEventListener('click', () => openImgStudio());
    return {
        runQuickSnapshot: _runQuickSnapshot,
        openImgStudio,
        showStylePicker:  _showStylePicker,
        doSnapshot:       _doSnapshot,
    };
}
