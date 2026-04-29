/**
 * llm-engine.js
 * Core LLM interaction logic for the Underdark interface.
 * Handles payload construction, prompt engineering, and streaming.
 */

import { getApiKey, isValidKeyFormat } from '../../../../glass/script/modules/llm-auth.js';
import { scanLorebooks } from './lorebook.js';

const API_BASE = "https://nano-gpt.com/api/v1"; // Default Nano-GPT API

/**
 * Constructs the final prompt payload for the LLM.
 */
export function buildPayload(ctx) {
    const { character, history, lore, config } = ctx;
    
    const messages = [];

    // 1. System Prompt (The Foundation)
    let systemContent = config.sysDirective || `Write {{char}}'s next reply in a fictional roleplay between {{char}} and {{user}}.
Stay in character. Be descriptive. Use sensory details.
Character Persona:
${character.description}
${character.personality ? `Personality: ${character.personality}` : ''}
${character.scenario ? `Scenario: ${character.scenario}` : ''}
${character.system_prompt ? `Instructions: ${character.system_prompt}` : ''}`;

    // Replace macros
    systemContent = systemContent.replace(/{{char}}/g, character.name).replace(/{{user}}/g, 'User');
    
    if (config.nsfwBypass) {
        systemContent += `\n\n${config.nsfwBypass}`;
    }
    
    messages.push({ role: 'system', content: systemContent });

    // 2. Lorebook Injection
    const activeLore = scanLorebooks(history, lore);
    if (activeLore && activeLore.length) {
        const loreContent = activeLore.map(entry => `[World Info: ${entry.name}]\n${entry.content}`).join('\n\n');
        messages.push({ role: 'system', content: loreContent });
    }

    // 3. History (The Thread)
    // Truncation based on maxContext config
    // (A naive implementation: keeping the last N messages to loosely respect token limits)
    // 1 message roughly = 50 tokens (very rough approximation for fast filtering)
    const turnLimit = Math.floor(config.maxContext / 50); 
    const contextHistory = history.slice(-turnLimit);

    contextHistory.forEach(msg => {
        const isBot = msg.role === 'bot';
        let content = msg.content;
        
        if (isBot && msg.botId && msg.botId !== character.id) {
             // Prefix message with the other bot's name if multi-bot
        }

        messages.push({
            role: isBot ? 'assistant' : 'user',
            name: isBot ? character.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) : undefined,
            content: content
        });
    });

    // 4. Author's Note (The Final Push)
    if (config.authorsNote) {
        messages.push({ role: 'system', content: `[Author's Note: ${config.authorsNote}]` });
    }

    return {
        model: config.model || "deepseek-r1",
        messages,
        temperature: config.temperature || 0.8,
        top_p: config.topP || 0.95,
        top_k: config.topK || 40,
        repetition_penalty: config.repetitionPenalty || 1.1,
        presence_penalty: config.presencePenalty || 0,
        frequency_penalty: config.frequencyPenalty || 0,
        max_tokens: config.maxOutput || 512,
        stream: config.stream
    };
}

/**
 * Dispatches a streaming request to the LLM backend.
 */
export async function streamCompletion(payload, onChunk, onDone, onError) {
    const apiKey = getApiKey();
    
    try {
        const res = await fetch(`${API_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6).trim();
                    if (dataStr === '[DONE]') {
                        onDone(fullText);
                        return;
                    }

                    try {
                        const json = JSON.parse(dataStr);
                        const delta = json.choices?.[0]?.delta?.content || "";
                        if (delta) {
                            fullText += delta;
                            onChunk(delta, fullText);
                        }
                    } catch (e) {
                        // Ignore parse errors on partial chunks
                    }
                }
            }
        }
    } catch (err) {
        onError(err);
    }
}
