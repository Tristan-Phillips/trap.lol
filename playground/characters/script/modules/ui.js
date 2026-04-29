/**
 * ui.js — Complete DOM orchestration for The Underdark.
 * Handles: sessions, roster, group chat, character creator, lorebook CRUD,
 * full config bindings, persona/override editor, streaming, telemetry, API key flow.
 */

import {
    state, loadState, saveState,
    newSession, switchSession, deleteSession, renameSession,
    addMessage, editMessage, deleteMessage, clearHistory,
    setActiveBot, removeBotFromSession,
    getCharOverride, setCharOverride,
    setConfig, saveCharacter, deleteCharacter,
    defaultCharOverride
} from './state.js';
import { buildPayload, streamCompletion } from './llm-engine.js';
import { addBook, removeBook, addEntry, updateEntry, removeEntry, createBook } from './lorebook.js';
import { parseCharacterCard, buildCard, normalizeData } from './parser-v2.js';
import { getApiKey, setApiKey, clearApiKey, isValidKeyFormat, restoreKeyFromCookie } from '../../../../glass/script/modules/llm-auth.js';

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
        if (window.lucide) window.lucide.createIcons({ nodes: [modal] });

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

function lucideRefresh(node) {
    if (window.lucide) window.lucide.createIcons({ nodes: [node] });
}

// ── Markdown Renderer ─────────────────────────────────────────────────────────
function renderMarkdown(text) {
    try {
        let html = marked.parse(text, { breaks: true, gfm: true });
        if (typeof DOMPurify !== 'undefined') {
            html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
        }
        return html;
    } catch (_) {
        return `<p>${esc(text).replace(/\n/g, '<br>')}</p>`;
    }
}

// ── Group auto-response manager ───────────────────────────────────────────────
let groupAutoTimers = [];
function clearGroupTimers() {
    groupAutoTimers.forEach(clearTimeout);
    groupAutoTimers = [];
}

// ── Main Init ─────────────────────────────────────────────────────────────────
export function initUI() {
    loadState();
    restoreKeyFromCookie();

    // ── Sidebar: Roster ───────────────────────────────────────────────────────
    const $rosterSidebar  = qs('#roster-sidebar');
    const $terminalSidebar = qs('#terminal-sidebar');

    qs('#toggle-roster').addEventListener('click', () => {
        const collapsed = $rosterSidebar.dataset.collapsed === 'true';
        $rosterSidebar.dataset.collapsed = !collapsed;
        qs('#toggle-roster i').dataset.lucide = collapsed ? 'chevron-left' : 'chevron-right';
        lucideRefresh(qs('#toggle-roster'));
    });

    // Mobile toggle
    qs('#toggle-roster-mobile')?.addEventListener('click', () => {
        const c = $rosterSidebar.dataset.collapsed === 'true';
        $rosterSidebar.dataset.collapsed = !c;
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
        const chars = state.characters.filter(c => {
            if (!searchQuery) return true;
            return c.name.toLowerCase().includes(searchQuery)
                || (c.tagline || '').toLowerCase().includes(searchQuery)
                || (c.tags || []).some(t => t.toLowerCase().includes(searchQuery));
        });

        if (!state.characters.length) {
            $charList.innerHTML = '<div class="roster-empty"><i data-lucide="ghost"></i><span>No fragments found.<br>Import or create one.</span></div>';
            lucideRefresh($charList);
            return;
        }

        if (!chars.length) {
            $charList.innerHTML = '<div class="roster-empty"><i data-lucide="search-x"></i><span>No matches</span></div>';
            lucideRefresh($charList);
            return;
        }

        $charList.innerHTML = chars.map(c => {
            const active = state.activeBotIds.includes(c.id);
            const avatar = c.avatar_path
                ? `url(${c.avatar_path})`
                : state.loadedCharacters[c.id]?.avatar
                    ? `url(${state.loadedCharacters[c.id].avatar})`
                    : 'none';
            return `
            <div class="character-card ${active ? 'character-card--active' : ''}" data-id="${esc(c.id)}" title="${esc(c.name)}">
                <div class="character-card__avatar" style="background-image:${avatar}">
                    ${!c.avatar_path && !state.loadedCharacters[c.id]?.avatar ? `<i data-lucide="user"></i>` : ''}
                </div>
                <div class="character-card__info">
                    <span class="character-card__name">${esc(c.name)}</span>
                    <span class="character-card__tagline">${esc(c.tagline || '')}</span>
                </div>
                ${active ? '<span class="character-card__active-pip"></span>' : ''}
            </div>`;
        }).join('');

        qsa('.character-card', $charList).forEach($card => {
            $card.addEventListener('click', () => selectCharacter($card.dataset.id));
        });

        lucideRefresh($charList);
    }

    // ── Character Selection ───────────────────────────────────────────────────
    async function selectCharacter(id) {
        const meta = state.characters.find(c => c.id === id);
        if (!meta) return;

        // Load card data if not cached
        if (!state.loadedCharacters[id]) {
            if (meta.card_path) {
                try {
                    const res  = await fetch(meta.card_path);
                    const raw  = await res.json();
                    state.loadedCharacters[id] = normalizeData(raw);
                    saveState();
                } catch (e) {
                    console.error('[underdark] Failed to load card:', e);
                    return;
                }
            } else {
                return; // No data
            }
        }

        const char = state.loadedCharacters[id];
        setActiveBot(id);
        renderRoster();
        renderActiveBots();
        renderProfile(char, id);
        renderPersonaCharSelect();
        updateCinematicBackground(meta.avatar_path || char.avatar);

        // Remove welcome screen
        qs('#arena-welcome')?.remove();

        // First message if thread is empty
        if (!state.history.length && char.first_mes) {
            const msg = addMessage('bot', char.first_mes, id);
            appendMessage(msg, char.name, meta.avatar_path || char.avatar);
        }
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
            const avatar   = meta?.avatar_path || char?.avatar;
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

        qsa('.active-bot', $container).forEach($bot => {
            $bot.addEventListener('click', e => {
                if (e.target.closest('[data-remove]')) return;
                const id   = $bot.dataset.id;
                const char = state.loadedCharacters[id];
                const meta = state.characters.find(c => c.id === id);
                setActiveBot(id);
                renderActiveBots();
                if (char) renderProfile(char, id);
                if (meta) updateCinematicBackground(meta.avatar_path || char?.avatar);
                renderPersonaCharSelect();
            });
        });

        qsa('[data-remove]', $container).forEach($btn => {
            $btn.addEventListener('click', async e => {
                e.stopPropagation();
                const id = $btn.dataset.remove;
                removeBotFromSession(id);
                renderActiveBots();
                renderRoster();
                const newActive = state.loadedCharacters[state.activeBotId];
                const newMeta   = state.characters.find(c => c.id === state.activeBotId);
                if (newActive) renderProfile(newActive, state.activeBotId);
                if (newMeta)   updateCinematicBackground(newMeta.avatar_path || newActive?.avatar);
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
    function renderProfile(char, id) {
        const $profile = qs('#profile-card');
        const meta     = state.characters.find(c => c.id === id);
        const avatar   = meta?.avatar_path || char.avatar;

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

        qs('#profile-actions').hidden = false;

        // Alt greeting switcher
        qs('#alt-greeting-select')?.addEventListener('change', e => {
            if (!e.target.value) return;
            const greeting = char.alternate_greetings[parseInt(e.target.value)];
            if (greeting && state.history.length === 0) {
                const msg = addMessage('bot', greeting, id);
                appendMessage(msg, char.name, meta?.avatar_path || char.avatar);
            }
        });

        lucideRefresh($profile);

        // Profile action buttons
        qs('#btn-edit-char').onclick = () => openCreator(id);
        qs('#btn-remove-char').onclick = () => {
            removeBotFromSession(id);
            renderActiveBots();
            renderRoster();
            $profile.innerHTML = '<div class="profile-view__empty">No character selected</div>';
            qs('#profile-actions').hidden = true;
        };
        qs('#btn-delete-char').onclick = async () => {
            const ok = await confirm('Delete Character', `Permanently delete ${char.name}? This removes them from all threads.`);
            if (!ok) return;
            deleteCharacter(id);
            renderRoster();
            renderActiveBots();
            $profile.innerHTML = '<div class="profile-view__empty">No character selected</div>';
            qs('#profile-actions').hidden = true;
        };
    }

    function updateCinematicBackground(path) {
        const $bg = qs('#arena-background');
        if (path) {
            $bg.style.backgroundImage = `url(${path})`;
            $bg.classList.add('arena__bg--visible');
        } else {
            $bg.style.backgroundImage = 'none';
            $bg.classList.remove('arena__bg--visible');
        }
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
                    avatar_path: null,
                    tags:        card.tags || []
                };
                saveCharacter(meta, card);
                renderRoster();
                selectCharacter(id);
            } catch (err) {
                alert(`Import failed: ${err.message}`);
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
    qs('#welcome-create').addEventListener('click', () => openCreator());
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

    qs('#creator-save').addEventListener('click', () => {
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

        saveCharacter(meta, card);
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

    function appendMessage(msgObj, nameOverride, avatarUrl) {
        const { id, role, content, botId } = msgObj;
        const char = botId ? state.loadedCharacters[botId] : null;
        const meta = botId ? state.characters.find(c => c.id === botId) : null;
        const name = nameOverride
            || (botId ? (getCharOverride(botId).nickname || char?.name) : null)
            || (role === 'user' ? (state.config.userName || 'You') : 'System');
        const avatar = avatarUrl || meta?.avatar_path || char?.avatar || null;

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
                    <span class="message__time">${new Date(msgObj.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <div class="message__actions">
                        <button class="msg-action" data-action="copy"  title="Copy">   <i data-lucide="copy"></i>   </button>
                        <button class="msg-action" data-action="edit"  title="Edit">   <i data-lucide="pencil"></i> </button>
                        <button class="msg-action" data-action="retry" title="Retry"  data-bot-id="${esc(botId || '')}">
                            <i data-lucide="refresh-cw"></i>
                        </button>
                        <button class="msg-action" data-action="delete" title="Delete"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
                <div class="message__bubble">
                    <div class="message__content">${renderMarkdown(content)}</div>
                </div>
                ${msgObj.edited ? '<span class="message__edited">edited</span>' : ''}
            </div>`;

        // Wire message actions
        qs('[data-action="copy"]', $msg).addEventListener('click', () => {
            navigator.clipboard.writeText(content).catch(() => {});
        });

        qs('[data-action="edit"]', $msg).addEventListener('click', () => {
            qs('#msg-edit-id').value      = id;
            qs('#msg-edit-content').value = content;
            showModal('modal-msg-edit');

            const save = () => {
                const newContent = qs('#msg-edit-content').value.trim();
                if (!newContent) return;
                editMessage(id, newContent);
                qs('.message__content', $msg).innerHTML = renderMarkdown(newContent);
                const edited = qs('.message__edited', $msg);
                if (!edited) {
                    const span = document.createElement('span');
                    span.className = 'message__edited';
                    span.textContent = 'edited';
                    $msg.querySelector('.message__main').appendChild(span);
                }
                hideModal('modal-msg-edit');
            };

            qs('#msg-edit-save').onclick   = save;
            qs('#msg-edit-cancel').onclick = () => hideModal('modal-msg-edit');
            qs('#msg-edit-close').onclick  = () => hideModal('modal-msg-edit');
        });

        qs('[data-action="retry"]', $msg).addEventListener('click', async () => {
            if (state.isStreaming) return;
            const targetBotId = $msg.querySelector('[data-bot-id]')?.dataset.botId || state.activeBotId;
            if (!targetBotId) return;
            // Delete from this message onward, then re-trigger
            const idx = state.history.findIndex(m => m.id === id);
            if (idx >= 0) {
                state.session.history = state.history.slice(0, idx);
                saveState();
                // Remove DOM messages from this one onward
                const allMsgs = qsa('.message', $thread);
                const msgIdx  = allMsgs.indexOf($msg);
                allMsgs.slice(msgIdx).forEach(m => m.remove());
            }
            await triggerBotResponse(targetBotId);
        });

        qs('[data-action="delete"]', $msg).addEventListener('click', async () => {
            const ok = await confirm('Delete Message', 'Delete this message from the thread?');
            if (!ok) return;
            deleteMessage(id);
            $msg.remove();
        });

        $thread.appendChild($msg);
        $thread.scrollTop = $thread.scrollHeight;
        lucideRefresh($msg);
        return $msg;
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
                    <div class="welcome-box">
                        <i data-lucide="zap" class="welcome-box__icon"></i>
                        <h2>Neural Interface Established</h2>
                        <p>Select a fragment from the roster or create one to begin.</p>
                        <button id="welcome-create" class="btn btn--accent" style="margin-top:1rem;">
                            <i data-lucide="wand-2"></i> Create Character
                        </button>
                    </div>`;
                $thread.appendChild(welcome);
                qs('#welcome-create', welcome)?.addEventListener('click', () => openCreator());
                lucideRefresh(welcome);
            }
            return;
        }

        state.history.forEach(msg => {
            const char = msg.botId ? state.loadedCharacters[msg.botId] : null;
            const meta = msg.botId ? state.characters.find(c => c.id === msg.botId) : null;
            appendMessage(msg, char?.name || null, meta?.avatar_path || char?.avatar);
        });
    }

    function renderAll() {
        renderSessions();
        renderRoster();
        renderActiveBots();
        renderLorebooks();
        renderFullHistory();
        syncConfigUI();
        renderPersonaCharSelect();
        updateTelemetry();

        const activeChar = state.loadedCharacters[state.activeBotId];
        const activeMeta = state.characters.find(c => c.id === state.activeBotId);
        if (activeChar) {
            renderProfile(activeChar, state.activeBotId);
            updateCinematicBackground(activeMeta?.avatar_path || activeChar.avatar);
        } else {
            qs('#profile-card').innerHTML = '<div class="profile-view__empty">No character selected</div>';
            qs('#profile-actions').hidden = true;
        }
    }

    // ── Streaming Bot Response ────────────────────────────────────────────────
    async function triggerBotResponse(botId) {
        const char = state.loadedCharacters[botId];
        const meta = state.characters.find(c => c.id === botId);
        if (!char || state.isStreaming) return;

        state.isStreaming = true;
        const controller = new AbortController();
        state.pendingAbort = controller;
        setSendState(true);

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

        try {
            const payload = buildPayload({
                character: { ...char, id: botId },
                history:   state.history,
                lore:      state.lorebooks,
                config:    state.config,
                isGroup:   state.activeBotIds.length > 1,
                allChars:  state.activeBotIds.map(id => ({ ...state.loadedCharacters[id], id }))
            });

            await streamCompletion(payload,
                (_delta, full) => {
                    $content.innerHTML = renderMarkdown(full);
                    $thread.scrollTop  = $thread.scrollHeight;
                },
                (finalText, tokens) => {
                    const msg = addMessage('bot', finalText, botId, {
                        tokens,
                        model: payload.model
                    });
                    $botMsg.dataset.msgId = msg.id;
                    $content.innerHTML   = renderMarkdown(finalText);
                    // Wire retry on final message
                    qs('[data-action="retry"]', $botMsg)?.setAttribute('data-bot-id', botId);
                    state.isStreaming = false;
                    setSendState(false);
                    updateTelemetry();
                },
                (err) => {
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

    function setSendState(streaming) {
        const $btn = qs('#send-btn');
        if (streaming) {
            $btn.innerHTML = '<i data-lucide="square"></i>';
            $btn.title = 'Stop generation';
            $btn.classList.add('input-container__send--stop');
        } else {
            $btn.innerHTML = '<i data-lucide="send"></i>';
            $btn.title = 'Send';
            $btn.classList.remove('input-container__send--stop');
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

        // Stop if streaming
        if (state.isStreaming) {
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

        // Add user message
        const msg = addMessage('user', text);
        appendMessage(msg);

        clearGroupTimers();

        // Group chat: all bots respond; solo: just activeBotId
        const respondingBots = state.config.groupTurnMode === 'auto' && state.activeBotIds.length > 1
            ? state.activeBotIds
            : [state.activeBotId];

        if (respondingBots.length === 1) {
            await triggerBotResponse(respondingBots[0]);
        } else {
            const delay = state.config.groupAutoDelay || 600;
            for (let i = 0; i < respondingBots.length; i++) {
                const botId = respondingBots[i];
                const t = setTimeout(async () => {
                    if (!state.isStreaming) await triggerBotResponse(botId);
                }, i * delay);
                groupAutoTimers.push(t);
            }
        }

        $textarea.focus();
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
                : (state.loadedCharacters[m.botId]?.name || 'Bot');
            return `[${name}]\n${m.content}`;
        }).join('\n\n---\n\n');

        const blob = new Blob([lines], { type: 'text/plain' });
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
        set('user-name-input', c.userName);
        set('an-depth-input',  c.authorsNoteDepth);   setBadge('an-depth-val',  c.authorsNoteDepth);
        set('group-delay-input', c.groupAutoDelay);   setBadge('group-delay-val', `${c.groupAutoDelay}ms`);
        set('context-strategy', c.contextStrategy);
        set('group-turn-mode',  c.groupTurnMode);
        if (qs('#stream-toggle')) qs('#stream-toggle').checked = c.stream;
    }

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
    bindText('sys-directive',  'sysDirective');
    bindText('authors-note',   'authorsNote');
    bindText('nsfw-bypass',    'nsfwBypass');
    bindText('user-name-input','userName');

    qs('#stream-toggle')?.addEventListener('change', e => setConfig({ stream: e.target.checked }));
    qs('#context-strategy')?.addEventListener('change', e => setConfig({ contextStrategy: e.target.value }));
    qs('#group-turn-mode')?.addEventListener('change', e => setConfig({ groupTurnMode: e.target.value }));

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

            selects.forEach(($sel, i) => {
                const prefix = i > 0 ? '<option value="">— Use global model —</option>' : '';
                $sel.innerHTML = prefix + optHtml;
                if (i === 0) {
                    $sel.value = state.config.model || data.default_routing || 'deepseek-r1';
                    setConfig({ model: $sel.value });
                }
            });

        } catch (_) {
            selects.forEach(($sel, i) => {
                $sel.innerHTML = (i > 0 ? '<option value="">— Use global model —</option>' : '')
                    + '<option value="deepseek-r1">DeepSeek R1</option>';
            });
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
        $sel.innerHTML = '<option value="">— Select character —</option>'
            + state.activeBotIds.map(id => {
                const c = state.loadedCharacters[id];
                return c ? `<option value="${esc(id)}">${esc(c.name)}</option>` : '';
            }).join('');
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

        // Load character-specific model into override model select
        qs('#persona-model-select').value = override.modelOverride || '';
    }

    qs('#persona-char-select')?.addEventListener('change', e => {
        loadPersonaFields(e.target.value);
    });

    const savePersonaDebounced = debounce((charId) => {
        if (!charId) return;
        const fields = {};
        qsa('[data-po]').forEach(el => {
            const key = el.dataset.po;
            if (!key) return;
            fields[key] = el.type === 'range' ? parseFloat(el.value) : el.value;
        });
        setCharOverride(charId, fields);
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

    // ── Modal: message edit ───────────────────────────────────────────────────
    qs('#msg-edit-close')?.addEventListener('click', () => hideModal('modal-msg-edit'));
    qs('.modal__backdrop', qs('#modal-msg-edit'))?.addEventListener('click', () => hideModal('modal-msg-edit'));

    // ── Modal: confirm backdrop ───────────────────────────────────────────────
    qs('.modal__backdrop', qs('#modal-confirm'))?.addEventListener('click', () => {
        qs('#confirm-cancel').click();
    });

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            qsa('.modal:not([hidden])').forEach(m => { m.hidden = true; });
            return;
        }
        if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey
            && document.activeElement?.tagName !== 'INPUT'
            && document.activeElement?.tagName !== 'TEXTAREA') {
            toggleTerminal();
        }
    });

    // ── Initial Render ────────────────────────────────────────────────────────
    loadManifest().then(() => {
        renderAll();
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
        // Load manifest lorebooks if none saved
        if (!state.lorebooks.length && data.lorebooks?.length) {
            state.session.lorebooks = data.lorebooks;
        }
        saveState();
    } catch (_) {
        // Silently ignore — user may have no manifest chars
    }
}
