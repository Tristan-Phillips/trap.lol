/**
 * parser-v2.js
 * Robust Character Card Parser (PNG V1/V2 & JSON)
 * Decodes tEXt chunks and chara chunks for SillyTavern/Chub compatibility.
 */

export async function parseCharacterCard(file) {
    if (file.type === 'application/json' || file.name.endsWith('.json')) {
        return parseJson(file);
    }
    if (file.type === 'image/png' || file.name.endsWith('.png')) {
        return parsePng(file);
    }
    throw new Error('Unsupported file format. Please provide a PNG or JSON card.');
}

async function parseJson(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    return normalizeData(data);
}

async function parsePng(file) {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    
    // Check PNG signature
    if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {
        throw new Error('Not a valid PNG file.');
    }

    let offset = 8;
    let charaData = null;

    while (offset < view.byteLength) {
        const length = view.getUint32(offset);
        const type = new TextDecoder().decode(buffer.slice(offset + 4, offset + 8));
        
        if (type === 'tEXt' || type === 'iTXt') {
            const chunkData = new Uint8Array(buffer.slice(offset + 8, offset + 8 + length));
            const text = new TextDecoder().decode(chunkData);
            
            // Look for 'chara' keyword in tEXt/iTXt (V1 format)
            if (text.startsWith('chara\0')) {
                charaData = text.slice(6); // Skip 'chara\0'
                break;
            }
        }

        if (type === 'chara') {
            // V2 format: dedicated 'chara' chunk, usually base64 encoded
            const chunkData = new Uint8Array(buffer.slice(offset + 8, offset + 8 + length));
            const text = new TextDecoder().decode(chunkData);
            charaData = text;
            break;
        }

        if (type === 'IEND') break;
        offset += length + 12; // Length(4) + Type(4) + Data(length) + CRC(4)
    }

    if (!charaData) {
        throw new Error('No character metadata found in PNG. Ensure this is a valid character card.');
    }

    try {
        // Try decoding as Base64 (V2 standard)
        const decoded = atob(charaData);
        return normalizeData(JSON.parse(decoded));
    } catch (e) {
        // Fallback to raw JSON (V1 standard)
        try {
            return normalizeData(JSON.parse(charaData));
        } catch (e2) {
            throw new Error('Failed to parse character metadata. The data may be corrupted or in an unknown format.');
        }
    }
}

/**
 * Normalizes different card formats (V1, V2, Chub, SillyTavern) into a standard format.
 */
function normalizeData(raw) {
    // If it's a V2 card, the data is inside a 'data' property
    const d = raw.data || raw;
    
    return {
        name:        d.name || d.char_name || 'Unknown Fragment',
        description: d.description || d.char_persona || '',
        personality: d.personality || '',
        scenario:    d.scenario || '',
        first_mes:   d.first_mes || d.mes_example || '',
        mes_example: d.mes_example || '',
        creator_notes: d.creator_notes || '',
        system_prompt: d.system_prompt || '',
        post_history_instructions: d.post_history_instructions || '',
        alternate_greetings: d.alternate_greetings || [],
        tags:        d.tags || [],
        creator:     d.creator || '',
        version:     d.version || '1.0',
        // Visuals
        avatar:      raw.avatar || null // PNG parser doesn't extract pixels here, caller handles file URL
    };
}
