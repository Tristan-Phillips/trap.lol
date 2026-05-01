/**
 * parser-v2.js — Character Card Parser
 * Supports: SillyTavern V1/V2 PNG, Chub PNG, JSON, inline creation
 * Extracts avatar image data from PNG cards.
 */

export async function parseCharacterCard(file) {
    if (file.size > 15 * 1024 * 1024) {
        throw new Error('File too large (max 15 MB). Use a smaller card or JSON format.');
    }
    if (file.type === 'application/json' || file.name.endsWith('.json')) {
        return parseJson(file);
    }
    if (file.type === 'image/png' || file.name.endsWith('.png')) {
        return parsePng(file);
    }
    throw new Error('Unsupported format. Provide a PNG or JSON character card.');
}

async function parseJson(file) {
    const text = await file.text();
    return normalizeData(JSON.parse(text));
}

async function parsePng(file) {
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > 15 * 1024 * 1024) {
        throw new Error('PNG too large.');
    }
    const view   = new DataView(buffer);

    if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
        throw new Error('Not a valid PNG file.');
    }

    let offset   = 8;
    let charaData = null;
    let avatarDataUrl = null;

    // Extract avatar as data URL from the PNG itself
    try {
        const blob = new Blob([buffer], { type: 'image/png' });
        avatarDataUrl = await blobToDataUrl(blob);
    } catch (_) {}

    while (offset < view.byteLength - 12) {
        const length = view.getUint32(offset);
        const type   = String.fromCharCode(
            view.getUint8(offset + 4), view.getUint8(offset + 5),
            view.getUint8(offset + 6), view.getUint8(offset + 7)
        );

        if (type === 'tEXt' || type === 'iTXt') {
            const bytes = new Uint8Array(buffer, offset + 8, length);
            const text  = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
            if (text.startsWith('chara\0')) {
                charaData = text.slice(6);
                break;
            }
        }

        if (type === 'chara') {
            const bytes = new Uint8Array(buffer, offset + 8, length);
            charaData   = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
            break;
        }

        if (type === 'IEND') break;
        if (length > buffer.byteLength) break; // guard corrupted files
        offset += length + 12;
    }

    if (!charaData) {
        throw new Error('No character metadata found in this PNG. Make sure it is a valid character card.');
    }

    let parsed;
    try {
        parsed = JSON.parse(atob(charaData));
    } catch (_) {
        try {
            parsed = JSON.parse(charaData);
        } catch (e) {
            throw new Error('Character metadata is corrupted or in an unknown format.');
        }
    }

    const card = normalizeData(parsed);
    if (avatarDataUrl && !card.avatar) {
        card.avatar = avatarDataUrl;
    }
    return card;
}

function blobToDataUrl(blob) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(blob);
    });
}

/**
 * Normalizes V1, V2, Chub, and raw JSON into a canonical card shape.
 */
export function normalizeData(raw) {
    const d = raw.data || raw;

    return {
        // Core identity
        name:        d.name        || d.char_name   || 'Unnamed Character',
        description: d.description || d.char_persona || '',
        personality: d.personality || '',
        scenario:    d.scenario    || '',
        // Dialogue
        first_mes:   d.first_mes   || '',
        mes_example: d.mes_example || '',
        alternate_greetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings : [],
        // Prompt engineering
        system_prompt:             d.system_prompt              || '',
        post_history_instructions: d.post_history_instructions  || '',
        // Meta
        creator_notes: d.creator_notes || '',
        tags:          Array.isArray(d.tags) ? d.tags : [],
        creator:       d.creator  || '',
        version:       d.character_version || d.version || '1.0',
        // Extensions (Chub / extra fields)
        extensions:    d.extensions || {},
        // Visuals — may be base64 data URL or path
        avatar: d.avatar || raw.avatar || null
    };
}

/**
 * Builds a new blank card from a plain object (for the character creator UI).
 */
export function buildCard(fields) {
    return normalizeData({ data: fields });
}
