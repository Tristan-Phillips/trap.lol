/**
 * ui.js — Complete DOM orchestration for The Underdark.
 * Handles: sessions, roster, group chat, character creator, lorebook CRUD,
 * full config bindings, persona/override editor, streaming, telemetry, API key flow.
 */

import {
    state, loadState, saveState,
    newSession, switchSession, deleteSession, renameSession,
    addMessage, editMessage, deleteMessage, clearHistory,
    addComment, deleteComment,
    setActiveBot, removeBotFromSession,
    getCharOverride, setCharOverride,
    setConfig, saveCharacter, deleteCharacter,
    defaultCharOverride, resolveCharAvatar,
    addReaction, getReactions, exportSessionJson, importSessionJson
} from './state.js';
import { buildPayload, streamCompletion } from './llm-engine.js';
import { addBook, removeBook, addEntry, updateEntry, removeEntry, createBook } from './lorebook.js';
import { parseCharacterCard, buildCard, normalizeData } from './parser-v2.js';
import { getApiKey, setApiKey, clearApiKey, isValidKeyFormat, restoreKeyFromCookie } from '../../../../glass/script/modules/llm-auth.js';
import { initSimsEditor } from './sims-editor.js';

// ── Utility ───────────────────────────────────────────────────────────────────
const qs  = (sel, ctx = document) => ctx.querySelector(sel);
const qsa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const esc = str => String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function confirm(title, body) {
    return new Promise(res => {
        const modal = qs('#modal-confirm');
        qs('#confirm-title', modal).innerHTML = `<i data-lucide="alert-triangle"></i> ${esc(title)}`;
        qs('#confirm-body',  modal).textContent = body;
        modal.hidden = false;
        if (window.lucide) window.lucide.createIcons();

        const ok     = qs('#confirm-ok',     modal);
        const cancel = qs('#confirm-cancel', modal);
        const bd     = qs('.modal__backdrop', modal);

        const cleanup = (val) => {
            modal.hidden = true;
            ok.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
            bd.removeEventListener('click', onCancel);
            res(val);
        };
        const onOk     = () => cleanup(true);
        const onCancel = () => cleanup(false);
        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
        bd.addEventListener('click', onCancel);
    });
}

function showModal(id) { const m = qs(`#${id}`); if (m) { m.hidden = false; lucideRefresh(m); } }
function hideModal(id) { const m = qs(`#${id}`); if (m) m.hidden = true; }

function lucideRefresh(_node) {
    if (window.lucide) window.lucide.createIcons();
}

// ── Toast notifications ───────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 3000) {
    const $c = qs('#toast-container');
    if (!$c) return;
    const $t = document.createElement('div');
    $t.className = `toast toast--${type}`;
    const icons = { info: 'check-circle', error: 'alert-circle', warn: 'alert-triangle' };
    $t.innerHTML = `<i data-lucide="${icons[type] || 'check-circle'}"></i><span>${esc(message)}</span>`;
    $c.appendChild($t);
    if (window.lucide) window.lucide.createIcons({ nodes: [$t] });
    // Animate in
    requestAnimationFrame(() => $t.classList.add('toast--visible'));
    setTimeout(() => {
        $t.classList.remove('toast--visible');
        $t.addEventListener('transitionend', () => $t.remove(), { once: true });
    }, duration);
}

// ── Avatar resolver cache ─────────────────────────────────────────────────────
const _avatarCache = {};
async function getAvatarUrl(charId, stored) {
    if (!stored) return null;
    if (!stored.startsWith('idb:')) return stored;
    if (_avatarCache[charId]) return _avatarCache[charId];
    const url = await resolveCharAvatar(charId, stored).catch(() => null);
    if (url) _avatarCache[charId] = url;
    return url;
}
// Sync variant: returns cached value or placeholder — for non-async render paths
function getAvatarUrlSync(charId, stored) {
    if (!stored) return null;
    if (!stored.startsWith('idb:')) return stored;
    return _avatarCache[charId] || null;
}

// ── Markdown Renderer ─────────────────────────────────────────────────────────
// RP text layer detection — logic-based, no codes required from the LLM.
// Patterns detected automatically:
//   “quoted text”   → .rp-speech  (warm gold — character's spoken voice)
//   *action text*   → <em>        (muted italic — narration/action, handled by marked)
//   _inner thought_ → .rp-thought (violet italic — internal monologue)
//
// Implementation: operate entirely on the final HTML string AFTER marked.parse()
// and DOMPurify.sanitize(), so neither library can interfere with the spans we inject.
// “straight quotes” are handled pre-parse via placeholder tokens to survive marked's
// quote-entity conversion; curly/smart quotes are handled post-sanitize directly.

const _rpTokens = [];
function _rpToken(type, inner) {
    const idx = _rpTokens.length;
    _rpTokens.push({ type, inner });
    // Use a placeholder with no underscores/asterisks so marked.js never interprets it
    return `«rp${idx}»`;
}
function _rpFlush(html) {
    return html.replace(/«rp(\d+)»/g, (_, i) => {
        const { type, inner } = _rpTokens[Number(i)];
        return `<span class=”rp-${type}”>${inner}</span>`;
    });
}

function renderMarkdown(text) {
    _rpTokens.length = 0;
    try {
        // _inner thought_ — consume before marked.js can interpret the underscores
        text = text.replace(/(?<![_\w])_([^_\n]{2,}?)_(?![_\w])/g, (_, inner) =>
            _rpToken('thought', inner));
        // “straight quoted speech” — tokenise pre-parse so marked can't entity-encode the quotes
        text = text.replace(/”([^”\n]{2,}?)”/g, (_, inner) =>
            _rpToken('speech', `“${inner}”`));
        // *action/narration* — left for marked.js, which converts it to <em> natively
        let html = marked.parse(text, { breaks: true, gfm: true });
        if (typeof DOMPurify !== 'undefined') {
            html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
        }
        // Restore RP spans after sanitisation (DOMPurify never sees them)
        html = _rpFlush(html);
        // Curly/smart quotes output by the LLM — safe to handle post-sanitize
        html = html.replace(/“([^“”<>\n]{2,}?)”/g,
            (_, inner) => `<span class=”rp-speech”>“${inner}”</span>`);
        return html;
    } catch (_) {
        _rpTokens.length = 0;
        return `<p>${esc(text).replace(/\n/g, '<br>')}</p>`;
    }
}

// ── Group auto-response manager ───────────────────────────────────────────────
let _groupAbort = false;
const _rrIndex = {};   // sessionId → next round-robin bot index
function clearGroupTimers() {
    _groupAbort = true;
}

// ── Narrative flag keys (shared between syncConfigUI and init bindings) ────────
const FLAG_KEYS = [
    'showThoughts', 'showSystemPrompt', 'injectConsistency', 'injectSliders',
    'injectAppearance', 'injectAdult', 'injectPersonality', 'injectVoice',
    'injectStyle', 'injectAIDirectives', 'impersonationBlock', 'povFirst',
    'jailbreakResistance'
];

// ── Main Init ─────────────────────────────────────────────────────────────────
export function initUI() {
    loadState();
    restoreKeyFromCookie();

    // ── Sidebar: Roster ───────────────────────────────────────────────────────
    const $rosterSidebar  = qs('#roster-sidebar');
    const $terminalSidebar = qs('#terminal-sidebar');

    const setRosterCollapsed = (collapsed) => {
        $rosterSidebar.dataset.collapsed = collapsed;
        document.body.classList.toggle('roster-collapsed', collapsed);
        const icon = qs('#toggle-roster i');
        if (icon) icon.dataset.lucide = collapsed ? 'chevron-right' : 'chevron-left';
        lucideRefresh(qs('#toggle-roster'));
    };

    qs('#toggle-roster').addEventListener('click', () => {
        setRosterCollapsed($rosterSidebar.dataset.collapsed !== 'true');
    });

    qs('#roster-reveal-tab')?.addEventListener('click', () => {
        setRosterCollapsed(false);
    });

    // Init state
    setRosterCollapsed($rosterSidebar.dataset.collapsed === 'true');

    // Mobile toggle
    qs('#toggle-roster-mobile')?.addEventListener('click', () => {
        const c = $rosterSidebar.dataset.collapsed === 'true';
        $rosterSidebar.dataset.collapsed = !c;
    });

    // Close sidebars when clicking the ::before overlay on mobile
    $rosterSidebar.addEventListener('click', e => {
        if (e.target === $rosterSidebar) $rosterSidebar.dataset.collapsed = 'true';
    });
    $terminalSidebar.addEventListener('click', e => {
        if (e.target === $terminalSidebar) $terminalSidebar.dataset.collapsed = 'true';
    });

    // ── Sidebar: Terminal ─────────────────────────────────────────────────────
    const toggleTerminal = (force) => {
        const cur  = $terminalSidebar.dataset.collapsed === 'true';
        const next = force !== undefined ? force : !cur;
        $terminalSidebar.dataset.collapsed = next;
    };
    qs('#toggle-terminal').addEventListener('click', () => toggleTerminal());
    qs('#close-terminal').addEventListener('click',  () => toggleTerminal(true));

    // ── Tab system ────────────────────────────────────────────────────────────
    qsa('.tab-btn').forEach($btn => {
        $btn.addEventListener('click', () => {
            const target = $btn.dataset.tab;
            qsa('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
            qsa('.tab-panel').forEach(p => p.classList.remove('active'));
            $btn.classList.add('active');
            $btn.setAttribute('aria-selected', 'true');
            qs(`#tab-${target}`)?.classList.add('active');
        });
    });

    // ── Session Bar ───────────────────────────────────────────────────────────
    const $sessionSelect = qs('#session-select');

    function renderSessions() {
        $sessionSelect.innerHTML = state.sessions.map(s =>
            `<option value="${esc(s.id)}" ${s.id === state.activeSessionId ? 'selected' : ''}>
                ${esc(s.name)}
            </option>`
        ).join('');
    }

    $sessionSelect.addEventListener('change', () => {
        switchSession($sessionSelect.value);
        renderAll();
    });

    qs('#session-new').addEventListener('click', () => {
        const name = prompt('Thread name:', `Thread #${state.sessions.length + 1}`);
        if (!name?.trim()) return;
        newSession(name.trim());
        renderSessions();
        renderAll();
    });

    qs('#session-rename').addEventListener('click', () => {
        const name = prompt('Rename thread:', state.session.name);
        if (!name?.trim()) return;
        renameSession(state.activeSessionId, name.trim());
        renderSessions();
    });

    qs('#session-delete').addEventListener('click', async () => {
        const ok = await confirm('Delete Thread', `Delete "${state.session.name}"? This cannot be undone.`);
        if (!ok) return;
        deleteSession(state.activeSessionId);
        renderSessions();
        renderAll();
    });

    // ── API Key ───────────────────────────────────────────────────────────────
    const $apiInput  = qs('#api-key-input');
    const $apiSave   = qs('#api-key-save');
    const $apiToggle = qs('#api-key-toggle');
    const $apiStatus = qs('#api-key-status');

    function updateApiStatus() {
        const key   = getApiKey();
        const valid = isValidKeyFormat(key);
        $apiStatus.textContent = key
            ? (valid ? '✓ Key active' : '✗ Invalid key format')
            : 'No key set';
        $apiStatus.className = `api-key-status ${key ? (valid ? 'api-key-status--ok' : 'api-key-status--err') : ''}`;
    }

    $apiToggle.addEventListener('click', () => {
        const isPass = $apiInput.type === 'password';
        $apiInput.type = isPass ? 'text' : 'password';
        $apiToggle.querySelector('i').dataset.lucide = isPass ? 'eye-off' : 'eye';
        lucideRefresh($apiToggle);
    });

    $apiSave.addEventListener('click', () => {
        const val = $apiInput.value.trim();
        if (!val) { clearApiKey(); updateApiStatus(); return; }
        if (!isValidKeyFormat(val)) {
            $apiInput.classList.add('shake');
            setTimeout(() => $apiInput.classList.remove('shake'), 500);
            return;
        }
        setApiKey(val);
        $apiInput.value = '';
        $apiInput.type  = 'password';
        updateApiStatus();
    });

    updateApiStatus();

    // ── Character Roster ──────────────────────────────────────────────────────
    const $charList = qs('#character-list');
    const $charSearch = qs('#character-search');
    let searchQuery = '';

    $charSearch.addEventListener('input', debounce(() => {
        searchQuery = $charSearch.value.toLowerCase().trim();
        renderRoster();
    }, 200));

    function renderRoster() {
        if (!state.characters.length) {
            $charList.innerHTML = `
                <div class="roster-empty">
                    <i data-lucide="ghost"></i>
                    <span>No fragments found.<br>Import or create one below.</span>
                </div>`;
            lucideRefresh($charList);
            return;
        }

        const q = searchQuery.toLowerCase().trim();
        const filtered = state.characters.filter(c => {
            if (!q) return true;
            return c.name.toLowerCase().includes(q)
                || (c.tagline || '').toLowerCase().includes(q)
                || (c.tags || []).some(t => t.toLowerCase().includes(q));
        });

        if (!filtered.length) {
            $charList.innerHTML = `
                <div class="roster-empty">
                    <i data-lucide="search-x"></i>
                    <span>No matches for "${esc(q)}"</span>
                    <button class="btn btn--ghost btn--sm" id="roster-clear-search">Clear</button>
                </div>`;
            qs('#roster-clear-search')?.addEventListener('click', () => {
                searchQuery = '';
                $charSearch.value = '';
                renderRoster();
            });
            lucideRefresh($charList);
            return;
        }

        const inThread  = filtered.filter(c => state.activeBotIds.includes(c.id));
        const available = filtered.filter(c => !state.activeBotIds.includes(c.id));

        const makeCard = (c, active) => {
            const rawAv = c.avatar_path || state.loadedCharacters[c.id]?.avatar || null;
            const av    = getAvatarUrlSync(c.id, rawAv);
            const isActivePrimary = c.id === state.activeBotId;
            return `
            <div class="character-card ${active ? 'character-card--active' : ''} ${isActivePrimary ? 'character-card--primary' : ''}"
                 data-id="${esc(c.id)}" title="${esc(c.name)}${c.tagline ? ' — ' + esc(c.tagline) : ''}">
                <div class="character-card__avatar" style="background-image:${av ? `url(${av})` : 'none'}">
                    ${!av ? `<i data-lucide="user"></i>` : ''}
                    ${active ? `<span class="character-card__in-thread-badge" title="In thread"><i data-lucide="message-circle"></i></span>` : ''}
                </div>
                <div class="character-card__info">
                    <span class="character-card__name">${esc(c.name)}</span>
                    <span class="character-card__tagline">${esc(c.tagline || '')}</span>
                    <div class="character-card__tags">
                        ${(c.tags || []).slice(0, 3).map(t => `<span class="char-tag-chip" data-tag-filter="${esc(t)}">${esc(t)}</span>`).join('')}
                    </div>
                </div>
                <div class="character-card__actions">
                    ${active
                        ? `<button class="character-card__btn character-card__btn--remove" data-remove="${esc(c.id)}" title="Remove from thread"><i data-lucide="log-out"></i></button>`
                        : `<button class="character-card__btn character-card__btn--add" data-add="${esc(c.id)}" title="Add to thread"><i data-lucide="plus"></i></button>`
                    }
                    <button class="character-card__btn character-card__btn--edit" data-edit="${esc(c.id)}" title="Open Sims Editor  [E]"><i data-lucide="sliders-horizontal"></i></button>
                </div>
            </div>`;
        };

        let html = '';
        if (inThread.length) {
            html += `<div class="roster-section-label"><i data-lucide="message-circle"></i> In Thread <span class="roster-section-count">${inThread.length}</span></div>`;
            html += inThread.map(c => makeCard(c, true)).join('');
        }
        if (available.length) {
            html += `<div class="roster-section-label ${inThread.length ? 'roster-section-label--sep' : ''}"><i data-lucide="users"></i> Available <span class="roster-section-count">${available.length}</span></div>`;
            html += available.map(c => makeCard(c, false)).join('');
        }
        $charList.innerHTML = html;

        // Click card body → select/profile
        qsa('.character-card', $charList).forEach($card => {
            $card.addEventListener('click', e => {
                if (e.target.closest('.character-card__actions')) return;
                selectCharacter($card.dataset.id);
            });
        });

        // Add to thread
        qsa('[data-add]', $charList).forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                addCharacterToThread(btn.dataset.add);
            });
        });

        // Remove from thread
        qsa('[data-remove]', $charList).forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const removedId = btn.dataset.remove;
                const removedMeta = state.characters.find(c => c.id === removedId);
                removeBotFromSession(removedId);
                delete _rrIndex[state.activeSessionId];
                renderActiveBots();
                renderRoster();
                renderWelcomeGrid();
                renderPersonaCharSelect();
                showToast(`${removedMeta?.name || 'Character'} removed from thread`);
                // If removed was the profile-displayed char, clear profile
                if (removedId === state.activeBotId || !state.activeBotIds.length) {
                    qs('#profile-card').innerHTML = '<div class="profile-view__empty">No character selected</div>';
                    qs('#profile-actions').hidden = true;
                    if (qs('#gallery-strip')) qs('#gallery-strip').hidden = true;
                }
            });
        });

        // Edit (Sims Editor)
        qsa('[data-edit]', $charList).forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                openSimsEditor(btn.dataset.edit);
            });
        });

        // Tag filter chips
        qsa('[data-tag-filter]', $charList).forEach(chip => {
            chip.addEventListener('click', e => {
                e.stopPropagation();
                searchQuery = chip.dataset.tagFilter.toLowerCase();
                $charSearch.value = searchQuery;
                renderRoster();
            });
        });

        lucideRefresh($charList);

        // Async: resolve IDB avatars
        filtered.forEach(async c => {
            const rawAv = c.avatar_path || state.loadedCharacters[c.id]?.avatar || null;
            if (rawAv?.startsWith('idb:')) {
                const url = await getAvatarUrl(c.id, rawAv);
                if (url) {
                    const $av = qs(`.character-card[data-id="${c.id}"] .character-card__avatar`, $charList);
                    if ($av) $av.style.backgroundImage = `url(${url})`;
                }
            }
        });
    }

    // ── Character Loading (load card data + profile, no thread side-effects) ───
    async function loadCharacterCard(id) {
        const meta = state.characters.find(c => c.id === id);
        if (!meta) return null;
        if (!state.loadedCharacters[id]) {
            if (meta.card_path) {
                try {
                    const res = await fetch(meta.card_path);
                    const raw = await res.json();
                    state.loadedCharacters[id] = normalizeData(raw);
                    saveState();
                } catch (e) {
                    console.error('[underdark] Failed to load card:', e);
                    showToast(`Failed to load character card: ${e.message}`, 'error');
                    return null;
                }
            } else {
                return null;
            }
        }
        return state.loadedCharacters[id];
    }

    // ── Add Character to Current Thread (explicit user action) ───────────────
    async function addCharacterToThread(id) {
        const char = await loadCharacterCard(id);
        if (!char) return;
        const meta = state.characters.find(c => c.id === id);

        // Auto-attach lorebook if specified and not already in session
        if (meta.lorebook_path) {
            const alreadyAttached = state.lorebooks.some(b => b._sourcePath === meta.lorebook_path);
            if (!alreadyAttached) {
                try {
                    const lbRes  = await fetch(meta.lorebook_path);
                    const lbData = await lbRes.json();
                    lbData._sourcePath = meta.lorebook_path;
                    state.session.lorebooks.push(lbData);
                    saveState();
                    renderLorebooks();
                } catch (e) {
                    console.warn('[underdark] Failed to load lorebook:', e);
                }
            }
        }

        setActiveBot(id);
        delete _rrIndex[state.activeSessionId];
        renderRoster();
        renderActiveBots();
        renderProfile(char, id);
        renderPersonaCharSelect();
        renderWelcomeGrid();
        showToast(`${char.name} added to thread`);
        const avatarUrl = await getAvatarUrl(id, meta.avatar_path || char.avatar);
        updateCinematicBackground(avatarUrl);

        // Remove welcome screen only if it's still there
        qs('#arena-welcome')?.remove();

        // First message only if thread is currently empty
        if (!state.history.length && char.first_mes) {
            const msg = addMessage('bot', char.first_mes, id);
            appendMessage(msg, char.name, meta.avatar_path || char.avatar);
        }
    }

    // ── Select Character (roster click: show profile + set active bot UI, no thread) ──
    async function selectCharacter(id) {
        const char = await loadCharacterCard(id);
        if (!char) return;
        const meta = state.characters.find(c => c.id === id);

        // If already in this thread, just switch active bot
        if (state.activeBotIds.includes(id)) {
            setActiveBot(id);
            renderRoster();
            renderActiveBots();
            renderProfile(char, id);
            renderPersonaCharSelect();
            const avatarUrl = await getAvatarUrl(id, meta.avatar_path || char.avatar);
            updateCinematicBackground(avatarUrl);
            return;
        }

        // Not in thread yet — just show profile in terminal, open terminal
        renderProfile(char, id);
        const avatarUrl = await getAvatarUrl(id, meta.avatar_path || char.avatar);
        updateCinematicBackground(avatarUrl);
        // Open terminal to Profile tab so user can see the character
        const $terminal = qs('#terminal-sidebar');
        if ($terminal?.dataset.collapsed === 'true') {
            toggleTerminal(false);
        }
        // Activate profile tab
        qsa('.tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === 'profile');
            b.setAttribute('aria-selected', b.dataset.tab === 'profile');
        });
        qsa('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-profile'));
    }

    // ── Active Bots Header ────────────────────────────────────────────────────
    function renderActiveBots() {
        const $container = qs('#active-bots');
        const $label     = qs('#active-bot-label');

        if (!state.activeBotIds.length) {
            $container.innerHTML = '';
            if ($label) $label.textContent = '';
            return;
        }

        $container.innerHTML = state.activeBotIds.map(id => {
            const char = state.loadedCharacters[id];
            const meta = state.characters.find(c => c.id === id);
            const name = char?.name || '?';
            const isActive = id === state.activeBotId;
            const rawAv    = meta?.avatar_path || char?.avatar;
            const avatar   = getAvatarUrlSync(id, rawAv);
            return `
            <div class="active-bot ${isActive ? 'active-bot--selected' : ''}" data-id="${esc(id)}" title="${esc(name)}">
                <div class="active-bot__avatar" style="background-image:${avatar ? `url(${avatar})` : 'none'}">
                    ${!avatar ? `<i data-lucide="user"></i>` : ''}
                </div>
                <button class="active-bot__remove" data-remove="${esc(id)}" title="Remove ${esc(name)}">
                    <i data-lucide="x"></i>
                </button>
            </div>`;
        }).join('');

        // Async patch IDB avatars for active bots
        state.activeBotIds.forEach(async id => {
            const char  = state.loadedCharacters[id];
            const meta  = state.characters.find(c => c.id === id);
            const rawAv = meta?.avatar_path || char?.avatar;
            if (rawAv?.startsWith('idb:')) {
                const url = await getAvatarUrl(id, rawAv);
                if (url) {
                    const $av = qs(`.active-bot[data-id="${id}"] .active-bot__avatar`, $container);
                    if ($av) $av.style.backgroundImage = `url(${url})`;
                }
            }
        });

        qsa('.active-bot', $container).forEach($bot => {
            $bot.addEventListener('click', async e => {
                if (e.target.closest('[data-remove]')) return;
                const id   = $bot.dataset.id;
                const char = state.loadedCharacters[id];
                const meta = state.characters.find(c => c.id === id);
                setActiveBot(id);
                renderActiveBots();
                if (char) renderProfile(char, id);
                if (meta) updateCinematicBackground(await getAvatarUrl(id, meta.avatar_path || char?.avatar));
                renderPersonaCharSelect();
            });
        });

        qsa('[data-remove]', $container).forEach($btn => {
            $btn.addEventListener('click', async e => {
                e.stopPropagation();
                const id = $btn.dataset.remove;
                removeBotFromSession(id);
                delete _rrIndex[state.activeSessionId];
                renderActiveBots();
                renderRoster();
                const newActive = state.loadedCharacters[state.activeBotId];
                const newMeta   = state.characters.find(c => c.id === state.activeBotId);
                if (newActive) renderProfile(newActive, state.activeBotId);
                if (newMeta) {
                    const avUrl = await getAvatarUrl(state.activeBotId, newMeta.avatar_path || newActive?.avatar);
                    updateCinematicBackground(avUrl);
                }
            });
        });

        // Update send label
        const activeChar = state.loadedCharacters[state.activeBotId];
        if ($label && activeChar) {
            $label.textContent = `→ ${getCharOverride(state.activeBotId).nickname || activeChar.name}`;
        }

        lucideRefresh($container);
    }

    // ── Profile Panel ─────────────────────────────────────────────────────────
    async function renderProfile(char, id) {
        const $profile = qs('#profile-card');
        const meta     = state.characters.find(c => c.id === id);
        const rawAv    = meta?.avatar_path || char.avatar;
        const avatar   = await getAvatarUrl(id, rawAv).catch(() => rawAv);

        $profile.innerHTML = `
            <div class="profile-details">
                ${avatar
                    ? `<div class="profile-details__avatar" style="background-image:url(${avatar})"></div>`
                    : `<div class="profile-details__avatar profile-details__avatar--empty"><i data-lucide="user"></i></div>`
                }
                <h3 class="profile-details__name">${esc(char.name)}</h3>
                ${char.tags?.length ? `<div class="profile-details__tags">${char.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
                ${char.creator ? `<div class="profile-details__meta">by ${esc(char.creator)}</div>` : ''}
                <div class="profile-details__section">
                    <strong>Description</strong>
                    <p>${esc(char.description || '—').replace(/\n/g, '<br>')}</p>
                </div>
                ${char.personality ? `<div class="profile-details__section"><strong>Personality</strong><p>${esc(char.personality)}</p></div>` : ''}
                ${char.scenario    ? `<div class="profile-details__section"><strong>Scenario</strong><p>${esc(char.scenario).replace(/\n/g,'<br>')}</p></div>` : ''}
                ${char.creator_notes ? `<div class="profile-details__section"><strong>Notes</strong><p>${esc(char.creator_notes)}</p></div>` : ''}
                ${char.alternate_greetings?.length ? `
                    <div class="profile-details__section">
                        <strong>Alt. Greetings</strong>
                        <select id="alt-greeting-select" class="control-select control-select--sm">
                            <option value="">— Default greeting —</option>
                            ${char.alternate_greetings.map((g, i) => `<option value="${i}">Alt ${i + 1}: ${esc(g.slice(0, 50))}...</option>`).join('')}
                        </select>
                    </div>
                ` : ''}
            </div>`;

        const inThread = state.activeBotIds.includes(id);
        qs('#profile-actions').hidden = false;
        // Show add-to-thread only if not already in thread
        const $addBtn    = qs('#btn-add-to-thread');
        const $removeBtn = qs('#btn-remove-char');
        if ($addBtn)    $addBtn.hidden    = inThread;
        if ($removeBtn) $removeBtn.hidden = !inThread;
        renderGalleryStrip(id);

        // Alt greeting switcher
        qs('#alt-greeting-select')?.addEventListener('change', e => {
            if (!e.target.value) return;
            const greeting = char.alternate_greetings[parseInt(e.target.value)];
            if (!greeting) return;
            if (state.history.length > 0) {
                showToast('Clear the thread first to use an alternate greeting', 'warn');
                e.target.value = '';
                return;
            }
            const msg = addMessage('bot', greeting, id);
            appendMessage(msg, char.name, meta?.avatar_path || char.avatar);
        });

        lucideRefresh($profile);

        // Profile action buttons
        qs('#btn-add-to-thread').onclick = () => addCharacterToThread(id);
        qs('#btn-sims-edit').onclick     = () => openSimsEditor(id);
        qs('#btn-gallery-add').onclick   = () => openGalleryModal(id);
        qs('#btn-edit-char').onclick     = () => openCreator(id);
        qs('#btn-remove-char').onclick = () => {
            removeBotFromSession(id);
            delete _rrIndex[state.activeSessionId];
            renderActiveBots();
            renderRoster();
            renderWelcomeGrid();
            renderPersonaCharSelect();
            showToast(`${char.name} removed from thread`);
            $profile.innerHTML = '<div class="profile-view__empty">No character selected</div>';
            qs('#profile-actions').hidden = true;
            if (qs('#gallery-strip')) qs('#gallery-strip').hidden = true;
        };
        qs('#btn-delete-char').onclick = async () => {
            const ok = await confirm('Delete Character', `Permanently delete ${char.name}? This cannot be undone.`);
            if (!ok) return;
            await deleteCharacter(id);
            delete _avatarCache[id];
            renderRoster();
            renderActiveBots();
            renderPersonaCharSelect();
            showToast(`${char.name} deleted`, 'warn');
            $profile.innerHTML = '<div class="profile-view__empty">No character selected</div>';
            qs('#profile-actions').hidden = true;
            if (qs('#gallery-strip')) qs('#gallery-strip').hidden = true;
        };
    }

    function updateCinematicBackground(path) {
        const $bg = qs('#arena-background');
        // If a custom background preset/image is set, don't override with cinematic
        const bgCfg = state.config.chatBackground;
        if (bgCfg?.preset || bgCfg?.url) return;
        if (path) {
            $bg.style.backgroundImage = `url(${path})`;
            $bg.classList.add('arena__bg--visible');
        } else {
            $bg.style.backgroundImage = 'none';
            $bg.classList.remove('arena__bg--visible');
        }
    }

    function applyChatBackground() {
        const $bg = qs('#arena-background');
        const bgCfg = state.config.chatBackground || {};

        // Clear all preset classes always
        ['ember','abyss','void','neon','sakura','deep','ash'].forEach(p =>
            $bg.classList.remove(`arena__bg--${p}`)
        );

        if (bgCfg.url) {
            const blur   = bgCfg.blur   ?? 45;
            const bright = bgCfg.bright ?? 30;
            const opacity = bgCfg.opacity ?? 50;
            $bg.style.backgroundImage = `url(${bgCfg.url})`;
            $bg.style.filter  = `blur(${blur}px) brightness(${bright / 100}) saturate(1.3)`;
            $bg.style.opacity = opacity / 100;
            $bg.classList.add('arena__bg--visible');
        } else if (bgCfg.preset) {
            const blur   = bgCfg.blur   ?? 45;
            const bright = bgCfg.bright ?? 30;
            const opacity = bgCfg.opacity ?? 50;
            $bg.style.backgroundImage = 'none';
            $bg.style.filter  = `blur(${blur}px) brightness(${bright / 100}) saturate(1.3)`;
            $bg.style.opacity = opacity / 100;
            $bg.classList.add('arena__bg--visible', `arena__bg--${bgCfg.preset}`);
        } else {
            // No custom bg — clear inline overrides so cinematic bg can take over
            $bg.style.filter  = '';
            $bg.style.opacity = '';
        }
    }

    // ── Welcome Screen Character Grid ─────────────────────────────────────────
    function renderWelcomeGrid() {
        const $grid = qs('#welcome-char-grid');
        if (!$grid) return;

        if (!state.characters.length) {
            $grid.innerHTML = '<p style="color:var(--text-muted);font-size:.8rem;text-align:center;width:100%;padding:.5rem 0;">No characters yet — create or import one below.</p>';
            return;
        }

        $grid.innerHTML = state.characters.map(c => {
            const rawAv = c.avatar_path || state.loadedCharacters[c.id]?.avatar || null;
            const av = getAvatarUrlSync(c.id, rawAv);
            const inThread = state.activeBotIds.includes(c.id);
            return `<div class="welcome-char-card ${inThread ? 'welcome-char-card--active' : ''}" data-id="${esc(c.id)}">
                <div class="welcome-char-card__avatar" style="${av ? `background-image:url(${av})` : ''}">
                    ${!av ? '<i data-lucide="user"></i>' : ''}
                </div>
                <span class="welcome-char-card__name">${esc(c.name)}</span>
                <span class="welcome-char-card__tagline">${esc(c.tagline || '')}</span>
                <span class="welcome-char-card__add-hint">${inThread ? '✓ In thread' : '+ Add'}</span>
            </div>`;
        }).join('');

        qsa('.welcome-char-card', $grid).forEach($card => {
            $card.addEventListener('click', () => addCharacterToThread($card.dataset.id));
        });

        // Patch IDB avatars
        state.characters.forEach(async c => {
            const rawAv = c.avatar_path || state.loadedCharacters[c.id]?.avatar || null;
            if (rawAv?.startsWith('idb:')) {
                const url = await getAvatarUrl(c.id, rawAv);
                if (url) {
                    const $av = qs(`.welcome-char-card[data-id="${c.id}"] .welcome-char-card__avatar`, $grid);
                    if ($av) $av.style.backgroundImage = `url(${url})`;
                }
            }
        });

        lucideRefresh($grid);
    }

    // ── Character Picker Modal ────────────────────────────────────────────────
    function openCharPicker() {
        const $modal = qs('#modal-char-picker');
        if (!$modal) return;
        renderPickerGrid('');
        $modal.hidden = false;
        lucideRefresh($modal);
        setTimeout(() => qs('#picker-search-input')?.focus(), 50);
    }

    function renderPickerGrid(query) {
        const $grid = qs('#picker-char-grid');
        if (!$grid) return;
        const q = query.toLowerCase().trim();
        const chars = state.characters.filter(c => {
            if (!q) return true;
            return c.name.toLowerCase().includes(q) || (c.tagline || '').toLowerCase().includes(q);
        });
        if (!chars.length) {
            $grid.innerHTML = '<p style="color:var(--text-muted);font-size:.8rem;text-align:center;padding:1rem;grid-column:1/-1;">No characters found</p>';
            return;
        }
        $grid.innerHTML = chars.map(c => {
            const rawAv = c.avatar_path || state.loadedCharacters[c.id]?.avatar || null;
            const av = getAvatarUrlSync(c.id, rawAv);
            const inThread = state.activeBotIds.includes(c.id);
            return `<div class="picker-char-card ${inThread ? 'picker-char-card--active' : ''}" data-id="${esc(c.id)}">
                <div class="picker-char-card__avatar" style="${av ? `background-image:url(${av})` : ''}">
                    ${!av ? '<i data-lucide="user"></i>' : ''}
                </div>
                <span class="picker-char-card__name">${esc(c.name)}</span>
            </div>`;
        }).join('');

        qsa('.picker-char-card', $grid).forEach($card => {
            $card.addEventListener('click', async () => {
                const id = $card.dataset.id;
                if (state.activeBotIds.includes(id)) {
                    // Already in thread — switch active bot
                    setActiveBot(id);
                    renderActiveBots();
                    const char = state.loadedCharacters[id];
                    const meta = state.characters.find(c => c.id === id);
                    if (char) renderProfile(char, id);
                    if (meta) updateCinematicBackground(await getAvatarUrl(id, meta.avatar_path || char?.avatar));
                } else {
                    await addCharacterToThread(id);
                }
                qs('#modal-char-picker').hidden = true;
                renderPickerGrid('');
            });
        });

        chars.forEach(async c => {
            const rawAv = c.avatar_path || state.loadedCharacters[c.id]?.avatar || null;
            if (rawAv?.startsWith('idb:')) {
                const url = await getAvatarUrl(c.id, rawAv);
                if (url) {
                    const $av = qs(`.picker-char-card[data-id="${c.id}"] .picker-char-card__avatar`, $grid);
                    if ($av) $av.style.backgroundImage = `url(${url})`;
                }
            }
        });

        lucideRefresh($grid);
    }

    qs('#add-char-btn')?.addEventListener('click', openCharPicker);
    qs('#char-picker-close')?.addEventListener('click', () => { qs('#modal-char-picker').hidden = true; });
    qs('.modal__backdrop', qs('#modal-char-picker'))?.addEventListener('click', () => { qs('#modal-char-picker').hidden = true; });
    qs('#picker-search-input')?.addEventListener('input', debounce(e => renderPickerGrid(e.target.value), 200));

    // ── Gallery ────────────────────────────────────────────────────────────────
    let galleryCharId = null;
    let lbImages = [];
    let lbIndex  = 0;

    function getCharGallery(id) {
        return state.loadedCharacters[id]?.extensions?.underdark?.gallery || [];
    }

    function getAllGalleryImages(id) {
        const meta  = state.characters.find(c => c.id === id);
        const extra = getCharGallery(id);
        return [meta?.avatar_path, ...extra].filter(Boolean);
    }

    function ensureGalleryStore(id) {
        const char = state.loadedCharacters[id];
        if (!char) return null;
        if (!char.extensions)                char.extensions = {};
        if (!char.extensions.underdark)      char.extensions.underdark = {};
        if (!char.extensions.underdark.gallery) char.extensions.underdark.gallery = [];
        return char;
    }

    // ── Gallery strip (profile tab) ───────────────────────────────────────────
    function renderGalleryStrip(id) {
        const $strip = qs('#gallery-strip');
        if (!$strip) return;
        const allImages = getAllGalleryImages(id);

        if (!allImages.length) {
            $strip.hidden = true;
            return;
        }

        $strip.innerHTML = allImages.map((src, i) =>
            `<div class="gallery-strip__thumb ${i === 0 ? 'gallery-strip__thumb--active' : ''}"
                  style="background-image:url(${src})" data-gsrc="${esc(src)}" data-gi="${i}" title="Image ${i + 1}">
                 <span class="gallery-strip__num">${i + 1}</span>
             </div>`
        ).join('');
        // "Add more" placeholder at end
        $strip.innerHTML += `<div class="gallery-strip__add" id="gallery-strip-add" title="Manage gallery">
            <i data-lucide="plus"></i>
        </div>`;
        $strip.hidden = false;

        qsa('.gallery-strip__thumb', $strip).forEach($t => {
            $t.addEventListener('click', () => {
                qsa('.gallery-strip__thumb', $strip).forEach(x => x.classList.remove('gallery-strip__thumb--active'));
                $t.classList.add('gallery-strip__thumb--active');
                const $av = qs('.profile-details__avatar');
                if ($av) $av.style.backgroundImage = `url(${$t.dataset.gsrc})`;
                // Open lightbox on strip click
                openLightbox(id, parseInt($t.dataset.gi));
            });
        });

        qs('#gallery-strip-add', $strip)?.addEventListener('click', () => openGalleryModal(id));
        lucideRefresh($strip);
    }

    // ── Gallery modal (manage / add / remove) ─────────────────────────────────
    function openGalleryModal(id) {
        galleryCharId = id;
        const char = state.loadedCharacters[id];
        const meta = state.characters.find(c => c.id === id);
        qs('#gallery-char-name').textContent = char?.name || meta?.name || 'Gallery';
        renderGalleryModal(id);
        qs('#modal-gallery').hidden = false;
        lucideRefresh(qs('#modal-gallery'));
    }

    function renderGalleryModal(id) {
        const $grid = qs('#gallery-grid');
        if (!$grid) return;
        const allImages = getAllGalleryImages(id);
        const $count = qs('#gallery-count');
        if ($count) $count.textContent = allImages.length ? `${allImages.length} image${allImages.length !== 1 ? 's' : ''}` : '';

        if (!allImages.length) {
            $grid.innerHTML = `
                <div class="gallery-empty">
                    <i data-lucide="image-off"></i>
                    <span>No images yet</span>
                    <p>Upload files or paste an image URL below.</p>
                </div>`;
            lucideRefresh($grid);
            return;
        }

        $grid.innerHTML = allImages.map((src, i) => {
            const isCover = i === 0;
            return `
            <div class="gallery-item ${isCover ? 'gallery-item--cover' : ''}"
                 data-gi="${i}" draggable="true">
                <img src="${esc(src)}" alt="Gallery image ${i + 1}" loading="lazy">
                <div class="gallery-item__overlay">
                    <div class="gallery-item__overlay-top">
                        ${isCover ? `<span class="gallery-item__cover-badge"><i data-lucide="star"></i> Cover</span>` : ''}
                        <button class="gallery-item__btn gallery-item__btn--lb" data-lb="${i}" title="Open fullscreen">
                            <i data-lucide="expand"></i>
                        </button>
                    </div>
                    <div class="gallery-item__overlay-bot">
                        ${!isCover ? `<button class="gallery-item__btn gallery-item__btn--cover" data-set-cover="${i - 1}" title="Set as cover / avatar">
                            <i data-lucide="star"></i>
                        </button>` : ''}
                        ${!isCover ? `<button class="gallery-item__btn gallery-item__btn--del" data-del="${i - 1}" title="Remove">
                            <i data-lucide="trash-2"></i>
                        </button>` : ''}
                    </div>
                </div>
                <div class="gallery-item__drag-handle" title="Drag to reorder">
                    <i data-lucide="grip-vertical"></i>
                </div>
            </div>`;
        }).join('');

        // Lightbox open
        qsa('[data-lb]', $grid).forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                openLightbox(id, parseInt(btn.dataset.lb));
            });
        });

        // Set cover
        qsa('[data-set-cover]', $grid).forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.setCover);
                const char = ensureGalleryStore(id);
                if (!char) return;
                const gallery = char.extensions.underdark.gallery;
                const src = gallery[idx];
                const meta = state.characters.find(c => c.id === id);
                if (meta && src) {
                    // Swap: push old avatar into gallery, set new one
                    if (meta.avatar_path) gallery.unshift(meta.avatar_path);
                    gallery.splice(gallery.indexOf(src), 1);
                    meta.avatar_path = src;
                    saveState();
                    renderRoster();
                    renderGalleryStrip(id);
                    renderGalleryModal(id);
                    showToast(`Cover image updated for ${meta.name}`);
                }
            });
        });

        // Delete
        qsa('[data-del]', $grid).forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.del);
                const char = ensureGalleryStore(id);
                if (!char) return;
                char.extensions.underdark.gallery.splice(idx, 1);
                saveState();
                renderGalleryStrip(id);
                renderGalleryModal(id);
                showToast('Image removed');
            });
        });

        // Drag-to-reorder (gallery images only — index 0 = avatar, can't reorder that)
        setupGalleryDragSort($grid, id);

        lucideRefresh($grid);
    }

    function setupGalleryDragSort($grid, id) {
        let dragSrc = null;

        qsa('.gallery-item:not(.gallery-item--cover)', $grid).forEach(item => {
            item.addEventListener('dragstart', e => {
                dragSrc = item;
                item.classList.add('gallery-item--dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            item.addEventListener('dragend', () => {
                item.classList.remove('gallery-item--dragging');
                qsa('.gallery-item--dragover', $grid).forEach(el => el.classList.remove('gallery-item--dragover'));
                dragSrc = null;
            });
            item.addEventListener('dragover', e => {
                e.preventDefault();
                if (dragSrc && dragSrc !== item && !item.classList.contains('gallery-item--cover')) {
                    item.classList.add('gallery-item--dragover');
                }
            });
            item.addEventListener('dragleave', () => item.classList.remove('gallery-item--dragover'));
            item.addEventListener('drop', e => {
                e.preventDefault();
                item.classList.remove('gallery-item--dragover');
                if (!dragSrc || dragSrc === item || item.classList.contains('gallery-item--cover')) return;
                const srcIdx = parseInt(dragSrc.dataset.gi) - 1; // -1 because index 0 is avatar (not in gallery array)
                const dstIdx = parseInt(item.dataset.gi) - 1;
                if (srcIdx < 0 || dstIdx < 0) return;
                const char = ensureGalleryStore(id);
                if (!char) return;
                const arr = char.extensions.underdark.gallery;
                const [removed] = arr.splice(srcIdx, 1);
                arr.splice(dstIdx, 0, removed);
                saveState();
                renderGalleryModal(id);
                renderGalleryStrip(id);
            });
        });
    }

    // ── Lightbox ──────────────────────────────────────────────────────────────
    function openLightbox(charId, startIndex) {
        lbImages   = getAllGalleryImages(charId);
        lbIndex    = startIndex;
        galleryCharId = charId;
        renderLightbox();
        qs('#lightbox').hidden = false;
        lucideRefresh(qs('#lightbox'));
    }

    function renderLightbox() {
        if (!lbImages.length) return;
        lbIndex = Math.max(0, Math.min(lbImages.length - 1, lbIndex));
        const src = lbImages[lbIndex];
        qs('#lb-img').src = src;
        qs('#lb-idx').textContent  = lbIndex + 1;
        qs('#lb-total').textContent = lbImages.length;
        qs('#lb-caption').textContent = lbIndex === 0 ? 'Cover Image' : `Image ${lbIndex + 1}`;
        // Disable set-avatar for cover
        const $setAv = qs('#lb-set-avatar');
        if ($setAv) $setAv.disabled = (lbIndex === 0);
        const $del = qs('#lb-remove');
        if ($del) $del.disabled = (lbIndex === 0);
        // Prev/next visibility
        qs('#lb-prev').style.opacity = lbIndex > 0 ? '1' : '0.25';
        qs('#lb-next').style.opacity = lbIndex < lbImages.length - 1 ? '1' : '0.25';
    }

    qs('#lb-prev')?.addEventListener('click', () => { lbIndex--; renderLightbox(); });
    qs('#lb-next')?.addEventListener('click', () => { lbIndex++; renderLightbox(); });
    qs('#lb-close')?.addEventListener('click', () => { qs('#lightbox').hidden = true; });
    qs('.lightbox__backdrop')?.addEventListener('click', () => { qs('#lightbox').hidden = true; });

    qs('#lb-set-avatar')?.addEventListener('click', () => {
        if (!galleryCharId || lbIndex === 0) return;
        const src  = lbImages[lbIndex];
        const meta = state.characters.find(c => c.id === galleryCharId);
        const char = ensureGalleryStore(galleryCharId);
        if (!meta || !char) return;
        const gallery = char.extensions.underdark.gallery;
        if (meta.avatar_path) gallery.unshift(meta.avatar_path);
        const idx = gallery.indexOf(src);
        if (idx !== -1) gallery.splice(idx, 1);
        meta.avatar_path = src;
        saveState();
        renderRoster();
        renderGalleryStrip(galleryCharId);
        renderGalleryModal(galleryCharId);
        lbImages = getAllGalleryImages(galleryCharId);
        lbIndex  = 0;
        renderLightbox();
        showToast('Cover image updated');
    });

    qs('#lb-remove')?.addEventListener('click', async () => {
        if (!galleryCharId || lbIndex === 0) return;
        const char = ensureGalleryStore(galleryCharId);
        if (!char) return;
        char.extensions.underdark.gallery.splice(lbIndex - 1, 1);
        saveState();
        lbImages = getAllGalleryImages(galleryCharId);
        renderGalleryStrip(galleryCharId);
        renderGalleryModal(galleryCharId);
        if (!lbImages.length) { qs('#lightbox').hidden = true; return; }
        lbIndex = Math.min(lbIndex, lbImages.length - 1);
        renderLightbox();
        showToast('Image removed');
    });

    // Keyboard nav in lightbox
    document.addEventListener('keydown', e => {
        if (qs('#lightbox')?.hidden === false) {
            if (e.key === 'ArrowLeft')  { lbIndex--; renderLightbox(); }
            if (e.key === 'ArrowRight') { lbIndex++; renderLightbox(); }
            if (e.key === 'Escape')     { qs('#lightbox').hidden = true; }
        }
    });

    // Close gallery modal
    qs('#gallery-close')?.addEventListener('click', () => { qs('#modal-gallery').hidden = true; });
    qs('.modal__backdrop', qs('#modal-gallery'))?.addEventListener('click', () => { qs('#modal-gallery').hidden = true; });

    // Upload files
    qs('#gallery-add-file')?.addEventListener('click', () => qs('#gallery-file-input').click());
    qs('#gallery-file-input')?.addEventListener('change', async e => {
        const files = [...e.target.files];
        e.target.value = '';
        if (!galleryCharId) return;
        const char = ensureGalleryStore(galleryCharId);
        if (!char) return;
        let added = 0;
        for (const file of files) {
            if (file.size > 10 * 1024 * 1024) { showToast(`${file.name} exceeds 10 MB limit`, 'error'); continue; }
            await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = ev => { char.extensions.underdark.gallery.push(ev.target.result); added++; resolve(); };
                reader.onerror = () => { showToast(`Failed to read ${file.name}`, 'error'); resolve(); };
                reader.readAsDataURL(file);
            });
        }
        if (added) {
            saveState();
            renderGalleryStrip(galleryCharId);
            renderGalleryModal(galleryCharId);
            showToast(`${added} image${added !== 1 ? 's' : ''} added`);
        }
    });

    // Add by URL
    qs('#gallery-url-add')?.addEventListener('click', () => {
        const $input = qs('#gallery-url-input');
        const url = $input?.value.trim();
        if (!url) return;
        // Basic URL validation
        try { new URL(url); } catch { showToast('Invalid URL', 'error'); return; }
        if (!galleryCharId) return;
        const char = ensureGalleryStore(galleryCharId);
        if (!char) return;
        char.extensions.underdark.gallery.push(url);
        $input.value = '';
        saveState();
        renderGalleryStrip(galleryCharId);
        renderGalleryModal(galleryCharId);
        showToast('Image URL added');
    });
    qs('#gallery-url-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') qs('#gallery-url-add').click();
    });

    // ── Chat Background ────────────────────────────────────────────────────────
    function initChatBackground() {
        const bgCfg = state.config.chatBackground || {};
        const $blurInput   = qs('#bg-blur-input');
        const $blurVal     = qs('#bg-blur-val');
        const $brightInput = qs('#bg-bright-input');
        const $brightVal   = qs('#bg-bright-val');
        const $opacInput   = qs('#bg-opacity-input');
        const $opacVal     = qs('#bg-opacity-val');
        const $urlInput    = qs('#bg-url-input');

        if ($blurInput)   { $blurInput.value   = bgCfg.blur   ?? 45;  if ($blurVal)   $blurVal.textContent   = $blurInput.value; }
        if ($brightInput) { $brightInput.value = bgCfg.bright ?? 30;  if ($brightVal) $brightVal.textContent = $brightInput.value; }
        if ($opacInput)   { $opacInput.value   = bgCfg.opacity ?? 50; if ($opacVal)   $opacVal.textContent   = $opacInput.value; }
        if ($urlInput && bgCfg.url)  $urlInput.value = bgCfg.url;

        // Mark active preset
        const activePreset = bgCfg.preset || '';
        qsa('.bg-preset').forEach(btn => {
            btn.classList.toggle('active', (btn.dataset.bg || '') === activePreset);
        });

        qsa('.bg-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                qsa('.bg-preset').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (!state.config.chatBackground) state.config.chatBackground = {};
                state.config.chatBackground.preset = btn.dataset.bg || '';
                state.config.chatBackground.url    = '';
                if ($urlInput) $urlInput.value = '';
                saveState();
                applyChatBackground();
            });
        });

        const syncSlider = (input, valEl, key) => {
            input?.addEventListener('input', () => {
                if (valEl) valEl.textContent = input.value;
                if (!state.config.chatBackground) state.config.chatBackground = {};
                state.config.chatBackground[key] = parseInt(input.value);
                saveState();
                applyChatBackground();
            });
        };
        syncSlider($blurInput, $blurVal, 'blur');
        syncSlider($brightInput, $brightVal, 'bright');
        syncSlider($opacInput, $opacVal, 'opacity');

        qs('#bg-url-apply')?.addEventListener('click', () => {
            const url = $urlInput?.value.trim() || '';
            if (!state.config.chatBackground) state.config.chatBackground = {};
            state.config.chatBackground.url    = url;
            state.config.chatBackground.preset = '';
            qsa('.bg-preset').forEach(b => b.classList.toggle('active', !url && (b.dataset.bg || '') === ''));
            saveState();
            applyChatBackground();
        });

        applyChatBackground();
    }

    // ── Character Import ──────────────────────────────────────────────────────
    qs('#import-card').addEventListener('click', () => qs('#card-input').click());
    qs('#card-input').addEventListener('change', async e => {
        const files = [...e.target.files];
        e.target.value = '';
        for (const file of files) {
            try {
                const card = await parseCharacterCard(file);
                const id   = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                const meta = {
                    id,
                    name:        card.name,
                    tagline:     card.creator_notes?.slice(0, 80) || 'Imported Fragment',
                    avatar_path: card.avatar || null,
                    tags:        card.tags || []
                };
                await saveCharacter(meta, card);
                renderRoster();
                selectCharacter(id);
                showToast(`${card.name} imported`);
            } catch (err) {
                showToast(`Import failed: ${err.message}`, 'error');
            }
        }
    });

    // ── Character Creator Modal ───────────────────────────────────────────────
    let creatorEditId = null;
    let creatorAvatarDataUrl = null;

    function openCreator(editId = null) {
        creatorEditId     = editId;
        creatorAvatarDataUrl = null;
        const modal = qs('#modal-creator');

        // Reset
        qsa('#modal-creator input, #modal-creator textarea').forEach(el => { el.value = ''; });
        qs('#creator-title-text').textContent = editId ? 'Edit Fragment' : 'Create Fragment';
        qs('#creator-avatar-preview').style.backgroundImage = 'none';
        qs('#creator-avatar-preview').classList.remove('has-image');

        if (editId) {
            const char = state.loadedCharacters[editId];
            const meta = state.characters.find(c => c.id === editId);
            if (char) {
                qs('#creator-name').value        = char.name        || '';
                qs('#creator-tagline').value     = meta?.tagline    || '';
                qs('#creator-description').value = char.description || '';
                qs('#creator-personality').value = char.personality || '';
                qs('#creator-scenario').value    = char.scenario    || '';
                qs('#creator-first-mes').value   = char.first_mes   || '';
                qs('#creator-system-prompt').value = char.system_prompt || '';
                qs('#creator-post-history').value  = char.post_history_instructions || '';
                qs('#creator-notes').value         = char.creator_notes || '';
                qs('#creator-author').value        = char.creator || '';
                qs('#creator-mes-example').value   = char.mes_example || '';
                qs('#creator-alt-greetings').value = (char.alternate_greetings || []).join('\n');
                qs('#creator-tags').value          = (meta?.tags || char.tags || []).join(', ');
                if (meta?.avatar_path || char.avatar) {
                    const src = meta?.avatar_path || char.avatar;
                    qs('#creator-avatar-preview').style.backgroundImage = `url(${src})`;
                    qs('#creator-avatar-preview').classList.add('has-image');
                    creatorAvatarDataUrl = src;
                }
            }
        }

        // Creator tabs
        qsa('.creator-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                qsa('.creator-tab').forEach(b => b.classList.remove('active'));
                qsa('.creator-tab-panel').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                qs(`#ctab-${btn.dataset.ctab}`)?.classList.add('active');
            });
        });

        // Reset to first tab
        qsa('.creator-tab').forEach((b, i) => b.classList.toggle('active', i === 0));
        qsa('.creator-tab-panel').forEach((p, i) => p.classList.toggle('active', i === 0));

        showModal('modal-creator');
    }

    qs('#create-character').addEventListener('click', () => openCreator());
    // Static welcome button (may or may not exist if history loaded)
    qs('#welcome-create')?.addEventListener('click', () => openCreator());
    qs('#creator-close').addEventListener('click',  () => hideModal('modal-creator'));
    qs('#creator-cancel').addEventListener('click', () => hideModal('modal-creator'));
    qs('.modal__backdrop', qs('#modal-creator'))?.addEventListener('click', () => hideModal('modal-creator'));

    // Avatar picker
    qs('#creator-avatar-btn').addEventListener('click', () => qs('#creator-avatar-input').click());
    qs('#creator-avatar-input').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            creatorAvatarDataUrl = ev.target.result;
            qs('#creator-avatar-preview').style.backgroundImage = `url(${creatorAvatarDataUrl})`;
            qs('#creator-avatar-preview').classList.add('has-image');
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });

    qs('#creator-save').addEventListener('click', async () => {
        const name = qs('#creator-name').value.trim();
        if (!name) {
            qs('#creator-name').classList.add('shake');
            setTimeout(() => qs('#creator-name').classList.remove('shake'), 500);
            return;
        }

        const id = creatorEditId || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        const card = buildCard({
            name,
            description:              qs('#creator-description').value.trim(),
            personality:              qs('#creator-personality').value.trim(),
            scenario:                 qs('#creator-scenario').value.trim(),
            first_mes:                qs('#creator-first-mes').value.trim(),
            system_prompt:            qs('#creator-system-prompt').value.trim(),
            post_history_instructions:qs('#creator-post-history').value.trim(),
            creator_notes:            qs('#creator-notes').value.trim(),
            creator:                  qs('#creator-author').value.trim(),
            mes_example:              qs('#creator-mes-example').value.trim(),
            alternate_greetings:      qs('#creator-alt-greetings').value.trim()
                .split('\n').map(s => s.trim()).filter(Boolean),
            tags: qs('#creator-tags').value.split(',').map(t => t.trim()).filter(Boolean),
            avatar: creatorAvatarDataUrl || null
        });

        const meta = {
            id,
            name,
            tagline: qs('#creator-tagline').value.trim() || '',
            avatar_path: creatorAvatarDataUrl || null,
            tags: card.tags
        };

        await saveCharacter(meta, card);
        hideModal('modal-creator');
        renderRoster();
        selectCharacter(id);
    });

    qs('#creator-export').addEventListener('click', () => {
        const name = qs('#creator-name').value.trim() || 'character';
        const card = buildCard({
            name,
            description:               qs('#creator-description').value.trim(),
            personality:               qs('#creator-personality').value.trim(),
            scenario:                  qs('#creator-scenario').value.trim(),
            first_mes:                 qs('#creator-first-mes').value.trim(),
            system_prompt:             qs('#creator-system-prompt').value.trim(),
            post_history_instructions: qs('#creator-post-history').value.trim(),
            creator_notes:             qs('#creator-notes').value.trim(),
            creator:                   qs('#creator-author').value.trim(),
            mes_example:               qs('#creator-mes-example').value.trim(),
            alternate_greetings:       qs('#creator-alt-greetings').value.trim().split('\n').filter(Boolean),
            tags:                      qs('#creator-tags').value.split(',').map(t => t.trim()).filter(Boolean)
        });
        const json = JSON.stringify({ spec: 'chara_card_v2', data: card }, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `${name.toLowerCase().replace(/\s+/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // ── Lorebook UI ───────────────────────────────────────────────────────────
    const $loreList    = qs('#lore-list');
    const $bookSelect  = qs('#book-select');
    const $bookWrap    = qs('#book-select-wrap');

    function getActiveBookId() {
        return $bookSelect.value || state.lorebooks[0]?.id || null;
    }

    function renderLorebooks() {
        const lorebooks = state.lorebooks;
        if (!lorebooks.length) {
            $loreList.innerHTML = '<div class="world-view__empty">No lorebooks. Click + to add one.</div>';
            $bookWrap.hidden = true;
            return;
        }

        $bookWrap.hidden = false;
        // Guard: ensure all books have an entries array (handles malformed saves)
        lorebooks.forEach(b => { if (!Array.isArray(b.entries)) b.entries = []; });
        $bookSelect.innerHTML = lorebooks.map(b =>
            `<option value="${esc(b.id)}">${esc(b.name)} (${b.entries.length})</option>`
        ).join('');

        const bookId  = getActiveBookId();
        const book    = lorebooks.find(b => b.id === bookId) || lorebooks[0];
        if (!book) return;

        if (!book.entries.length) {
            $loreList.innerHTML = '<div class="world-view__empty">No entries. Click + to add.</div>';
            return;
        }

        $loreList.innerHTML = book.entries.map(e => `
            <div class="lore-entry ${e.disabled ? 'lore-entry--disabled' : ''}" data-lore-id="${esc(e.id)}">
                <div class="lore-entry__header">
                    <span class="lore-entry__name">${esc(e.name)}</span>
                    <div class="lore-entry__actions">
                        ${e.alwaysOn ? '<span class="badge badge--info">Always On</span>' : ''}
                        <button class="btn-icon btn-icon--xs" data-lore-edit="${esc(e.id)}" title="Edit">
                            <i data-lucide="pencil"></i>
                        </button>
                        <button class="btn-icon btn-icon--xs btn-icon--danger" data-lore-del="${esc(e.id)}" title="Delete">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
                ${e.keywords.length
                    ? `<div class="lore-entry__keys">${e.keywords.map(k => `<span class="tag">${esc(k)}</span>`).join('')}</div>`
                    : ''
                }
                <div class="lore-entry__content">${esc(e.content).slice(0, 120)}${e.content.length > 120 ? '…' : ''}</div>
            </div>
        `).join('');

        qsa('[data-lore-edit]', $loreList).forEach(btn => {
            btn.addEventListener('click', () => openLoreEditor(bookId, btn.dataset.loreEdit));
        });
        qsa('[data-lore-del]', $loreList).forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await confirm('Delete Entry', 'Delete this lore entry?');
                if (!ok) return;
                removeEntry(state.lorebooks, bookId, btn.dataset.loreDel);
                saveState();
                renderLorebooks();
            });
        });

        lucideRefresh($loreList);
    }

    $bookSelect.addEventListener('change', renderLorebooks);

    qs('#remove-book')?.addEventListener('click', async () => {
        const bookId = getActiveBookId();
        if (!bookId) return;
        const book = state.lorebooks.find(b => b.id === bookId);
        if (!book) return;
        const ok = await confirm('Delete Lorebook', `Delete "${book.name}" and all its entries? This cannot be undone.`);
        if (!ok) return;
        removeBook(state.lorebooks, bookId);
        saveState();
        renderLorebooks();
        showToast(`Lorebook "${book.name}" deleted`, 'warn');
    });

    qs('#add-book').addEventListener('click', () => {
        const name = prompt('Lorebook name:', 'New Lorebook');
        if (!name?.trim()) return;
        addBook(state.lorebooks, name.trim());
        saveState();
        renderLorebooks();
    });

    qs('#add-lore').addEventListener('click', () => {
        const bookId = getActiveBookId();
        if (!bookId) {
            const book = createBook('Global');
            state.lorebooks.push(book);
        }
        openLoreEditor(getActiveBookId() || state.lorebooks[0].id, null);
    });

    // ── Lore Entry Editor Modal ───────────────────────────────────────────────
    function openLoreEditor(bookId, entryId) {
        const book  = state.lorebooks.find(b => b.id === bookId);
        const entry = entryId ? book?.entries.find(e => e.id === entryId) : null;

        qs('#lore-entry-id').value      = entryId || '';
        qs('#lore-book-id').value       = bookId  || '';
        qs('#lore-entry-name').value    = entry?.name    || '';
        qs('#lore-entry-keywords').value = (entry?.keywords || []).join(', ');
        qs('#lore-entry-content').value  = entry?.content  || '';
        qs('#lore-entry-comment').value  = entry?.comment  || '';
        qs('#lore-always-on').checked    = entry?.alwaysOn ?? false;
        qs('#lore-use-regex').checked    = entry?.useRegex ?? false;
        qs('#lore-case-sensitive').checked = entry?.caseSensitive ?? false;
        qs('#lore-disabled').checked     = entry?.disabled ?? false;

        const priority = entry?.priority ?? 50;
        const order    = entry?.insertionOrder ?? 100;
        qs('#lore-priority-input').value = priority;
        qs('#lore-order-input').value    = order;
        qs('#lore-priority-val').textContent = priority;
        qs('#lore-order-val').textContent    = order;

        showModal('modal-lore-editor');
    }

    qs('#lore-priority-input').addEventListener('input', e => {
        qs('#lore-priority-val').textContent = e.target.value;
    });
    qs('#lore-order-input').addEventListener('input', e => {
        qs('#lore-order-val').textContent = e.target.value;
    });

    qs('#lore-editor-close').addEventListener('click',  () => hideModal('modal-lore-editor'));
    qs('#lore-editor-cancel').addEventListener('click', () => hideModal('modal-lore-editor'));
    qs('.modal__backdrop', qs('#modal-lore-editor'))?.addEventListener('click', () => hideModal('modal-lore-editor'));

    qs('#lore-editor-save').addEventListener('click', () => {
        const entryId = qs('#lore-entry-id').value;
        const bookId  = qs('#lore-book-id').value;
        const fields  = {
            name:            qs('#lore-entry-name').value.trim()     || 'Unnamed',
            keywords:        qs('#lore-entry-keywords').value.split(',').map(k => k.trim()).filter(Boolean),
            content:         qs('#lore-entry-content').value.trim(),
            comment:         qs('#lore-entry-comment').value.trim(),
            alwaysOn:        qs('#lore-always-on').checked,
            useRegex:        qs('#lore-use-regex').checked,
            caseSensitive:   qs('#lore-case-sensitive').checked,
            disabled:        qs('#lore-disabled').checked,
            priority:        parseInt(qs('#lore-priority-input').value),
            insertionOrder:  parseInt(qs('#lore-order-input').value)
        };

        if (entryId) {
            updateEntry(state.lorebooks, bookId, entryId, fields);
        } else {
            addEntry(state.lorebooks, bookId, fields);
        }

        saveState();
        hideModal('modal-lore-editor');
        renderLorebooks();
    });

    // ── Message Thread & Rendering ────────────────────────────────────────────
    const $thread = qs('#message-thread');

    function appendMessage(msgObj, nameOverride, avatarUrl, thoughts = null) {
        const { id, role, content, botId } = msgObj;
        const char = botId ? state.loadedCharacters[botId] : null;
        const meta = botId ? state.characters.find(c => c.id === botId) : null;
        const name = nameOverride
            || (botId ? (getCharOverride(botId).nickname || char?.name) : null)
            || (role === 'user' ? (state.config.userName || 'You') : 'System');
        const rawAvatar = avatarUrl || meta?.avatar_path || char?.avatar || null;
        const avatar = rawAvatar ? getAvatarUrlSync(botId, rawAvatar) : null;

        const showThoughts = state.config.flags?.showThoughts ?? false;
        const thoughtsHtml = showThoughts && thoughts?.length
            ? `<details class="message__thoughts">
                <summary class="message__thoughts-label"><i data-lucide="brain"></i> Inner thoughts</summary>
                <div class="message__thoughts-body">${thoughts.map(t => `<p>${esc(t)}</p>`).join('')}</div>
               </details>`
            : '';

        const commentCount  = msgObj.comments?.length || 0;
        const hasComments   = commentCount > 0;
        const isBot         = role === 'bot';
        const modelLabel    = msgObj.model ? `<span class="message__model-badge">${esc(msgObj.model.split('/').pop() || msgObj.model)}</span>` : '';
        const tokenLabel    = (isBot && msgObj.tokens > 0) ? `<span class="message__token-badge" title="${msgObj.tokens} tokens">${msgObj.tokens}t</span>` : '';

        const $msg = document.createElement('div');
        $msg.className = `message message--${role}`;
        $msg.dataset.msgId = id;

        $msg.innerHTML = `
            <div class="message__avatar" style="background-image:${avatar ? `url(${avatar})` : 'none'}">
                ${!avatar ? `<i data-lucide="${role === 'user' ? 'user' : 'cpu'}"></i>` : ''}
            </div>
            <div class="message__main">
                <div class="message__header">
                    <span class="message__name">${esc(name)}</span>
                    ${modelLabel}
                    ${tokenLabel}
                    <span class="message__time">${new Date(msgObj.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <div class="message__actions">
                        <button class="msg-action" data-action="copy"    title="Copy text"><i data-lucide="copy"></i></button>
                        <button class="msg-action" data-action="edit"    title="Edit message"><i data-lucide="pencil"></i></button>
                        ${isBot ? `<button class="msg-action" data-action="retry"  title="Regenerate" data-bot-id="${esc(botId || '')}"><i data-lucide="refresh-cw"></i></button>` : ''}
                        ${isBot ? `<button class="msg-action" data-action="branch" title="Branch from here (keep this, regenerate)" data-bot-id="${esc(botId || '')}"><i data-lucide="git-branch"></i></button>` : ''}
                        <button class="msg-action ${hasComments ? 'msg-action--has-annotation' : ''}" data-action="comment" title="Annotate${hasComments ? ` (${commentCount})` : ''}">
                            <i data-lucide="message-square"></i>
                            ${hasComments ? `<span class="msg-action__badge">${commentCount}</span>` : ''}
                        </button>
                        <button class="msg-action" data-action="react" title="React"><i data-lucide="smile-plus"></i></button>
                        <button class="msg-action msg-action--danger" data-action="delete" title="Delete message"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
                ${thoughtsHtml}
                <div class="message__bubble">
                    <div class="message__content">${renderMarkdown(content)}</div>
                </div>
                ${msgObj.edited ? '<span class="message__meta-tag">edited</span>' : ''}
                ${(() => {
                    const r = msgObj.reactions || {};
                    const entries = Object.entries(r).filter(([, who]) => who.length > 0);
                    if (!entries.length) return '';
                    return `<div class="message__reactions">${entries.map(([emoji, who]) =>
                        `<button class="reaction-chip ${who.includes('user') ? 'reaction-chip--active' : ''}"
                         data-react-emoji="${esc(emoji)}" title="${who.length} reaction">${emoji} <span>${who.length}</span></button>`
                    ).join('')}</div>`;
                })()}
                ${hasComments ? `<div class="message__comment-strip">${msgObj.comments.map(c => `
                    <div class="message__comment" data-comment-id="${esc(c.id)}">
                        <i data-lucide="message-square" class="message__comment-icon"></i>
                        <span class="message__comment-text">${esc(c.text)}</span>
                        <button class="message__comment-del" data-del-comment="${esc(c.id)}" title="Remove note"><i data-lucide="x"></i></button>
                    </div>`).join('')}
                </div>` : ''}
            </div>`;

        // ── Copy ─────────────────────────────────────────────────────────────
        qs('[data-action="copy"]', $msg).addEventListener('click', () => {
            navigator.clipboard.writeText(content).then(() => {
                const btn = qs('[data-action="copy"]', $msg);
                btn.querySelector('i').dataset.lucide = 'check';
                lucideRefresh(btn);
                setTimeout(() => { btn.querySelector('i').dataset.lucide = 'copy'; lucideRefresh(btn); }, 1500);
            }).catch(() => {});
        });

        // ── Edit ─────────────────────────────────────────────────────────────
        qs('[data-action="edit"]', $msg).addEventListener('click', () => {
            openMsgEditModal(id, content, isBot, name, (newContent, retrigger) => {
                editMessage(id, newContent);
                qs('.message__content', $msg).innerHTML = renderMarkdown(newContent);
                let $tag = qs('.message__meta-tag', $msg);
                if (!$tag) {
                    $tag = document.createElement('span');
                    $tag.className = 'message__meta-tag';
                    qs('.message__main', $msg).appendChild($tag);
                }
                $tag.textContent = 'edited';

                if (retrigger && !state.isStreaming) {
                    const idx = state.history.findIndex(m => m.id === id);
                    if (idx < 0) return;

                    if (isBot && botId) {
                        // Bot edit + regenerate: remove this message and everything after, re-run
                        state.session.history = state.history.slice(0, idx);
                        saveState();
                        const allMsgs = qsa('.message', $thread);
                        allMsgs.slice(allMsgs.indexOf($msg)).forEach(m => m.remove());
                        triggerBotResponse(botId);
                    } else {
                        // User edit + re-run: keep this message, remove everything after it
                        state.session.history = state.history.slice(0, idx + 1);
                        saveState();
                        const allMsgs = qsa('.message', $thread);
                        allMsgs.slice(allMsgs.indexOf($msg) + 1).forEach(m => m.remove());
                        const targetBotId = state.activeBotId;
                        if (targetBotId) triggerBotResponse(targetBotId);
                    }
                }
            });
        });

        // ── Retry (regenerate — removes this message, re-runs) ───────────────
        qs('[data-action="retry"]', $msg)?.addEventListener('click', async () => {
            if (state.isStreaming) return;
            const targetBotId = qs('[data-action="retry"]', $msg)?.dataset.botId || state.activeBotId;
            if (!targetBotId) return;
            const idx = state.history.findIndex(m => m.id === id);
            if (idx >= 0) {
                state.session.history = state.history.slice(0, idx);
                saveState();
                const allMsgs = qsa('.message', $thread);
                const msgIdx  = allMsgs.indexOf($msg);
                allMsgs.slice(msgIdx).forEach(m => m.remove());
            }
            await triggerBotResponse(targetBotId);
        });

        // ── Branch (keep this response, generate an alternative after same context) ──
        qs('[data-action="branch"]', $msg)?.addEventListener('click', async () => {
            if (state.isStreaming) return;
            const targetBotId = qs('[data-action="branch"]', $msg)?.dataset.botId || state.activeBotId;
            if (!targetBotId) return;
            const idx = state.history.findIndex(m => m.id === id);
            if (idx < 0) return;
            // Snapshot the original bot message and everything after it
            const originalBotMsg = state.history[idx];
            const msgsAfter      = state.history.slice(idx + 1);
            // Trim history to just before this message so the LLM regenerates
            // from the same prior context (same user turn)
            state.session.history = state.history.slice(0, idx);
            // triggerBotResponse will append its new message to the trimmed history
            await triggerBotResponse(targetBotId);
            // Re-append the original bot message and anything that was after it,
            // so the thread now has: ...pre, NEW response, original response, ...after
            state.session.history = [
                ...state.session.history,
                originalBotMsg,
                ...msgsAfter
            ];
            saveState();
            // Render the re-appended messages into the DOM
            [originalBotMsg, ...msgsAfter].forEach(m => {
                const c = m.botId ? state.loadedCharacters[m.botId] : null;
                const meta = m.botId ? state.characters.find(ch => ch.id === m.botId) : null;
                appendMessage(m, c?.name || null, meta?.avatar_path || c?.avatar, m.thoughts || null);
            });
        });

        // ── React ────────────────────────────────────────────────────────────
        qs('[data-action="react"]', $msg).addEventListener('click', (e) => {
            e.stopPropagation();
            showReactionPicker($msg, id);
        });

        // ── Existing reaction chips ───────────────────────────────────────────
        qsa('[data-react-emoji]', $msg).forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                addReaction(id, btn.dataset.reactEmoji);
                refreshReactions($msg, id);
            });
        });

        // ── Comment / Annotate ───────────────────────────────────────────────
        qs('[data-action="comment"]', $msg).addEventListener('click', () => {
            openCommentModal(id, $msg);
        });

        // ── Delete inline comment notes ──────────────────────────────────────
        qsa('[data-del-comment]', $msg).forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const cid = btn.dataset.delComment;
                deleteComment(id, cid);
                btn.closest('.message__comment')?.remove();
                refreshCommentActionBadge($msg, id);
            });
        });

        // ── Delete message ───────────────────────────────────────────────────
        qs('[data-action="delete"]', $msg).addEventListener('click', async () => {
            const ok = await confirm('Delete Message', 'Remove this message from the thread?');
            if (!ok) return;
            deleteMessage(id);
            $msg.remove();
        });

        $thread.appendChild($msg);
        $thread.scrollTop = $thread.scrollHeight;
        lucideRefresh($msg);
        return $msg;
    }

    // ── Message edit modal ────────────────────────────────────────────────────
    let _editAbort = null;

    function openMsgEditModal(msgId, currentContent, isBot, speakerName, onSave) {
        // Abort any previous open instance's listeners first
        _editAbort?.abort();
        _editAbort = new AbortController();
        const sig = _editAbort.signal;

        const $ta    = qs('#msg-edit-content');
        const $count = qs('#msg-edit-charcount');
        const $title = qs('#msg-edit-title');
        const $retrigLabel = qs('.msg-edit-retrigger-label');

        qs('#msg-edit-id').value  = msgId;
        $ta.value                 = currentContent;
        qs('#msg-edit-retrigger').checked = false;
        if ($count) $count.textContent = `${currentContent.length} chars`;

        // Context-aware title and retrigger label
        if ($title) $title.innerHTML = `<i data-lucide="pencil"></i> Edit — ${esc(speakerName || 'Message')}`;
        if ($retrigLabel) {
            $retrigLabel.lastChild.textContent = isBot
                ? ' Regenerate this response'
                : ' Re-run bot after saving';
        }

        // Single input listener, cleaned up on close
        $ta.addEventListener('input', () => {
            if ($count) $count.textContent = `${$ta.value.length} chars`;
        }, { signal: sig });

        const close = () => { hideModal('modal-msg-edit'); _editAbort?.abort(); };

        const doSave = () => {
            const newContent = $ta.value.trim();
            if (!newContent) return;
            onSave(newContent, qs('#msg-edit-retrigger')?.checked ?? false);
            close();
        };

        qs('#msg-edit-save').onclick   = doSave;
        qs('#msg-edit-cancel').onclick = close;
        qs('#msg-edit-close').onclick  = close;
        $ta.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doSave(); } };

        showModal('modal-msg-edit');
        lucideRefresh(qs('#msg-edit-title'));
        setTimeout(() => { $ta.focus(); $ta.setSelectionRange($ta.value.length, $ta.value.length); }, 50);
    }

    // ── Comment modal ─────────────────────────────────────────────────────────
    function openCommentModal(msgId, $msgEl) {
        qs('#msg-comment-msg-id').value = msgId;
        renderCommentList(msgId);
        showModal('modal-msg-comment');
        setTimeout(() => qs('#msg-comment-input')?.focus(), 50);

        const doAdd = () => {
            const text = qs('#msg-comment-input').value.trim();
            if (!text) return;
            const comment = addComment(msgId, text);
            if (!comment) return;
            qs('#msg-comment-input').value = '';
            renderCommentList(msgId);
            refreshCommentActionBadge($msgEl, msgId);
        };

        qs('#msg-comment-add').onclick = doAdd;
        qs('#msg-comment-input').onkeydown = e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doAdd(); }
        };
        qs('#msg-comment-close').onclick     = () => hideModal('modal-msg-comment');
        qs('#msg-comment-close-btn').onclick = () => hideModal('modal-msg-comment');
        qs('.modal__backdrop', qs('#modal-msg-comment'))?.removeEventListener('click', _commentBackdrop);
        _commentBackdrop = () => hideModal('modal-msg-comment');
        qs('.modal__backdrop', qs('#modal-msg-comment'))?.addEventListener('click', _commentBackdrop);
    }
    let _commentBackdrop = null;

    function renderCommentList(msgId) {
        const msg = state.history.find(m => m.id === msgId);
        const $list = qs('#msg-comment-list');
        if (!$list) return;
        const comments = msg?.comments || [];
        if (!comments.length) {
            $list.innerHTML = '<div class="comment-list__empty">No notes yet.</div>';
            return;
        }
        $list.innerHTML = comments.map(c => `
            <div class="comment-item" data-cid="${esc(c.id)}">
                <div class="comment-item__text">${esc(c.text)}</div>
                <div class="comment-item__meta">
                    <span>${new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <button class="btn-icon btn-icon--xs btn-icon--danger" data-del-cmt="${esc(c.id)}" title="Delete note">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>`).join('');

        qsa('[data-del-cmt]', $list).forEach(btn => {
            btn.addEventListener('click', () => {
                deleteComment(msgId, btn.dataset.delCmt);
                renderCommentList(msgId);
                // also refresh the badge on the original message element
                const $msgEl = qs(`.message[data-msg-id="${msgId}"]`, $thread);
                if ($msgEl) refreshCommentActionBadge($msgEl, msgId);
            });
        });
        lucideRefresh($list);
    }

    function refreshCommentActionBadge($msgEl, msgId) {
        const msg = state.history.find(m => m.id === msgId);
        const count = msg?.comments?.length || 0;
        const $btn  = qs('[data-action="comment"]', $msgEl);
        if (!$btn) return;
        $btn.classList.toggle('msg-action--has-annotation', count > 0);
        $btn.title = count > 0 ? `Annotate (${count})` : 'Annotate';
        const $badge = qs('.msg-action__badge', $btn);
        if (count > 0) {
            if ($badge) { $badge.textContent = count; }
            else {
                const span = document.createElement('span');
                span.className = 'msg-action__badge';
                span.textContent = count;
                $btn.appendChild(span);
            }
        } else {
            $badge?.remove();
        }
    }

    function showReactionPicker($msgEl, msgId) {
        const $picker = qs('#reaction-picker');
        if (!$picker) return;
        // Position BEFORE unhiding to prevent top-left flash
        const rect = $msgEl.getBoundingClientRect();
        const pickerW = 260;
        const top  = Math.max(4, rect.top + window.scrollY - 50);
        const left = Math.max(4, Math.min(rect.left, window.innerWidth - pickerW - 8));
        $picker.style.top  = `${top}px`;
        $picker.style.left = `${left}px`;
        $picker.hidden = false;
        $picker.dataset.forMsg = msgId;

        // Wire buttons
        qsa('.reaction-picker__btn', $picker).forEach(btn => {
            btn.onclick = () => {
                addReaction(msgId, btn.dataset.emoji);
                refreshReactions($msgEl, msgId);
                $picker.hidden = true;
            };
        });

        // Close on outside click or Escape
        const closePicker = (e) => {
            if (e.type === 'keydown' && e.key !== 'Escape') return;
            if (e.type === 'click' && $picker.contains(e.target)) return;
            $picker.hidden = true;
            document.removeEventListener('click', closePicker, true);
            document.removeEventListener('keydown', closePicker, true);
        };
        setTimeout(() => {
            document.addEventListener('click', closePicker, true);
            document.addEventListener('keydown', closePicker, true);
        }, 0);
    }

    function refreshReactions($msgEl, msgId) {
        const msg = state.history.find(m => m.id === msgId);
        const r = msg?.reactions || {};
        const entries = Object.entries(r).filter(([, who]) => who.length > 0);
        let $strip = qs('.message__reactions', $msgEl);
        if (!entries.length) { $strip?.remove(); return; }
        const html = `<div class="message__reactions">${entries.map(([emoji, who]) =>
            `<button class="reaction-chip ${who.includes('user') ? 'reaction-chip--active' : ''}"
             data-react-emoji="${esc(emoji)}" title="${who.length} reaction">${emoji} <span>${who.length}</span></button>`
        ).join('')}</div>`;
        if ($strip) {
            $strip.outerHTML = html;
        } else {
            const $bubble = qs('.message__bubble', $msgEl);
            $bubble?.insertAdjacentHTML('afterend', html);
        }
        // Re-wire new chips
        qs('.message__reactions', $msgEl)?.querySelectorAll('[data-react-emoji]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                addReaction(msgId, btn.dataset.reactEmoji);
                refreshReactions($msgEl, msgId);
            });
        });
    }

    function renderFullHistory() {
        const existing = qsa('.message', $thread);
        existing.forEach(m => m.remove());
        qs('#arena-welcome')?.remove();

        if (!state.history.length && !state.activeBotIds.length) {
            if (!qs('#arena-welcome')) {
                const welcome = document.createElement('div');
                welcome.className = 'arena__welcome';
                welcome.id = 'arena-welcome';
                welcome.innerHTML = `
                    <div class="welcome-screen">
                        <div class="welcome-screen__header">
                            <i data-lucide="zap" class="welcome-screen__icon"></i>
                            <h2>Begin Synchronization</h2>
                            <p>Choose a fragment to inhabit this thread.</p>
                        </div>
                        <div id="welcome-char-grid" class="welcome-char-grid"></div>
                        <div class="welcome-screen__actions">
                            <button id="welcome-create" class="btn btn--ghost">
                                <i data-lucide="wand-2"></i> Create Character
                            </button>
                            <button id="welcome-import" class="btn btn--ghost">
                                <i data-lucide="upload"></i> Import Card
                            </button>
                        </div>
                    </div>`;
                $thread.appendChild(welcome);
                qs('#welcome-create', welcome)?.addEventListener('click', () => openCreator());
                qs('#welcome-import', welcome)?.addEventListener('click', () => qs('#card-input').click());
                lucideRefresh(welcome);
            }
            renderWelcomeGrid();
            return;
        }

        state.history.forEach(msg => {
            const char = msg.botId ? state.loadedCharacters[msg.botId] : null;
            const meta = msg.botId ? state.characters.find(c => c.id === msg.botId) : null;
            appendMessage(msg, char?.name || null, meta?.avatar_path || char?.avatar, msg.thoughts || null);
        });
    }

    // ── Thread Search ─────────────────────────────────────────────────────────
    const $searchBar    = qs('#thread-search-bar');
    const $searchInput  = qs('#thread-search-input');
    const $searchCount  = qs('#thread-search-count');
    const $searchClear  = qs('#thread-search-clear');
    let _searchMatches  = [];
    let _searchIdx      = 0;
    let _searchOrigHTML = new Map(); // $contentEl → original innerHTML

    qs('#search-toggle')?.addEventListener('click', () => {
        const hidden = $searchBar.hidden;
        $searchBar.hidden = !hidden;
        if (!$searchBar.hidden) {
            $searchInput.focus();
            $searchInput.select();
            if ($searchClear) $searchClear.hidden = !$searchInput.value;
        } else {
            if ($searchClear) $searchClear.hidden = true;
            clearSearch();
        }
    });

    function clearSearch() {
        _searchOrigHTML.forEach((orig, el) => { el.innerHTML = orig; });
        _searchOrigHTML.clear();
        _searchMatches = [];
        _searchIdx = 0;
        if ($searchCount) $searchCount.textContent = '';
        if ($searchInput) $searchInput.value = '';
    }

    function runSearch(query) {
        // Restore original HTML first
        _searchOrigHTML.forEach((orig, el) => { el.innerHTML = orig; });
        _searchOrigHTML.clear();
        _searchMatches = [];
        _searchIdx = 0;

        if (!query.trim()) {
            if ($searchCount) $searchCount.textContent = '';
            return;
        }

        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(${escaped})`, 'gi');

        qsa('.message__content', $thread).forEach($el => {
            const orig = $el.innerHTML;
            if (!re.test($el.textContent)) return;
            _searchOrigHTML.set($el, orig);
            $el.innerHTML = $el.innerHTML.replace(re, '<mark class="search-highlight">$1</mark>');
            qsa('.search-highlight', $el).forEach(m => _searchMatches.push(m));
        });

        if ($searchCount) $searchCount.textContent = _searchMatches.length ? `${_searchIdx + 1}/${_searchMatches.length}` : 'No results';
        if (_searchMatches.length) scrollToMatch(0);
    }

    function scrollToMatch(idx) {
        _searchMatches.forEach((m, i) => m.classList.toggle('search-highlight--current', i === idx));
        _searchMatches[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if ($searchCount) $searchCount.textContent = `${idx + 1}/${_searchMatches.length}`;
    }

    $searchInput?.addEventListener('input', debounce(() => {
        runSearch($searchInput.value);
        if ($searchClear) $searchClear.hidden = !$searchInput.value;
    }, 200));
    $searchClear?.addEventListener('click', () => {
        $searchInput.value = '';
        $searchClear.hidden = true;
        clearSearch();
        $searchInput.focus();
    });
    qs('#thread-search-prev')?.addEventListener('click', () => {
        if (!_searchMatches.length) return;
        _searchIdx = (_searchIdx - 1 + _searchMatches.length) % _searchMatches.length;
        scrollToMatch(_searchIdx);
    });
    qs('#thread-search-next')?.addEventListener('click', () => {
        if (!_searchMatches.length) return;
        _searchIdx = (_searchIdx + 1) % _searchMatches.length;
        scrollToMatch(_searchIdx);
    });
    qs('#thread-search-close')?.addEventListener('click', () => {
        $searchBar.hidden = true;
        if ($searchClear) $searchClear.hidden = true;
        clearSearch();
    });

    // ── Quick Reply Bar ───────────────────────────────────────────────────────
    const QR_PROMPTS = {
        continue:    '(Continue the scene from where we left off.)',
        describe:    '(Describe the current scene and setting in vivid detail.)',
        narrate:     '(Narrate what happens next without dialogue.)',
        introspect:  '(Share your inner thoughts and feelings right now.)',
        ooc:         '[OOC: Let\'s pause the scene for a moment. ]',
        shorter:     '(Please write a shorter response this time.)',
        longer:      '(Please write a longer, more detailed response.)',
    };

    qs('#btn-quick-reply')?.addEventListener('click', () => {
        const $bar = qs('#quick-reply-bar');
        if ($bar) $bar.hidden = !$bar.hidden;
    });

    qsa('.qr-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const text = QR_PROMPTS[btn.dataset.qr] || '';
            if (!text) return;
            const $ta = qs('#rp-input');
            const cur = $ta.value;
            $ta.value = cur ? `${cur}\n${text}` : text;
            $ta.dispatchEvent(new Event('input'));
            $ta.focus();
            qs('#quick-reply-bar').hidden = true;
        });
    });

    // ── Session Export / Import ───────────────────────────────────────────────
    qs('#btn-export-session')?.addEventListener('click', () => {
        const json = exportSessionJson(state.activeSessionId);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `underdark-session-${state.session.name.replace(/\s+/g,'-')}-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    qs('#btn-import-session')?.addEventListener('click', () => {
        qs('#session-import-input')?.click();
    });

    qs('#session-import-input')?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        e.target.value = '';
        try {
            const text = await file.text();
            await importSessionJson(text);
            renderSessions();
            renderAll();
        } catch (err) {
            showToast(`Import failed: ${err.message}`, 'error');
        }
    });

    function renderAll() {
        renderSessions();
        renderRoster();
        renderActiveBots();
        renderLorebooks();
        renderFullHistory();
        syncConfigUI();
        renderPersonaCharSelect();
        updateTelemetry();
        applyChatBackground();

        const activeChar = state.loadedCharacters[state.activeBotId];
        const activeMeta = state.characters.find(c => c.id === state.activeBotId);
        if (activeChar) {
            renderProfile(activeChar, state.activeBotId);
            getAvatarUrl(state.activeBotId, activeMeta?.avatar_path || activeChar.avatar)
                .then(url => updateCinematicBackground(url));
        } else {
            qs('#profile-card').innerHTML = '<div class="profile-view__empty">No character selected</div>';
            qs('#profile-actions').hidden = true;
            const $gs = qs('#gallery-strip');
            if ($gs) $gs.hidden = true;
        }
    }

    // ── Streaming Bot Response ────────────────────────────────────────────────
    async function triggerBotResponse(botId) {
        const char = state.loadedCharacters[botId];
        const meta = state.characters.find(c => c.id === botId);
        if (!char || state.isStreaming) return;
        // Eagerly resolve IDB avatar so it's ready when placeholder renders
        const rawAv = meta?.avatar_path || char.avatar;
        if (rawAv?.startsWith('idb:')) await getAvatarUrl(botId, rawAv).catch(() => {});

        state.isStreaming = true;
        const controller = new AbortController();
        state.pendingAbort = controller;
        const override = getCharOverride(botId);
        setSendState(true, override.nickname || char.name);

        // Create placeholder message
        const placeholder = {
            id: `msg-tmp-${Date.now()}`,
            role: 'bot',
            content: '',
            botId,
            timestamp: Date.now(),
            tokens: 0,
            model: state.config.model
        };
        const $botMsg = appendMessage(placeholder, char.name, meta?.avatar_path || char.avatar);
        const $content = qs('.message__content', $botMsg);
        $content.innerHTML = '<span class="thinking"><span></span><span></span><span></span></span>';

        // Live "thinking" indicator shown while <think> tags are streaming
        let $thinkingAside = null;
        let isInsideThink   = false;

        try {
            const payload = buildPayload({
                character:  { ...char, id: botId },
                history:    state.history,
                lore:       state.lorebooks,
                config:     state.config,
                isGroup:    state.activeBotIds.length > 1,
                allChars:   state.activeBotIds.map(id => ({ ...state.loadedCharacters[id], id })),
                sessionId:  state.activeSessionId
            });

            // Debug: show built system prompt as a one-time collapsible block,
            // only when the thread has no prior debug message this session.
            if (state.config.flags?.showSystemPrompt && !qs('.message--debug', $thread)) {
                const sysMsgs = payload.messages.filter(m => m.role === 'system');
                const sysText = sysMsgs.map(m => m.content).join('\n\n---\n\n');
                const $debug  = document.createElement('div');
                $debug.className = 'message message--debug';
                $debug.innerHTML = `
                    <details class="debug-prompt">
                        <summary class="debug-prompt__label">
                            <i data-lucide="terminal"></i> System Prompt
                            <span class="debug-prompt__hint">click to expand</span>
                        </summary>
                        <pre class="debug-prompt__body">${esc(sysText)}</pre>
                    </details>`;
                $thread.insertBefore($debug, $botMsg);
                lucideRefresh($debug);
            }

            await streamCompletion(payload,
                (_delta, full) => {
                    // Detect whether we are currently inside a <think> block
                    const openCount  = (full.match(/<think>/gi)  || []).length;
                    const closeCount = (full.match(/<\/think>/gi) || []).length;
                    const nowThinking = openCount > closeCount;

                    if (nowThinking && !isInsideThink) {
                        // Just entered a <think> block — show aside indicator
                        isInsideThink = true;
                        if (!$thinkingAside) {
                            $thinkingAside = document.createElement('div');
                            $thinkingAside.className = 'message__thinking-live';
                            $thinkingAside.innerHTML = '<i data-lucide="brain"></i> <span>Thinking…</span>';
                            const $main = qs('.message__main', $botMsg);
                            $main.insertBefore($thinkingAside, qs('.message__bubble', $botMsg));
                            lucideRefresh($thinkingAside);
                        }
                    } else if (!nowThinking && isInsideThink) {
                        // Exited the <think> block — remove the indicator
                        isInsideThink = false;
                        $thinkingAside?.remove();
                        $thinkingAside = null;
                    }

                    $content.innerHTML = renderMarkdown(full);
                    $thread.scrollTop  = $thread.scrollHeight;
                },
                (finalText, tokens, thoughts) => {
                    // Clean up any lingering thinking indicator
                    $thinkingAside?.remove();

                    const msg = addMessage('bot', finalText, botId, {
                        tokens,
                        model: payload.model,
                        thoughts: thoughts?.length ? thoughts : null
                    });
                    $botMsg.dataset.msgId = msg.id;
                    $content.innerHTML   = renderMarkdown(finalText);

                    // Patch token badge into the live message element
                    if (tokens > 0) {
                        const $hdr = qs('.message__header', $botMsg);
                        if ($hdr && !qs('.message__token-badge', $hdr)) {
                            const $tb = document.createElement('span');
                            $tb.className = 'message__token-badge';
                            $tb.title = `${tokens} tokens`;
                            $tb.textContent = `${tokens}t`;
                            const $time = qs('.message__time', $hdr);
                            if ($time) $hdr.insertBefore($tb, $time);
                            else $hdr.appendChild($tb);
                        }
                    }

                    // Inject permanent thought bubble
                    if (state.config.flags?.showThoughts && thoughts?.length) {
                        const $thoughtsEl = document.createElement('details');
                        $thoughtsEl.className = 'message__thoughts';
                        $thoughtsEl.innerHTML = `
                            <summary class="message__thoughts-label"><i data-lucide="brain"></i> Inner thoughts</summary>
                            <div class="message__thoughts-body">${thoughts.map(t => `<p>${esc(t)}</p>`).join('')}</div>`;
                        const $bubble = qs('.message__bubble', $botMsg);
                        $bubble.parentElement.insertBefore($thoughtsEl, $bubble);
                        lucideRefresh($thoughtsEl);
                    }

                    qs('[data-action="retry"]', $botMsg)?.setAttribute('data-bot-id', botId);
                    state.isStreaming = false;
                    setSendState(false);
                    updateTelemetry();
                },
                (err) => {
                    $thinkingAside?.remove();
                    $content.innerHTML = `<span class="msg-error">[Error: ${esc(err.message)}]</span>`;
                    state.isStreaming = false;
                    setSendState(false);
                },
                controller.signal
            );
        } catch (err) {
            $content.innerHTML = `<span class="msg-error">[Error: ${esc(err.message)}]</span>`;
            state.isStreaming = false;
            setSendState(false);
        }
    }

    function setSendState(streaming, botName = null) {
        const $btn = qs('#send-btn');
        const $est = qs('#token-estimate');
        if (streaming) {
            $btn.innerHTML = '<i data-lucide="square"></i>';
            $btn.title = 'Stop generation (also cancels queued group bots)';
            $btn.classList.add('input-container__send--stop');
            if ($est && botName) $est.textContent = `${botName} is writing…`;
        } else {
            $btn.innerHTML = '<i data-lucide="send"></i>';
            $btn.title = 'Send';
            $btn.classList.remove('input-container__send--stop');
            if ($est) $est.textContent = '';
        }
        lucideRefresh($btn);
    }

    // ── Form Submit ───────────────────────────────────────────────────────────
    const $form     = qs('#rp-form');
    const $textarea = qs('#rp-input');
    const $sendBtn  = qs('#send-btn');
    const $tokenEst = qs('#token-estimate');

    $textarea.addEventListener('input', () => {
        $textarea.style.height = 'auto';
        $textarea.style.height = Math.min($textarea.scrollHeight, 200) + 'px';
        // Live token estimate
        const est = Math.ceil($textarea.value.length / 4);
        if ($tokenEst) $tokenEst.textContent = est > 10 ? `~${est} tokens` : '';
    });

    $textarea.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            $form.requestSubmit();
        }
    });

    $form.addEventListener('submit', async e => {
        e.preventDefault();

        // Stop if streaming — also cancel any queued group bots
        if (state.isStreaming) {
            _groupAbort = true;
            state.pendingAbort?.abort();
            return;
        }

        if (!state.activeBotId) {
            $textarea.placeholder = 'Select a character first...';
            setTimeout(() => { $textarea.placeholder = 'Type your response...'; }, 2000);
            return;
        }

        const text = $textarea.value.trim();
        if (!text) return;

        $textarea.value = '';
        $textarea.style.height = 'auto';
        if ($tokenEst) $tokenEst.textContent = '';

        // Remove welcome screen
        qs('#arena-welcome')?.remove();

        // Add user message (may auto-name session on first message)
        const msg = addMessage('user', text);
        appendMessage(msg);
        renderSessions();

        _groupAbort = false;

        // Determine which bots respond this turn based on turn mode
        const mode = state.config.groupTurnMode || 'auto';
        const bots = state.activeBotIds;
        let respondingBots;
        if (bots.length <= 1 || mode === 'manual') {
            // manual: only the active (user-selected) bot speaks
            respondingBots = [state.activeBotId];
        } else if (mode === 'round-robin') {
            // One bot per turn, cycling through the roster in order
            const sid = state.activeSessionId;
            if (_rrIndex[sid] === undefined) _rrIndex[sid] = 0;
            const idx = _rrIndex[sid] % bots.length;
            respondingBots = [bots[idx]];
            _rrIndex[sid] = (idx + 1) % bots.length;
        } else {
            // auto: all bots respond sequentially
            respondingBots = bots;
        }

        if (respondingBots.length === 1) {
            await triggerBotResponse(respondingBots[0]);
        } else {
            // Sequential queue: each bot awaits the previous, with a brief gap
            const delay = state.config.groupAutoDelay || 600;
            (async () => {
                for (const botId of respondingBots) {
                    if (_groupAbort) break;
                    await new Promise(r => setTimeout(r, delay));
                    if (_groupAbort) break;
                    await triggerBotResponse(botId);
                }
            })();
        }

        $textarea.focus();
    });

    // ── Image Attach (previews only — injected as markdown image reference) ────
    qs('#btn-add-image')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type   = 'file';
        input.accept = 'image/*';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                const dataUrl = ev.target.result;
                const $prev   = qs('#input-previews');
                const thumb   = document.createElement('div');
                thumb.className = 'input-preview-thumb';
                thumb.innerHTML = `
                    <img src="${dataUrl}" alt="attachment">
                    <button class="input-preview-thumb__remove" title="Remove">
                        <i data-lucide="x"></i>
                    </button>`;
                thumb.querySelector('button').addEventListener('click', () => thumb.remove());
                $prev.appendChild(thumb);
                lucideRefresh(thumb);
                // Append markdown image ref to textarea
                const $ta = qs('#rp-input');
                $ta.value += ($ta.value ? '\n' : '') + `![image](${dataUrl})`;
                $ta.dispatchEvent(new Event('input'));
            };
            reader.readAsDataURL(file);
        };
        input.click();
    });

    // ── Header Actions ────────────────────────────────────────────────────────
    qs('#clear-thread').addEventListener('click', async () => {
        const ok = await confirm('Clear Thread', 'Clear all messages in this thread?');
        if (!ok) return;
        clearHistory();
        clearGroupTimers();
        renderFullHistory();
        updateTelemetry();
    });

    qs('#export-chat').addEventListener('click', () => {
        const lines = state.history.map(m => {
            const name = m.role === 'user'
                ? (state.config.userName || 'User')
                : (getCharOverride(m.botId)?.nickname || state.loadedCharacters[m.botId]?.name || 'Bot');
            const modelTag  = m.model ? ` [${m.model.split('/').pop()}]` : '';
            const time      = new Date(m.timestamp).toLocaleString();
            const editedTag = m.edited ? ' (edited)' : '';
            let block = `[${name}${modelTag} — ${time}${editedTag}]\n${m.content}`;
            if (m.thoughts?.length) {
                block += `\n\n<inner thoughts>\n${m.thoughts.join('\n')}\n</inner thoughts>`;
            }
            if (m.comments?.length) {
                block += `\n\n<notes>\n${m.comments.map(c => `  • ${c.text}`).join('\n')}\n</notes>`;
            }
            return block;
        }).join('\n\n---\n\n');

        const header = `# ${state.session.name}\nExported: ${new Date().toLocaleString()}\n\n`;
        const blob = new Blob([header + lines], { type: 'text/plain' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `underdark-${state.session.name.replace(/\s+/g, '-')}-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // ── Config Bindings ───────────────────────────────────────────────────────
    function bindSlider(inputId, valId, stateKey, isInt = false, transform = null) {
        const $in  = qs(`#${inputId}`);
        const $val = qs(`#${valId}`);
        if (!$in || !$val) return;
        $in.addEventListener('input', () => {
            const v = isInt ? parseInt($in.value) : parseFloat($in.value);
            const display = transform ? transform(v) : (isInt ? v : v.toFixed(2));
            $val.textContent = display;
            setConfig({ [stateKey]: v });
        });
    }

    function syncConfigUI() {
        const c = state.config;
        const set = (id, val) => {
            const el = qs(`#${id}`);
            if (el) el.value = val;
        };
        const setBadge = (id, val) => {
            const el = qs(`#${id}`);
            if (el) el.textContent = val;
        };

        set('temp-input',      c.temperature);        setBadge('temp-val',      c.temperature?.toFixed(2));
        set('topp-input',      c.topP);               setBadge('topp-val',      c.topP?.toFixed(2));
        set('topk-input',      c.topK);               setBadge('topk-val',      c.topK);
        set('minp-input',      c.minP);               setBadge('minp-val',      c.minP?.toFixed(2));
        set('rep-input',       c.repetitionPenalty);  setBadge('rep-val',       c.repetitionPenalty?.toFixed(2));
        set('pres-input',      c.presencePenalty);    setBadge('pres-val',      c.presencePenalty?.toFixed(2));
        set('freq-input',      c.frequencyPenalty);   setBadge('freq-val',      c.frequencyPenalty?.toFixed(2));
        set('maxctx-input',    c.maxContext);          setBadge('maxctx-val',    c.maxContext);
        set('maxout-input',    c.maxOutput);           setBadge('maxout-val',    c.maxOutput);
        set('sys-directive',   c.sysDirective);
        set('authors-note',    c.authorsNote);
        set('nsfw-bypass',     c.nsfwBypass);
        set('user-name-input',    c.userName);
        set('user-persona-input', c.userPersona);
        set('an-depth-input',  c.authorsNoteDepth);   setBadge('an-depth-val',  c.authorsNoteDepth);
        set('group-delay-input', c.groupAutoDelay);   setBadge('group-delay-val', `${c.groupAutoDelay}ms`);
        set('context-strategy', c.contextStrategy);
        set('group-turn-mode',  c.groupTurnMode);
        if (qs('#model-select') && c.model) qs('#model-select').value = c.model;
        if (qs('#stream-toggle')) qs('#stream-toggle').checked = c.stream;

        // World tab
        const scanDepth = c.lorebookScanDepth ?? 5;
        if (qs('#lore-scan-input'))  qs('#lore-scan-input').value   = scanDepth;
        if (qs('#lore-scan-val'))    qs('#lore-scan-val').textContent = scanDepth;

        // Sync narrative flags
        const flags = c.flags || {};
        FLAG_KEYS.forEach(key => {
            const $cb = qs(`#flag-${key}`);
            if ($cb) $cb.checked = flags[key] ?? $cb.defaultChecked;
        });
    }

    // Lorebook scan depth (lives in World tab)
    qs('#lore-scan-input')?.addEventListener('input', e => {
        const v = parseInt(e.target.value);
        qs('#lore-scan-val').textContent = v;
        setConfig({ lorebookScanDepth: v });
    });

    bindSlider('temp-input',       'temp-val',      'temperature');
    bindSlider('topp-input',       'topp-val',      'topP');
    bindSlider('topk-input',       'topk-val',      'topK', true);
    bindSlider('minp-input',       'minp-val',      'minP');
    bindSlider('rep-input',        'rep-val',       'repetitionPenalty');
    bindSlider('pres-input',       'pres-val',      'presencePenalty');
    bindSlider('freq-input',       'freq-val',      'frequencyPenalty');
    bindSlider('maxctx-input',     'maxctx-val',    'maxContext', true);
    bindSlider('maxout-input',     'maxout-val',    'maxOutput', true);
    bindSlider('an-depth-input',   'an-depth-val',  'authorsNoteDepth', true);
    bindSlider('group-delay-input','group-delay-val','groupAutoDelay', true, v => `${v}ms`);

    const bindText = (id, key) => {
        const $el = qs(`#${id}`);
        if ($el) $el.addEventListener('input', debounce(() => setConfig({ [key]: $el.value }), 300));
    };
    bindText('sys-directive',      'sysDirective');
    bindText('authors-note',       'authorsNote');
    bindText('nsfw-bypass',        'nsfwBypass');
    bindText('user-name-input',    'userName');
    bindText('user-persona-input', 'userPersona');

    qs('#stream-toggle')?.addEventListener('change', e => setConfig({ stream: e.target.checked }));
    qs('#context-strategy')?.addEventListener('change', e => setConfig({ contextStrategy: e.target.value }));
    qs('#group-turn-mode')?.addEventListener('change', e => setConfig({ groupTurnMode: e.target.value }));

    // Narrative flag toggles
    FLAG_KEYS.forEach(key => {
        qs(`#flag-${key}`)?.addEventListener('change', e => {
            setConfig({ flags: { ...state.config.flags, [key]: e.target.checked } });
        });
    });

    // Load models
    async function loadModels() {
        const selects = qsa('#model-select, #persona-model-select');
        try {
            const res  = await fetch('../../glass/data/llm.json');
            const data = await res.json();

            const optHtml = data._index.map(group => `
                <optgroup label="${esc(group.family)}">
                    ${group.models.map(id => {
                        const m = data.routing_table[id];
                        return m ? `<option value="${esc(id)}">${esc(m.label)}</option>` : '';
                    }).join('')}
                </optgroup>`).join('');

            // Also populate the sims editor model select
            const $simsModel = qs('#sims-model-select');
            if ($simsModel) {
                $simsModel.innerHTML = '<option value="">— Use global model —</option>' + optHtml;
            }

            selects.forEach(($sel, i) => {
                const prefix = i > 0 ? '<option value="">— Use global model —</option>' : '';
                $sel.innerHTML = prefix + optHtml;
                if (i === 0) {
                    $sel.value = state.config.model || data.default_routing || 'deepseek-r1';
                    setConfig({ model: $sel.value });
                }
            });

        } catch (err) {
            console.warn('[underdark] loadModels failed, using fallback:', err.message);
            const fallbackOpt = '<option value="deepseek-r1">DeepSeek R1</option>';
            selects.forEach(($sel, i) => {
                $sel.innerHTML = (i > 0 ? '<option value="">— Use global model —</option>' : '') + fallbackOpt;
            });
            const $simsModel = qs('#sims-model-select');
            if ($simsModel) $simsModel.innerHTML = '<option value="">— Use global model —</option>' + fallbackOpt;
            setConfig({ model: 'deepseek-r1' });
        }

        qs('#stat-model').textContent = state.config.model || '—';
    }

    qs('#model-select')?.addEventListener('change', e => {
        setConfig({ model: e.target.value });
        qs('#stat-model').textContent = e.target.value || '—';
    });

    // ── Persona / Override Editor ─────────────────────────────────────────────
    function renderPersonaCharSelect() {
        const $sel = qs('#persona-char-select');
        if (!$sel) return;
        const current = $sel.value;
        // Show ALL roster characters (not just active bots)
        $sel.innerHTML = '<option value="">— Select character —</option>'
            + state.characters.map(c => {
                const inThread = state.activeBotIds.includes(c.id);
                const label = inThread ? `${esc(c.name)} ●` : esc(c.name);
                return `<option value="${esc(c.id)}">${label}</option>`;
            }).join('');
        // Restore previous selection if still valid
        if (current && state.characters.some(c => c.id === current)) $sel.value = current;
        // Auto-select active bot if only one and nothing selected
        if (!$sel.value && state.activeBotIds.length === 1) {
            $sel.value = state.activeBotIds[0];
            loadPersonaFields($sel.value);
        }
    }

    function loadPersonaFields(charId) {
        if (!charId) return;
        const override = getCharOverride(charId);
        qsa('[data-po]').forEach(el => {
            const key = el.dataset.po;
            if (key === undefined) return;
            if (el.type === 'range') {
                el.value = override[key] ?? el.defaultValue;
            } else {
                el.value = override[key] ?? '';
            }
        });
        // Sync badge labels for persona sliders
        const syncBadge = (inputId, valId) => {
            const $in = qs(`#${inputId}`);
            const $v  = qs(`#${valId}`);
            if ($in && $v) $v.textContent = $in.value;
        };
        syncBadge('dominance-input', 'dominance-val');
        syncBadge('explicit-input',  'explicit-val');
        syncBadge('romance-input',   'romance-val');
        syncBadge('violence-input',  'violence-val');

        // Show the persona fields panel once a character is selected
        const $fields = qs('#persona-fields');
        if ($fields) $fields.hidden = false;

        // Load character-specific model
        if (qs('#persona-model-select')) qs('#persona-model-select').value = override.modelOverride || '';

        // Update persona header with character name + avatar
        const char = state.loadedCharacters[charId];
        const meta = state.characters.find(c => c.id === charId);
        const $hdr = qs('#persona-char-header');
        if ($hdr && (char || meta)) {
            const name = char?.name || meta?.name || '—';
            const rawAv = meta?.avatar_path || char?.avatar;
            const av = getAvatarUrlSync(charId, rawAv);
            $hdr.innerHTML = `
                <div class="persona-char-avatar" style="${av ? `background-image:url(${av})` : ''}">
                    ${!av ? '<i data-lucide="user"></i>' : ''}
                </div>
                <div class="persona-char-info">
                    <span class="persona-char-name">${esc(name)}</span>
                    <span class="persona-char-status">${state.activeBotIds.includes(charId) ? '● In thread' : '○ Not in thread'}</span>
                </div>`;
            $hdr.hidden = false;
            lucideRefresh($hdr);
            // Async avatar patch for IDB
            if (rawAv?.startsWith('idb:')) {
                getAvatarUrl(charId, rawAv).then(url => {
                    const $av = qs('.persona-char-avatar', $hdr);
                    if ($av && url) $av.style.backgroundImage = `url(${url})`;
                });
            }
        }
    }

    qs('#persona-char-select')?.addEventListener('change', e => {
        loadPersonaFields(e.target.value);
    });

    // Keys the persona tab writes that live in override.ext (mirrors EXT_KEYS in sims-editor).
    // Core fields from defaultCharOverride() are intentionally excluded — they save to coreFields.
    const PERSONA_EXT_KEYS = new Set([
        'height','bodyType','skinTone','hairColor','hairStyle','eyeColor',
        'distinctiveFeatures',
        'breastSize','areolaeSize','nippleColor','bodyHair','genitalia','otherAdultFeatures'
    ]);

    const savePersonaDebounced = debounce((charId) => {
        if (!charId) return;
        const coreFields = {};
        const extFields  = {};
        qsa('[data-po]').forEach(el => {
            const key = el.dataset.po;
            if (!key) return;
            const val = el.type === 'range' ? parseFloat(el.value) : el.value;
            if (PERSONA_EXT_KEYS.has(key)) extFields[key] = val;
            else coreFields[key] = val;
        });
        // Read the raw stored override (not the flattened getCharOverride result)
        // so we can preserve ext fields not shown on this tab.
        const stored = state.config.charOverrides?.[charId] || {};
        const newExt = { ...(stored.ext || {}), ...extFields };
        setCharOverride(charId, { ...coreFields, ext: newExt });
    }, 400);

    qsa('[data-po]').forEach(el => {
        el.addEventListener('input', () => {
            const charId = qs('#persona-char-select')?.value;
            if (!charId) return;
            // Update badge if slider
            if (el.type === 'range') {
                const map = {
                    dominanceLevel: 'dominance-val',
                    explicitnessLevel: 'explicit-val',
                    romanticismLevel: 'romance-val',
                    violenceLevel: 'violence-val'
                };
                const badgeId = map[el.dataset.po];
                if (badgeId) qs(`#${badgeId}`).textContent = el.value;
            }
            savePersonaDebounced(charId);
        });
    });

    qs('#persona-model-select')?.addEventListener('change', e => {
        const charId = qs('#persona-char-select')?.value;
        if (charId) setCharOverride(charId, { modelOverride: e.target.value });
    });

    // ── Telemetry ─────────────────────────────────────────────────────────────
    function updateTelemetry() {
        qs('#stat-turns').textContent  = state.telemetry.turns;
        qs('#stat-tokens').textContent = state.telemetry.sessionTokens;
        qs('#stat-model').textContent  = state.config.model || '—';
    }

    // ── Modal: message edit backdrop ─────────────────────────────────────────
    qs('.modal__backdrop', qs('#modal-msg-edit'))?.addEventListener('click', () => {
        hideModal('modal-msg-edit');
        _editAbort?.abort();
        _editAbort = null;
    });

    // ── Modal: confirm backdrop ───────────────────────────────────────────────
    qs('.modal__backdrop', qs('#modal-confirm'))?.addEventListener('click', () => {
        qs('#confirm-cancel').click();
    });

    // ── Theme Switcher ────────────────────────────────────────────────────────
    const THEME_KEY = 'underdark_theme';
    const savedTheme = localStorage.getItem(THEME_KEY) || 'neon-magenta';
    document.body.classList.add(savedTheme);

    qsa('[data-theme]', qs('#theme-swatches') || document).forEach($btn => {
        if ($btn.dataset.theme === savedTheme) $btn.classList.add('active');
        else $btn.classList.remove('active');
        $btn.addEventListener('click', () => {
            const theme = $btn.dataset.theme;
            document.body.className = document.body.className.replace(/neon-\w+/g, '').trim();
            document.body.classList.add(theme);
            document.body.classList.add('underdark-page');
            localStorage.setItem(THEME_KEY, theme);
            qsa('[data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
        });
    });

    // ── Danger Zone ───────────────────────────────────────────────────────────
    qs('#btn-clear-all-data')?.addEventListener('click', async () => {
        const ok = await confirm('Wipe All Data', 'This will permanently delete all characters, sessions, history, and settings. Are you absolutely sure?');
        if (!ok) return;
        localStorage.clear();
        // Also wipe IndexedDB avatar store
        try { const { idbClear } = await import('./storage.js'); await idbClear(); } catch (_) {}
        location.reload();
    });

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    document.addEventListener('keydown', e => {
        // Escape closes any open modal, lightbox, or reaction picker
        if (e.key === 'Escape') {
            const $picker = qs('#reaction-picker');
            if ($picker && !$picker.hidden) { $picker.hidden = true; return; }
            if (!qs('#lightbox')?.hidden) { qs('#lightbox').hidden = true; return; }
            qsa('.modal:not([hidden])').forEach(m => { m.hidden = true; });
            return;
        }
        const inInput = document.activeElement?.tagName === 'INPUT'
                     || document.activeElement?.tagName === 'TEXTAREA'
                     || document.activeElement?.tagName === 'SELECT';
        if (inInput || e.ctrlKey || e.metaKey || e.altKey) return;

        if (e.key === 't' || e.key === 'T') toggleTerminal();
        if (e.key === 'r' || e.key === 'R') setRosterCollapsed($rosterSidebar.dataset.collapsed !== 'true');
        if (e.key === 'n' || e.key === 'N') openCreator();
        if (e.key === 'e' || e.key === 'E') { if (state.activeBotId) openSimsEditor(state.activeBotId); }
        if (e.key === 'a' || e.key === 'A') openCharPicker();
        if (e.key === 'g' || e.key === 'G') { if (state.activeBotId) openGalleryModal(state.activeBotId); }
        if (e.key === 'f' || e.key === 'F') toggleFocusMode();
        if (e.key === '/' ) { e.preventDefault(); qs('#search-toggle')?.click(); }
    });

    // ── Focus / Read Mode ─────────────────────────────────────────────────────
    const FOCUS_KEY = 'underdark_focus';
    function toggleFocusMode(force) {
        const on = force !== undefined ? force : !document.body.classList.contains('focus-mode');
        document.body.classList.toggle('focus-mode', on);
        qs('#focus-mode-btn')?.classList.toggle('active', on);
        localStorage.setItem(FOCUS_KEY, on ? '1' : '');

        if (on) {
            // Open the right terminal so the character dossier is immediately visible
            toggleTerminal(false);
            // Switch to profile tab so you see the character, not config
            const $profileBtn = qs('.tab-btn[data-tab="profile"]');
            if ($profileBtn) $profileBtn.click();
            showToast('Focus mode — just you and the characters', 'info', 2200);
        } else {
            showToast('Editor mode restored', 'info', 1800);
        }
    }
    qs('#focus-mode-btn')?.addEventListener('click', () => toggleFocusMode());
    // Restore on load
    if (localStorage.getItem(FOCUS_KEY)) toggleFocusMode(true);

    // ── Sims Editor ───────────────────────────────────────────────────────────
    const simsEditor = initSimsEditor();

    // Always re-fetch the card from disk before opening the editor so that
    // extensions.underdark fields are guaranteed to be present even if localStorage
    // was full and the card data didn't survive the previous session's saveState().
    async function openSimsEditor(id) {
        if (!id) return;
        const meta = state.characters.find(c => c.id === id);
        if (meta?.card_path) {
            try {
                const res = await fetch(meta.card_path);
                const raw = await res.json();
                state.loadedCharacters[id] = normalizeData(raw);
            } catch (_) {
                // fall through to whatever is already in memory
                await loadCharacterCard(id);
            }
        } else {
            await loadCharacterCard(id);
        }
        simsEditor?.open(id);
    }

    qs('#btn-sims-edit')?.addEventListener('click', () => {
        if (state.activeBotId) openSimsEditor(state.activeBotId);
    });

    // ── Welcome screen static button wiring ─────────────────────────────────
    qs('#welcome-create')?.addEventListener('click', () => openCreator());
    qs('#welcome-import')?.addEventListener('click', () => qs('#card-input').click());

    // ── Initial Render ────────────────────────────────────────────────────────
    loadManifest().then(() => {
        renderAll();
        initChatBackground();
        loadModels();
        updateApiStatus();
    });
}

// ── Manifest Loader ───────────────────────────────────────────────────────────
async function loadManifest() {
    try {
        const res  = await fetch('./data/index.json');
        const data = await res.json();
        // Merge manifest chars into state (don't overwrite local/imported)
        const existingIds = new Set(state.characters.map(c => c.id));
        (data.characters || []).forEach(c => {
            if (!existingIds.has(c.id)) {
                state.characters.push(c);
            }
        });
        // Load manifest lorebooks if none saved in this session
        if (!state.lorebooks.length && data.lorebooks?.length) {
            for (const lb of data.lorebooks) {
                if (lb.lore_path) {
                    try {
                        const lbRes  = await fetch(lb.lore_path);
                        const lbData = await lbRes.json();
                        lbData._sourcePath = lb.lore_path;
                        state.session.lorebooks.push(lbData);
                    } catch (_) {}
                }
            }
        }
        saveState();
    } catch (_) {
        // Silently ignore — user may have no manifest chars
    }
}
