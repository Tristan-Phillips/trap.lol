/**
 * commands.js — Slash command registry and executor for The Underdark.
 *
 * Commands intercept the input before it hits the normal message pipeline.
 * Each command returns a CommandResult:
 *   { handled: true }           — swallow the input, do nothing visible
 *   { handled: true, sysMsg }   — inject a styled system message into the thread
 *   { handled: true, reinject } — queue an ephemeral directive for next LLM call
 *   { handled: false }          — not a command, fall through to normal send
 *   { handled: true, action: fn } — run async side-effect, caller awaits
 */

import { state, setConfig, saveState, getCharOverride } from './state.js';
export { IMAGE_MODELS, DEFAULT_MODEL, buildImagePrompt, generateImage } from './image-engine.js';

// ── Registry ──────────────────────────────────────────────────────────────────
// Each entry: { cmd, args, desc, detail }
export const COMMANDS = [
    { cmd: '/compact',  args: '',              desc: 'Compress history into a narrative summary' },
    { cmd: '/summary',  args: '[n]',           desc: 'Show a recap of the last n turns (default: all)' },
    { cmd: '/retry',    args: '',              desc: 'Regenerate the last bot response' },
    { cmd: '/ooc',      args: '<message>',     desc: 'Send an out-of-character note (no bot response)' },
    { cmd: '/scene',    args: '<description>', desc: 'Inject a scene description, then trigger a response' },
    { cmd: '/as',       args: '<name> <text>', desc: 'Narrate as a named NPC / third party' },
    { cmd: '/mood',     args: '<tone>',        desc: 'Shift tone for the next reply only (e.g. /mood tense)' },
    { cmd: '/pov',      args: '[first|third|second]', desc: 'Switch narrative POV for all future replies' },
    { cmd: '/persona',  args: '<description>', desc: 'Update your persona description on the fly' },
    { cmd: '/remember', args: '<fact>',        desc: 'Append a fact to the active character\'s persistent memory' },
    { cmd: '/image',    args: '[description]', desc: 'Generate an image — opens the image studio' },
    { cmd: '/help',     args: '',              desc: 'Show this command list' },
];

// ── Parser ────────────────────────────────────────────────────────────────────
export function parseCommand(raw) {
    const text = raw.trimStart();
    if (!text.startsWith('/')) return null;
    const space = text.indexOf(' ');
    const cmd = (space === -1 ? text : text.slice(0, space)).toLowerCase();
    const args = space === -1 ? '' : text.slice(space + 1).trim();
    return { cmd, args };
}

// ── Executor ──────────────────────────────────────────────────────────────────
// Returns a CommandResult (see module doc above), or null if not a command.
export async function executeCommand(raw, { triggerBotResponse, appendSystemMessage, showToast, syncConfigUI }) {
    const parsed = parseCommand(raw);
    if (!parsed) return null;
    const { cmd, args } = parsed;

    // ── /help ─────────────────────────────────────────────────────────────────
    if (cmd === '/help') {
        const rows = COMMANDS.map(c =>
            `<tr><td class="cmd-help__cmd">${c.cmd}${c.args ? ' <span class="cmd-help__arg">' + c.args + '</span>' : ''}</td><td class="cmd-help__desc">${c.desc}</td></tr>`
        ).join('');
        appendSystemMessage(
            `<div class="cmd-help"><div class="cmd-help__header"><i data-lucide="terminal"></i> Slash Commands</div><table class="cmd-help__table">${rows}</table></div>`,
            { raw: true, label: 'Commands' }
        );
        return { handled: true };
    }

    // ── /ooc <message> ────────────────────────────────────────────────────────
    if (cmd === '/ooc') {
        if (!args) { showToast('/ooc requires a message', 'warn'); return { handled: true }; }
        appendSystemMessage(`<span class="cmd-ooc"><strong>[OOC]</strong> ${escHtml(args)}</span>`, { label: 'OOC' });
        return { handled: true };
    }

    // ── /as <name> <text> ─────────────────────────────────────────────────────
    if (cmd === '/as') {
        const spaceIdx = args.indexOf(' ');
        if (spaceIdx === -1) { showToast('/as requires a name and message', 'warn'); return { handled: true }; }
        const name = args.slice(0, spaceIdx).trim();
        const text = args.slice(spaceIdx + 1).trim();
        if (!text) { showToast('/as requires message text after the name', 'warn'); return { handled: true }; }
        appendSystemMessage(
            `<span class="cmd-as"><strong>${escHtml(name)}</strong>: ${escHtml(text)}</span>`,
            { label: name }
        );
        return { handled: true };
    }

    // ── /scene <description> ──────────────────────────────────────────────────
    if (cmd === '/scene') {
        if (!args) { showToast('/scene requires a description', 'warn'); return { handled: true }; }
        const reinject = `[Scene Transition]\n${args}\n\nDescribe the new environment and how ${state.config.userName || 'the user'} and your character respond to this shift in setting.`;
        appendSystemMessage(`<em class="cmd-scene">📍 ${escHtml(args)}</em>`, { label: 'Scene' });
        // Store as pending reinject; caller will add it to the next payload
        return { handled: true, reinject, triggerResponse: true };
    }

    // ── /mood <tone> ──────────────────────────────────────────────────────────
    if (cmd === '/mood') {
        if (!args) { showToast('/mood requires a tone word (e.g. /mood tense)', 'warn'); return { handled: true }; }
        const reinject = `[Tone Directive — one reply only]\nWrite your next response in a ${args} tone. Let this mood color your word choices, pacing, and emotional register throughout your reply.`;
        showToast(`Mood set to "${args}" for next reply`, 'info', 2000);
        return { handled: true, reinject, triggerResponse: false };
    }

    // ── /pov [first|third|second] ─────────────────────────────────────────────
    if (cmd === '/pov') {
        const validPovs = { first: 'first', '1st': 'first', third: 'third-limited', '3rd': 'third-limited', second: 'second', '2nd': 'second' };
        const pov = validPovs[args.toLowerCase()];
        if (!pov) {
            showToast('Valid POVs: first, third, second', 'warn');
            return { handled: true };
        }
        const povLabels = { first: 'First Person (I)', 'third-limited': 'Third Person', second: 'Second Person (You)' };
        // Apply to active char's override
        const botId = state.activeBotId;
        if (botId) {
            const { setCharOverride } = await import('./state.js');
            setCharOverride(botId, { narrativePOV: pov });
        } else {
            showToast('No active character to apply POV to', 'warn');
            return { handled: true };
        }
        appendSystemMessage(`<span class="cmd-directive"><i data-lucide="book-open"></i> POV switched to <strong>${escHtml(povLabels[pov])}</strong></span>`, { label: 'Directive', raw: true });
        return { handled: true };
    }

    // ── /persona <description> ────────────────────────────────────────────────
    if (cmd === '/persona') {
        if (!args) { showToast('/persona requires a description', 'warn'); return { handled: true }; }
        setConfig({ userPersona: args });
        if (syncConfigUI) syncConfigUI();
        appendSystemMessage(`<span class="cmd-directive"><i data-lucide="user"></i> Your persona updated: <em>${escHtml(args)}</em></span>`, { label: 'Directive', raw: true });
        return { handled: true };
    }

    // ── /remember <fact> ──────────────────────────────────────────────────────
    if (cmd === '/remember') {
        if (!args) { showToast('/remember requires a fact to record', 'warn'); return { handled: true }; }
        const botId = state.activeBotId;
        if (!botId) { showToast('No active character to remember for', 'warn'); return { handled: true }; }
        const { getCharOverride: getCO, setCharOverride: setCO } = await import('./state.js');
        const override = getCO(botId);
        const existing = override.persistentMemory || '';
        const separator = existing.trim() ? '\n' : '';
        setCO(botId, { persistentMemory: existing + separator + `• ${args}` });
        appendSystemMessage(`<span class="cmd-directive"><i data-lucide="bookmark"></i> Remembered: <em>${escHtml(args)}</em></span>`, { label: 'Memory', raw: true });
        return { handled: true };
    }

    // ── /retry ────────────────────────────────────────────────────────────────
    if (cmd === '/retry') {
        const history = state.history;
        // Find last bot message
        const lastBotIdx = [...history].reverse().findIndex(m => m.role === 'bot');
        if (lastBotIdx === -1) { showToast('No bot message to retry', 'warn'); return { handled: true }; }
        const lastBot = history[history.length - 1 - lastBotIdx];
        // Remove it from state
        const { deleteMessage } = await import('./state.js');
        deleteMessage(lastBot.id);
        // Re-trigger bot response for the same bot
        await triggerBotResponse(lastBot.botId || state.activeBotId);
        return { handled: true };
    }

    // ── /summary [n] ─────────────────────────────────────────────────────────
    if (cmd === '/summary') {
        const n = parseInt(args) || 0;
        const history = state.history;
        const msgs = n > 0 ? history.slice(-n * 2) : history;
        if (!msgs.length) { showToast('No history to summarize', 'warn'); return { handled: true }; }

        const apiKey = await import('../../../../glass/script/modules/llm-auth.js')
            .then(m => m.getApiKey()).catch(() => null);
        if (!apiKey) { showToast('API key required for /summary', 'warn'); return { handled: true }; }

        showToast('Generating summary…', 'info', 3000);

        const botId = state.activeBotId;
        const char = botId ? state.loadedCharacters[botId] : null;
        const charName = char ? (getCharOverride(botId).nickname || char.name) : 'the character';

        const transcript = msgs.map(m => {
            const speaker = m.role === 'user'
                ? (state.config.userName || 'User')
                : (m.botId ? (getCharOverride(m.botId).nickname || state.loadedCharacters[m.botId]?.name || charName) : charName);
            return `${speaker}: ${m.content.replace(/<[^>]+>/g, '').slice(0, 600)}`;
        }).join('\n\n');

        const API_BASE = 'https://nano-gpt.com/api/v1';
        try {
            const res = await fetch(`${API_BASE}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: state.config.model || 'deepseek-r1',
                    messages: [
                        { role: 'system', content: `You are a skilled fiction editor. Summarize the following roleplay transcript into a vivid, narrative-form recap. Write in past tense. Capture key emotional beats, plot developments, relationship dynamics, and any decisions or consequences that will affect the story going forward. 3-5 paragraphs. Use prose, not bullet points.` },
                        { role: 'user', content: `Summarize this roleplay:\n\n${transcript}` }
                    ],
                    temperature: 0.4,
                    max_tokens: 600,
                    stream: false
                })
            });
            const data = await res.json();
            const summaryText = data.choices?.[0]?.message?.content?.trim() || 'Could not generate summary.';
            appendSystemMessage(
                `<div class="cmd-summary"><div class="cmd-summary__label"><i data-lucide="book-text"></i> Story So Far</div><div class="cmd-summary__body">${escHtml(summaryText).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</div></div>`,
                { raw: true, label: 'Summary' }
            );
        } catch (err) {
            showToast(`Summary failed: ${err.message}`, 'error');
        }
        return { handled: true };
    }

    // ── /compact ──────────────────────────────────────────────────────────────
    if (cmd === '/compact') {
        const history = state.history;
        if (history.length < 4) { showToast('Need at least 4 messages to compact', 'warn'); return { handled: true }; }

        const apiKey = await import('../../../../glass/script/modules/llm-auth.js')
            .then(m => m.getApiKey()).catch(() => null);
        if (!apiKey) { showToast('API key required for /compact', 'warn'); return { handled: true }; }

        showToast('Compacting history…', 'info', 4000);

        const botId = state.activeBotId;
        const char = botId ? state.loadedCharacters[botId] : null;
        const charName = char ? (getCharOverride(botId).nickname || char.name) : 'the character';
        const userName = state.config.userName || 'User';

        // Keep the last 4 messages verbatim; compress everything before that
        const keepTail = 4;
        const toCompress = history.slice(0, -keepTail);
        const tail = history.slice(-keepTail);

        if (!toCompress.length) { showToast('Nothing to compact yet', 'warn'); return { handled: true }; }

        const transcript = toCompress.map(m => {
            const speaker = m.role === 'user' ? userName
                : (m.botId ? (getCharOverride(m.botId).nickname || state.loadedCharacters[m.botId]?.name || charName) : charName);
            return `${speaker}: ${m.content.replace(/<[^>]+>/g, '').slice(0, 600)}`;
        }).join('\n\n');

        const API_BASE = 'https://nano-gpt.com/api/v1';
        try {
            const res = await fetch(`${API_BASE}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: state.config.model || 'deepseek-r1',
                    messages: [
                        { role: 'system', content: `You are a continuity anchor for an ongoing roleplay. Summarize the following transcript into a compressed narrative memory block. Write in past tense. Include: setting, key events, emotional state of each character, any decisions/consequences that affect what comes next. Keep it under 200 words. Dense but precise — this will be injected as a story anchor for the AI's context.` },
                        { role: 'user', content: transcript }
                    ],
                    temperature: 0.3,
                    max_tokens: 300,
                    stream: false
                })
            });
            const data = await res.json();
            const summary = data.choices?.[0]?.message?.content?.trim();
            if (!summary) throw new Error('Empty response from model');

            // Replace history: anchor message + tail
            const anchorMsg = {
                id: `msg-compact-${Date.now()}`,
                role: 'system',
                content: `[STORY ANCHOR — events before this point]\n${summary}`,
                botId: null,
                timestamp: Date.now(),
                tokens: 0,
                model: '',
                thoughts: null,
                comments: [],
                reactions: {},
                edited: false,
                _isAnchor: true
            };

            state.chat.history = [anchorMsg, ...tail];
            saveState();

            appendSystemMessage(
                `<div class="cmd-compact"><div class="cmd-compact__label"><i data-lucide="archive"></i> History compacted — ${toCompress.length} messages → anchor</div><div class="cmd-compact__preview">${escHtml(summary.slice(0, 200))}${summary.length > 200 ? '…' : ''}</div></div>`,
                { raw: true, label: 'Compact', replaceThread: true }
            );
            return { handled: true };
        } catch (err) {
            showToast(`Compact failed: ${err.message}`, 'error');
            return { handled: true };
        }
    }

    // ── /image [description] ──────────────────────────────────────────────────
    if (cmd === '/image') {
        return { handled: true, action: 'open-image-gen', args };
    }

    // ── Unknown command ────────────────────────────────────────────────────────
    // Only report unknown if it looks intentional (starts with / and has a word)
    if (/^\/[a-z]/.test(cmd)) {
        showToast(`Unknown command: ${cmd}. Type /help for a list.`, 'warn');
        return { handled: true };
    }

    return null;
}

// ── Autocomplete filter ───────────────────────────────────────────────────────
export function filterCommands(partial) {
    if (!partial || !partial.startsWith('/')) return [];
    const q = partial.toLowerCase();
    return COMMANDS.filter(c => c.cmd.startsWith(q));
}

// ── Local HTML escaper (no DOM import needed) ─────────────────────────────────
function escHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
