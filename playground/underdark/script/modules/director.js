/**
 * director.js — Director Panel for The Underdark.
 * Owns: Direct chips, Mood toggles, World (Overlord) shortcuts,
 *       AI quick-reply generation, inline reply chips, scene inject bar wiring.
 *
 * Call initDirector(deps) once from initUI() after the DOM is ready.
 * Exports getActiveTone() so the form submit handler can read mood state.
 *
 * NOT owned here (stay in ui.js — require closure state):
 *   - #btn-trigger-response  (needs getCharOverride closure)
 *   - #btn-overlord-beat     (needs _overlordBeatInFlight closure)
 */

import { qs, qsa, esc, parseLLMArray } from './shared-utils.js?v=4';
import { fetchCompletion } from './llm-engine.js?v=15';
import { getApiKey } from '/glass/script/modules/llm-auth.js?v=3';

// ── Direct tab — chips that fire the character immediately (no player message) ──
const DIR_DIRECT = [
    { grp: 'Scene',   key: 'continue',   label: '▶ Continue',       directive: '(Continue the scene from where we left off.)',                                   overlordBeat: true  },
    { grp: 'Scene',   key: 'timeskip',   label: '⟳ Time skip',       directive: '(Move the story forward in time to the next meaningful moment.)',               overlordBeat: true  },
    { grp: 'Scene',   key: 'slow',       label: '◌ Linger',          directive: '(Slow the pace. Linger on this moment — the senses, the silence, the feeling.)', overlordBeat: false },
    { grp: 'Voice',   key: 'introspect', label: '⦿ Inner world',     directive: '(Open up your inner world right now. Thoughts, fears, desires — let them surface.)' },
    { grp: 'Voice',   key: 'describe',   label: '◈ Describe',        directive: '(Paint the scene around you — what do you see, hear, feel, smell right now?)'   },
    { grp: 'Voice',   key: 'react',      label: '⊞ React',           directive: '(React honestly to what just happened. How does it land for you?)'              },
    { grp: 'Voice',   key: 'whisper',    label: '⌁ Whisper',         directive: '(Lean in close and whisper something — something you would not say out loud.)'  },
    { grp: 'Shape',   key: 'shorter',    label: '← Shorter',         directive: '(Keep this response brief and punchy.)'                                         },
    { grp: 'Shape',   key: 'longer',     label: '→ Longer',          directive: '(Give a longer, fully painted response this time.)'                             },
    { grp: 'Shape',   key: 'prose',      label: '~ Prose',           directive: '(Write this beat as lyrical prose — slow, sensory, literary.)'                  },
];
const _dirDirectLookup = {};
DIR_DIRECT.forEach(e => { _dirDirectLookup[e.key] = e; });

// ── Mood tab — persistent toggles that colour every response until cleared ──
let _activeTone = null; // { key, directive }
const DIR_TONES = [
    { key: 'lust',      label: '♦ Lust',       directive: '[TONE SHIFT — ACTIVE]\nLet desire bleed through every word. {C}\'s body language, word choice, and attention are tuned to attraction right now. Let it show — in what they notice, what they linger on, what they don\'t say.' },
    { key: 'rage',      label: '⚡ Rage',        directive: '[TONE SHIFT — ACTIVE]\n{C} is furious. Something has cracked beneath the surface. Let rage coil through their responses — short sentences, clipped answers, the effort of restraint or its total absence.' },
    { key: 'grief',     label: '◎ Grief',       directive: '[TONE SHIFT — ACTIVE]\n{C} is carrying loss right now. Let it dull the edges of their presence — slower responses, distance, moments where they almost say what they\'re feeling and then don\'t.' },
    { key: 'fear',      label: '◈ Fear',        directive: '[TONE SHIFT — ACTIVE]\n{C} is afraid. Not of something abstract — of something immediate, present in this scene. Let hypervigilance show: checking exits, flinching at small sounds, holding very still.' },
    { key: 'tender',    label: '♡ Tender',      directive: '[TONE SHIFT — ACTIVE]\nThis is a soft moment for {C}. Let tenderness come through — gentle touches, quieter voice, the kind of attention that makes someone feel seen.' },
    { key: 'predatory', label: '☽ Predatory',   directive: '[TONE SHIFT — ACTIVE]\n{C} is in hunter mode. Controlled, deliberate, circling. Every movement is measured. They want something and they are deciding how to take it.' },
    { key: 'broken',    label: '◌ Unravelling', directive: '[TONE SHIFT — ACTIVE]\n{C} is close to the edge. Composure is thin and cracking. Let the fractures show — uneven speech, sudden silences, emotions surfacing that they would normally bury.' },
    { key: 'joy',       label: '✧ Joy',         directive: '[TONE SHIFT — ACTIVE]\n{C} is genuinely, unexpectedly happy right now. Let lightness lift the scene — a warmth in how they look at things, humour that comes naturally, the rare looseness of someone who isn\'t guarding themselves.' },
];
const _dirToneLookup = {};
DIR_TONES.forEach(t => { _dirToneLookup[t.key] = t; });

// ── World tab — Overlord scene narration shortcuts ─────────────────────────────
const DIR_OVERLORD = [
    { key: 'beat',       label: '⊹ Beat',        title: 'Narrate the current scene beat',      action: () => qs('#btn-overlord-beat')?.click() },
    { key: 'transition', label: '→ Transition',   title: 'Scene transition',                    action: () => qs('#codex-overlord-transition')?.click() },
    { key: 'entrance',   label: '◈ Entrance',    title: 'Character entrance narration',        action: () => qs('#codex-overlord-entrance')?.click() },
    { key: 'moment',     label: '◉ Moment',      title: 'Charged / intimate moment',           action: () => qs('#codex-overlord-moment')?.click() },
    { key: 'reaction',   label: '⚡ Environment', title: 'Environmental reaction',              action: () => qs('#codex-overlord-reaction')?.click() },
    { key: 'whisper',    label: '⌁ Whisper',     title: 'Overlord aside / whisper to player',  action: () => qs('#codex-overlord-whisper')?.click() },
    { key: 'irony',      label: '⊗ Irony',       title: 'Dramatic irony injection',            action: () => qs('#codex-overlord-irony')?.click() },
    { key: 'recap',      label: '⊡ Recap',       title: 'Story anchor recap',                  action: () => qs('#codex-recap')?.click() },
    { key: 'redesc',     label: '⊙ Re-describe',  title: 'Force Overlord to re-describe scene', action: () => qs('#codex-force-overlord')?.click() },
];

// ── AI quick-reply cache (per history length) ─────────────────────────────────
let _aiQRCache = null;

// ── Exported getter — lets the form submit handler in ui.js read mood state ───
export function getActiveTone() { return _activeTone; }

// ── Build Director panel HTML ─────────────────────────────────────────────────
function _buildDirectorPanel($bar) {
    const directGroups = {};
    DIR_DIRECT.forEach(e => {
        if (!directGroups[e.grp]) directGroups[e.grp] = [];
        directGroups[e.grp].push(e);
    });

    const directHtml = Object.entries(directGroups).map(([grp, entries]) =>
        `<div class="dir-group">
            <span class="dir-group__label">${esc(grp)}</span>
            ${entries.map(e => `<button class="dir-btn dir-btn--direct" data-dir-direct="${esc(e.key)}">${esc(e.label)}</button>`).join('')}
        </div>`
    ).join('');

    const moodHtml = DIR_TONES.map(t =>
        `<button class="dir-btn dir-btn--tone${_activeTone?.key === t.key ? ' dir-btn--tone-active' : ''}" data-dir-tone="${esc(t.key)}" title="${esc(t.directive.split('\n')[1] || '')}">${esc(t.label)}</button>`
    ).join('');

    const worldHtml = DIR_OVERLORD.map(o =>
        `<button class="dir-btn dir-btn--overlord" data-dir-overlord="${esc(o.key)}" title="${esc(o.title)}">${esc(o.label)}</button>`
    ).join('');

    $bar.innerHTML = `
        <div class="dir-tabs">
            <button class="dir-tab dir-tab--active" data-tab="direct">Direct</button>
            <button class="dir-tab" data-tab="mood">Mood${_activeTone ? ' ●' : ''}</button>
            <button class="dir-tab" data-tab="world">World</button>
        </div>
        <div class="dir-tab-pane dir-tab-pane--active" data-tab-pane="direct">
            <div class="dir-direct-hint">Fires the character immediately — no message needed.</div>
            ${directHtml}
        </div>
        <div class="dir-tab-pane" data-tab-pane="mood">
            <div class="dir-group dir-group--tone">
                ${moodHtml}
            </div>
            ${_activeTone ? `<div class="dir-tone-active-row"><span class="dir-tone-active-label">Active: ${esc(_dirToneLookup[_activeTone.key]?.label || '')}</span><button class="dir-tone-clear" id="dir-tone-clear-btn">× Clear</button></div>` : ''}
        </div>
        <div class="dir-tab-pane" data-tab-pane="world">
            <div class="dir-group">
                ${worldHtml}
            </div>
        </div>`;
}

export function injectInlineReplyChips(replies) {
    const $thread = qs('#arena-thread');
    if (!$thread) return;
    qs('.inline-reply-chips', $thread)?.remove();
    const $chips = document.createElement('div');
    $chips.className = 'inline-reply-chips';
    $chips.setAttribute('aria-label', 'Suggested replies');
    $chips.innerHTML = replies.map((r, i) =>
        `<button class="inline-reply-chip" data-reply-idx="${i}">${esc(r)}</button>`
    ).join('');
    $thread.appendChild($chips);
    requestAnimationFrame(() => { $thread.scrollTop = $thread.scrollHeight; });
}

export async function generateAIQuickReplies(state) {
    const key = getApiKey();
    if (!key) return;
    const hist = state.history.filter(m => m.role === 'bot' || m.role === 'user').slice(-3);
    if (hist.length < 1) return;
    const histLen = state.history.length;
    if (_aiQRCache?.histLen === histLen) return;

    const snippet = hist.map(m => {
        const name = m.role === 'user'
            ? (state.config.userName || 'You')
            : (state.loadedCharacters[m.botId]?.name || 'Character');
        return `${name}: ${m.content?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)}`;
    }).join('\n');

    try {
        const { text } = await fetchCompletion({
            model: state.config.model || 'deepseek-r1',
            messages: [
                { role: 'system', content: 'You generate short reply starters for a player in a collaborative roleplay. Output ONLY a JSON array of exactly 3 strings, each 4-10 words. Each string is a complete first-person reply starter that the player can build on. Vary the emotional register: one confident/direct, one vulnerable/emotional, one intrigued/questioning. No quotes around the full output — just raw JSON array.' },
                { role: 'user', content: `Recent exchange:\n${snippet}\n\nGenerate 3 reply starters.` }
            ],
            max_tokens: 100,
            temperature: 0.9
        });
        const replies = parseLLMArray(text).slice(0, 3).filter(r => typeof r === 'string' && r.trim());
        if (replies.length) {
            _aiQRCache = { histLen, replies };
            const $bar = qs('#quick-reply-bar');
            if ($bar) delete $bar.dataset.built;
            injectInlineReplyChips(replies);
        }
    } catch { /* silent */ }
}

// ── Wire all Director event listeners ────────────────────────────────────────
export function initDirector({ state, triggerBotResponse, _fireOverlordBeat }) {
    // Panel open / close
    qs('#btn-quick-reply')?.addEventListener('click', () => {
        const $bar = qs('#quick-reply-bar');
        if (!$bar) return;
        const opening = $bar.hidden;
        if (opening) _buildDirectorPanel($bar);
        $bar.hidden = !opening;
    });

    // Tab switching inside the Director panel
    document.addEventListener('click', e => {
        const tab = e.target.closest('.dir-tab');
        if (!tab) return;
        const $bar = qs('#quick-reply-bar');
        if (!$bar || $bar.hidden) return;
        const target = tab.dataset.tab;
        qsa('.dir-tab', $bar).forEach(t => t.classList.toggle('dir-tab--active', t.dataset.tab === target));
        qsa('.dir-tab-pane', $bar).forEach(p => p.classList.toggle('dir-tab-pane--active', p.dataset.tabPane === target));
    });

    // Direct chip — fires character immediately, no player message
    document.addEventListener('click', async e => {
        const btn = e.target.closest('.dir-btn--direct');
        if (!btn) return;
        const entry = _dirDirectLookup[btn.dataset.dirDirect];
        if (!entry) return;
        qs('#quick-reply-bar')?.setAttribute('hidden', '');

        let reinject = entry.directive;
        if (_activeTone?.directive) {
            const charName = state.bots?.find(b => b.id === state.activeBotId)?.name || 'the character';
            reinject += '\n\n' + _activeTone.directive.replace(/\{C\}/g, charName);
        }

        if (entry.overlordBeat) {
            await _fireOverlordBeat({ force: false, context: entry.directive });
        }
        triggerBotResponse(state.activeBotId, reinject);
    });

    // Mood tone toggle
    document.addEventListener('click', e => {
        const btn = e.target.closest('.dir-btn--tone');
        if (!btn) return;
        const key = btn.dataset.dirTone;
        const tone = _dirToneLookup[key];
        if (!tone) return;
        _activeTone = (_activeTone?.key === key) ? null : { key, directive: tone.directive };
        const $bar = qs('#quick-reply-bar');
        if ($bar && !$bar.hidden) {
            _buildDirectorPanel($bar);
            qsa('.dir-tab', $bar).forEach(t => t.classList.toggle('dir-tab--active', t.dataset.tab === 'mood'));
            qsa('.dir-tab-pane', $bar).forEach(p => p.classList.toggle('dir-tab-pane--active', p.dataset.tabPane === 'mood'));
        }
    });

    // Clear mood button
    document.addEventListener('click', e => {
        if (!e.target.closest('#dir-tone-clear-btn')) return;
        _activeTone = null;
        const $bar = qs('#quick-reply-bar');
        if ($bar && !$bar.hidden) {
            _buildDirectorPanel($bar);
            qsa('.dir-tab', $bar).forEach(t => t.classList.toggle('dir-tab--active', t.dataset.tab === 'mood'));
            qsa('.dir-tab-pane', $bar).forEach(p => p.classList.toggle('dir-tab-pane--active', p.dataset.tabPane === 'mood'));
        }
    });

    // World (Overlord) shortcut click
    document.addEventListener('click', e => {
        const btn = e.target.closest('.dir-btn--overlord');
        if (!btn) return;
        const entry = DIR_OVERLORD.find(o => o.key === btn.dataset.dirOverlord);
        if (!entry) return;
        qs('#quick-reply-bar')?.setAttribute('hidden', '');
        entry.action();
    });

    // AI quick-reply click (Director panel)
    document.addEventListener('click', e => {
        const btn = e.target.closest('.dir-btn--ai') || e.target.closest('.qr-btn--ai');
        if (!btn) return;
        const idx = parseInt(btn.dataset.qrAi, 10);
        const text = _aiQRCache?.replies?.[idx];
        if (!text) return;
        const $ta = qs('#rp-input');
        if (!$ta) return;
        $ta.value = $ta.value ? `${$ta.value}\n${text}` : text;
        $ta.dispatchEvent(new Event('input'));
        $ta.focus();
        qs('#quick-reply-bar')?.setAttribute('hidden', '');
    });

    // Inline reply chip click (in-thread suggestions row)
    document.addEventListener('click', e => {
        const chip = e.target.closest('.inline-reply-chip');
        if (!chip) return;
        const idx  = parseInt(chip.dataset.replyIdx, 10);
        const text = _aiQRCache?.replies?.[idx];
        if (!text) return;
        const $ta = qs('#rp-input');
        if ($ta) {
            $ta.value = $ta.value ? `${$ta.value}\n${text}` : text;
            $ta.dispatchEvent(new Event('input'));
            $ta.focus();
        }
        qs('.inline-reply-chips', qs('#arena-thread'))?.remove();
    });

    // Scene inject bar toggle
    qs('#btn-scene-inject')?.addEventListener('click', () => {
        const $bar = qs('#scene-inject-bar');
        if (!$bar) return;
        const opening = $bar.hidden;
        $bar.hidden = !opening;
        if (opening) {
            qs('#scene-inject-input')?.focus();
            qs('#btn-scene-inject')?.classList.add('scene-inject-armed');
        } else {
            qs('#btn-scene-inject')?.classList.remove('scene-inject-armed');
        }
    });
    qs('#scene-inject-clear')?.addEventListener('click', () => {
        const $inp = qs('#scene-inject-input');
        if ($inp) $inp.value = '';
        qs('#scene-inject-bar')?.setAttribute('hidden', '');
        qs('#btn-scene-inject')?.classList.remove('scene-inject-armed');
    });
    qs('#scene-inject-input')?.addEventListener('keydown', e => {
        if (e.key === 'Escape') { qs('#btn-scene-inject')?.click(); }
    });
}
