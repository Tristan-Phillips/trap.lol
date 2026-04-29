/**
 * llm-engine.js — LLM payload construction and streaming.
 * Supports: sliding window / summarize context strategies,
 * per-character model overrides, post_history_instructions,
 * multi-bot message labeling, character physical anchors.
 */

import { getApiKey } from '../../../../glass/script/modules/llm-auth.js';
import { scanLorebooks } from './lorebook.js';
import { getCharOverride } from './state.js';

const API_BASE = 'https://nano-gpt.com/api/v1';

// ── Rough token estimator (4 chars ≈ 1 token) ────────────────────────────────
function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
}

// ── Build appearance/override injection string ────────────────────────────────
function buildOverrideBlock(override, charName) {
    const lines = [];

    const addLine = (label, val) => { if (val && String(val).trim()) lines.push(`${label}: ${val}`); };

    // Identity anchors
    addLine('Voice & Tone',      override.voiceTone);
    addLine('Speech Patterns',   override.speechPatterns);

    // Appearance anchors
    const appearance = [
        override.species, override.gender, override.age ? `age ${override.age}` : '',
        override.height, override.bodyType, override.skinTone,
        override.hairColor ? `${override.hairColor} ${override.hairStyle || ''}`.trim() : '',
        override.eyeColor ? `${override.eyeColor} eyes` : '',
        override.distinctiveFeatures
    ].filter(Boolean);
    if (appearance.length) lines.push(`${charName}'s Appearance: ${appearance.join(', ')}`);

    // Adult appearance anchors (only if any are set)
    const adult = [
        override.breastSize    ? `breast size ${override.breastSize}` : '',
        override.areolaeSize   ? `areolae ${override.areolaeSize}` : '',
        override.nippleColor   ? `nipple color ${override.nippleColor}` : '',
        override.bodyHair      ? `body hair ${override.bodyHair}` : '',
        override.genitalia     ? override.genitalia : '',
        override.otherAdultFeatures
    ].filter(Boolean);
    if (adult.length) lines.push(`${charName}'s Physical Details: ${adult.join(', ')}`);

    // Behavioral sliders as directives
    if (override.dominanceLevel !== undefined) {
        const dom = override.dominanceLevel;
        if (dom <= 20)       lines.push(`${charName} is deeply submissive.`);
        else if (dom >= 80)  lines.push(`${charName} is strongly dominant.`);
    }
    if (override.explicitnessLevel !== undefined) {
        const ex = override.explicitnessLevel;
        if (ex <= 20)        lines.push(`Keep all content tasteful and non-explicit.`);
        else if (ex >= 80)   lines.push(`Explicit sexual content is permitted and expected.`);
    }
    if (override.violenceLevel !== undefined) {
        const vl = override.violenceLevel;
        if (vl >= 80)        lines.push(`Graphic violence is permitted.`);
    }

    addLine(`${charName}'s Additional Notes`, override.appendToSystem);

    return lines.length ? `\n\n[Character Anchors for ${charName}]\n${lines.join('\n')}` : '';
}

// ── System prompt builder ─────────────────────────────────────────────────────
function buildSystemPrompt(character, config, override) {
    const userName = config.userName || 'User';

    // Custom override wins
    if (override.systemPromptOverride) {
        return override.systemPromptOverride
            .replace(/\{\{char\}\}/gi, override.nickname || character.name)
            .replace(/\{\{user\}\}/gi, userName)
            + buildOverrideBlock(override, override.nickname || character.name);
    }

    // Character's own system prompt + fallback template
    const charName = override.nickname || character.name;
    let base = config.sysDirective
        || character.system_prompt
        || `Write ${charName}'s next reply in a fictional roleplay between ${charName} and ${userName}.\nStay in character at all times. Be vivid and use sensory details.`;

    base = base
        .replace(/\{\{char\}\}/gi, charName)
        .replace(/\{\{user\}\}/gi, userName);

    const sections = [base];

    if (character.description) sections.push(`Character Persona:\n${character.description}`);
    if (character.personality)  sections.push(`Personality: ${character.personality}`);
    if (character.scenario)     sections.push(`Scenario: ${character.scenario}`);
    if (config.userPersona)     sections.push(`About ${userName}: ${config.userPersona}`);

    sections.push(buildOverrideBlock(override, charName));

    if (config.nsfwBypass) sections.push(config.nsfwBypass);

    return sections.filter(Boolean).join('\n\n');
}

// ── Context window management ─────────────────────────────────────────────────
function applyContextStrategy(history, config, systemTokens) {
    const strategy  = config.contextStrategy || 'sliding';
    const budget    = (config.maxContext || 8192) - systemTokens - (config.maxOutput || 512) - 64;
    if (budget <= 0) return history.slice(-2);

    if (strategy === 'truncate') {
        // Keep newest messages that fit in budget
        let tokens = 0;
        const result = [];
        for (let i = history.length - 1; i >= 0; i--) {
            const t = estimateTokens(history[i].content) + 8;
            if (tokens + t > budget) break;
            tokens += t;
            result.unshift(history[i]);
        }
        return result;
    }

    if (strategy === 'sliding') {
        // Like truncate but always keeps first message (first_mes context)
        let tokens = 0;
        const result = [];
        for (let i = history.length - 1; i >= 0; i--) {
            const t = estimateTokens(history[i].content) + 8;
            if (tokens + t > budget && result.length) break;
            tokens += t;
            result.unshift(history[i]);
        }
        return result;
    }

    // 'summarize' — placeholder: falls back to sliding until summary engine added
    return applyContextStrategy(history, { ...config, contextStrategy: 'sliding' }, systemTokens);
}

// ── Main payload builder ──────────────────────────────────────────────────────
export function buildPayload(ctx) {
    const { character, history, lore, config, isGroup = false, allChars = [] } = ctx;
    const override  = getCharOverride(character.id || character.name);
    const charName  = override.nickname || character.name;
    const userName  = config.userName || 'User';
    const messages  = [];

    // 1. System prompt
    const systemContent = buildSystemPrompt(character, config, override);
    messages.push({ role: 'system', content: systemContent });

    // 2. Lorebook injection
    const activeLore = scanLorebooks(history, lore, config.lorebookScanDepth || 5);
    if (activeLore.length) {
        const loreBlock = activeLore
            .map(e => `[World Info — ${e.name}]\n${e.content}`)
            .join('\n\n');
        messages.push({ role: 'system', content: loreBlock });
    }

    // 3. Context-windowed history
    const systemTokens = estimateTokens(systemContent) + (activeLore.length ? estimateTokens(activeLore.map(e => e.content).join('')) : 0);
    const contextHistory = applyContextStrategy(history, config, systemTokens);

    contextHistory.forEach(msg => {
        const isBot    = msg.role === 'bot';
        const speaker  = isBot
            ? (allChars.find(c => c.id === msg.botId)
                ? (getCharOverride(msg.botId).nickname || allChars.find(c => c.id === msg.botId)?.name)
                : charName)
            : userName;

        let content = msg.content;

        // In group chat, prefix messages with speaker name for clarity
        if (isGroup && isBot && allChars.length > 1) {
            content = `${speaker}: ${content}`;
        }

        messages.push({
            role: isBot ? 'assistant' : 'user',
            content
        });
    });

    // 4. Post-history instructions (V2 spec)
    const postHistory = override.postHistoryOverride || character.post_history_instructions;
    if (postHistory) {
        const expanded = postHistory
            .replace(/\{\{char\}\}/gi, charName)
            .replace(/\{\{user\}\}/gi, userName);
        messages.push({ role: 'system', content: expanded });
    }

    // 5. Author's Note at injection depth
    if (config.authorsNote) {
        const depth = Math.max(0, config.authorsNoteDepth || 4);
        const insertAt = Math.max(1, messages.length - depth);
        messages.splice(insertAt, 0, {
            role: 'system',
            content: `[Author's Note: ${config.authorsNote}]`
        });
    }

    // 6. Assemble payload
    const model = override.modelOverride || config.model || 'deepseek-r1';

    return {
        model,
        messages,
        temperature:        config.temperature        ?? 0.8,
        top_p:              config.topP               ?? 0.95,
        top_k:              config.topK               ?? 40,
        min_p:              config.minP               ?? 0.05,
        repetition_penalty: config.repetitionPenalty  ?? 1.1,
        presence_penalty:   config.presencePenalty    ?? 0,
        frequency_penalty:  config.frequencyPenalty   ?? 0,
        max_tokens:         config.maxOutput          ?? 512,
        stream:             config.stream             ?? true,
        _charName: charName  // passed through for UI labeling, stripped before send
    };
}

// ── Streaming fetch ───────────────────────────────────────────────────────────
export async function streamCompletion(payload, onChunk, onDone, onError, signal) {
    const apiKey = getApiKey();
    if (!apiKey) {
        onError(new Error('No API key. Add your nano-gpt key in Settings → Config → API Key.'));
        return;
    }

    // Strip internal-only fields
    const sendPayload = { ...payload };
    delete sendPayload._charName;

    let fullText  = '';
    let tokenCount = 0;

    try {
        const res = await fetch(`${API_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(sendPayload),
            signal
        });

        if (!res.ok) {
            let errMsg = `HTTP ${res.status}`;
            try { const j = await res.json(); errMsg = j.error?.message || j.error || errMsg; } catch (_) {}
            throw new Error(errMsg);
        }

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete last line

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const dataStr = line.slice(6).trim();
                if (dataStr === '[DONE]') {
                    onDone(fullText, tokenCount);
                    return;
                }
                try {
                    const json  = JSON.parse(dataStr);
                    const delta = json.choices?.[0]?.delta?.content || '';
                    if (delta) {
                        fullText   += delta;
                        tokenCount += estimateTokens(delta);
                        onChunk(delta, fullText);
                    }
                    // Some APIs return usage mid-stream
                    if (json.usage?.completion_tokens) {
                        tokenCount = json.usage.completion_tokens;
                    }
                } catch (_) {}
            }
        }

        // Stream ended without [DONE] marker
        if (fullText) onDone(fullText, tokenCount);
        else onError(new Error('Stream ended with no content.'));

    } catch (err) {
        if (err.name === 'AbortError') {
            if (fullText) onDone(fullText, tokenCount);
            else onError(new Error('Generation cancelled.'));
        } else {
            onError(err);
        }
    }
}

// ── Non-streaming fallback ────────────────────────────────────────────────────
export async function fetchCompletion(payload) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('No API key configured.');

    const sendPayload = { ...payload, stream: false };
    delete sendPayload._charName;

    const res = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(sendPayload)
    });

    if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error?.message || j.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return {
        text:   data.choices?.[0]?.message?.content || '',
        tokens: data.usage?.completion_tokens || 0
    };
}
