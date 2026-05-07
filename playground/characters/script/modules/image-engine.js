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
        sub:   true,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'nano-banana',
        label: 'Nano Banana',
        tags:  ['fast', 'art', 'nsfw'],
        desc:  'Fast & uncensored — good for explicit RP scenes',
        nsfw:  true,
        sub:   true,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'flux-dev',
        label: 'FLUX Dev',
        tags:  ['hq', 'photo', 'art'],
        desc:  'High-fidelity photorealistic output, detail-rich',
        nsfw:  true,
        sub:   true,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'flux-schnell',
        label: 'FLUX Schnell',
        tags:  ['fast'],
        desc:  'Fastest FLUX — quick previews and iterations',
        nsfw:  false,
        sub:   true,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'flux-kontext',
        label: 'FLUX Kontext',
        tags:  ['edit', 'hq'],
        desc:  'Context-aware editing — use an existing image as base',
        nsfw:  true,
        sub:   false,
        sizes: ['1024x1024', '512x512'],
        img2img: true,
    },
    {
        id:    'gpt-4o-image',
        label: 'GPT-4o Image',
        tags:  ['photo', 'hq', 'art'],
        desc:  'OpenAI vision model — strong prompt adherence',
        nsfw:  false,
        sub:   false,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'gpt-image-1',
        label: 'GPT Image 1',
        tags:  ['photo', 'hq'],
        desc:  'OpenAI photorealistic — excellent faces and lighting',
        nsfw:  false,
        sub:   false,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'ghiblify',
        label: 'Ghiblify',
        tags:  ['anime', 'art'],
        desc:  'Studio Ghibli style — painterly, warm, soft',
        nsfw:  false,
        sub:   true,
        sizes: ['1024x1024', '512x512'],
        img2img: true,
    },
    {
        id:    'bagel',
        label: 'Bagel',
        tags:  ['art', 'nsfw'],
        desc:  'Artistic / illustrative — flexible style, uncensored',
        nsfw:  true,
        sub:   true,
        sizes: ['1024x1024', '512x512'],
        img2img: true,
    },
    {
        id:    'SDXL-ArliMix-v1',
        label: 'SDXL ArliMix',
        tags:  ['anime', 'art', 'nsfw'],
        desc:  'SDXL anime/art mix — detailed, vibrant, uncensored',
        nsfw:  true,
        sub:   true,
        sizes: ['1024x1024', '512x512'],
    },
    {
        id:    'hidream-edit',
        label: 'HiDream Edit',
        tags:  ['edit', 'hq'],
        desc:  'Advanced image editing with prompt-guided changes',
        nsfw:  true,
        sub:   true,
        sizes: ['1024x1024', '512x512'],
        img2img: true,
    },
    {
        id:    'gemini-flash-edit',
        label: 'Gemini Flash Edit',
        tags:  ['edit', 'fast'],
        desc:  'Fast Gemini-based editing — good for quick touch-ups',
        nsfw:  false,
        sub:   false,
        sizes: ['1024x1024', '512x512'],
        img2img: true,
    },
    {
        id:    'Upscaler',
        label: 'Upscaler',
        tags:  ['edit'],
        desc:  'Upscale any image to higher resolution',
        nsfw:  true,
        sub:   true,
        sizes: ['1024x1024'],
        img2img: true,
    },
];

export const DEFAULT_MODEL = 'hidream';

// ── Prompt Builder ────────────────────────────────────────────────────────────
// Structured prompt assembly. Scene builder fields are injected into the exact
// structural position that image models expect them — not dumped as a suffix.
//
// Output order: SUBJECT > PHYSICAL > CLOTHING/POSE > ACTION > ENVIRONMENT >
//               LIGHTING > ADULT > SCENE CONTEXT > LORE > HOMEBREW > QUALITY
//
// Returns { positive, negative } — callers combine them as needed for each API.
export function buildImagePrompt(opts = {}) {
    const {
        charId       = state.activeBotId,
        scene        = {},           // scene builder state object from ui.js
        userAddition = '',           // free-text addition (legacy / direct calls)
        historyDepth = 6,
        includeNsfw  = true,
        nsfwLevel    = 'explicit',   // 'sfw'|'suggestive'|'explicit'|'unrestricted'
    } = opts;

    const char     = charId ? state.loadedCharacters[charId] : null;
    const override = charId ? getCharOverride(charId) : {};
    const charName = override.nickname || char?.name || 'a person';

    // Helper — resolve a scene group value (may be __custom__ → custom field)
    const sv = (k) => {
        const v = scene[k];
        if (!v) return '';
        if (v === '__custom__') return scene[`${k}Custom`] || '';
        return v;
    };

    const pos = []; // positive prompt parts
    const neg = []; // negative prompt parts

    // ── 1. Primary subject (character name + physical) ────────────────────────
    const physParts = [];
    const addOv = (...fields) => fields.forEach(f => {
        const v = override[f];
        if (v && String(v).trim() && String(v).toLowerCase() !== 'n/a')
            physParts.push(String(v).trim());
    });
    addOv('species', 'gender', 'age', 'height', 'bodyType', 'skinTone');
    if (override.hairColor) physParts.push(`${override.hairColor}${override.hairStyle ? ` ${override.hairStyle}` : ''} hair`);
    if (override.eyeColor)  physParts.push(`${override.eyeColor} eyes`);
    addOv('faceShape', 'complexion', 'jawType', 'cheekbones', 'eyeShape', 'lipsType',
          'distinctiveFeatures', 'tattoos', 'scarsMarks');

    if (physParts.length) {
        pos.push(`${charName}, ${physParts.join(', ')}`);
    } else if (char?.description) {
        pos.push(`${charName}, ${char.description.replace(/\s+/g, ' ').trim().slice(0, 180)}`);
    } else {
        pos.push(charName);
    }

    // ── 2. Clothing / outfit ──────────────────────────────────────────────────
    const clothingParts = [];
    const clothing = sv('clothing');
    if (clothing) {
        clothingParts.push(clothing);
    } else {
        // Fall back to character override outfit
        const addSt = (...fields) => fields.forEach(f => {
            const v = override[f];
            if (v && String(v).trim()) clothingParts.push(String(v).trim());
        });
        addSt('outfitDescription', 'styleArchetype', 'colorPalette', 'signatureItem',
              'footwear', 'jewelry', 'makeupStyle', 'headwear', 'eyewear');
    }
    if (clothingParts.length) pos.push(clothingParts.join(', '));

    // ── 3. Body focus ─────────────────────────────────────────────────────────
    const bodyFocus = sv('bodyFocus');
    if (bodyFocus) pos.push(bodyFocus);

    // ── 4. Pose / position ───────────────────────────────────────────────────
    const pose = sv('pose');
    if (pose) pos.push(pose);

    // ── 5. Activity / action ─────────────────────────────────────────────────
    const activity = sv('activity');
    if (activity) pos.push(activity);

    // ── 6. Expression ────────────────────────────────────────────────────────
    const expr = sv('expr');
    if (expr) pos.push(expr);

    // ── 7. Camera / framing ──────────────────────────────────────────────────
    const cam = sv('cam');
    if (cam) pos.push(cam);

    // ── 8. Partners / group indicators ───────────────────────────────────────
    const partners = sv('partners');
    if (partners) pos.push(partners);

    // ── 9. Environment ───────────────────────────────────────────────────────
    const env = sv('env');
    if (env) {
        pos.push(env);
    } else {
        const worldScenario = state.reality?.worldConfig?.scenario || '';
        if (worldScenario) pos.push(worldScenario.replace(/\s+/g, ' ').trim().slice(0, 100));
    }

    // ── 10. Lighting / mood ──────────────────────────────────────────────────
    const mood = sv('mood');
    if (mood) pos.push(mood);

    // ── 11. Art style ────────────────────────────────────────────────────────
    const style = sv('style') || 'photorealistic';
    pos.push(style);

    // ── 12. Adult anatomy — only when NSFW and character has fields ──────────
    if (includeNsfw && nsfwLevel !== 'sfw') {
        const adultParts = [];
        const addAd = (...fields) => fields.forEach(f => {
            const v = override[f];
            if (v && String(v).trim() && String(v).toLowerCase() !== 'n/a') adultParts.push(String(v).trim());
        });
        addAd('breastSize', 'breastShape', 'areolaeSize', 'nippleColor',
              'penisSize', 'penisShape', 'buttocksSize', 'buttocksShape',
              'bodyHair', 'genitalia', 'intimateMarkings', 'otherAdultFeatures');
        if (adultParts.length) pos.push(adultParts.join(', '));

        // NSFW content level tag
        const nsfwTags = {
            suggestive:   'suggestive, tasteful nudity, semi-explicit',
            explicit:     'explicit, nsfw, uncensored, nude',
            unrestricted: 'fully explicit, uncensored, no restrictions, maximally detailed adult scene',
        };
        pos.push(nsfwTags[nsfwLevel] || nsfwTags.explicit);
    }

    // ── 13. Scene context from chat history ──────────────────────────────────
    const recentHistory = state.history.slice(-historyDepth);
    const lastBot = [...recentHistory].reverse().find(m => m.role === 'bot');
    if (lastBot?.content) {
        const sceneText = lastBot.content
            .replace(/<[^>]+>/g, '')
            .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
            .replace(/_([^_]+)_/g, '$1')
            .replace(/\s+/g, ' ').trim().slice(0, 200);
        if (sceneText) pos.push(sceneText);
    }

    // ── 14. Active lorebook entries ──────────────────────────────────────────
    if (state.lorebooks?.length) {
        scanLorebooks(state.history, state.lorebooks, 5).slice(0, 2).forEach(e => {
            const brief = e.content.replace(/\s+/g, ' ').trim().slice(0, 100);
            if (brief) pos.push(brief);
        });
    }

    // ── 15. Homebrew positive injection ──────────────────────────────────────
    if (scene.positive?.trim()) pos.push(scene.positive.trim());
    if (userAddition?.trim())   pos.push(userAddition.trim());

    // ── 16. Quality suffix ───────────────────────────────────────────────────
    const qualityTags = nsfwLevel === 'unrestricted'
        ? 'masterpiece, best quality, highly detailed, sharp focus, anatomically correct, 8k'
        : 'masterpiece, best quality, highly detailed, sharp focus, cinematic lighting, 8k resolution, professional';
    pos.push(qualityTags);

    // ── Negative prompt ──────────────────────────────────────────────────────
    const baseNeg = 'worst quality, low quality, blurry, deformed, ugly, bad anatomy, extra limbs, missing limbs, watermark, text, logo';
    if (scene.negative?.trim()) neg.push(scene.negative.trim());
    neg.push(baseNeg);

    return {
        positive: pos.filter(Boolean).join(', '),
        negative: neg.join(', '),
    };
}

// ── LLM-assisted prompt generation ───────────────────────────────────────────
// Calls the LLM (character's model or global model) to write a rich, coherent
// image generation prompt that:
//   • Anchors to the character's precise physical description
//   • Captures the current scene context and emotional tone
//   • Maintains continuity with what has happened in the chat
//   • Translates narrative text into concrete, painterly image-prompt language
//
// Returns the prompt string. Throws on API failure.
export async function generateImagePromptWithLLM(opts = {}) {
    const {
        charId       = state.activeBotId,
        userHint     = '',
        scene        = {},
        historyDepth = 8,
        includeNsfw  = true,
    } = opts;

    const apiKey = getApiKey();
    if (!apiKey) throw new Error('No API key configured.');

    const char     = charId ? state.loadedCharacters[charId] : null;
    const meta     = charId ? state.characters.find(c => c.id === charId) : null;
    const override = charId ? getCharOverride(charId) : {};
    const charName = override.nickname || char?.name || 'the character';
    const userName = state.config.userName || 'User';

    // Pick which model to call — character override first, then global config
    const llmModel = override.modelOverride || state.config.selectedModel || 'gemini-2.0-flash';

    // Build a rich context document for the LLM
    const contextParts = [];

    // Character physical sheet
    const physFields = [];
    const addPh = (...keys) => keys.forEach(k => { const v = override[k]; if (v && String(v).trim()) physFields.push(String(v).trim()); });
    addPh('species','gender','age','height','bodyType','skinTone');
    if (override.hairColor) physFields.push(`${override.hairColor} ${override.hairStyle || ''}`.trim() + ' hair');
    if (override.eyeColor)  physFields.push(`${override.eyeColor} eyes`);
    addPh('distinctiveFeatures','faceShape','complexion','jawType','cheekbones',
          'eyeShape','noseType','lipsType','tattoos','scarsMarks','posture','gait');
    if (physFields.length) contextParts.push(`Character: ${charName}\nPhysical: ${physFields.join(', ')}`);

    // Style
    const styleFields = [];
    const addSt = (...keys) => keys.forEach(k => { const v = override[k]; if (v && String(v).trim()) styleFields.push(String(v).trim()); });
    addSt('styleArchetype','outfitDescription','colorPalette','signatureItem','footwear','jewelry','makeupStyle','lipstickColor','eyeMakeup','headwear','eyewear');
    if (styleFields.length) contextParts.push(`Style/outfit: ${styleFields.join(', ')}`);

    // Adult anatomy (when nsfw enabled)
    if (includeNsfw) {
        const adultFields = [];
        const addAd = (...keys) => keys.forEach(k => {
            const v = override[k];
            if (v && String(v).trim() && String(v).toLowerCase() !== 'n/a') adultFields.push(String(v).trim());
        });
        addAd('breastSize','breastShape','areolaeSize','nippleColor','buttocksSize','buttocksShape','bodyHair','genitalia','otherAdultFeatures','intimateMarkings');
        if (adultFields.length) contextParts.push(`Adult anatomy: ${adultFields.join(', ')}`);
    }

    // World scenario
    const worldScenario = state.reality?.worldConfig?.scenario || state.config.groupScenario || '';
    if (worldScenario) contextParts.push(`World/setting: ${worldScenario.trim().slice(0, 300)}`);

    // Character scenario from card
    if (char?.scenario) contextParts.push(`Scene context: ${char.scenario.trim().slice(0, 200)}`);

    // Recent chat history — last N messages, both user and bot
    const recent = state.history.slice(-historyDepth);
    if (recent.length) {
        const transcript = recent
            .filter(m => m.role === 'user' || m.role === 'bot')
            .map(m => {
                const speaker = m.role === 'user' ? userName : charName;
                const text = m.content
                    .replace(/<[^>]+>/g, '')
                    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
                    .replace(/_([^_]+)_/g, '$1')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 300);
                return `${speaker}: ${text}`;
            })
            .join('\n');
        if (transcript) contextParts.push(`Recent conversation:\n${transcript}`);
    }

    // Active lorebook
    if (state.lorebooks?.length) {
        const lore = scanLorebooks(state.history, state.lorebooks, 5);
        lore.slice(0, 3).forEach(e => {
            const brief = e.content.replace(/\s+/g, ' ').trim().slice(0, 150);
            if (brief) contextParts.push(`Lore: ${brief}`);
        });
    }

    // Scene builder selections
    const sv = (k) => { const v = scene[k]; if (!v) return ''; if (v === '__custom__') return scene[`${k}Custom`] || ''; return v; };
    const sceneSelections = [
        sv('clothing') && `Clothing: ${sv('clothing')}`,
        sv('pose')     && `Pose: ${sv('pose')}`,
        sv('expr')     && `Expression: ${sv('expr')}`,
        sv('env')      && `Environment: ${sv('env')}`,
        sv('mood')     && `Lighting/mood: ${sv('mood')}`,
        sv('style')    && `Art style: ${sv('style')}`,
        sv('cam')      && `Camera: ${sv('cam')}`,
        sv('bodyFocus')&& `Body focus: ${sv('bodyFocus')}`,
        sv('activity') && `Activity: ${sv('activity')}`,
        sv('partners') && `Partners: ${sv('partners')}`,
        scene.nsfw && scene.nsfw !== 'sfw' && `NSFW level: ${scene.nsfw}`,
        scene.positive?.trim() && `Additional visual details: ${scene.positive.trim()}`,
    ].filter(Boolean);
    if (sceneSelections.length) contextParts.push(`Scene builder selections:\n${sceneSelections.join('\n')}`);

    // User's additional direction
    if (userHint.trim()) contextParts.push(`User direction: ${userHint.trim()}`);

    const systemPrompt = `You are an expert image prompt engineer for AI art generators (Stable Diffusion, FLUX, HiDream, etc).

Given detailed context about a character and the current scene, write a single, highly-specific image generation prompt.

Rules:
- Write ONLY the prompt text — no preamble, no explanation, no markdown
- Describe what is visually present: character appearance, pose, expression, clothing, lighting, environment, mood
- Use comma-separated descriptive phrases in natural English
- Anchor to the character's exact physical traits (do not invent new ones)
- Reflect the emotional tone and setting from the recent conversation
- If explicit anatomy is included in the context, include it naturally in physical detail descriptions
- End with quality keywords: masterpiece, best quality, highly detailed, sharp focus, cinematic lighting
- Maximum 250 words`;

    const userMessage = `${contextParts.join('\n\n')}\n\nWrite the image generation prompt now.`;

    const LLM_API = 'https://nano-gpt.com/v1/chat/completions';
    const res = await fetch(LLM_API, {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: llmModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userMessage  },
            ],
            max_tokens: 400,
            temperature: 0.7,
            stream: false,
        }),
    });

    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error?.message || (typeof j.error === 'string' ? j.error : msg); } catch (_) {}
        throw new Error(msg);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('LLM returned empty prompt.');
    return content;
}

// ── Fetch generated image as a local data URL ─────────────────────────────────
// Always converts to data URL immediately — URL format signs expire in ~1h,
// so we download and cache locally the moment we get a response.
export async function generateImage({ model, prompt, negativePrompt, size = '1024x1024', seed, strength }) {
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
    if (seed !== undefined && seed !== null)           body.seed = seed;
    if (strength !== undefined)                        body.strength = strength;
    if (negativePrompt && negativePrompt.trim())       body.negative_prompt = negativePrompt.trim();

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
