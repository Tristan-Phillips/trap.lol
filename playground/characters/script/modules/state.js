/**
 * state.js — The Reality Matrix
 *
 * This module manages the top-level 'Realities' (Workspaces) and the 'Chats'
 * (DMs and Groups) within them. It enables cross-channel memory sharing
 * and isolated continuities.
 */

import { saveAvatar, loadAvatar, deleteAvatar, isDataUrl } from './storage.js';

const STORAGE_KEY = 'underdark_v4';
const CHARS_KEY   = 'underdark_chars_v4';

// Legacy keys for migration
const LEGACY_STORAGE_KEY = 'underdark_v3';

// ── Default config shape ────────────────────────────────────────────────────
export function defaultConfig() {
    return {
        model: '',
        contextStrategy: 'sliding',
        groupScenario: '', // Shared context for all chats in a reality
        temperature: 0.80,
        topP: 0.95,
        topK: 40,
        minP: 0.05,
        repetitionPenalty: 1.10,
        presencePenalty: 0,
        frequencyPenalty: 0,
        sysDirective: '',
        authorsNote: '',
        authorsNoteDepth: 4,
        nsfwBypass: '',
        maxContext: 8192,
        maxOutput: 512,
        stream: true,
        lorebookScanDepth: 5,
        groupTurnMode: 'manual',
        groupAutoDelay: 600,
        userName: 'User',
        userPersona: '',
        charOverrides: {},
        flags: {
            showThoughts:        false,
            showSystemPrompt:    false,
            injectConsistency:   true,
            injectSliders:       true,
            injectAppearance:    true,
            injectAdult:         true,
            injectPersonality:   true,
            injectVoice:         true,
            injectStyle:         true,
            injectAIDirectives:  true,
            impersonationBlock:  true,
            jailbreakResistance: false,
            povFirst:            true,
        }
    };
}

export function defaultCharOverride() {
    return {
        nickname: '',
        voiceTone: '',
        speechPatterns: '',
        species: '',
        gender: '',
        age: '',
        height: '',
        bodyType: '',
        skinTone: '',
        hairColor: '',
        hairStyle: '',
        eyeColor: '',
        distinctiveFeatures: '',
        breastSize: '',
        nippleColor: '',
        areolaeSize: '',
        bodyHair: '',
        genitalia: '',
        otherAdultFeatures: '',
        dominanceLevel: 50,
        explicitnessLevel: 50,
        romanticismLevel: 50,
        violenceLevel: 30,
        modelOverride: '',
        systemPromptOverride: '',
        postHistoryOverride: '',
        appendToSystem: '',
        persistentMemory: '',
        enabled: true
    };
}

// ── Chat & Reality shapes ────────────────────────────────────────────────────

export function createChat(type = 'dm', botIds = [], name = '') {
    const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    return {
        id,
        type, // 'dm' | 'group'
        name: name || (type === 'dm' ? 'Direct Message' : 'New Group'),
        botIds,
        history: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        shareMemory: true, // If true, other chats in the reality are context-accessible
        activeBotId: botIds[0] || null,
        config: {} // Optional chat-specific overrides if needed later
    };
}

export function createReality(name = 'New Reality') {
    const id = `real-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return {
        id,
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        worldConfig: {
            scenario: '', // The overarching Isekai/World rules
            activeLorebooks: [] // IDs of lorebooks enabled in this reality
        },
        chats: [],
        activeChatId: null,
        config: defaultConfig()
    };
}

// ── Master state ─────────────────────────────────────────────────────────────
export const state = {
    characters: [],
    loadedCharacters: {},
    realities: [],
    activeRealityId: null,
    socialData: {}, // { charId: { postIdx: [ { role, content, timestamp } ] } }

    get reality() {
        return this.realities.find(r => r.id === this.activeRealityId) || this.realities[0];
    },
    get chat() {
        const r = this.reality;
        if (!r) return null;
        return r.chats.find(c => c.id === r.activeChatId) || r.chats[0];
    },
    get session() { return this.chat; },

    // Proxies for legacy/direct access
    get history()     { return this.chat?.history ?? []; },
    get lorebooks()   { return this.reality?.worldConfig.activeLorebooks ?? []; },
    get config()      { return this.reality?.config ?? defaultConfig(); },
    get activeBotId() { return this.chat?.activeBotId ?? null; },
    get activeBotIds(){ return this.chat?.botIds ?? []; },

    isStreaming: false,
    pendingAbort: null,
    telemetry: { turns: 0, totalTokens: 0, sessionTokens: 0 }
};

// ── Persistence & Migration ──────────────────────────────────────────────────

export function saveState() {
    try {
        const payload = {
            realities: state.realities,
            activeRealityId: state.activeRealityId,
            telemetry: state.telemetry,
            socialData: state.socialData
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        localStorage.setItem(CHARS_KEY, JSON.stringify({
            characters: state.characters,
            loadedCharacters: state.loadedCharacters
        }));
    } catch (e) {
        console.warn('[state] Save failed:', e);
    }
}

export function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            state.realities = data.realities || [];
            state.activeRealityId = data.activeRealityId || null;
            state.telemetry = data.telemetry || { turns: 0, totalTokens: 0, sessionTokens: 0 };
            state.socialData = data.socialData || {};
        } else {
            // Check for v3 legacy data
            const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
            if (legacyRaw) {
                console.log('[state] Migrating from v3 Reality structure...');
                const legacy = JSON.parse(legacyRaw);
                const legacyReality = createReality('Legacy Reality');
                (legacy.sessions || []).forEach(sess => {
                    const type = (sess.activeBotIds?.length > 1) ? 'group' : 'dm';
                    const chat = createChat(type, sess.activeBotIds || [], sess.name);
                    chat.history = sess.history || [];
                    chat.activeBotId = sess.activeBotId;
                    legacyReality.chats.push(chat);
                });
                legacyReality.config = { ...legacyReality.config, ...(legacy.config || {}) };
                state.realities.push(legacyReality);
                state.activeRealityId = legacyReality.id;
                legacyReality.activeChatId = legacyReality.chats[0]?.id || null;
                // Move telemetry
                state.telemetry = legacy.telemetry || state.telemetry;
            }
        }

        const chars = localStorage.getItem(CHARS_KEY) || localStorage.getItem('underdark_chars_v3');
        if (chars) {
            const data = JSON.parse(chars);
            state.characters = data.characters || [];
            state.loadedCharacters = data.loadedCharacters || {};
        }
    } catch (e) {
        console.warn('[state] Load failed:', e);
    }

    // Ensure at least one reality exists
    if (!state.realities.length) {
        const real = createReality('Continuity Alpha');
        state.realities.push(real);
        state.activeRealityId = real.id;
    }

    // Sanitize and ensure active IDs
    state.realities.forEach(real => {
        if (!real.chats.length) {
            const chat = createChat('dm', [], 'New Message');
            real.chats.push(chat);
        }
        if (!real.activeChatId || !real.chats.find(c => c.id === real.activeChatId)) {
            real.activeChatId = real.chats[0].id;
        }
        // Sync configs
        const saved = real.config || {};
        real.config = { ...defaultConfig(), ...saved };
        real.config.flags = { ...defaultConfig().flags, ...(saved.flags || {}) };
    });

    if (!state.activeRealityId || !state.realities.find(r => r.id === state.activeRealityId)) {
        state.activeRealityId = state.realities[0].id;
    }
}

// ── Reality Helpers ──────────────────────────────────────────────────────────

export function newReality(name) {
    const real = createReality(name);
    state.realities.push(real);
    state.activeRealityId = real.id;
    saveState();
    return real;
}

export function switchReality(id) {
    if (state.realities.find(r => r.id === id)) {
        state.activeRealityId = id;
        saveState();
    }
}

export function deleteReality(id) {
    state.realities = state.realities.filter(r => r.id !== id);
    if (!state.realities.length) {
        const real = createReality('Continuity Alpha');
        state.realities.push(real);
    }
    if (state.activeRealityId === id || !state.realities.find(r => r.id === state.activeRealityId)) {
        state.activeRealityId = state.realities[0].id;
    }
    saveState();
}

// ── Chat Helpers ─────────────────────────────────────────────────────────────

export function newChat(type, botIds, name) {
    const chat = createChat(type, botIds, name);
    state.reality.chats.unshift(chat); // Newest at top
    state.reality.activeChatId = chat.id;
    saveState();
    return chat;
}

export function switchChat(id) {
    if (state.reality.chats.find(c => c.id === id)) {
        state.reality.activeChatId = id;
        saveState();
    }
}

export function deleteChat(id) {
    state.reality.chats = state.reality.chats.filter(c => c.id !== id);
    if (!state.reality.chats.length) {
        const chat = createChat('dm', [], 'New Message');
        state.reality.chats.push(chat);
    }
    if (state.reality.activeChatId === id || !state.reality.chats.find(c => c.id === state.reality.activeChatId)) {
        state.reality.activeChatId = state.reality.chats[0].id;
    }
    saveState();
}

export function renameChat(id, name) {
    const c = state.reality.chats.find(c => c.id === id);
    if (c) { c.name = name; saveState(); }
}

// ── Message Helpers ──────────────────────────────────────────────────────────

export function addMessage(role, content, botId = null, meta = {}) {
    const msg = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role,
        content,
        botId,
        timestamp: Date.now(),
        tokens: meta.tokens || 0,
        model: meta.model || '',
        prompt: meta.prompt || null,
        thoughts: meta.thoughts || null,
        comments: [],
        reactions: {},
        edited: false
    };
    state.chat.history.push(msg);
    state.chat.updatedAt = Date.now();
    state.reality.updatedAt = Date.now();

    // Auto-name
    if (role === 'user' && state.chat.history.filter(m => m.role === 'user').length === 1) {
        const isDefault = /^New\s*(Message|Group)$/.test(state.chat.name);
        if (isDefault) {
            const excerpt = content.replace(/\s+/g, ' ').trim().slice(0, 42);
            state.chat.name = excerpt.length < content.trim().length ? excerpt + '…' : excerpt;
        }
    }

    if (role === 'user') state.telemetry.turns++;
    state.telemetry.totalTokens += msg.tokens;
    state.telemetry.sessionTokens += msg.tokens;

    saveState();
    return msg;
}

export function editMessage(msgId, newContent) {
    const msg = state.chat.history.find(m => m.id === msgId);
    if (msg) { msg.content = newContent; msg.edited = true; saveState(); }
}

export function deleteMessage(msgId) {
    state.chat.history = state.chat.history.filter(m => m.id !== msgId);
    saveState();
}

export function addComment(msgId, text) {
    const msg = state.chat.history.find(m => m.id === msgId);
    if (!msg) return null;
    if (!msg.comments) msg.comments = [];
    const comment = {
        id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        text,
        timestamp: Date.now()
    };
    msg.comments.push(comment);
    saveState();
    return comment;
}

export function deleteComment(msgId, commentId) {
    const msg = state.chat.history.find(m => m.id === msgId);
    if (!msg?.comments) return;
    msg.comments = msg.comments.filter(c => c.id !== commentId);
    saveState();
}

export function clearHistory() {
    state.chat.history = [];
    state.telemetry.sessionTokens = 0;
    saveState();
}

// ── Bot Helpers ──────────────────────────────────────────────────────────────

export function setActiveBot(id) {
    state.chat.activeBotId = id;
    if (!state.chat.botIds.includes(id)) {
        state.chat.botIds.push(id);
    }
    saveState();
}

export function removeBotFromChat(id) {
    state.chat.botIds = state.chat.botIds.filter(b => b !== id);
    if (state.chat.activeBotId === id) {
        state.chat.activeBotId = state.chat.botIds[0] || null;
    }
    saveState();
}

// ── Shared Memory Synapse Logic ──────────────────────────────────────────────

/**
 * Returns a collection of history entries from other chats in this reality
 * for a specific bot. This is the "past memory" injected into the prompt.
 */
export function getBotMemoriesFromReality(botId, currentChatId, limit = 10) {
    const memories = [];
    state.reality.chats.forEach(c => {
        if (c.id === currentChatId) return; // Skip current
        if (!c.botIds.includes(botId)) return; // Bot must be present

        // Grab relevant history
        const relevant = c.history.filter(m => m.content && (m.botId === botId || m.role === 'user'));
        relevant.slice(-limit).forEach(m => {
            memories.push({
                ...m,
                chatName: c.name,
                isGroup: c.type === 'group'
            });
        });
    });
    // Sort by timestamp
    return memories.sort((a, b) => a.timestamp - b.timestamp);
}

// ── Standard Character & Config Helpers (Proxied) ─────────────────────────────

export function getCharOverride(charId) {
    const overrides = state.config.charOverrides || {};
    const saved     = overrides[charId] || {};
    const { ext, _userEdits, ...rest } = saved;
    return { ...defaultCharOverride(), ...rest, ...(ext || {}) };
}

export function setCharOverride(charId, fields) {
    if (!state.config.charOverrides) state.config.charOverrides = {};
    const existing = state.config.charOverrides[charId] || {};
    const mergedExt = { ...(existing.ext || {}), ...(fields.ext || {}) };
    state.config.charOverrides[charId] = { ...existing, ...fields, ext: mergedExt };
    saveState();
}

export function setConfig(fields) {
    Object.assign(state.reality.config, fields);
    saveState();
}

export async function saveCharacter(meta, card) {
    let avatarToStore = meta.avatar_path || card.avatar || null;
    if (avatarToStore && isDataUrl(avatarToStore)) {
        await saveAvatar(meta.id, avatarToStore).catch(() => {});
        avatarToStore = `idb:${meta.id}`;
        meta = { ...meta, avatar_path: avatarToStore };
        card = { ...card, avatar: avatarToStore };
    }
    const existing = state.characters.findIndex(c => c.id === meta.id);
    if (existing >= 0) state.characters[existing] = meta;
    else state.characters.push(meta);
    state.loadedCharacters[meta.id] = card;
    saveState();
}

export async function deleteCharacter(id) {
    await deleteAvatar(id).catch(() => {});
    state.characters = state.characters.filter(c => c.id !== id);
    delete state.loadedCharacters[id];
    saveState();
}

// ── Standard Helpers ──────────────────────────────────────────────────────────

export async function resolveCharAvatar(charId, stored) {
    if (!stored) return null;
    if (stored === `idb:${charId}` || stored.startsWith('idb:')) {
        return loadAvatar(charId).catch(() => null);
    }
    return stored;
}

export function addReaction(msgId, emoji) {
    const msg = state.chat.history.find(m => m.id === msgId);
    if (!msg) return;
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    if (!msg.reactions[emoji].includes('user')) {
        msg.reactions[emoji].push('user');
    } else {
        // Toggle off
        msg.reactions[emoji] = msg.reactions[emoji].filter(r => r !== 'user');
        if (!msg.reactions[emoji].length) delete msg.reactions[emoji];
    }
    saveState();
}

export function getReactions(msgId) {
    const msg = state.chat.history.find(m => m.id === msgId);
    return msg?.reactions || {};
}

export function exportSessionJson(chatId) {
    const chat = state.reality.chats.find(c => c.id === chatId) || state.chat;
    const chars = {};
    (chat.botIds || []).forEach(id => {
        if (state.loadedCharacters[id]) chars[id] = state.loadedCharacters[id];
    });
    return JSON.stringify({ version: 'underdark_reality_chat_v1', chat, characters: chars }, null, 2);
}

export async function importSessionJson(jsonString) {
    const data = JSON.parse(jsonString);
    const chat = data.chat || data.session;
    if (!chat) throw new Error('Invalid import format');
    
    chat.id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    chat.name = `${chat.name} (imported)`;
    state.reality.chats.unshift(chat);
    state.reality.activeChatId = chat.id;

    if (data.characters) {
        Object.entries(data.characters).forEach(([id, card]) => {
            if (!state.loadedCharacters[id]) {
                state.loadedCharacters[id] = card;
                if (!state.characters.find(c => c.id === id)) {
                    state.characters.push({ id, name: card.name || id, tagline: 'Imported', avatar_path: card.avatar || null, tags: card.tags || [] });
                }
            }
        });
    }
    saveState();
    return chat;
}
