/**
 * state.js
 * Application state for the Underdark interface.
 */

export const state = {
    characters: [],      // Manifest data
    loadedCharacters: {}, // Full V2 data keyed by ID
    activeBotIds: [],    // IDs of bots in the current thread
    activeBotId: null,   // Currently selected bot for profile view
    history: [],         // Chat history
    lorebooks: [],       // Active lorebooks
    config: {
        model: '',
        contextStrategy: 'truncate',
        temperature: 0.8,
        topP: 0.95,
        topK: 40,
        repetitionPenalty: 1.1,
        presencePenalty: 0,
        frequencyPenalty: 0,
        sysDirective: '',
        authorsNote: '',
        nsfwBypass: '',
        maxContext: 8192,
        maxOutput: 512,
        stream: true
    }
};

export function addMessage(role, content, botId = null) {
    state.history.push({
        role,
        content,
        botId,
        timestamp: Date.now()
    });
}

export function setActiveBot(id) {
    state.activeBotId = id;
    if (!state.activeBotIds.includes(id)) {
        state.activeBotIds.push(id);
    }
}
