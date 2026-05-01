/**
 * state.js — Central application state with full localStorage persistence.
 * All mutations go through exported helpers so persistence stays consistent.
 */

const STORAGE_KEY = 'underdark_v3';
const SESSION_KEY = 'underdark_sessions_v3';
const CHARS_KEY   = 'underdark_chars_v3';

// ── Default config shape ────────────────────────────────────────────────────
export function defaultConfig() {
    return {
        model: '',
        contextStrategy: 'sliding',
        temperature: 0.80,
        topP: 0.95,
        topK: 40,
        minP: 0.05,
        typicalP: 1.0,
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
        groupTurnMode: 'auto',    // 'auto' | 'manual' | 'round-robin'
        groupAutoDelay: 600,      // ms between auto responses in group chat
        userName: 'User',
        userPersona: '',
        charOverrides: {},        // keyed by charId → object of override fields
        // ── Narrative feature flags ───────────────────────────────────────────
        flags: {
            showThoughts:        false,  // render <think>…</think> as visible aside
            showSystemPrompt:    false,  // show the built system prompt in chat for debugging
            injectConsistency:   true,   // append "stay in character" reinforcement paragraph
            injectSliders:       true,   // inject behavioral slider directives into system prompt
            injectAppearance:    true,   // inject physical appearance anchors
            injectAdult:         true,   // inject adult anatomy anchors
            injectPersonality:   true,   // inject personality/psychology fields from ext
            injectVoice:         true,   // inject voice/speech fields from ext
            injectStyle:         true,   // inject fashion/style fields from ext
            injectAIDirectives:  true,   // inject AI panel (prose style, POV, length) directives
            impersonationBlock:  true,   // instruct model never to speak as the user
            jailbreakResistance: false,  // add anti-jailbreak reminder to post-history
            povFirst:            true,   // prefer first-person narrative
        }
    };
}

// ── Character override shape (the "everything" config) ──────────────────────
export function defaultCharOverride() {
    return {
        // Identity
        nickname: '',
        voiceTone: '',           // e.g. "husky, low, measured"
        speechPatterns: '',      // e.g. "speaks in short sentences, uses slang"
        // Appearance (physical anchors for consistency)
        species: '',
        gender: '',
        age: '',
        height: '',
        bodyType: '',
        skinTone: '',
        hairColor: '',
        hairStyle: '',
        eyeColor: '',
        distinctiveFeatures: '', // scars, tattoos, etc.
        // NSFW / Adult appearance fields
        breastSize: '',
        nippleColor: '',
        areolaeSize: '',
        bodyHair: '',
        genitalia: '',
        otherAdultFeatures: '',
        // Behavioral
        dominanceLevel: 50,      // 0=submissive, 100=dominant
        explicitnessLevel: 50,   // 0=fade-to-black, 100=explicit
        romanticismLevel: 50,
        violenceLevel: 30,
        // Model override for this specific character
        modelOverride: '',
        systemPromptOverride: '',
        postHistoryOverride: '',
        // Persona injection mode
        appendToSystem: '',      // freeform appended to system prompt
        enabled: true
    };
}

// ── Session shape ────────────────────────────────────────────────────────────
export function createSession(name = 'New Thread') {
    return {
        id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        activeBotIds: [],
        activeBotId: null,
        history: [],
        lorebooks: [],
        config: defaultConfig()
    };
}

// ── Master state ─────────────────────────────────────────────────────────────
export const state = {
    // Persisted across sessions
    characters: [],          // roster metadata [{id,name,tagline,avatar_path,card_path,tags}]
    loadedCharacters: {},    // full card data keyed by id
    sessions: [],            // array of session objects
    activeSessionId: null,

    // Current session shortcut (always mirrors sessions[activeIdx])
    get session() {
        return this.sessions.find(s => s.id === this.activeSessionId) || this.sessions[0];
    },
    get history()    { return this.session?.history    ?? []; },
    get lorebooks()  { return this.session?.lorebooks  ?? []; },
    get config()     { return this.session?.config     ?? defaultConfig(); },
    get activeBotId(){ return this.session?.activeBotId ?? null; },
    get activeBotIds(){ return this.session?.activeBotIds ?? []; },

    // Volatile UI state
    isStreaming: false,
    pendingAbort: null,      // AbortController for current stream
    telemetry: { turns: 0, totalTokens: 0, sessionTokens: 0 }
};

// ── Persistence ──────────────────────────────────────────────────────────────
export function saveState() {
    try {
        const payload = {
            sessions: state.sessions,
            activeSessionId: state.activeSessionId,
            telemetry: state.telemetry
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        // Characters stored separately (can be large)
        localStorage.setItem(CHARS_KEY, JSON.stringify({
            characters: state.characters,
            loadedCharacters: state.loadedCharacters
        }));
    } catch (e) {
        console.warn('[state] Save failed (quota?):', e);
    }
}

export function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            state.sessions = data.sessions || [];
            state.activeSessionId = data.activeSessionId || null;
            state.telemetry = data.telemetry || { turns: 0, totalTokens: 0, sessionTokens: 0 };
        }
        const chars = localStorage.getItem(CHARS_KEY);
        if (chars) {
            const data = JSON.parse(chars);
            state.characters = data.characters || [];
            state.loadedCharacters = data.loadedCharacters || {};
        }
    } catch (e) {
        console.warn('[state] Load failed:', e);
    }

    // Ensure at least one session exists
    if (!state.sessions.length) {
        const sess = createSession('Thread #1');
        state.sessions.push(sess);
        state.activeSessionId = sess.id;
    } else if (!state.activeSessionId || !state.sessions.find(s => s.id === state.activeSessionId)) {
        state.activeSessionId = state.sessions[0].id;
    }

    // Migrate: ensure each session has full config with new keys
    state.sessions.forEach(sess => {
        sess.config = { ...defaultConfig(), ...sess.config };
    });
}

// ── Session helpers ──────────────────────────────────────────────────────────
export function newSession(name) {
    const sess = createSession(name);
    state.sessions.push(sess);
    state.activeSessionId = sess.id;
    saveState();
    return sess;
}

export function switchSession(id) {
    if (state.sessions.find(s => s.id === id)) {
        state.activeSessionId = id;
        saveState();
    }
}

export function deleteSession(id) {
    state.sessions = state.sessions.filter(s => s.id !== id);
    if (!state.sessions.length) {
        const sess = createSession('Thread #1');
        state.sessions.push(sess);
    }
    if (state.activeSessionId === id || !state.sessions.find(s => s.id === state.activeSessionId)) {
        state.activeSessionId = state.sessions[0].id;
    }
    saveState();
}

export function renameSession(id, name) {
    const s = state.sessions.find(s => s.id === id);
    if (s) { s.name = name; saveState(); }
}

// ── Message helpers ──────────────────────────────────────────────────────────
export function addMessage(role, content, botId = null, meta = {}) {
    const msg = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role,
        content,
        botId,
        timestamp: Date.now(),
        tokens: meta.tokens || 0,
        model: meta.model || '',
        edited: false
    };
    state.session.history.push(msg);
    state.session.updatedAt = Date.now();

    // Telemetry
    if (role === 'user') state.telemetry.turns++;
    state.telemetry.totalTokens += msg.tokens;
    state.telemetry.sessionTokens += msg.tokens;

    saveState();
    return msg;
}

export function editMessage(msgId, newContent) {
    const msg = state.session.history.find(m => m.id === msgId);
    if (msg) { msg.content = newContent; msg.edited = true; saveState(); }
}

export function deleteMessage(msgId) {
    state.session.history = state.session.history.filter(m => m.id !== msgId);
    saveState();
}

export function clearHistory() {
    state.session.history = [];
    state.telemetry.sessionTokens = 0;
    saveState();
}

// ── Bot helpers ──────────────────────────────────────────────────────────────
export function setActiveBot(id) {
    state.session.activeBotId = id;
    if (!state.session.activeBotIds.includes(id)) {
        state.session.activeBotIds.push(id);
    }
    saveState();
}

export function removeBotFromSession(id) {
    state.session.activeBotIds = state.session.activeBotIds.filter(b => b !== id);
    if (state.session.activeBotId === id) {
        state.session.activeBotId = state.session.activeBotIds[0] || null;
    }
    saveState();
}

// ── Character override helpers ───────────────────────────────────────────────
export function getCharOverride(charId) {
    const overrides = state.config.charOverrides || {};
    return { ...defaultCharOverride(), ...(overrides[charId] || {}) };
}

export function setCharOverride(charId, fields) {
    if (!state.config.charOverrides) state.config.charOverrides = {};
    state.config.charOverrides[charId] = {
        ...(state.config.charOverrides[charId] || defaultCharOverride()),
        ...fields
    };
    saveState();
}

// ── Config helpers ────────────────────────────────────────────────────────────
export function setConfig(fields) {
    Object.assign(state.session.config, fields);
    saveState();
}

// ── Character storage helpers ────────────────────────────────────────────────
export function saveCharacter(meta, card) {
    const existing = state.characters.findIndex(c => c.id === meta.id);
    if (existing >= 0) {
        state.characters[existing] = meta;
    } else {
        state.characters.push(meta);
    }
    state.loadedCharacters[meta.id] = card;
    saveState();
}

export function deleteCharacter(id) {
    state.characters = state.characters.filter(c => c.id !== id);
    delete state.loadedCharacters[id];
    // Remove from all sessions
    state.sessions.forEach(sess => {
        sess.activeBotIds = sess.activeBotIds.filter(b => b !== id);
        if (sess.activeBotId === id) sess.activeBotId = sess.activeBotIds[0] || null;
    });
    saveState();
}
