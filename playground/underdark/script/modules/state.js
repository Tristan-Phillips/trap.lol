/**
 * state.js — The Reality Matrix
 *
 * This module manages the top-level 'Realities' (Workspaces) and the 'Chats'
 * (DMs and Groups) within them. It enables cross-channel memory sharing
 * and isolated continuities.
 */

import { saveAvatar, loadAvatar, deleteAvatar, isDataUrl, saveImageBlob, deleteImageBlob, isIdbImageRef, idbImageRefId, idbGetAllEntries, idbSetBulk } from './storage.js?v=3';

const STORAGE_KEY = 'underdark_v4';
const CHARS_KEY   = 'underdark_chars_v4';

// Legacy keys for migration
const LEGACY_STORAGE_KEY = 'underdark_v3';

// ── Default config shape ────────────────────────────────────────────────────
export function defaultConfig() {
    return {
        model: '',
        contextStrategy: 'sliding',
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

// ── Per-thread config (overrides reality.config for this chat only) ─────────
export function defaultThreadConfig() {
    return {
        // null = inherit from reality.config; set a value to override
        model:            null,
        maxOutput:        null,
        temperature:      null,
        userName:         null,
        userPersona:      null,
        // Thread-scoped world context (layered on top of reality scenario)
        threadScenario:   '',
        // Lorebook overrides: array of lorebook IDs that should always be active for this thread
        // Characters' lorebooks are auto-attached unless autoAttachLorebooks === false
        autoAttachLorebooks: true,
        pinnedLoreBookIds:   [],
        // Thread activity log — array of { id, ts, type, text, editable }
        // types: 'event' | 'message' | 'scene' | 'note'
        log: []
    };
}

// ── Group chat immersion config ──────────────────────────────────────────────
export function defaultGroupConfig() {
    return {
        // What characters see when they recall 1-on-1 DM history
        // 'past'      — explicit past memories (default, existing behaviour)
        // 'faint'     — hazy impressions, déjà vu ("I sense I know you from somewhere…")
        // 'presience' — prophetic flashes, as though they glimpsed the future
        memoryFraming: 'past',

        // Isekai / world-binding answers (set during group creation wizard)
        // Free-form answers to prompted world questions displayed during creation
        isekaiAnswers: {},  // { questionKey: answer }

        // Group intro message override (injected as the *first* system message for the group)
        groupIntro: '',

        // Turn order: 'auto' | 'round-robin' | 'player-driven'
        turnOrder: 'auto',

        // Whether all members acknowledge the same shared world scenario or each interprets it individually
        sharedWorldAwareness: true,

        // Relationship web: sparse map of charId → { knows: [charId], relationType: string }
        // Used to inject inter-character relationship context into prompts
        relationships: {},

        // Optional banner/icon for the group chat (emoji or char initials fallback)
        groupIcon: '',

        // How many DM history messages each character draws as memory
        memoryDepth: 10,

        // Whether characters in this group are aware they are in a group vs 1-on-1
        // 'aware'   — they know there are other people present
        // 'unaware' — they each think they're alone with the user (unreliable narrator mode)
        // 'selective' — each char knows only about the chars listed in their 'knows' relationship
        groupAwareness: 'aware',

        // Voice/tone uniformity: 'distinct' (each char fully their own) | 'harmonised' (slight blending for cohesion)
        voiceMode: 'distinct',

        // Narrative tone config — injected into every character's system context for this thread
        narrativeTone: {
            sexualEnergy: '',   // e.g. "slow burn, unresolved desire"
            toneTags:     '',   // comma-separated tone keywords e.g. "dark,erotic,melancholic"
            amplify:      '',   // e.g. "power dynamics, sensory detail"
            avoid:        '',   // e.g. "gore, fourth-wall breaks"
            pacing:       '',   // e.g. "balanced prose, moderate length"
        },
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
        shareMemory: true,
        activeBotId: botIds[0] || null,
        config: {},
        threadConfig: defaultThreadConfig(),
        groupConfig: type === 'group' ? defaultGroupConfig() : null,
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
        // Merge with on-disk loadedCharacters to preserve writes from other tabs
        // (e.g. wallhaven assigning images). In-memory wins for all fields except
        // extensions.underdark.gallery and videoGallery which are merged additively.
        let mergedLoaded = state.loadedCharacters;
        try {
            const diskRaw = localStorage.getItem(CHARS_KEY);
            if (diskRaw) {
                const diskData = JSON.parse(diskRaw);
                const diskLoaded = diskData.loadedCharacters || {};
                mergedLoaded = { ...diskLoaded };
                Object.entries(state.loadedCharacters).forEach(([id, memChar]) => {
                    const diskChar = diskLoaded[id];
                    if (!diskChar) { mergedLoaded[id] = memChar; return; }
                    // Start from in-memory (authoritative for chat/persona fields)
                    const merged = { ...diskChar, ...memChar };
                    // Additively merge gallery arrays from disk (external writes)
                    const mExt  = memChar?.extensions?.underdark;
                    const dExt  = diskChar?.extensions?.underdark;
                    if (dExt) {
                        if (!merged.extensions)           merged.extensions = {};
                        if (!merged.extensions.underdark) merged.extensions.underdark = {};
                        const mG = mExt?.gallery || [];
                        const dG = dExt.gallery  || [];
                        merged.extensions.underdark.gallery = [...new Set([...mG, ...dG])];
                        const mV = mExt?.videoGallery || [];
                        const dV = dExt.videoGallery  || [];
                        merged.extensions.underdark.videoGallery = [...new Set([...mV, ...dV])];
                    }
                    mergedLoaded[id] = merged;
                });
            }
        } catch { /* ignore — fall back to in-memory */ }
        localStorage.setItem(CHARS_KEY, JSON.stringify({
            characters: state.characters,
            loadedCharacters: mergedLoaded
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
        // Backfill threadConfig for chats created before this feature
        real.chats.forEach(chat => {
            if (!chat.threadConfig) chat.threadConfig = defaultThreadConfig();
            else chat.threadConfig = { ...defaultThreadConfig(), ...chat.threadConfig };
        });
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
    const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const msg = {
        id: msgId,
        role,
        content,
        botId,
        timestamp: Date.now(),
        tokens: meta.tokens || 0,
        model: meta.model || '',
        prompt: meta.prompt || null,
        thoughts: meta.thoughts || null,
        overlordMode: meta.overlordMode || null,
        sceneBreak: meta.sceneBreak ?? (meta.overlordMode ? true : false),
        variants: meta.variants || [],
        variantIdx: meta.variantIdx ?? 0,
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

    // Offload image data URLs to IndexedDB to avoid localStorage quota exhaustion.
    // saveState() is deferred until after the IDB write so the persisted record
    // always contains the idb: ref rather than the raw data URL.
    if (role === 'image' && isDataUrl(content)) {
        saveImageBlob(msgId, content).then(idbRef => {
            msg.content = idbRef;
        }).catch(() => {
            // IDB failed — keep raw data URL in msg.content and fall through to saveState
        }).finally(() => {
            saveState();
        });
        return msg;
    }

    saveState();
    return msg;
}

export async function deleteImageMessage(msgId) {
    const msg = state.chat.history.find(m => m.id === msgId);
    if (msg?.role === 'image' && isIdbImageRef(msg.content)) {
        await deleteImageBlob(idbImageRefId(msg.content)).catch(() => {});
    }
    state.chat.history = state.chat.history.filter(m => m.id !== msgId);
    saveState();
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
export function getBotMemoriesFromReality(botId, currentChatId, limit = 20) {
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

// ── Full Instance Export / Import ─────────────────────────────────────────────
// Exports everything: all realities, all chats, all characters, all IDB blobs
// (avatars, gallery images, chat image messages). API keys are never included.

export async function exportFullInstance() {
    const idbBlobs = await idbGetAllEntries().catch(() => ({}));
    const payload = {
        version:        'underdark_full_v1',
        exportedAt:     new Date().toISOString(),
        realities:      state.realities,
        activeRealityId: state.activeRealityId,
        characters:     state.characters,
        loadedCharacters: state.loadedCharacters,
        socialData:     state.socialData,
        telemetry:      state.telemetry,
        idb:            idbBlobs,
    };
    return JSON.stringify(payload);
}

export async function importFullInstance(jsonString) {
    const data = JSON.parse(jsonString);
    if (data.version !== 'underdark_full_v1') throw new Error('Unrecognised export format. Expected underdark_full_v1.');

    // Restore IDB blobs first (avatars, images) — must complete before UI loads characters
    if (data.idb && Object.keys(data.idb).length) {
        await idbSetBulk(data.idb).catch(e => console.warn('[import] IDB restore partial:', e));
    }

    // Restore state
    state.realities         = data.realities     || [];
    state.activeRealityId   = data.activeRealityId || null;
    state.characters        = data.characters    || [];
    state.loadedCharacters  = data.loadedCharacters || {};
    state.socialData        = data.socialData    || {};
    state.telemetry         = data.telemetry     || { turns: 0, totalTokens: 0, sessionTokens: 0 };

    // Sanitize — same logic as loadState post-load
    if (!state.realities.length) {
        const real = createReality('Continuity Alpha');
        state.realities.push(real);
    }
    state.realities.forEach(real => {
        if (!real.chats.length) real.chats.push(createChat('dm', [], 'New Message'));
        if (!real.activeChatId || !real.chats.find(c => c.id === real.activeChatId)) {
            real.activeChatId = real.chats[0].id;
        }
        const saved = real.config || {};
        real.config = { ...defaultConfig(), ...saved };
        real.config.flags = { ...defaultConfig().flags, ...(saved.flags || {}) };
        real.chats.forEach(chat => {
            if (!chat.threadConfig) chat.threadConfig = defaultThreadConfig();
            else chat.threadConfig = { ...defaultThreadConfig(), ...chat.threadConfig };
        });
    });
    if (!state.activeRealityId || !state.realities.find(r => r.id === state.activeRealityId)) {
        state.activeRealityId = state.realities[0].id;
    }

    saveState();
}

// ── Cross-tab sync — merge loadedCharacters written by wallhaven or other tabs ──
window.addEventListener('storage', e => {
    if (e.key !== CHARS_KEY || !e.newValue) return;
    try {
        const incoming = JSON.parse(e.newValue);
        if (!incoming?.loadedCharacters) return;
        // Deep-merge each incoming loadedCharacters entry so we don't lose
        // fields that underdark holds in memory (name, persona, etc.)
        Object.entries(incoming.loadedCharacters).forEach(([id, inChar]) => {
            if (!state.loadedCharacters[id]) {
                state.loadedCharacters[id] = inChar;
                return;
            }
            const local = state.loadedCharacters[id];
            if (!inChar?.extensions?.underdark) return;
            if (!local.extensions)           local.extensions = {};
            if (!local.extensions.underdark) local.extensions.underdark = {};
            const inExt = inChar.extensions.underdark;
            const lExt  = local.extensions.underdark;
            if (Array.isArray(inExt.gallery)) {
                if (!Array.isArray(lExt.gallery)) lExt.gallery = [];
                inExt.gallery.forEach(url => { if (!lExt.gallery.includes(url)) lExt.gallery.push(url); });
            }
            if (Array.isArray(inExt.videoGallery)) {
                if (!Array.isArray(lExt.videoGallery)) lExt.videoGallery = [];
                inExt.videoGallery.forEach(url => { if (!lExt.videoGallery.includes(url)) lExt.videoGallery.push(url); });
            }
            if (inExt.galleryMeta) Object.assign(lExt.galleryMeta || (lExt.galleryMeta = {}), inExt.galleryMeta);
        });
    } catch { /* ignore parse errors */ }
});
