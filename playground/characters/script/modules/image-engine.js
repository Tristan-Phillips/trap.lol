/**
 * image-engine.js — Image generation for The Underdark.
 *
 * Builds maximally detailed, character-accurate prompts by pulling from:
 *   - Character card (appearance, personality, scenario, first_mes)
 *   - Active char overrides (physical, style, adult fields)
 *   - Active reality world config / scenario
 *   - Recent chat history (last N messages for scene context)
 *   - Lore entries (world-info that fired in recent turns)
 *   - Explicit user-supplied prompt additions
 *
 * Returns the generated image as a data URL for local storage (no expiry).
 */

import { state, getCharOverride } from './state.js';
import { getApiKey }               from '../../../../glass/script/modules/llm-auth.js';
import { scanLorebooks }           from './lorebook.js';

const API_BASE = 'https://nano-gpt.com/v1/images/generations';

// ── Image Model Registry ──────────────────────────────────────────────────────
// tag keys: 'photo' | 'anime' | 'art' | 'nsfw' | 'edit' | 'fast' | 'hq'
export const IMAGE_MODELS = [
    {
        id:    'hidream',
        label: 'HiDream',
        tags:  ['hq', 'photo', 'art'],
        desc:  'Best overall quality — photorealistic + artistic, slow',
        nsfw:  true,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'nano-banana',
        label: 'Nano Banana',
        tags:  ['fast', 'art', 'nsfw'],
        desc:  'Fast & uncensored — good for explicit RP scenes',
        nsfw:  true,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'flux-dev',
        label: 'FLUX Dev',
        tags:  ['hq', 'photo', 'art'],
        desc:  'High-fidelity photorealistic output, detail-rich',
        nsfw:  true,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'flux-schnell',
        label: 'FLUX Schnell',
        tags:  ['fast'],
        desc:  'Fastest FLUX — quick previews and iterations',
        nsfw:  false,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'flux-kontext',
        label: 'FLUX Kontext',
        tags:  ['edit', 'hq'],
        desc:  'Context-aware editing — use an existing image as base',
        nsfw:  true,
        sizes: ['1024x1024', '512x512'],
        img2img: true,
    },
    {
        id:    'gpt-4o-image',
        label: 'GPT-4o Image',
        tags:  ['photo', 'hq', 'art'],
        desc:  'OpenAI vision model — strong prompt adherence',
        nsfw:  false,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'gpt-image-1',
        label: 'GPT Image 1',
        tags:  ['photo', 'hq'],
        desc:  'OpenAI photorealistic — excellent faces and lighting',
        nsfw:  false,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'ghiblify',
        label: 'Ghiblify',
        tags:  ['anime', 'art'],
        desc:  'Studio Ghibli style — painterly, warm, soft',
        nsfw:  false,
        sizes: ['1024x1024', '512x512'],
        img2img: true,
    },
    {
        id:    'bagel',
        label: 'Bagel',
        tags:  ['art', 'nsfw'],
        desc:  'Artistic / illustrative — flexible style, uncensored',
        nsfw:  true,
        sizes: ['1024x1024', '512x512'],
        img2img: true,
    },
    {
        id:    'SDXL-ArliMix-v1',
        label: 'SDXL ArliMix',
        tags:  ['anime', 'art', 'nsfw'],
        desc:  'SDXL anime/art mix — detailed, vibrant, uncensored',
        nsfw:  true,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'hidream-edit',
        label: 'HiDream Edit',
        tags:  ['edit', 'hq'],
        desc:  'Advanced image editing with prompt-guided changes',
        nsfw:  true,
        sizes: ['1024x1024', '512x512'],
        img2img: true,
    },
    {
        id:    'gemini-flash-edit',
        label: 'Gemini Flash Edit',
        tags:  ['edit', 'fast'],
        desc:  'Fast Gemini-based editing — good for quick touch-ups',
        nsfw:  false,
        sizes: ['1024x1024', '512x512'],
        img2img: true,
    },
    {
        id:    'Upscaler',
        label: 'Upscaler',
        tags:  ['edit'],
        desc:  'Upscale any image to higher resolution',
        nsfw:  true,
        sizes: ['1024x1024'],
        img2img: true,
    },
];

export const DEFAULT_MODEL = 'hidream';

// ── Prompt Builder ────────────────────────────────────────────────────────────
// Assembles the most accurate, detailed prompt possible from all available context.
export function buildImagePrompt(opts = {}) {
    const {
        charId          = state.activeBotId,
        userAddition    = '',   // text from /image command
        historyDepth    = 6,    // recent messages to pull scene context from
        includeNsfw     = true,
    } = opts;

    const char     = charId ? state.loadedCharacters[charId] : null;
    const meta     = charId ? state.characters.find(c => c.id === charId) : null;
    const override = charId ? getCharOverride(charId) : {};
    const charName = override.nickname || char?.name || 'character';
    const userName = state.config.userName || 'User';

    const parts = [];

    // 1. Scene context from recent history ─────────────────────────────────────
    const recentHistory = state.history.slice(-historyDepth);
    if (recentHistory.length) {
        const lastBot = [...recentHistory].reverse().find(m => m.role === 'bot');
        if (lastBot?.content) {
            // Strip markdown/HTML, take the first 300 chars as scene anchor
            const sceneText = lastBot.content
                .replace(/<[^>]+>/g, '')
                .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
                .replace(/_([^_]+)_/g, '$1')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 300);
            if (sceneText) parts.push(`Scene: ${sceneText}`);
        }
    }

    // 2. World scenario / reality override ─────────────────────────────────────
    const worldScenario = state.reality?.worldConfig?.scenario || state.config.groupScenario || '';
    if (worldScenario) {
        const brief = worldScenario.replace(/\s+/g, ' ').trim().slice(0, 150);
        parts.push(`Setting: ${brief}`);
    }

    // 3. Character appearance ──────────────────────────────────────────────────
    if (char) {
        const appearanceParts = [];

        // From override fields (most specific)
        const addOv = (...fields) => {
            fields.forEach(f => { if (override[f] && String(override[f]).trim()) appearanceParts.push(String(override[f]).trim()); });
        };
        addOv('species', 'gender', 'age', 'height', 'bodyType', 'skinTone');
        if (override.hairColor) appearanceParts.push(`${override.hairColor} ${override.hairStyle || ''}`.trim() + ' hair');
        if (override.eyeColor)  appearanceParts.push(`${override.eyeColor} eyes`);
        addOv('distinctiveFeatures', 'posture', 'gait');

        // From card description (fallback)
        if (!appearanceParts.length && char.description) {
            const brief = char.description.replace(/\s+/g, ' ').trim().slice(0, 200);
            if (brief) appearanceParts.push(brief);
        }

        if (appearanceParts.length) {
            parts.push(`${charName}: ${appearanceParts.join(', ')}`);
        }

        // Style / fashion
        const styleParts = [];
        const addSt = (...fields) => {
            fields.forEach(f => { if (override[f] && String(override[f]).trim()) styleParts.push(String(override[f]).trim()); });
        };
        addSt('styleArchetype', 'outfitDescription', 'colorPalette', 'signatureItem', 'footwear', 'jewelry', 'makeupStyle');
        if (styleParts.length) parts.push(`Outfit: ${styleParts.join(', ')}`);

        // Adult physical (if nsfw allowed)
        if (includeNsfw) {
            const adultParts = [];
            const addAd = (...fields) => {
                fields.forEach(f => {
                    const v = override[f];
                    if (v && String(v).trim() && String(v).toLowerCase() !== 'n/a') adultParts.push(String(v).trim());
                });
            };
            addAd('breastSize', 'breastShape', 'areolaeSize', 'nippleColor', 'penisSize', 'penisShape', 'buttocksSize', 'bodyHair', 'genitalia', 'otherAdultFeatures');
            if (adultParts.length) parts.push(`Physical details: ${adultParts.join(', ')}`);
        }
    }

    // 4. Active lorebook entries ───────────────────────────────────────────────
    if (state.lorebooks?.length) {
        const loreEntries = scanLorebooks(state.history, state.lorebooks, 5);
        loreEntries.slice(0, 2).forEach(e => {
            const brief = e.content.replace(/\s+/g, ' ').trim().slice(0, 120);
            if (brief) parts.push(`World detail: ${brief}`);
        });
    }

    // 5. User addition (explicit direction from /image command) ────────────────
    if (userAddition.trim()) {
        parts.push(userAddition.trim());
    }

    // 6. Technical quality suffix ──────────────────────────────────────────────
    const qualitySuffix = [
        'masterpiece', 'best quality', 'highly detailed', 'sharp focus',
        '8k resolution', 'cinematic lighting', 'professional photograph',
    ].join(', ');

    const rawPrompt = parts.join('. ').trim();
    // Ensure there is always a meaningful subject — fall back to char name or generic
    const subject = rawPrompt || charName || 'a person';
    return `${subject}. ${qualitySuffix}`;
}

// ── Fetch generated image as a local data URL ─────────────────────────────────
// Always converts to data URL immediately — URL format signs expire in ~1h,
// so we download and cache locally the moment we get a response.
export async function generateImage({ model, prompt, size = '1024x1024', seed, strength }) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('No API key configured.');

    const cleanPrompt = (prompt || '').trim();
    if (!cleanPrompt) throw new Error('Prompt cannot be empty.');

    const body = {
        model:           model || DEFAULT_MODEL,
        prompt:          cleanPrompt,
        n:               1,
        size,
        response_format: 'b64_json',  // inline — no second fetch, no CORS
    };
    if (seed !== undefined && seed !== null) body.seed = seed;
    if (strength !== undefined)             body.strength = strength;

    const res = await fetch(API_BASE, {
        method:  'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error?.message || j.error?.message || (typeof j.error === 'string' ? j.error : msg); } catch (_) {}
        throw new Error(msg);
    }

    const data = await res.json();
    const item = data.data?.[0];
    if (!item) throw new Error('No image in response.');

    // b64_json is the primary format — convert to data URL for local persistence
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;

    throw new Error('Response contained no image data.');
}
