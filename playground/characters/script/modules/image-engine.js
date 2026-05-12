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
// structural position that image models weight most heavily.
//
// Output order:
//   SUBJECT + PHYSICAL (incl. adult anatomy inline) → HAIR OVERRIDE →
//   CLOTHING (state + outfit-type + top/bottom/footwear + accessories) →
//   POSE → ACTIVITY → EXPRESSION → SKIN FX → CAMERA → PARTNERS →
//   ENVIRONMENT → TIME/WEATHER → LIGHTING → VIBE → FANTASY FX →
//   ART STYLE → COLOR/COMPOSITION → NSFW TAG → SCENE CONTEXT →
//   LORE → QUALITY → HOMEBREW
//
// Placing adult anatomy with the physical subject (not after style tags) ensures
// models anchor to it correctly — early tokens carry the highest weight.
//
// Returns { positive, negative } — callers combine them as needed for each API.
export function buildImagePrompt(opts = {}) {
    const {
        charId       = state.activeBotId,
        scene        = {},
        userAddition = '',
        historyDepth = 6,
        includeNsfw  = true,
        nsfwLevel    = 'explicit',
    } = opts;

    const char     = charId ? state.loadedCharacters[charId] : null;
    const override = charId ? getCharOverride(charId) : {};
    const charName = override.nickname || char?.name || 'a person';

    // Resolve a single-select scene field (handles __custom__ indirection)
    const sv = (k) => {
        const v = scene[k];
        if (!v) return '';
        if (v === '__custom__') return scene[`${k}Custom`] || '';
        return String(v);
    };
    // Resolve a multi-select field (Set or array) → comma-joined string
    const mv = (k) => {
        const v = scene[k];
        if (!v) return '';
        if (v instanceof Set)  return [...v].filter(Boolean).join(', ');
        if (Array.isArray(v))  return v.filter(Boolean).join(', ');
        return String(v);
    };
    // Resolve override field — skips empty / 'n/a'
    const ov = (f) => {
        const v = override[f];
        return (v && String(v).trim() && String(v).toLowerCase() !== 'n/a') ? String(v).trim() : '';
    };

    const pos = [];
    const neg = [];

    // ── 1. Primary subject: character name + full physical description ─────────
    // Adult anatomy is placed here (not after style tags) so the model anchors
    // to it as part of the subject definition, not as a late-stage tag.
    const physParts = [];
    const push = (...fields) => fields.forEach(f => { const v = ov(f); if (v) physParts.push(v); });
    push('species', 'gender', 'age', 'height', 'bodyType', 'skinTone');
    if (ov('hairColor')) physParts.push(`${ov('hairColor')}${ov('hairStyle') ? ` ${ov('hairStyle')}` : ''} hair`);
    if (ov('eyeColor'))  physParts.push(`${ov('eyeColor')} eyes`);
    push('faceShape', 'complexion', 'jawType', 'cheekbones', 'eyeShape', 'lipsType',
         'distinctiveFeatures', 'tattoos', 'scarsMarks');

    // Inline adult anatomy when NSFW — models weight subject-block tokens highest
    if (includeNsfw && nsfwLevel !== 'sfw') {
        push('breastSize', 'breastShape', 'areolaeSize', 'nippleColor',
             'penisSize', 'penisShape', 'buttocksSize', 'buttocksShape',
             'bodyHair', 'genitalia', 'intimateMarkings', 'otherAdultFeatures');
    }

    if (physParts.length) {
        pos.push(`${charName}, ${physParts.join(', ')}`);
    } else if (char?.description) {
        pos.push(`${charName}, ${char.description.replace(/\s+/g, ' ').trim().slice(0, 180)}`);
    } else {
        pos.push(charName);
    }

    // ── 2. Hair style override (scene-level, overrides char default) ───────────
    const hair = sv('hair');
    if (hair) pos.push(hair);

    // ── 3. Clothing ─────────────────────────────────────────────────────────────
    // Priority: clothingState > outfit-type > top+bottom+footwear > char defaults
    // All present values are combined — they are complementary, not mutually exclusive.
    const clothingParts = [];

    const clothingState = sv('clothingState');
    if (clothingState) clothingParts.push(clothingState);

    // Outfit type (e.g. "sexy lingerie set") — the primary outfit selector
    const clothing = sv('clothing');
    if (clothing) clothingParts.push(clothing);

    // Per-part selectors from the studio (top / bottom / footwear)
    // These add specificity on top of the outfit type, never replace it.
    const clothingTop      = sv('clothingTop');
    const clothingBottom   = sv('clothingBottom');
    const clothingFootwear = sv('clothingFootwear');
    if (clothingTop)      clothingParts.push(clothingTop);
    if (clothingBottom)   clothingParts.push(clothingBottom);
    if (clothingFootwear) clothingParts.push(clothingFootwear);

    // If nothing at all was selected, fall back to char's own style fields
    if (!clothingParts.length) {
        ['outfitDescription', 'styleArchetype', 'colorPalette', 'signatureItem',
         'footwear', 'jewelry', 'makeupStyle', 'headwear', 'eyewear']
            .forEach(f => { const v = ov(f); if (v) clothingParts.push(v); });
    }

    const accessories = mv('accessories');
    if (accessories) clothingParts.push(accessories);

    if (clothingParts.length) pos.push(clothingParts.join(', '));

    // ── 4. Pose / body position ────────────────────────────────────────────────
    const pose = sv('pose');
    if (pose) pos.push(pose);

    // ── 5. Activity / act ─────────────────────────────────────────────────────
    const activity = sv('activity');
    if (activity) pos.push(activity);

    // ── 6. Expression / emotion ───────────────────────────────────────────────
    const expr = sv('expr');
    if (expr) pos.push(expr);

    // ── 7. Skin & body effects ────────────────────────────────────────────────
    const skinFx = mv('skinEffects');
    if (skinFx) pos.push(skinFx);

    // ── 8. Camera / framing ───────────────────────────────────────────────────
    const cam = sv('cam');
    if (cam) pos.push(cam);

    // ── 9. Body focus ─────────────────────────────────────────────────────────
    const bodyFocus = sv('bodyFocus');
    if (bodyFocus) pos.push(bodyFocus);

    // ── 10. Partners ──────────────────────────────────────────────────────────
    const partners = sv('partners');
    if (partners) pos.push(partners);

    // ── 11. Environment ───────────────────────────────────────────────────────
    const env = sv('env');
    if (env) {
        pos.push(env);
    } else {
        const worldScenario = state.reality?.worldConfig?.scenario || '';
        if (worldScenario) pos.push(worldScenario.replace(/\s+/g, ' ').trim().slice(0, 100));
    }

    // ── 12. Time of day + weather ─────────────────────────────────────────────
    const timeOfDay = sv('timeOfDay');
    if (timeOfDay) pos.push(timeOfDay);
    const weather = sv('weather');
    if (weather) pos.push(weather);

    // ── 13. Lighting / mood ───────────────────────────────────────────────────
    const mood = sv('mood');
    if (mood) pos.push(mood);

    // ── 14. Scene vibe ────────────────────────────────────────────────────────
    const vibe = sv('vibe');
    if (vibe) pos.push(vibe);

    // ── 15. Fantasy / special FX ──────────────────────────────────────────────
    const fantasyFx = mv('fantasyFx');
    if (fantasyFx) pos.push(fantasyFx);

    // ── 16. Art style ─────────────────────────────────────────────────────────
    const style = sv('style') || 'photorealistic photography, 8k';
    pos.push(style);

    // ── 17. Color tone + composition ──────────────────────────────────────────
    const colorTone = sv('colorTone');
    if (colorTone) pos.push(colorTone);
    const composition = sv('composition');
    if (composition) pos.push(composition);

    // ── 18. NSFW tag — placed after style so it modifies rendering intent ──────
    if (includeNsfw && nsfwLevel !== 'sfw') {
        const nsfwTags = {
            suggestive:   'suggestive, sensual, tasteful nudity',
            explicit:     'explicit, nsfw, uncensored, sexually explicit',
            unrestricted: 'fully explicit, uncensored, maximally detailed adult scene, anatomically correct, no restrictions',
        };
        pos.push(nsfwTags[nsfwLevel] || nsfwTags.explicit);
    }

    // ── 19. Scene context from recent chat history ────────────────────────────
    // Only inject when the user hasn't manually configured the scene — if cam,
    // pose, env, or activity chips are set, those already define the scene and
    // raw prose from the chat would add noise and contradictions.
    const hasManualScene = sv('cam') || sv('pose') || sv('env') || sv('activity');
    if (historyDepth > 0 && !hasManualScene) {
        const recentHistory = state.history.slice(-historyDepth);
        const lastBot = [...recentHistory].reverse().find(m => m.role === 'bot');
        if (lastBot?.content) {
            const sceneText = lastBot.content
                .replace(/<[^>]+>/g, '')
                .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
                .replace(/_([^_]+)_/g, '$1')
                .replace(/\s+/g, ' ').trim().slice(0, 150);
            if (sceneText) pos.push(sceneText);
        }
    }

    // ── 20. Active lorebook entries ───────────────────────────────────────────
    if (state.lorebooks?.length) {
        scanLorebooks(state.history, state.lorebooks, 5).slice(0, 2).forEach(e => {
            const brief = e.content.replace(/\s+/g, ' ').trim().slice(0, 100);
            if (brief) pos.push(brief);
        });
    }

    // ── 21. Quality tags (user-selected or baseline) ──────────────────────────
    const qualityOverrides = mv('quality');
    if (qualityOverrides) {
        pos.push(qualityOverrides);
    } else {
        const qualityBase = nsfwLevel === 'unrestricted'
            ? 'masterpiece, best quality, highly detailed, sharp focus, anatomically correct, perfect anatomy, 8k uhd'
            : 'masterpiece, best quality, highly detailed, sharp focus, cinematic lighting, 8k resolution';
        pos.push(qualityBase);
    }

    // ── 22. Homebrew positive injection ───────────────────────────────────────
    if (scene.positive?.trim()) pos.push(scene.positive.trim());
    if (userAddition?.trim())   pos.push(userAddition.trim());

    // ── Negative prompt ───────────────────────────────────────────────────────
    // Covers the most common failure modes across SD/FLUX/HiDream models.
    const baseNeg = [
        'worst quality, low quality, normal quality, jpeg artifacts, blurry, pixelated',
        'deformed, ugly, disfigured, bad anatomy, wrong anatomy, extra limbs, missing limbs',
        'extra fingers, fused fingers, too many fingers, malformed hands, bad hands',
        'multiple heads, duplicate, cloned face, cloned body, siamese',
        'watermark, text, logo, signature, username, artist name, caption',
    ].join(', ');

    const nsfwNeg = (includeNsfw && nsfwLevel !== 'sfw')
        ? ''
        : 'nude, naked, nsfw, explicit, sexual, genitalia, exposed';

    if (scene.negative?.trim()) neg.push(scene.negative.trim());
    neg.push(baseNeg);
    if (nsfwNeg) neg.push(nsfwNeg);

    return {
        positive: pos.filter(Boolean).join(', '),
        negative: neg.filter(Boolean).join(', '),
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

    // Scene builder selections — all groups
    const sv2 = (k) => { const v = scene[k]; if (!v) return ''; if (v === '__custom__') return scene[`${k}Custom`] || ''; return v; };
    const mv2 = (k) => { const v = scene[k]; if (!v) return ''; if (v instanceof Set) return [...v].join(', '); if (Array.isArray(v)) return v.join(', '); return String(v); };
    const sceneSelections = [
        sv2('clothingState') && `Clothing state: ${sv2('clothingState')}`,
        sv2('clothing')      && `Outfit: ${sv2('clothing')}`,
        mv2('accessories')   && `Accessories: ${mv2('accessories')}`,
        sv2('hair')          && `Hair: ${sv2('hair')}`,
        sv2('cam')           && `Camera: ${sv2('cam')}`,
        sv2('pose')          && `Pose: ${sv2('pose')}`,
        sv2('activity')      && `Activity/act: ${sv2('activity')}`,
        sv2('bodyFocus')     && `Body focus: ${sv2('bodyFocus')}`,
        sv2('partners')      && `Partners: ${sv2('partners')}`,
        sv2('expr')          && `Expression: ${sv2('expr')}`,
        mv2('skinEffects')   && `Skin effects: ${mv2('skinEffects')}`,
        sv2('env')           && `Location: ${sv2('env')}`,
        sv2('timeOfDay')     && `Time: ${sv2('timeOfDay')}`,
        sv2('weather')       && `Weather: ${sv2('weather')}`,
        sv2('mood')          && `Lighting: ${sv2('mood')}`,
        sv2('vibe')          && `Scene vibe: ${sv2('vibe')}`,
        mv2('fantasyFx')     && `Fantasy elements: ${mv2('fantasyFx')}`,
        sv2('style')         && `Art style: ${sv2('style')}`,
        sv2('colorTone')     && `Color tone: ${sv2('colorTone')}`,
        sv2('composition')   && `Composition: ${sv2('composition')}`,
        scene.nsfw && scene.nsfw !== 'sfw' && `NSFW level: ${scene.nsfw}`,
        scene.positive?.trim() && `Additional details: ${scene.positive.trim()}`,
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

// ── Video Generation ──────────────────────────────────────────────────────────
// nano-gpt video API — OpenAI-compatible video generations endpoint.
// Returns a URL to the generated video (or base64 if supported).
// Videos may take 30–120s to generate; this function polls until complete.
//
// Supported models (as of 2026-05):
//   kling-1.6-standard, kling-1.6-pro, wan-t2v-14b, minimax-video-01,
//   luma-dream-machine
const VIDEO_API_BASE = 'https://nano-gpt.com/v1/video/generations';

export const VIDEO_MODELS = [
    { id: 'kling-1.6-standard', label: 'Kling 1.6 Standard', desc: 'Best overall quality. Photorealistic motion.' },
    { id: 'kling-1.6-pro',      label: 'Kling 1.6 Pro',      desc: 'Longer clips, smoother motion, higher fidelity.' },
    { id: 'wan-t2v-14b',        label: 'Wan T2V 14B',         desc: 'Open source — fast, uncensored.' },
    { id: 'minimax-video-01',   label: 'MiniMax Video',        desc: 'Photorealistic faces and bodies.' },
    { id: 'luma-dream-machine', label: 'Luma Dream Machine',   desc: 'Cinematic quality, excellent consistency.' },
];

export async function generateVideo({ model, prompt, imageUrl, duration = 5, seed, onProgress } = {}) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('No API key configured.');

    const cleanPrompt = (prompt || '').trim();
    if (!cleanPrompt) throw new Error('Prompt cannot be empty.');

    const body = {
        model:    model || 'kling-1.6-standard',
        prompt:   cleanPrompt,
        duration: Number(duration) || 5,
    };
    if (seed !== undefined && seed !== null && String(seed).trim()) body.seed = Number(seed);
    if (imageUrl) body.image = imageUrl; // img2vid: pass start frame

    const res = await fetch(VIDEO_API_BASE, {
        method:  'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error?.message || (typeof j.error === 'string' ? j.error : msg); } catch (_) {}
        throw new Error(msg);
    }

    const data = await res.json();

    // Async jobs return a task_id — poll until done
    const taskId = data.id || data.task_id || data.data?.id;
    if (taskId) {
        return await pollVideoTask(taskId, apiKey, onProgress);
    }

    // Synchronous response — direct URL or b64
    const item = data.data?.[0] || data;
    const url  = item?.url || item?.video_url || item?.b64_json;
    if (!url) throw new Error('No video in response.');
    if (item?.b64_json) return `data:video/mp4;base64,${item.b64_json}`;
    return url;
}

async function pollVideoTask(taskId, apiKey, onProgress, maxWaitMs = 180000) {
    const POLL_INTERVAL = 4000;
    const deadline = Date.now() + maxWaitMs;
    let elapsed = 0;

    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        elapsed += POLL_INTERVAL;

        const res = await fetch(`${VIDEO_API_BASE}/${taskId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j.error?.message || `Poll failed: HTTP ${res.status}`);
        }

        const data = await res.json();
        const status = data.status || data.data?.status || 'processing';

        // Progress callback — pass 0-1 estimate based on elapsed vs expected
        if (onProgress) {
            const pct = Math.min(elapsed / Math.min(maxWaitMs, 90000), 0.95);
            onProgress(pct, status);
        }

        if (status === 'succeeded' || status === 'completed' || status === 'done') {
            const item = data.data?.[0] || data.output?.[0] || data;
            const url  = item?.url || item?.video_url || data.url || data.video_url;
            if (!url) throw new Error('Task completed but no video URL in response.');
            return url;
        }

        if (status === 'failed' || status === 'error') {
            const msg = data.error?.message || data.message || 'Video generation failed.';
            throw new Error(msg);
        }
        // else: still processing — continue polling
    }

    throw new Error('Video generation timed out (3 minutes).');
}

// ── Build video prompt from scene context (same pattern as generateImagePromptWithLLM) ──
export async function generateVideoPromptWithLLM(opts = {}) {
    const { charId = state.activeBotId, userHint = '', historyDepth = 6 } = opts;
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('No API key configured.');

    const char     = charId ? state.loadedCharacters[charId] : null;
    const override = charId ? getCharOverride(charId) : {};
    const charName = override.nickname || char?.name || 'the character';
    const userName = state.config.userName || 'User';
    const llmModel = override.modelOverride || state.config.model || 'deepseek-r1';

    const parts = [];
    const physFields = [];
    const addPh = (...keys) => keys.forEach(k => { const v = override[k]; if (v && String(v).trim()) physFields.push(String(v).trim()); });
    addPh('species','gender','age','height','bodyType','skinTone');
    if (override.hairColor) physFields.push(`${override.hairColor}${override.hairStyle ? ` ${override.hairStyle}` : ''} hair`);
    if (override.eyeColor)  physFields.push(`${override.eyeColor} eyes`);
    if (physFields.length) parts.push(`Character: ${charName}\nPhysical: ${physFields.join(', ')}`);

    const worldScenario = state.reality?.worldConfig?.scenario || '';
    if (worldScenario) parts.push(`Setting: ${worldScenario.trim().slice(0, 200)}`);

    const recent = state.history.slice(-historyDepth);
    if (recent.length) {
        const transcript = recent
            .filter(m => m.role === 'user' || m.role === 'bot')
            .map(m => {
                const speaker = m.role === 'user' ? userName : charName;
                const text = m.content.replace(/<[^>]+>/g, '').replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1').replace(/_([^_]+)_/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 250);
                return `${speaker}: ${text}`;
            }).join('\n');
        if (transcript) parts.push(`Recent scene:\n${transcript}`);
    }

    if (userHint.trim()) parts.push(`Direction: ${userHint.trim()}`);

    const systemPrompt = `You are writing a video generation prompt for an AI video model (Kling, Luma, etc.).
Given scene context, write a single concise cinematic video prompt.
Rules:
- Plain text, no markdown, no explanation
- Describe motion: what moves, how, at what pace
- Include: character description, action, setting, camera movement, mood
- End with cinematic quality terms (smooth motion, cinematic lighting, 4K, etc.)
- Max 120 words`;

    const LLM_API = 'https://nano-gpt.com/api/v1/chat/completions';
    const res = await fetch(LLM_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: llmModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: parts.join('\n\n') + '\n\nWrite the video prompt now.' }
            ],
            max_tokens: 200,
            temperature: 0.7,
            stream: false,
        }),
    });

    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error?.message || msg; } catch (_) {}
        throw new Error(msg);
    }

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('LLM returned empty video prompt.');
    return content;
}
