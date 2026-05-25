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

import { state, getCharOverride } from './state.js?v=3';
import { getApiKey }               from '/hub/glass/script/modules/llm-auth.js?v=3';

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

// ── Visual keyword extractor ──────────────────────────────────────────────────
// Converts a raw override field value into clean image-prompt keywords.
// Fields from the char editor often contain narrative prose with parenthetical
// notes, semicolons, and long descriptions unsuitable for image models.
// This strips parentheticals, splits on semicolons, deduplicates, and trims
// to at most `maxWords` words per token so the model stays anchored visually.
function _cleanVisualField(raw, maxWords = 8) {
    if (!raw) return [];
    return raw
        .split(/[;,]+/)
        .map(s => s.replace(/\([^)]*\)/g, '').trim())  // strip (parentheticals)
        .map(s => s.replace(/[^\w\s\-']/g, '').trim()) // strip special chars
        .filter(s => s.length > 1)
        .map(s => s.split(/\s+/).slice(0, maxWords).join(' '))
        .filter(s => s.length > 0);
}

// ── Prompt Builder ────────────────────────────────────────────────────────────
// Structured prompt assembly. Scene builder fields are injected into the exact
// structural position that image models weight most heavily.
//
// Output order:
//   SUBJECT → HAIR → EYES → FACE FEATURES → DISTINGUISHING MARKS →
//   ADULT ANATOMY (if nsfw) → CLOTHING → POSE → ACTIVITY → EXPRESSION →
//   SKIN FX → CAMERA → BODY FOCUS → PARTNERS → ENVIRONMENT →
//   TIME/WEATHER → LIGHTING → VIBE → FANTASY FX → ART STYLE →
//   COLOR/COMPOSITION → NSFW TAG → QUALITY → HOMEBREW
//
// KEY DESIGN DECISIONS:
//   - Narrative prose fields (distinctiveFeatures, scarsMarks, etc.) are run
//     through _cleanVisualField() which strips parentheticals and splits on
//     semicolons, preventing prose dumps in the model's token stream.
//   - Lorebook entries are NEVER injected — they contain world-knowledge prose
//     that is meaningless or harmful to image models.
//   - Chat history is NEVER injected raw — use describeSceneWithLLM() for that.
//   - World scenario is NEVER injected — same reason.
//
// Returns { positive, negative } — callers combine them as needed for each API.
export function buildImagePrompt(opts = {}) {
    const {
        charId       = state.activeBotId,
        scene        = {},
        userAddition = '',
        includeNsfw  = true,
        nsfwLevel    = 'explicit',
    } = opts;

    const char     = charId ? state.loadedCharacters[charId] : null;
    const override = charId ? getCharOverride(charId) : {};
    const cardExt  = char?.extensions?.underdark || char?.data?.extensions?.underdark || {};
    const charName = override.nickname || cardExt.nickname || char?.name || 'a person';

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
    // Resolve override field — user override takes precedence over card extension
    const ov = (f) => {
        for (const v of [override[f], cardExt[f], cardExt.ext?.[f]]) {
            if (v && String(v).trim() && String(v).toLowerCase() !== 'n/a') return String(v).trim();
        }
        return '';
    };
    // Clean visual field — strips prose/parentheticals from an override field
    const cv = (f, maxWords = 8) => _cleanVisualField(ov(f), maxWords);

    const pos = [];
    const neg = [];

    // ── 1. Primary subject ────────────────────────────────────────────────────
    // Name first, then concise physical keywords. We never dump raw prose here.
    const physParts = [];

    // Clean short fields — these are usually 1-3 words and safe verbatim
    ['species', 'gender'].forEach(f => { const v = ov(f); if (v) physParts.push(v); });
    if (ov('age'))    physParts.push(`${ov('age').replace(/[^\d]+/g, '').slice(0,3) || ov('age')} years old`);
    if (ov('height')) physParts.push(ov('height').split(/[,;]/)[0].trim().slice(0, 20));

    // Body/skin — these are usually short enough to use directly
    ['bodyType', 'skinTone'].forEach(f => { const v = cv(f, 6); physParts.push(...v); });

    // Hair and eyes — construct clean natural phrases
    if (ov('hairColor')) {
        const hc = ov('hairColor').split(/[,;(]/)[0].trim();
        const hs = ov('hairStyle') ? ov('hairStyle').split(/[,;(]/)[0].trim() : '';
        physParts.push(hs ? `${hc} ${hs} hair` : `${hc} hair`);
    }
    if (ov('eyeColor')) {
        physParts.push(`${ov('eyeColor').split(/[,;(]/)[0].trim()} eyes`);
    }

    // Face features — clean and short
    ['faceShape', 'complexion', 'jawType', 'cheekbones', 'eyeShape', 'lipsType']
        .forEach(f => { const v = cv(f, 5); physParts.push(...v); });

    // Distinctive visual marks — clean prose down to keywords
    ['distinctiveFeatures', 'tattoos', 'scarsMarks']
        .forEach(f => { const v = cv(f, 7); physParts.push(...v); });

    // Adult anatomy inline — placed with subject so model anchors correctly
    if (includeNsfw && nsfwLevel !== 'sfw') {
        ['breastSize', 'breastShape', 'areolaeSize', 'nippleColor',
         'penisSize', 'penisShape', 'buttocksSize', 'buttocksShape',
         'bodyHair', 'genitalia', 'intimateMarkings', 'otherAdultFeatures']
            .forEach(f => { const v = cv(f, 6); physParts.push(...v); });
    }

    if (physParts.length) {
        pos.push(`${charName}, ${physParts.filter(Boolean).join(', ')}`);
    } else {
        pos.push(charName);
    }

    // ── 2. Hair style override (scene-level) ──────────────────────────────────
    const hair = sv('hair');
    if (hair) pos.push(hair);

    // ── 3. Clothing ──────────────────────────────────────────────────────────
    const clothingParts = [];

    const clothingState = sv('clothingState');
    if (clothingState) clothingParts.push(clothingState);

    const clothing = sv('clothing');
    if (clothing) clothingParts.push(clothing);

    const clothingTop      = sv('clothingTop');
    const clothingBottom   = sv('clothingBottom');
    const clothingFootwear = sv('clothingFootwear');
    if (clothingTop)      clothingParts.push(clothingTop);
    if (clothingBottom)   clothingParts.push(clothingBottom);
    if (clothingFootwear) clothingParts.push(clothingFootwear);

    // Fallback to char's own style fields only when no scene clothing selected
    if (!clothingParts.length) {
        // outfitDescription can be long prose — clean it
        const outfitKw = cv('outfitDescription', 8);
        if (outfitKw.length) clothingParts.push(...outfitKw);
        // These are usually short single-word descriptors
        ['styleArchetype', 'colorPalette', 'signatureItem', 'footwear',
         'jewelry', 'makeupStyle', 'headwear', 'eyewear']
            .forEach(f => { const v = cv(f, 5); clothingParts.push(...v); });
    }

    const accessories = mv('accessories');
    if (accessories) clothingParts.push(accessories);

    if (clothingParts.length) pos.push(clothingParts.filter(Boolean).join(', '));

    // ── 4–9. Pose / activity / expression / skin FX / camera / focus ──────────
    const pose = sv('pose');        if (pose)     pos.push(pose);
    const activity = sv('activity');if (activity) pos.push(activity);
    const expr = sv('expr');        if (expr)     pos.push(expr);
    const skinFx = mv('skinEffects');if (skinFx)  pos.push(skinFx);
    const cam = sv('cam');          if (cam)      pos.push(cam);
    const bodyFocus = sv('bodyFocus');if (bodyFocus) pos.push(bodyFocus);
    const partners = sv('partners');if (partners) pos.push(partners);

    // ── 10. Environment ───────────────────────────────────────────────────────
    // Only use explicitly-selected env chip — never auto-inject world scenario
    const env = sv('env');
    if (env) pos.push(env);

    // ── 11. Time / weather / mood / vibe / fantasy FX ─────────────────────────
    const timeOfDay = sv('timeOfDay'); if (timeOfDay) pos.push(timeOfDay);
    const weather   = sv('weather');   if (weather)   pos.push(weather);
    const mood      = sv('mood');      if (mood)      pos.push(mood);
    const vibe      = sv('vibe');      if (vibe)      pos.push(vibe);
    const fantasyFx = mv('fantasyFx'); if (fantasyFx) pos.push(fantasyFx);

    // ── 12. Art style ─────────────────────────────────────────────────────────
    pos.push(sv('style') || 'photorealistic photography, 8k');

    // ── 13. Color tone + composition ──────────────────────────────────────────
    const colorTone   = sv('colorTone');   if (colorTone)   pos.push(colorTone);
    const composition = sv('composition'); if (composition) pos.push(composition);

    // ── 14. NSFW tag ──────────────────────────────────────────────────────────
    if (includeNsfw && nsfwLevel !== 'sfw') {
        const nsfwTags = {
            suggestive:   'suggestive, sensual, tasteful nudity',
            explicit:     'explicit, nsfw, uncensored, sexually explicit',
            unrestricted: 'fully explicit, uncensored, maximally detailed adult scene, anatomically correct',
        };
        pos.push(nsfwTags[nsfwLevel] || nsfwTags.explicit);
    }

    // ── 15. Quality tags ──────────────────────────────────────────────────────
    const qualityOverrides = mv('quality');
    if (qualityOverrides) {
        pos.push(qualityOverrides);
    } else {
        pos.push('masterpiece, best quality, highly detailed, sharp focus, cinematic lighting, 8k');
    }

    // ── 16. Homebrew positive injection ───────────────────────────────────────
    if (scene.positive?.trim()) pos.push(scene.positive.trim());
    if (userAddition?.trim())   pos.push(userAddition.trim());

    // ── Negative prompt ───────────────────────────────────────────────────────
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

// ── Shared LLM call helper ────────────────────────────────────────────────────
async function _llmCall({ model, systemPrompt, userMessage, maxTokens = 400, temperature = 0.7 }) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('No API key configured.');
    const LLM_API = 'https://nano-gpt.com/api/v1/chat/completions';
    const res = await fetch(LLM_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model, max_tokens: maxTokens, temperature, stream: false,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userMessage  },
            ],
        }),
    });
    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.error?.message || (typeof j.error === 'string' ? j.error : msg); } catch (_) {}
        throw new Error(msg);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('LLM returned empty response.');
    return content;
}

// ── Shared char context builder ───────────────────────────────────────────────
// Builds a clean, structured character context document for LLM ingestion.
// Deliberately separates narrative prose (personality, scenario) from visual
// facts (physical, style) so the LLM can weight them correctly.
function _buildCharContext(charId, opts = {}) {
    const { includeNsfw = true, includeHistory = false, historyDepth = 8 } = opts;
    const char     = charId ? state.loadedCharacters[charId] : null;
    const override = charId ? getCharOverride(charId) : {};
    // Card's extensions.underdark is the canonical source; user overrides take precedence
    const cardExt  = char?.extensions?.underdark || char?.data?.extensions?.underdark || {};
    const charName = override.nickname || cardExt.nickname || char?.name || 'a character';
    const userName = state.config.userName || 'User';

    const clean = (v) => v ? String(v).replace(/\([^)]*\)/g, '').replace(/;/g, ',').trim() : '';
    // ov() reads override first, falls back to card's extensions.underdark, then card's ext sub-object
    const ov = (f) => {
        const candidates = [override[f], cardExt[f], cardExt.ext?.[f]];
        for (const v of candidates) {
            if (v && String(v).trim() && String(v).toLowerCase() !== 'n/a') return clean(String(v));
        }
        return '';
    };

    const lines = [`CHARACTER: ${charName}`];

    // Physical — structured as key: value pairs for the LLM to reference
    const phys = [];
    if (ov('species'))  phys.push(`species: ${ov('species')}`);
    if (ov('gender'))   phys.push(`gender: ${ov('gender')}`);
    if (ov('age'))      phys.push(`age: ${ov('age')}`);
    if (ov('height'))   phys.push(`height: ${ov('height').split(/[,;]/)[0].trim()}`);
    if (ov('bodyType')) phys.push(`build: ${ov('bodyType')}`);
    if (ov('skinTone')) phys.push(`skin: ${ov('skinTone').split(/[,;]/)[0].trim()}`);
    if (ov('hairColor')) {
        const hc = ov('hairColor').split(/[,;(]/)[0].trim();
        const hs = ov('hairStyle') ? ov('hairStyle').split(/[,;(]/)[0].trim() : '';
        phys.push(`hair: ${hc}${hs ? ', ' + hs : ''}`);
    }
    if (ov('eyeColor')) phys.push(`eyes: ${ov('eyeColor').split(/[,;(]/)[0].trim()}`);
    ['faceShape','complexion','jawType','eyeShape','lipsType'].forEach(f => {
        const v = ov(f); if (v) phys.push(`${f}: ${v.split(/[,;]/)[0].trim()}`);
    });
    if (ov('distinctiveFeatures')) phys.push(`distinctive: ${ov('distinctiveFeatures').slice(0, 120)}`);
    if (ov('tattoos'))   phys.push(`tattoos: ${ov('tattoos').slice(0, 80)}`);
    if (ov('scarsMarks')) phys.push(`scars/marks: ${ov('scarsMarks').slice(0, 80)}`);

    if (includeNsfw) {
        const adult = [];
        ['breastSize','breastShape','areolaeSize','nippleColor','buttocksSize','buttocksShape',
         'bodyHair','genitalia','intimateMarkings','otherAdultFeatures'].forEach(f => {
            const v = ov(f); if (v) adult.push(`${f}: ${v.split(/[,;]/)[0].trim()}`);
        });
        if (adult.length) phys.push(...adult);
    }

    if (phys.length) lines.push('PHYSICAL:\n' + phys.map(p => `  ${p}`).join('\n'));

    // Style / default appearance
    const style = [];
    ['styleArchetype','outfitDescription','colorPalette','signatureItem',
     'footwear','jewelry','makeupStyle','headwear','eyewear'].forEach(f => {
        const v = ov(f); if (v) style.push(`${f}: ${v.slice(0, 80)}`);
    });
    if (style.length) lines.push('DEFAULT STYLE:\n' + style.map(s => `  ${s}`).join('\n'));

    // Prose fallback — if structured fields are sparse, inject card description/personality
    // so the LLM has real character data instead of inventing a generic person.
    if (phys.length < 3 && char?.description) {
        lines.push('CHARACTER DESCRIPTION (use for visual traits):\n  ' + char.description.slice(0, 500));
    }
    if (char?.personality) {
        lines.push('PERSONALITY / VIBE:\n  ' + char.personality.slice(0, 200));
    }

    // Recent conversation history (for scene context)
    if (includeHistory && state.history.length) {
        const recent = state.history.slice(-historyDepth);
        const transcript = recent
            .filter(m => m.role === 'user' || m.role === 'bot')
            .map(m => {
                const speaker = m.role === 'user' ? userName : charName;
                const text = m.content
                    .replace(/<[^>]+>/g, '')
                    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
                    .replace(/_([^_]+)_/g, '$1')
                    .replace(/\s+/g, ' ').trim().slice(0, 280);
                return `  ${speaker}: ${text}`;
            }).join('\n');
        if (transcript) lines.push('RECENT SCENE:\n' + transcript);
    }

    return { charName, context: lines.join('\n\n') };
}

// ── Group context builder ─────────────────────────────────────────────────────
function _buildGroupContext(charIds, opts = {}) {
    const { includeNsfw = true } = opts;
    const gc = state.chat?.groupConfig;
    const sections = [];

    sections.push(`GROUP SCENE — ${charIds.length} CHARACTERS PRESENT:`);

    charIds.forEach(id => {
        const { context } = _buildCharContext(id, { includeNsfw, includeHistory: false });
        sections.push(context);
    });

    // Relationship web from groupConfig
    if (gc?.relationships) {
        const relLines = [];
        for (const [idA, bMap] of Object.entries(gc.relationships)) {
            for (const [idB, desc] of Object.entries(bMap)) {
                const nameA = state.characters.find(c => c.id === idA)?.name || idA;
                const nameB = state.characters.find(c => c.id === idB)?.name || idB;
                relLines.push(`  ${nameA} ↔ ${nameB}: ${desc}`);
            }
        }
        if (relLines.length) sections.push('RELATIONSHIPS:\n' + relLines.join('\n'));
    }

    // Recent history (last few turns across all characters)
    const userName = state.config.userName || 'User';
    if (state.history?.length) {
        const recent = state.history.slice(-8);
        const transcript = recent
            .filter(m => m.role === 'user' || m.role === 'bot')
            .map(m => {
                const char = m.role === 'bot' ? (state.characters.find(c => c.id === m.botId)?.name || 'Character') : userName;
                return `  ${char}: ${m.content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)}`;
            }).join('\n');
        if (transcript) sections.push('RECENT SCENE:\n' + transcript);
    }

    return sections.join('\n\n');
}

// ── LLM-assisted prompt generation ───────────────────────────────────────────
// Reads char JSON + scene builder state + optional chat history and asks the
// LLM to write a clean, visually-accurate image generation prompt.
// Returns the prompt string. Throws on API failure.
export async function generateImagePromptWithLLM(opts = {}) {
    const {
        charId       = state.activeBotId,
        userHint     = '',
        scene        = {},
        historyDepth = 8,
        includeNsfw  = true,
        withNegative = false,
    } = opts;

    const override = charId ? getCharOverride(charId) : {};
    const llmModel = override.modelOverride || state.config.model || 'deepseek-r1';

    // In a group chat with multiple participants, build a combined context for all
    const activeIds = state.activeBotIds || (charId ? [charId] : []);
    const isGroup = activeIds.length > 1 && state.chat?.type === 'group';

    const { context } = isGroup
        ? { context: _buildGroupContext(activeIds, { includeNsfw }) }
        : _buildCharContext(charId, { includeNsfw, includeHistory: true, historyDepth });

    // Scene builder selections — structured list, no raw prose
    const sv2 = (k) => { const v = scene[k]; if (!v) return ''; if (v === '__custom__') return scene[`${k}Custom`] || ''; return String(v); };
    const mv2 = (k) => { const v = scene[k]; if (!v) return ''; if (v instanceof Set) return [...v].join(', '); if (Array.isArray(v)) return v.join(', '); return String(v); };
    const sceneParts = [
        sv2('clothingState') && `clothing state: ${sv2('clothingState')}`,
        sv2('clothing')      && `outfit type: ${sv2('clothing')}`,
        sv2('clothingTop')   && `top: ${sv2('clothingTop')}`,
        sv2('clothingBottom')&& `bottom: ${sv2('clothingBottom')}`,
        sv2('clothingFootwear')&&`footwear: ${sv2('clothingFootwear')}`,
        mv2('accessories')   && `accessories: ${mv2('accessories')}`,
        sv2('hair')          && `hair style: ${sv2('hair')}`,
        sv2('pose')          && `pose: ${sv2('pose')}`,
        sv2('activity')      && `activity: ${sv2('activity')}`,
        sv2('expr')          && `expression: ${sv2('expr')}`,
        mv2('skinEffects')   && `skin effects: ${mv2('skinEffects')}`,
        sv2('cam')           && `camera: ${sv2('cam')}`,
        sv2('bodyFocus')     && `focus: ${sv2('bodyFocus')}`,
        sv2('partners')      && `with: ${sv2('partners')}`,
        sv2('env')           && `location: ${sv2('env')}`,
        sv2('timeOfDay')     && `time of day: ${sv2('timeOfDay')}`,
        sv2('weather')       && `weather: ${sv2('weather')}`,
        sv2('mood')          && `lighting: ${sv2('mood')}`,
        sv2('vibe')          && `vibe: ${sv2('vibe')}`,
        mv2('fantasyFx')     && `fantasy fx: ${mv2('fantasyFx')}`,
        sv2('style')         && `art style: ${sv2('style')}`,
        sv2('colorTone')     && `color tone: ${sv2('colorTone')}`,
        sv2('composition')   && `composition: ${sv2('composition')}`,
        includeNsfw && scene.nsfw && scene.nsfw !== 'sfw' && `content level: ${scene.nsfw}`,
        scene.positive?.trim() && `extra details: ${scene.positive.trim()}`,
    ].filter(Boolean);

    const sceneBlock = sceneParts.length
        ? 'SCENE BUILDER SELECTIONS:\n' + sceneParts.map(p => `  ${p}`).join('\n')
        : '';

    const userBlock = userHint.trim() ? `USER DIRECTION: ${userHint.trim()}` : '';

    const fullContext = [context, sceneBlock, userBlock].filter(Boolean).join('\n\n');

    const groupNote = isGroup
        ? `\n- This is a GROUP SCENE with multiple characters — describe all of them together in the frame\n- List each character's name and key visual traits, then describe them as an ensemble\n- Composition should show interaction / spatial relationship between characters`
        : '';

    const systemPrompt = withNegative
        ? `You are a master image prompt engineer for AI art generators (Stable Diffusion, FLUX, HiDream).

You receive a structured character sheet and scene description. Write a precise, visually-rich image generation prompt.

Respond with ONLY a JSON object — no markdown fences, no explanation:
{
  "positive": "...",
  "negative": "..."
}

POSITIVE PROMPT RULES:
- Comma-separated visual keywords and short phrases — no sentences, no narrative
- First: character name + core visual identity (hair colour, eye colour, defining features)
- Then: current state (clothing/nudity, pose, expression)
- Then: environment, lighting, atmosphere
- Then: camera/composition
- End with: masterpiece, best quality, highly detailed, sharp focus, 8k
- Include explicit anatomy naturally if NSFW level is provided — but as clean keywords, not prose
- Do NOT invent physical traits not in the character sheet
- Max 200 words${groupNote}

NEGATIVE PROMPT RULES:
- Only standard quality/anatomy failure modes
- Max 60 words`
        : `You are a master image prompt engineer for AI art generators (Stable Diffusion, FLUX, HiDream).

You receive a structured character sheet and scene description. Write a precise, visually-rich image generation prompt.

Output ONLY the prompt — no preamble, no explanation, no markdown.

RULES:
- Comma-separated visual keywords and short phrases — no sentences, no narrative prose
- First: character name + core visual identity (defining hair, eyes, skin, build)
- Then: current appearance state (clothing, pose, expression)
- Then: environment, time of day, lighting, atmosphere
- Then: camera angle, composition, focus
- End with: masterpiece, best quality, highly detailed, sharp focus, 8k
- Include explicit anatomy as clean keywords if NSFW level is in the context
- Do NOT invent traits not present in the character sheet
- Max 200 words${groupNote}`;

    const content = await _llmCall({
        model: llmModel,
        systemPrompt,
        userMessage: `${fullContext}\n\nWrite the image generation prompt now.`,
        maxTokens: 450,
        temperature: 0.65,
    });

    if (withNegative) {
        try {
            const clean = content.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
            const parsed = JSON.parse(clean);
            if (parsed.positive) return { positive: parsed.positive, negative: parsed.negative || '' };
        } catch (_) {}
        return { positive: content, negative: '' };
    }

    return content;
}

// ── Describe Scene — AI scene description with adjustable weights ─────────────
// The "Describe Scene" button flow:
//   1. Takes the character's JSON fields as the physical baseline
//   2. Reads the studio's current chip selections as the scene state
//   3. Optionally reads recent chat history for what's happening right now
//   4. User can supply a free-text hint
//   5. charWeight (0–1) controls how much detail goes to physical description
//   6. sceneWeight (0–1) controls how much detail goes to environment/atmosphere
//
// Returns { positive, negative }. Throws on API failure.
export async function describeSceneWithLLM(opts = {}) {
    const {
        charId      = state.activeBotId,
        scene       = {},
        userHint    = '',
        charWeight  = 0.7,   // 0 = barely mention char, 1 = full detailed char desc
        sceneWeight = 0.5,   // 0 = ignore scene, 1 = rich environment description
        includeNsfw = true,
        historyDepth = 4,
    } = opts;

    const override  = charId ? getCharOverride(charId) : {};
    const llmModel  = override.modelOverride || state.config.model || 'deepseek-r1';

    const { context } = _buildCharContext(charId, {
        includeNsfw,
        includeHistory: sceneWeight > 0.3 && historyDepth > 0,
        historyDepth,
    });

    // Scene builder — only include if sceneWeight is significant
    const sv2 = (k) => { const v = scene[k]; if (!v) return ''; if (v === '__custom__') return scene[`${k}Custom`] || ''; return String(v); };
    const mv2 = (k) => { const v = scene[k]; if (!v) return ''; if (v instanceof Set) return [...v].join(', '); if (Array.isArray(v)) return v.join(', '); return String(v); };

    const sceneLines = [];
    // Appearance state (always relevant)
    if (sv2('clothingState')) sceneLines.push(`clothing state: ${sv2('clothingState')}`);
    if (sv2('clothing'))      sceneLines.push(`outfit: ${sv2('clothing')}`);
    if (sv2('clothingTop'))   sceneLines.push(`top: ${sv2('clothingTop')}`);
    if (sv2('clothingBottom'))sceneLines.push(`bottom: ${sv2('clothingBottom')}`);
    if (sv2('clothingFootwear'))sceneLines.push(`footwear: ${sv2('clothingFootwear')}`);
    if (mv2('accessories'))   sceneLines.push(`accessories: ${mv2('accessories')}`);
    if (sv2('hair'))          sceneLines.push(`hair: ${sv2('hair')}`);
    if (sv2('pose'))          sceneLines.push(`pose: ${sv2('pose')}`);
    if (sv2('activity'))      sceneLines.push(`activity: ${sv2('activity')}`);
    if (sv2('expr'))          sceneLines.push(`expression: ${sv2('expr')}`);
    if (mv2('skinEffects'))   sceneLines.push(`skin effects: ${mv2('skinEffects')}`);
    if (sv2('cam'))           sceneLines.push(`camera: ${sv2('cam')}`);
    if (sv2('bodyFocus'))     sceneLines.push(`body focus: ${sv2('bodyFocus')}`);
    if (sv2('partners'))      sceneLines.push(`with: ${sv2('partners')}`);
    // Environment (weighted)
    if (sceneWeight > 0.2) {
        if (sv2('env'))       sceneLines.push(`location: ${sv2('env')}`);
        if (sv2('timeOfDay')) sceneLines.push(`time of day: ${sv2('timeOfDay')}`);
        if (sv2('weather'))   sceneLines.push(`weather: ${sv2('weather')}`);
        if (sv2('mood'))      sceneLines.push(`lighting: ${sv2('mood')}`);
        if (sv2('vibe'))      sceneLines.push(`vibe: ${sv2('vibe')}`);
        if (mv2('fantasyFx')) sceneLines.push(`fantasy fx: ${mv2('fantasyFx')}`);
    }
    if (sv2('style'))         sceneLines.push(`art style: ${sv2('style')}`);
    if (sv2('colorTone'))     sceneLines.push(`color tone: ${sv2('colorTone')}`);
    if (sv2('composition'))   sceneLines.push(`composition: ${sv2('composition')}`);
    if (includeNsfw && scene.nsfw && scene.nsfw !== 'sfw') sceneLines.push(`content level: ${scene.nsfw}`);
    if (scene.positive?.trim()) sceneLines.push(`extra: ${scene.positive.trim()}`);

    const sceneBlock = sceneLines.length
        ? 'SCENE STATE:\n' + sceneLines.map(l => `  ${l}`).join('\n')
        : '';

    const charDepth = charWeight >= 0.8 ? 'full detail — describe every listed physical trait precisely'
        : charWeight >= 0.5 ? 'moderate — key defining features: hair, eyes, skin, build, top 2-3 distinguishing marks'
        : 'minimal — name + 3-4 most iconic visual traits only';

    const sceneDepth = sceneWeight >= 0.8 ? 'rich environment — describe setting, atmosphere, lighting, mood in detail'
        : sceneWeight >= 0.4 ? 'moderate — scene location, lighting quality, general atmosphere'
        : 'minimal — just the immediate action and expression';

    const systemPrompt = `You are a master image prompt engineer for AI art generators (Stable Diffusion, FLUX, HiDream).

Given a character sheet and current scene state, write a single image generation prompt.

CHARACTER DEPTH INSTRUCTION: ${charDepth}
SCENE DEPTH INSTRUCTION: ${sceneDepth}

OUTPUT FORMAT — comma-separated visual tags and short phrases, ordered as:
1. Character name + physical identity (per character depth)
2. Current appearance state (clothing, pose, expression — always include)
3. Environment and atmosphere (per scene depth)
4. Camera, framing, composition
5. Art style and quality tags

RULES:
- Plain text only — no JSON, no markdown, no explanation
- No narrative sentences — only visual descriptors and concrete nouns
- Do NOT invent physical traits absent from the character sheet
- Include explicit anatomy as clean keywords if content level is present
- End with: masterpiece, best quality, highly detailed, sharp focus, 8k
- Max 180 words`;

    const hint = userHint.trim() ? `\n\nUSER DIRECTION: ${userHint.trim()}` : '';
    const fullContext = [context, sceneBlock].filter(Boolean).join('\n\n') + hint;

    const positive = await _llmCall({
        model:       llmModel,
        systemPrompt,
        userMessage: `${fullContext}\n\nWrite the image prompt now.`,
        maxTokens:   380,
        temperature: 0.6,
    });

    // Build negative using the standard helper (no LLM needed for this)
    const nsfwNeg = (includeNsfw && scene.nsfw && scene.nsfw !== 'sfw')
        ? ''
        : 'nude, naked, nsfw, explicit, genitalia, exposed';
    const negative = [
        scene.negative?.trim() || '',
        'worst quality, low quality, jpeg artifacts, blurry, deformed, bad anatomy, extra limbs, missing limbs, extra fingers, fused fingers, watermark, text, signature',
        nsfwNeg,
    ].filter(Boolean).join(', ');

    return { positive, negative };
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
    const cardExt  = char?.extensions?.underdark || char?.data?.extensions?.underdark || {};
    const charName = override.nickname || cardExt.nickname || char?.name || 'the character';
    const userName = state.config.userName || 'User';
    const llmModel = override.modelOverride || state.config.model || 'deepseek-r1';

    const _pick = (f) => { for (const v of [override[f], cardExt[f], cardExt.ext?.[f]]) { if (v && String(v).trim()) return String(v).trim(); } return ''; };
    const parts = [];
    const physFields = [];
    const addPh = (...keys) => keys.forEach(k => { const v = _pick(k); if (v) physFields.push(v); });
    addPh('species','gender','age','height','bodyType','skinTone');
    const hc = _pick('hairColor'), hs = _pick('hairStyle');
    if (hc) physFields.push(`${hc}${hs ? ` ${hs}` : ''} hair`);
    const ec = _pick('eyeColor');
    if (ec) physFields.push(`${ec} eyes`);
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
