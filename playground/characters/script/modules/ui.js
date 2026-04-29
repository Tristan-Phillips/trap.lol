/**
 * ui.js
 * DOM Orchestration for the Underdark interface.
 */

import { state, setActiveBot, addMessage } from './state.js';
import { buildPayload, streamCompletion } from './llm-engine.js';
import { addLorebookEntry } from './lorebook.js';

export function initUI() {
    const $rosterSidebar = document.getElementById('roster-sidebar');
    const $terminalSidebar = document.getElementById('terminal-sidebar');
    
    const $toggleRoster = document.getElementById('toggle-roster');
    const $toggleTerminal = document.getElementById('toggle-terminal');
    const $closeTerminal = document.getElementById('close-terminal');
    
    // --- Sidebar Toggles ---
    
    $toggleRoster.addEventListener('click', () => {
        const isCollapsed = $rosterSidebar.dataset.collapsed === 'true';
        $rosterSidebar.dataset.collapsed = !isCollapsed;
        $toggleRoster.querySelector('i').dataset.lucide = isCollapsed ? 'chevron-left' : 'chevron-right';
        if (window.lucide) window.lucide.createIcons({ nodes: [$toggleRoster] });
    });

    const toggleTerminal = (force) => {
        const current = $terminalSidebar.dataset.collapsed === 'true';
        const next = force !== undefined ? force : !current;
        $terminalSidebar.dataset.collapsed = next;
    };

    $toggleTerminal.addEventListener('click', () => toggleTerminal());
    $closeTerminal.addEventListener('click', () => toggleTerminal(true));

    // --- Tab System ---

    const $tabBtns = document.querySelectorAll('.tab-btn');
    const $tabPanels = document.querySelectorAll('.tab-panel');

    $tabBtns.forEach($btn => {
        $btn.addEventListener('click', () => {
            const target = $btn.dataset.tab;
            
            $tabBtns.forEach(b => b.classList.remove('active'));
            $tabPanels.forEach(p => p.classList.remove('active'));
            
            $btn.classList.add('active');
            document.getElementById(`tab-${target}`).classList.add('active');
        });
    });

    // --- Character List & Selection ---

    const $charList = document.getElementById('character-list');

    async function loadManifest() {
        try {
            const res = await fetch('./data/index.json');
            const data = await res.json();
            state.characters = data.characters;
            renderRoster();
        } catch (err) {
            console.error('[underdark] Failed to load manifest:', err);
            $charList.innerHTML = '<div class="error">Signal lost. Check logs.</div>';
        }
    }

    function renderRoster() {
        if (!state.characters.length) {
            $charList.innerHTML = '<div class="empty">No fragments found.</div>';
            return;
        }

        $charList.innerHTML = state.characters.map(char => `
            <div class="character-card" data-id="${char.id}">
                <div class="character-card__avatar" style="background-image: ${char.avatar_path ? `url(${char.avatar_path})` : 'linear-gradient(45deg, var(--bg-surface), var(--accent-subtle))'}"></div>
                <div class="character-card__info">
                    <span class="character-card__name">${char.name}</span>
                    <span class="character-card__tagline">${char.tagline || ''}</span>
                </div>
            </div>
        `).join('');

        $charList.querySelectorAll('.character-card').forEach($card => {
            $card.addEventListener('click', () => selectCharacter($card.dataset.id));
        });
    }

    function renderActiveBots() {
        const $activeBots = document.getElementById('active-bots');
        $activeBots.innerHTML = state.activeBotIds.map(id => {
            const char = state.loadedCharacters[id];
            const meta = state.characters.find(c => c.id === id);
            const isActive = id === state.activeBotId;
            return `
                <div class="active-bot ${isActive ? 'active-bot--selected' : ''}" data-id="${id}" title="${char.name}">
                    <div class="active-bot__avatar" style="background-image: ${meta?.avatar_path ? `url(${meta.avatar_path})` : 'linear-gradient(45deg, var(--bg-surface), var(--accent-subtle))'}"></div>
                </div>
            `;
        }).join('');

        $activeBots.querySelectorAll('.active-bot').forEach($bot => {
            $bot.addEventListener('click', () => {
                setActiveBot($bot.dataset.id);
                renderActiveBots();
                
                // Update profile view & bg
                const activeChar = state.loadedCharacters[$bot.dataset.id];
                const charMeta = state.characters.find(c => c.id === $bot.dataset.id);
                if (activeChar) renderProfile(activeChar);
                if (charMeta) updateCinematicBackground(charMeta.avatar_path);
            });
        });
    }

    async function selectCharacter(id) {
        const charMeta = state.characters.find(c => c.id === id);
        if (!charMeta) return;

        try {
            if (!state.loadedCharacters[id]) {
                const res = await fetch(charMeta.card_path);
                const rawData = await res.json();
                state.loadedCharacters[id] = normalizeData(rawData);
            }

            const char = state.loadedCharacters[id];
            setActiveBot(id);
            renderActiveBots();
            
            renderProfile(char);
            updateCinematicBackground(charMeta.avatar_path);
            
            const $welcome = document.querySelector('.arena__welcome');
            if ($welcome) $welcome.remove();
            
            // Check if thread is empty, if so, render first message
            if (state.history.length === 0 && char.first_mes) {
                addMessage('bot', char.first_mes, id);
                renderMessage('bot', char.first_mes, char.name);
            }
            
            console.log(`[underdark] Synchronized with ${char.name}`);
        } catch (err) {
            console.error('[underdark] Selection failed:', err);
        }
    }

    function renderProfile(char) {
        const $profile = document.getElementById('profile-card');
        $profile.innerHTML = `
            <div class="profile-details">
                <h3 class="profile-details__name">${char.name}</h3>
                <p class="profile-details__desc">${char.description}</p>
                ${char.personality ? `<div class="profile-details__section"><strong>Personality:</strong><p>${char.personality}</p></div>` : ''}
                ${char.scenario ? `<div class="profile-details__section"><strong>Scenario:</strong><p>${char.scenario}</p></div>` : ''}
            </div>
        `;
    }

    function updateCinematicBackground(path) {
        const $bg = document.getElementById('arena-background');
        if (path) {
            $bg.style.backgroundImage = `url(${path})`;
            $bg.classList.add('arena__bg--visible');
        } else {
            $bg.style.backgroundImage = 'none';
            $bg.classList.remove('arena__bg--visible');
        }
    }

    function normalizeData(raw) {
        const d = raw.data || raw;
        return {
            name: d.name || d.char_name || 'Unknown',
            description: d.description || d.char_persona || '',
            personality: d.personality || '',
            scenario: d.scenario || '',
            first_mes: d.first_mes || '',
            mes_example: d.mes_example || '',
            creator_notes: d.creator_notes || ''
        };
    }

    // --- Character Import Handling ---

    const $importBtn = document.getElementById('import-card');
    const $cardInput = document.getElementById('card-input');

    $importBtn.addEventListener('click', () => $cardInput.click());
    
    $cardInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const { parseCharacterCard } = await import('./parser-v2.js');
            const character = await parseCharacterCard(file);
            
            const id = `local-${Date.now()}`;
            state.characters.push({
                id,
                name: character.name,
                tagline: 'Imported Fragment',
                avatar_path: null,
                card_path: null
            });
            state.loadedCharacters[id] = character;
            
            renderRoster();
            selectCharacter(id);
        } catch (err) {
            console.error('[underdark] Import failed:', err);
            alert(`Signal Error: ${err.message}`);
        } finally {
            $cardInput.value = '';
        }
    });

    // --- Lorebook UI ---
    const $loreList = document.getElementById('lore-list');
    const $addLoreBtn = document.getElementById('add-lore');

    function renderLorebooks() {
        if (!state.lorebooks.length || !state.lorebooks[0].entries.length) {
            $loreList.innerHTML = '<div class="world-view__empty">No active lorebooks</div>';
            return;
        }

        $loreList.innerHTML = state.lorebooks[0].entries.map(entry => `
            <div class="lore-entry">
                <div class="lore-entry__name">${entry.name} <span class="lore-entry__keys">(${entry.keywords.join(', ')})</span></div>
                <div class="lore-entry__content">${entry.content}</div>
            </div>
        `).join('');
    }

    $addLoreBtn.addEventListener('click', () => {
        const name = prompt('Lore Entry Name:');
        if (!name) return;
        const keywords = prompt('Comma-separated keywords to trigger this entry:');
        if (!keywords) return;
        const content = prompt('Content (what the AI should know):');
        if (!content) return;

        addLorebookEntry(state.lorebooks, name, keywords, content);
        renderLorebooks();
    });

    // --- Chat Rendering & Form Loop ---

    const $thread = document.getElementById('message-thread');
    const $form = document.getElementById('rp-form');
    const $textarea = document.getElementById('rp-input');
    const $sendBtn = document.getElementById('send-btn');
    
    function renderMarkdown(text) {
        if (typeof marked !== "undefined") {
            try {
                let html = marked.parse(text);
                if (typeof DOMPurify !== "undefined") {
                    html = DOMPurify.sanitize(html);
                }
                return html;
            } catch (_) {}
        }
        return `<p>${text.replace(/\n/g, '<br>')}</p>`;
    }

    function renderMessage(role, content, nameOverride) {
        const $msg = document.createElement('div');
        $msg.className = `message message--${role}`;
        
        const name = nameOverride || (role === 'user' ? 'You' : 'System');
        
        $msg.innerHTML = `
            <div class="message__name">${name}</div>
            <div class="message__bubble">
                <div class="message__content">${renderMarkdown(content)}</div>
            </div>
        `;
        
        $thread.appendChild($msg);
        $thread.scrollTop = $thread.scrollHeight;
        return $msg;
    }

    $textarea.addEventListener('input', () => {
        $textarea.style.height = 'auto';
        $textarea.style.height = Math.min($textarea.scrollHeight, 200) + 'px';
    });

    $textarea.addEventListener('keydown', (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            $form.requestSubmit();
        }
    });

    $form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!state.activeBotId) {
            alert('Select a character first.');
            return;
        }

        const text = $textarea.value.trim();
        if (!text) return;

        $textarea.value = '';
        $textarea.style.height = 'auto';
        
        // Add to state and render user msg
        addMessage('user', text);
        renderMessage('user', text);
        
        $sendBtn.disabled = true;
        
        const activeChar = state.loadedCharacters[state.activeBotId];
        const $botMsg = renderMessage('bot', '<span class="thinking">...</span>', activeChar.name);
        const $botContent = $botMsg.querySelector('.message__content');
        
        try {
            const payload = buildPayload({
                character: activeChar,
                history: state.history,
                lore: state.lorebooks,
                config: state.config
            });
            
            await streamCompletion(payload, 
                (chunk, full) => {
                    $botContent.innerHTML = renderMarkdown(full);
                    $thread.scrollTop = $thread.scrollHeight;
                },
                (finalText) => {
                    addMessage('bot', finalText, state.activeBotId);
                    $sendBtn.disabled = false;
                    $textarea.focus();
                },
                (err) => {
                    $botContent.innerHTML = `<span style="color: #ef4444;">[Signal Error: ${err.message}]</span>`;
                    $sendBtn.disabled = false;
                }
            );
        } catch (err) {
            $botContent.innerHTML = `<span style="color: #ef4444;">[Signal Error: ${err.message}]</span>`;
            $sendBtn.disabled = false;
        }
    });

    // --- Config Integration ---
    const $modelSelect = document.getElementById('model-select');
    const $contextStrategy = document.getElementById('context-strategy');
    
    const bindSlider = (id, stateKey, isInt = false) => {
        const $input = document.getElementById(`${id}-input`);
        const $val = document.getElementById(`${id}-val`);
        if (!$input || !$val) return;
        $input.addEventListener('input', () => {
            const val = isInt ? parseInt($input.value) : parseFloat($input.value);
            state.config[stateKey] = val;
            $val.textContent = isInt ? val : val.toFixed(2);
        });
    };

    bindSlider('temp', 'temperature');
    bindSlider('topp', 'topP');
    bindSlider('topk', 'topK', true);
    bindSlider('rep', 'repetitionPenalty');
    bindSlider('pres', 'presencePenalty');
    bindSlider('freq', 'frequencyPenalty');
    bindSlider('maxctx', 'maxContext', true);
    bindSlider('maxout', 'maxOutput', true);

    const bindText = (id, stateKey) => {
        const $el = document.getElementById(id);
        if (!$el) return;
        $el.addEventListener('input', () => {
            state.config[stateKey] = $el.value;
        });
    };

    bindText('sys-directive', 'sysDirective');
    bindText('authors-note', 'authorsNote');
    bindText('nsfw-bypass', 'nsfwBypass');

    const $streamToggle = document.getElementById('stream-toggle');
    if ($streamToggle) {
        $streamToggle.addEventListener('change', () => {
            state.config.stream = $streamToggle.checked;
        });
    }

    if ($contextStrategy) {
        $contextStrategy.addEventListener('change', () => {
            state.config.contextStrategy = $contextStrategy.value;
        });
    }
    
    // Load models
    async function loadModels() {
        try {
            const res = await fetch('../../glass/data/llm.json');
            const data = await res.json();
            
            $modelSelect.innerHTML = data._index.map(group => `
                <optgroup label="${group.family}">
                    ${group.models.map(id => {
                        const m = data.routing_table[id];
                        return m ? `<option value="${id}">${m.label}</option>` : '';
                    }).join('')}
                </optgroup>
            `).join('');
            
            $modelSelect.value = data.default_routing || 'deepseek-r1';
            state.config.model = $modelSelect.value;
        } catch (err) {
            console.error('Failed to load models for Underdark', err);
            $modelSelect.innerHTML = '<option value="deepseek-r1">DeepSeek R1 (Fallback)</option>';
            state.config.model = 'deepseek-r1';
        }
    }

    $modelSelect.addEventListener('change', () => state.config.model = $modelSelect.value);

    // --- Initial Load ---
    loadManifest();
    loadModels();
}
