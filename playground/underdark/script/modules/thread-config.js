/**
 * thread-config.js — Thread Config Editor for The Underdark.
 * Owns: openThreadConfig modal, tcLogPush, renderThreadLog, updateThreadConfigBadge.
 *
 * Call initThreadConfig(deps) once from initUI() after the DOM is ready.
 * Exports tcLogPush + updateThreadConfigBadge so the rest of ui.js can log
 * events and refresh the badge without knowing about modal internals.
 */

import { qs, qsa, esc } from './shared-utils.js?v=4';
import { state, saveState, defaultThreadConfig } from './state.js?v=2';

// ── Module-level tone-tags state (mirrors _tcToneTags in the old closure) ─────
let _tcToneTags = '';

// ── Thread log helpers ────────────────────────────────────────────────────────

function _tcLog() {
    const tc = state.chat?.threadConfig;
    if (!tc) return null;
    if (!Array.isArray(tc.log)) tc.log = [];
    return tc.log;
}

export function tcLogPush(type, text) {
    const log = _tcLog();
    if (!log) return;
    log.push({
        id:   `log-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        ts:   Date.now(),
        type, // 'event' | 'message' | 'scene' | 'note'
        text
    });
    saveState();
}

export function updateThreadConfigBadge() {
    const $btn = qs('#btn-thread-config');
    if (!$btn) return;
    const tc = state.chat?.threadConfig;
    const hasOverrides = tc && (
        tc.threadScenario || tc.model || tc.temperature != null || tc.maxOutput != null ||
        tc.userName || tc.userPersona ||
        (tc.narrativeTone && Object.values(tc.narrativeTone).some(v => v))
    );
    $btn.classList.toggle('arena-action--active', !!hasOverrides);
    $btn.title = hasOverrides ? 'Thread Settings (overrides active)' : 'Thread Settings';
}

// ── Thread Log renderer ───────────────────────────────────────────────────────

function renderThreadLog() {
    const $list = qs('#tc-log-list');
    if (!$list) return;
    const log = _tcLog();
    if (!log) return;

    if (!log.length) {
        $list.innerHTML = `
            <div class="tc-log-empty">
                <i data-lucide="scroll-text"></i>
                <p>No entries yet. Events, scene transitions, and message summaries will appear here automatically.</p>
            </div>`;
        window.lucide?.createIcons({ nodes: [...$list.querySelectorAll('[data-lucide]')] });
        return;
    }

    const ICONS  = { event: 'activity', message: 'message-square', scene: 'sparkles', note: 'pencil-line' };
    const LABELS = { event: 'Event', message: 'Message', scene: 'Scene', note: 'Note' };

    $list.innerHTML = [...log].reverse().map(entry => {
        const d = new Date(entry.ts);
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        return `
        <div class="tc-log-entry" data-log-id="${esc(entry.id)}" data-type="${esc(entry.type)}">
            <div class="tc-log-entry__icon tc-log-entry__icon--${esc(entry.type)}">
                <i data-lucide="${ICONS[entry.type] || 'circle'}"></i>
            </div>
            <div class="tc-log-entry__body">
                <div class="tc-log-entry__meta">
                    <span class="tc-log-entry__type">${LABELS[entry.type] || entry.type}</span>
                    <span class="tc-log-entry__time">${dateStr} ${timeStr}</span>
                    <button class="tc-log-entry__edit-btn" data-log-edit="${esc(entry.id)}" title="Edit"><i data-lucide="pencil"></i></button>
                    <button class="tc-log-entry__del-btn" data-log-del="${esc(entry.id)}" title="Delete"><i data-lucide="x"></i></button>
                </div>
                <div class="tc-log-entry__text" data-log-text="${esc(entry.id)}">${esc(entry.text)}</div>
                <textarea class="tc-log-entry__edit-area tc-textarea" data-log-ta="${esc(entry.id)}" rows="2" hidden>${esc(entry.text)}</textarea>
                <div class="tc-log-entry__edit-actions" data-log-actions="${esc(entry.id)}" hidden>
                    <button class="tc-log-btn tc-log-btn--save" data-log-save="${esc(entry.id)}"><i data-lucide="check"></i> Save</button>
                    <button class="tc-log-btn tc-log-btn--cancel" data-log-cancel="${esc(entry.id)}"><i data-lucide="x"></i> Cancel</button>
                </div>
            </div>
        </div>`;
    }).join('');

    window.lucide?.createIcons({ nodes: [...$list.querySelectorAll('[data-lucide]')] });

    // Edit button
    qsa('[data-log-edit]', $list).forEach($btn => {
        $btn.addEventListener('click', () => {
            const id    = $btn.dataset.logEdit;
            const $text = qs(`[data-log-text="${id}"]`, $list);
            const $ta   = qs(`[data-log-ta="${id}"]`, $list);
            const $acts = qs(`[data-log-actions="${id}"]`, $list);
            if (!$ta) return;
            $ta.value = $text?.textContent || '';
            $text?.classList.add('tc-log-entry__text--hidden');
            $ta.hidden  = false;
            if ($acts) $acts.hidden = false;
            $ta.focus();
        });
    });

    // Save edit
    qsa('[data-log-save]', $list).forEach($btn => {
        $btn.addEventListener('click', () => {
            const id  = $btn.dataset.logSave;
            const $ta = qs(`[data-log-ta="${id}"]`, $list);
            const log = _tcLog();
            if (!log || !$ta) return;
            const entry = log.find(e => e.id === id);
            if (entry) { entry.text = $ta.value.trim(); saveState(); }
            renderThreadLog();
        });
    });

    // Cancel edit
    qsa('[data-log-cancel]', $list).forEach($btn => {
        $btn.addEventListener('click', () => renderThreadLog());
    });

    // Delete
    qsa('[data-log-del]', $list).forEach($btn => {
        $btn.addEventListener('click', () => {
            const id  = $btn.dataset.logDel;
            const log = _tcLog();
            if (!log) return;
            const idx = log.findIndex(e => e.id === id);
            if (idx >= 0) { log.splice(idx, 1); saveState(); }
            renderThreadLog();
        });
    });
}

// ── initThreadConfig — wire all thread config event listeners ─────────────────
export function initThreadConfig({ confirm, showModal, hideModal, showToast, lucideRefresh, buildModelOptHtml }) {

    function openThreadConfig() {
        const chat = state.chat;
        if (!chat) return;
        const tc   = chat.threadConfig || {};
        const tone = tc.narrativeTone  || {};

        qs('#tc-name-badge').textContent = chat.name;

        // Core tab
        qs('#tc-scenario').value        = tc.threadScenario || '';
        qs('#tc-user-name').value       = tc.userName || '';
        qs('#tc-user-persona').value    = tc.userPersona || '';
        const $autoLore = qs('#tc-auto-attach-lorebooks');
        if ($autoLore) $autoLore.checked = tc.autoAttachLorebooks !== false;

        // Pinned lorebook list
        const $pinList = qs('#tc-lore-pin-list');
        if ($pinList) {
            const pinned = new Set(tc.pinnedLoreBookIds || []);
            const books  = state.lorebooks || [];
            if (!books.length) {
                $pinList.innerHTML = '<span class="tc-lore-pin-empty">No lorebooks active in this continuity.</span>';
            } else {
                $pinList.innerHTML = books.map(b =>
                    `<label class="tc-lore-pin-row">
                        <input type="checkbox" class="tc-lore-pin-cb" data-book-id="${esc(b.id)}" ${pinned.has(b.id) ? 'checked' : ''}>
                        <span class="tc-lore-pin-name">${esc(b.name || 'Unnamed lorebook')}</span>
                        <span class="tc-lore-pin-count">${(b.entries || []).length} entries</span>
                    </label>`
                ).join('');
            }
        }

        // Populate model select if needed
        const $tcModel = qs('#tc-model-select');
        if ($tcModel && $tcModel.options.length <= 1) {
            fetch('/glass/data/llm.json').then(r => r.json()).then(data => {
                $tcModel.innerHTML = '<option value="">— Inherit from continuity —</option>' + buildModelOptHtml(data);
                $tcModel.value = tc.model || '';
                lucideRefresh($tcModel.closest('.tc-shell'));
            }).catch(() => {});
        } else if ($tcModel) {
            $tcModel.value = tc.model || '';
        }

        // Temp slider
        const hasTempOverride = tc.temperature != null;
        const $tempInherit = qs('#tc-temp-inherit');
        const $tempInput   = qs('#tc-temp-input');
        const $tempBadge   = qs('#tc-temp-badge');
        if ($tempInherit) $tempInherit.checked = !hasTempOverride;
        if ($tempInput)   { $tempInput.disabled = !hasTempOverride; $tempInput.value = tc.temperature ?? state.config.temperature ?? 0.8; }
        if ($tempBadge)   $tempBadge.textContent = hasTempOverride ? parseFloat(tc.temperature).toFixed(2) : 'inherit';

        // MaxOutput slider
        const hasMaxOutOverride = tc.maxOutput != null;
        const $maxInherit = qs('#tc-maxout-inherit');
        const $maxInput   = qs('#tc-maxout-input');
        const $maxBadge   = qs('#tc-maxout-badge');
        if ($maxInherit) $maxInherit.checked = !hasMaxOutOverride;
        if ($maxInput)   { $maxInput.disabled = !hasMaxOutOverride; $maxInput.value = tc.maxOutput ?? state.config.maxOutput ?? 512; }
        if ($maxBadge)   $maxBadge.textContent = hasMaxOutOverride ? tc.maxOutput : 'inherit';

        // Tone tab
        _tcToneTags = tone.toneTags || '';
        qs('#tc-sexual-energy').value = tone.sexualEnergy || '';
        qs('#tc-tone-tags').value     = _tcToneTags;
        qs('#tc-amplify').value       = tone.amplify || '';
        qs('#tc-avoid').value         = tone.avoid   || '';
        qs('#tc-pacing').value        = tone.pacing  || '';

        // Sync quick pills to saved values
        qsa('#tc-sexual-energy-pills .tc-energy-node').forEach($p => {
            $p.classList.toggle('active', $p.dataset.val === (tone.sexualEnergy || ''));
        });
        qsa('#tc-tone-pills .tc-tone-chip').forEach($p => {
            const tags = _tcToneTags.split(',').map(s => s.trim()).filter(Boolean);
            $p.classList.toggle('active', tags.includes($p.dataset.val));
        });
        qsa('#tc-pacing-pills .tc-pacing-btn').forEach($p => {
            $p.classList.toggle('active', $p.dataset.val === (tone.pacing || ''));
        });

        // Reset to Core tab
        qsa('.tc-nav__item').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        qsa('.tc-panel').forEach(p => { p.classList.remove('active'); p.hidden = true; });
        const $firstTab   = qs('.tc-nav__item[data-tc-tab="core"]');
        const $firstPanel = qs('#tc-panel-core');
        if ($firstTab)   { $firstTab.classList.add('active'); $firstTab.setAttribute('aria-selected', 'true'); }
        if ($firstPanel) { $firstPanel.classList.add('active'); $firstPanel.hidden = false; }

        showModal('modal-thread-config');
        lucideRefresh(qs('#modal-thread-config'));
    }

    // Tab switching
    qsa('.tc-nav__item').forEach(tab => {
        tab.addEventListener('click', () => {
            qsa('.tc-nav__item').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
            qsa('.tc-panel').forEach(p => { p.classList.remove('active'); p.hidden = true; });
            tab.classList.add('active'); tab.setAttribute('aria-selected', 'true');
            const $panel = qs(`#tc-panel-${tab.dataset.tcTab}`);
            if ($panel) { $panel.classList.add('active'); $panel.hidden = false; }
            if (tab.dataset.tcTab === 'log') renderThreadLog();
        });
    });

    // Inherit toggles
    qs('#tc-temp-inherit')?.addEventListener('change', e => {
        const $inp   = qs('#tc-temp-input');
        const $badge = qs('#tc-temp-badge');
        if (!$inp) return;
        $inp.disabled = e.target.checked;
        if ($badge) {
            $badge.textContent = e.target.checked ? 'inherit' : parseFloat($inp.value).toFixed(2);
            $badge.dataset.inherit = e.target.checked ? 'true' : 'false';
        }
    });
    qs('#tc-maxout-inherit')?.addEventListener('change', e => {
        const $inp   = qs('#tc-maxout-input');
        const $badge = qs('#tc-maxout-badge');
        if (!$inp) return;
        $inp.disabled = e.target.checked;
        if ($badge) {
            $badge.textContent = e.target.checked ? 'inherit' : $inp.value;
            $badge.dataset.inherit = e.target.checked ? 'true' : 'false';
        }
    });
    qs('#tc-temp-input')?.addEventListener('input', e => {
        const $badge = qs('#tc-temp-badge');
        if ($badge) { $badge.textContent = parseFloat(e.target.value).toFixed(2); $badge.dataset.inherit = 'false'; }
    });
    qs('#tc-maxout-input')?.addEventListener('input', e => {
        const $badge = qs('#tc-maxout-badge');
        if ($badge) { $badge.textContent = e.target.value; $badge.dataset.inherit = 'false'; }
    });

    // Energy nodes
    qs('#tc-sexual-energy-pills')?.addEventListener('click', e => {
        const $p = e.target.closest('.tc-energy-node');
        if (!$p) return;
        const val     = $p.dataset.val || '';
        const $target = qs(`#${$p.dataset.target}`);
        if ($target) $target.value = val === $target.value ? '' : val;
        qsa('#tc-sexual-energy-pills .tc-energy-node').forEach(b => b.classList.toggle('active', b.dataset.val === $target?.value));
    });

    // Tone chips (multi-select)
    qs('#tc-tone-pills')?.addEventListener('click', e => {
        const $p = e.target.closest('.tc-tone-chip');
        if (!$p) return;
        const val     = $p.dataset.val;
        const $hidden = qs('#tc-tone-tags');
        let tags = ($hidden?.value || '').split(',').map(s => s.trim()).filter(Boolean);
        const idx = tags.indexOf(val);
        if (idx >= 0) tags.splice(idx, 1); else tags.push(val);
        _tcToneTags = tags.join(', ');
        if ($hidden) $hidden.value = _tcToneTags;
        $p.classList.toggle('active', idx < 0);
    });

    // Pacing buttons
    qs('#tc-pacing-pills')?.addEventListener('click', e => {
        const $p = e.target.closest('.tc-pacing-btn');
        if (!$p) return;
        const val = $p.dataset.val;
        const $inp = qs('#tc-pacing');
        if ($inp) $inp.value = val === $inp.value ? '' : val;
        qsa('#tc-pacing-pills .tc-pacing-btn').forEach(b => b.classList.toggle('active', b.dataset.val === $inp?.value));
    });

    // Save
    qs('#tc-save')?.addEventListener('click', () => {
        const chat = state.chat;
        if (!chat) return;
        if (!chat.threadConfig) chat.threadConfig = defaultThreadConfig();
        const tc = chat.threadConfig;

        tc.threadScenario      = qs('#tc-scenario')?.value.trim() || '';
        const modelVal         = qs('#tc-model-select')?.value || '';
        tc.model               = modelVal || null;
        tc.userName            = qs('#tc-user-name')?.value.trim()    || null;
        tc.userPersona         = qs('#tc-user-persona')?.value.trim() || null;
        tc.autoAttachLorebooks = qs('#tc-auto-attach-lorebooks')?.checked !== false;
        tc.pinnedLoreBookIds   = [...qsa('.tc-lore-pin-cb:checked', qs('#tc-lore-pin-list'))].map(cb => cb.dataset.bookId).filter(Boolean);
        tc.temperature         = qs('#tc-temp-inherit')?.checked ? null : parseFloat(qs('#tc-temp-input')?.value || 0.8);
        tc.maxOutput           = qs('#tc-maxout-inherit')?.checked ? null : parseInt(qs('#tc-maxout-input')?.value || 512, 10);

        const tone = {
            sexualEnergy: qs('#tc-sexual-energy')?.value.trim() || '',
            toneTags:     _tcToneTags,
            amplify:      qs('#tc-amplify')?.value.trim() || '',
            avoid:        qs('#tc-avoid')?.value.trim()   || '',
            pacing:       qs('#tc-pacing')?.value.trim()  || '',
        };
        const hasTone = Object.values(tone).some(v => v.trim() !== '');
        tc.narrativeTone = hasTone ? tone : null;

        saveState();
        hideModal('modal-thread-config');
        showToast('Thread settings saved', 'info', 1800);

        const _changes = [];
        if (tc.model) _changes.push(`model → ${tc.model.split('/').pop()}`);
        if (tc.temperature != null) _changes.push(`temp → ${tc.temperature.toFixed(2)}`);
        if (tc.narrativeTone?.toneTags) _changes.push(`tone → ${tc.narrativeTone.toneTags}`);
        if (_changes.length) tcLogPush('event', `Thread settings updated: ${_changes.join(', ')}`);
        updateThreadConfigBadge();
    });

    qs('#btn-thread-config')?.addEventListener('click', openThreadConfig);
    qs('#tc-close')?.addEventListener('click',  () => hideModal('modal-thread-config'));
    qs('#tc-cancel')?.addEventListener('click', () => hideModal('modal-thread-config'));
    qs('#modal-thread-config .tc-modal__backdrop')?.addEventListener('click', () => hideModal('modal-thread-config'));

    // Add manual note
    qs('#tc-log-add-note')?.addEventListener('click', () => {
        tcLogPush('note', 'New note — click edit to write.');
        renderThreadLog();
    });

    // Clear log
    qs('#tc-log-clear')?.addEventListener('click', async () => {
        const ok = await confirm('Clear Log', 'Delete all log entries for this thread?', { danger: true });
        if (!ok) return;
        const log = _tcLog();
        if (log) { log.length = 0; saveState(); }
        renderThreadLog();
    });
}
