/**
 * char-creator.js — Full-featured character creation & editing studio.
 * Covers all chara_card_v2 fields + extensions.underdark (core + ext).
 * Produces ready-to-use JSON that drops into data/cards/ and data/index.json.
 */

import { state, saveCharacter, deleteCharacter, getCharOverride, setCharOverride, defaultCharOverride } from './state.js';
import { normalizeData } from './parser-v2.js';
import { saveAvatar, loadAvatar, isDataUrl } from './storage.js';

const qs  = (sel, ctx = document) => ctx.querySelector(sel);
const qsa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(str) {
    return str.toLowerCase().trim()
        .replace(/['']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function generateId(name) {
    return `${slugify(name) || 'char'}-${Date.now().toString(36)}`;
}

function readField(id, fallback = '') {
    const el = qs(`#cc-${id}`);
    return el ? el.value : fallback;
}

function setField(id, val) {
    const el = qs(`#cc-${id}`);
    if (el) el.value = (val == null ? '' : val);
}

function readSlider(key) {
    const el = qs(`#cc-sl-${key}`);
    return el ? parseFloat(el.value) : null;
}

function setSlider(key, val) {
    const el = qs(`#cc-sl-${key}`);
    if (!el) return;
    el.value = val;
    syncSliderBadge(key, val);
}

const SLIDER_DESCS = {
    dominanceLevel: [[0,15,'Deeply submissive'],[16,30,'Mostly submissive'],[31,45,'Slightly passive'],[46,55,'Balanced'],[56,70,'Quietly assertive'],[71,85,'Dominant'],[86,100,'Strongly dominant']],
    explicitnessLevel: [[0,15,'Fade-to-black'],[16,30,'Tasteful'],[31,45,'Suggestive'],[46,55,'Moderate'],[56,70,'Mature'],[71,85,'Explicit'],[86,100,'Fully explicit']],
    romanticismLevel: [[0,15,'Ice cold'],[16,30,'Distant'],[31,45,'Reserved'],[46,55,'Warm'],[56,70,'Romantic'],[71,85,'Intensely romantic'],[86,100,'Achingly passionate']],
    violenceLevel: [[0,15,'Non-violent'],[16,30,'Low'],[31,45,'Moderate'],[46,55,'Visceral'],[56,70,'Graphic'],[71,85,'Very graphic'],[86,100,'Extreme']],
    anxietyLevel: [[0,15,'Unflappable'],[16,30,'Serene'],[31,45,'Mildly anxious'],[46,55,'Moderate'],[56,70,'Anxious'],[71,85,'Hypervigilant'],[86,100,'Paranoid']],
    loyaltyLevel: [[0,15,'Self-serving'],[16,30,'Fickle'],[31,45,'Conditional'],[46,55,'Reliable'],[56,70,'Loyal'],[71,85,'Fiercely loyal'],[86,100,'Absolute loyalty']],
    stubbornness: [[0,15,'Malleable'],[16,30,'Open'],[31,45,'Adaptable'],[46,55,'Steady'],[56,70,'Stubborn'],[71,85,'Obstinate'],[86,100,'Immovable']],
    selfEsteemLevel: [[0,15,'Self-loathing'],[16,30,'Low self-worth'],[31,45,'Fragile'],[46,55,'Average'],[56,70,'Grounded'],[71,85,'Confident'],[86,100,'Bulletproof']],
    curiosityLevel: [[0,20,'Incurious'],[21,40,'Mildly inquisitive'],[41,60,'Averagely curious'],[61,80,'Highly curious'],[81,100,'Insatiably curious']],
    empathyLevel: [[0,20,'Predatory'],[21,40,'Callous'],[41,60,'Moderate'],[61,80,'Empathic'],[81,100,'Deeply empathic']],
};

function sliderDesc(key, val) {
    const ranges = SLIDER_DESCS[key];
    if (!ranges) return '';
    const v = parseFloat(val);
    for (const [lo, hi, txt] of ranges) { if (v >= lo && v <= hi) return txt; }
    return '';
}

function syncSliderBadge(key, val) {
    const badge = qs(`#cc-sl-badge-${key}`);
    const desc  = qs(`#cc-sl-desc-${key}`);
    if (badge) badge.textContent = val;
    if (desc)  desc.textContent  = sliderDesc(key, val);
}

// ── State ─────────────────────────────────────────────────────────────────────

let _editId        = null;   // null = create, string = edit existing
let _avatarDataUrl = null;   // current avatar (data URL, emoji, or remote URL)
let _additionalAvatars = []; // gallery images for this character

// ── Init ──────────────────────────────────────────────────────────────────────

export function initCharCreator() {
    const $modal = qs('#modal-char-creator');
    if (!$modal) return;

    // ── Open triggers ─────────────────────────────────────────────────────────
    qs('#create-character')?.addEventListener('click', () => openCreator(null));

    // Edit button on character cards (delegated, fired by ui.js via custom event)
    document.addEventListener('char-creator:open', e => openCreator(e.detail?.charId || null));

    // ── Close / backdrop ──────────────────────────────────────────────────────
    qs('#cc-close')?.addEventListener('click', closeCreator);
    qs('#cc-cancel')?.addEventListener('click', closeCreator);
    qs('.cc-backdrop')?.addEventListener('click', closeCreator);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !$modal.hidden) closeCreator();
    });

    // ── Tab switching ─────────────────────────────────────────────────────────
    qsa('.cc-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // ── Avatar handling ───────────────────────────────────────────────────────
    qs('#cc-avatar-upload-btn')?.addEventListener('click', () => qs('#cc-avatar-file')?.click());
    qs('#cc-avatar-file')?.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => setAvatarPreview(ev.target.result);
        reader.readAsDataURL(file);
        e.target.value = '';
    });

    qs('#cc-avatar-url-btn')?.addEventListener('click', () => {
        const url = qs('#cc-avatar-url-input')?.value.trim();
        if (url) setAvatarPreview(url);
    });

    qs('#cc-avatar-clear')?.addEventListener('click', () => {
        _avatarDataUrl = null;
        const $p = qs('#cc-avatar-preview');
        if ($p) { $p.style.backgroundImage = 'none'; $p.classList.remove('has-image'); }
        qs('#cc-avatar-url-input').value = '';
    });

    // ── Gallery uploads ───────────────────────────────────────────────────────
    qs('#cc-gallery-add-btn')?.addEventListener('click', () => qs('#cc-gallery-file')?.click());
    qs('#cc-gallery-file')?.addEventListener('change', async e => {
        for (const file of [...e.target.files]) {
            const dataUrl = await readFileAsDataUrl(file);
            _additionalAvatars.push({ url: dataUrl, label: '' });
        }
        renderGalleryStrip();
        e.target.value = '';
    });

    qs('#cc-gallery-url-btn')?.addEventListener('click', () => {
        const url = qs('#cc-gallery-url-input')?.value.trim();
        if (!url) return;
        _additionalAvatars.push({ url, label: '' });
        renderGalleryStrip();
        qs('#cc-gallery-url-input').value = '';
    });

    // ── Import existing card to prefill ───────────────────────────────────────
    qs('#cc-import-btn')?.addEventListener('click', () => qs('#cc-import-file')?.click());
    qs('#cc-import-file')?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const { parseCharacterCard } = await import('./parser-v2.js');
            const card = await parseCharacterCard(file);
            populateFromCard(null, card, null);
            showToast('Card imported — review and save.', 'info');
        } catch (err) {
            showToast(`Import failed: ${err.message}`, 'error');
        }
        e.target.value = '';
    });

    qs('#cc-open-sims')?.addEventListener('click', () => {
        if (!_editId) {
            showToast('Save the character first to use the visual editor.', 'warn');
            return;
        }
        document.dispatchEvent(new CustomEvent('sims-editor:open', { detail: { charId: _editId } }));
        closeCreator();
    });

    // ── Slider live sync ──────────────────────────────────────────────────────
    qsa('.cc-slider').forEach($sl => {
        const key = $sl.dataset.key;
        $sl.addEventListener('input', () => syncSliderBadge(key, $sl.value));
    });

    // ── Field Syncing (Sidebar <-> Identity Tab) ──────────────────────────────
    const syncFields = (id1, id2) => {
        const el1 = qs(`#cc-${id1}`);
        const el2 = qs(`#cc-${id2}`);
        if (!el1 || !el2) return;
        el1.addEventListener('input', () => { el2.value = el1.value; if (id1 === 'name') updateHeader(); });
        el2.addEventListener('input', () => { el1.value = el2.value; if (id1 === 'name') updateHeader(); });
    };
    syncFields('name', 'name-sync');
    syncFields('tagline', 'tagline-sync');

    // ── Auto-generate ID from name ────────────────────────────────────────────
    qs('#cc-name')?.addEventListener('input', debounce(() => {
        if (_editId) return; // don't overwrite id when editing
        const name = qs('#cc-name').value.trim();
        setField('id-preview', name ? generateId(name) : '');
    }, 300));

    // ── Save & Export ─────────────────────────────────────────────────────────
    qs('#cc-save')?.addEventListener('click',         () => saveCard(false));
    qs('#cc-save-activate')?.addEventListener('click',() => saveCard(true));
    qs('#cc-export-json')?.addEventListener('click',  exportJson);
    qs('#cc-topbar-export')?.addEventListener('click',exportJson);
    qs('#cc-export-codebase')?.addEventListener('click', exportToCodebase);

    return { open: openCreator, close: closeCreator };
}

// ── Open / Close ──────────────────────────────────────────────────────────────

async function openCreator(charId) {
    _editId            = charId || null;
    _avatarDataUrl     = null;
    _additionalAvatars = [];

    resetForm();
    switchTab('identity');

    if (charId) {
        const card = state.loadedCharacters[charId];
        const meta = state.characters.find(c => c.id === charId);
        if (card && meta) {
            await populateFromCard(meta, card, charId);
        }
    }

    const $modal = qs('#modal-char-creator');
    if ($modal) { $modal.hidden = false; if (window.lucide) window.lucide.createIcons(); }
    updateHeader();
}

function closeCreator() {
    const $modal = qs('#modal-char-creator');
    if ($modal) $modal.hidden = true;
    _editId            = null;
    _avatarDataUrl     = null;
    _additionalAvatars = [];
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tab) {
    qsa('.cc-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    qsa('.cc-tab-panel').forEach(p => p.hidden = p.dataset.panel !== tab);
}

// ── Header update ─────────────────────────────────────────────────────────────

function updateHeader() {
    const $title = qs('#cc-modal-title');
    const $badge = qs('#cc-char-badge');
    const name   = readField('name') || '—';
    if ($title) $title.textContent = _editId ? 'Edit Character' : 'Create Character';
    if ($badge) $badge.textContent = name;
}

// ── Form population ───────────────────────────────────────────────────────────

function resetForm() {
    qsa('#modal-char-creator input, #modal-char-creator textarea, #modal-char-creator select').forEach(el => {
        if (el.type === 'file' || el.type === 'checkbox' || el.type === 'radio') return;
        el.value = '';
    });
    qsa('#modal-char-creator input[type=checkbox]').forEach(el => el.checked = false);

    // Reset sliders to defaults
    const DEFAULTS = {
        dominanceLevel: 50, explicitnessLevel: 50, romanticismLevel: 50, violenceLevel: 30,
        anxietyLevel: 40, loyaltyLevel: 60, stubbornness: 50, selfEsteemLevel: 55,
        curiosityLevel: 60, empathyLevel: 50,
    };
    Object.entries(DEFAULTS).forEach(([k, v]) => setSlider(k, v));

    const $prev = qs('#cc-avatar-preview');
    if ($prev) { $prev.style.backgroundImage = 'none'; $prev.classList.remove('has-image'); }

    qs('#cc-gallery-strip').innerHTML = '';
    setField('id-preview', '');
    setField('name-sync', '');
    setField('tagline-sync', '');
    qs('#cc-version').value = '1.0';
    qs('#cc-creator').value = 'trap.lol';
    qs('#cc-spec-version').value = '2.0';
}

async function populateFromCard(meta, card, charId) {
    // Core card fields
    setField('name',           card.name || '');
    setField('name-sync',      card.name || '');
    setField('tagline',        meta?.tagline || '');
    setField('tagline-sync',   meta?.tagline || '');
    setField('description',    card.description || '');
    setField('personality',    card.personality || '');
    setField('scenario',       card.scenario || '');
    setField('first-mes',      card.first_mes || '');
    setField('mes-example',    card.mes_example || '');
    setField('alt-greetings',  (card.alternate_greetings || []).join('\n---\n'));
    setField('system-prompt',  card.system_prompt || '');
    setField('post-history',   card.post_history_instructions || '');
    setField('creator-notes',  card.creator_notes || '');
    setField('creator',        card.creator || 'trap.lol');
    setField('version',        card.version || card.character_version || '1.0');
    setField('tags',           (meta?.tags || card.tags || []).join(', '));
    setField('id-preview',     charId || '');

    // Use merged getCharOverride view (card data + any sims/persona edits layered on top)
    // so both editors always show the same values.
    const merged = charId ? getCharOverride(charId) : null;
    const ud  = card.extensions?.underdark || {};
    // For each field: merged view wins when charId is known; card data is fallback for new imports
    const ov  = merged || ud;
    const ext = merged?.ext || ud.ext || {};

    // Core underdark overrides
    setField('nickname',             ov.nickname             || ud.nickname             || '');
    setField('voice-tone',           ov.voiceTone            || ud.voiceTone            || '');
    setField('speech-patterns',      ov.speechPatterns       || ud.speechPatterns       || '');
    setField('species',              ov.species              || ud.species              || '');
    setField('gender',               ov.gender               || ud.gender               || '');
    setField('age',                  ov.age                  || ud.age                  || '');
    setField('height',               ov.height               || ud.height               || '');
    setField('body-type',            ov.bodyType             || ud.bodyType             || '');
    setField('skin-tone',            ov.skinTone             || ud.skinTone             || '');
    setField('hair-color',           ov.hairColor            || ud.hairColor            || '');
    setField('hair-style',           ov.hairStyle            || ud.hairStyle            || '');
    setField('eye-color',            ov.eyeColor             || ud.eyeColor             || '');
    setField('distinctive-features', ov.distinctiveFeatures  || ud.distinctiveFeatures  || '');
    setField('breast-size',          ov.breastSize           || ud.breastSize           || '');
    setField('nipple-color',         ov.nippleColor          || ud.nippleColor          || '');
    setField('areolae-size',         ov.areolaeSize          || ud.areolaeSize          || '');
    setField('body-hair',            ov.bodyHair             || ud.bodyHair             || '');
    setField('genitalia',            ov.genitalia            || ud.genitalia            || '');
    setField('other-adult',          ov.otherAdultFeatures   || ud.otherAdultFeatures   || '');
    setField('append-system',        ov.appendToSystem       || ud.appendToSystem       || '');
    setField('persistent-memory',    ov.persistentMemory     || ud.persistentMemory     || '');
    setField('model-override',       ov.modelOverride        || ud.modelOverride        || '');
    setField('system-override',      ov.systemPromptOverride || ud.systemPromptOverride || '');
    setField('post-override',        ov.postHistoryOverride  || ud.postHistoryOverride  || '');

    const sliderKeys = ['dominanceLevel','explicitnessLevel','romanticismLevel','violenceLevel',
                        'anxietyLevel','loyaltyLevel','stubbornness','selfEsteemLevel','curiosityLevel','empathyLevel'];
    sliderKeys.forEach(k => {
        const v = ov[k] ?? ud[k];
        if (v != null) setSlider(k, v);
    });

    const enabledCb = qs('#cc-enabled');
    if (enabledCb) enabledCb.checked = (ov.enabled ?? ud.enabled) !== false;

    // Extended fields
    const EXT_MAP = [
        // Identity
        ['ext-name','name'],['ext-pronouns','pronouns'],['ext-occupation','occupation'],
        ['ext-nationality','nationality'],['ext-aliases','aliases'],['ext-ethnicity','ethnicity'],
        ['ext-birthday','birthday'],['ext-location','location'],['ext-native-lang','nativeLanguage'],
        ['ext-languages','languagesSpoken'],['ext-zodiac','zodiac'],['ext-mbti','mbti'],
        ['ext-enneagram','enneagram'],
        // Face
        ['ext-face-shape','faceShape'],['ext-complexion','complexion'],['ext-jaw','jawType'],
        ['ext-cheekbones','cheekbones'],['ext-forehead','foreheadType'],['ext-undertone','skinUndertone'],
        ['ext-skin-texture','skinTexture'],['ext-eye-shape','eyeShape'],['ext-eye-spacing','eyeSpacing'],
        ['ext-eye-detail','eyeDetail'],['ext-eyebrow','eyebrowShape'],['ext-eyelashes','eyelashes'],
        ['ext-nose','noseType'],['ext-lips','lipsType'],['ext-lip-color','lipColor'],
        ['ext-teeth','teethType'],['ext-face-piercings','facePiercings'],['ext-facial-hair','facialHair'],
        // Hair
        ['ext-hair-highlights','hairHighlights'],['ext-hair-length','hairLength'],
        ['ext-hair-texture','hairTexture'],['ext-hair-density','hairDensity'],
        ['ext-hair-dyed','hairDyed'],['ext-hair-fade','hairFade'],['ext-hair-accessories','hairAccessories'],
        // Body
        ['ext-weight','weight'],['ext-shoulder','shoulderWidth'],['ext-waist','waistType'],
        ['ext-leg-type','legType'],['ext-hand-size','handSize'],['ext-posture','posture'],
        ['ext-gait','gait'],['ext-body-markings','bodyMarkings'],['ext-body-piercings','bodyPiercings'],
        ['ext-scent','scent'],['ext-tattoos','tattoos'],['ext-scars','scarsMarks'],
        ['ext-nail-length','nailLength'],['ext-nail-shape','nailShape'],['ext-nail-color','nailColor'],
        ['ext-physical-quirks','physicalQuirks'],
        // Style
        ['ext-style-archetype','styleArchetype'],['ext-outfit','outfitDescription'],
        ['ext-color-palette','colorPalette'],['ext-signature-item','signatureItem'],
        ['ext-footwear','footwear'],['ext-jewelry','jewelry'],['ext-underwear','underwear'],
        ['ext-formal-outfit','formalOutfit'],['ext-combat-outfit','combatOutfit'],
        ['ext-sleepwear','sleepwear'],['ext-swimwear','swimwear'],['ext-eyewear','eyewear'],
        ['ext-carried-items','carriedItems'],['ext-headwear','headwear'],
        ['ext-grooming','groomingStandard'],['ext-makeup-style','makeupStyle'],
        ['ext-lipstick','lipstickColor'],['ext-eye-makeup','eyeMakeup'],
        // Voice
        ['ext-accent','accent'],['ext-catchphrases','catchphrases'],
        ['ext-vocabulary','vocabulary'],['ext-voice-resonance','voiceResonance'],
        ['ext-voice-volume','voiceVolume'],['ext-accent-strength','accentStrength'],
        ['ext-swearing','swearingLevel'],['ext-speech-patterns','speechPatterns'],
        ['ext-laugh-style','laughStyle'],['ext-signature-sounds','signatureSounds'],
        // Personality
        ['ext-core-traits','coreTraits'],['ext-archetype','archetype'],
        ['ext-backstory','backstory'],['ext-secrets','secrets'],['ext-hobbies','hobbies'],
        ['ext-fears','fears'],['ext-desires','desires'],['ext-alignment','alignment'],
        ['ext-attachment','attachmentStyle'],['ext-love-langs','loveLangs'],
        ['ext-conflict-style','conflictStyle'],['ext-mood-baseline','moodBaseline'],
        ['ext-moral-philosophy','moralPhilosophy'],['ext-spirituality','spirituality'],
        ['ext-triggers','triggers'],['ext-pet-peeves','petPeeves'],['ext-comfort-objects','comfortObjects'],
        // Adult
        ['ext-sexual-orientation','sexualOrientation'],['ext-dominant-role','dominantRole'],
        ['ext-chest-type','chestType'],['ext-breast-shape','breastShape'],
        ['ext-buttocks-size','buttocksSize'],['ext-buttocks-shape','buttocksShape'],
        ['ext-intimate-markings','intimateMarkings'],['ext-penis-size','penisSize'],
        ['ext-penis-shape','penisShape'],['ext-erogenous','erogenousZones'],
        ['ext-vocal-response','vocalResponse'],['ext-aftercare','aftercareStyle'],
        ['ext-kinks','kinks'],['ext-fantasies','fantasies'],
        ['ext-hard-limits','hardLimits'],['ext-other-adult','otherAdultFeatures'],
        // AI
        ['ext-context-priority','contextPriority'],['ext-narrative-pov','narrativePOV'],
        ['ext-prose-style','proseStyle'],['ext-response-format','responseFormat'],
        ['ext-response-length','responseLength'],['ext-allowed-topics','allowedTopics'],
        ['ext-forbidden-topics','forbiddenTopics'],['ext-world-rules','worldRules'],
    ];

    // Numeric ext sliders
    const EXT_SLIDERS = ['eyeSize','hairShine','muscleTone','bodyFat',
        'verbosity','formality','speechPace',
        'sociabilityLevel','curiosityLevel','impulsivityLevel','anxietyLevel','stubbornness',
        'deceptivenessLevel','narcissismLevel','loyaltyLevel','protectivenessLevel',
        'selfEsteemLevel','empathyLevel','playfulnessLevel','obedienceLevel',
        'jealousyLevel','humorLevel','sadismLevel',
        'libido','stamina','exhibitionism'];

    EXT_MAP.forEach(([fieldId, extKey]) => {
        // merged (getCharOverride flat-merges ext into the top object) wins; ext fallback for import
        const val = (merged != null ? (merged[extKey] ?? ext[extKey]) : ext[extKey]) ?? '';
        setField(fieldId, val);
    });

    EXT_SLIDERS.forEach(k => {
        const v = merged != null ? (merged[k] ?? ext[k]) : ext[k];
        if (v != null) setSlider(k, v);
    });

    // Avatar
    if (meta?.avatar_path || card.avatar) {
        let src = meta?.avatar_path || card.avatar;
        if (src && src.startsWith('idb:') && charId) {
            src = await loadAvatar(charId).catch(() => null);
        }
        if (src) setAvatarPreview(src);
    }

    // Gallery
    if (ud.gallery?.length) {
        _additionalAvatars = ud.gallery.map(url => ({ url, label: '' }));
        renderGalleryStrip();
    }

    updateHeader();
}

// ── Avatar preview ────────────────────────────────────────────────────────────

function setAvatarPreview(src) {
    _avatarDataUrl = src;
    const $p = qs('#cc-avatar-preview');
    if (!$p) return;
    $p.style.backgroundImage = `url(${src})`;
    $p.classList.add('has-image');
}

function readFileAsDataUrl(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
    });
}

// ── Gallery strip render ───────────────────────────────────────────────────────

function renderGalleryStrip() {
    const $strip = qs('#cc-gallery-strip');
    if (!$strip) return;
    $strip.innerHTML = _additionalAvatars.map((item, i) => `
        <div class="cc-gallery-thumb" data-idx="${i}">
            <img src="${escAttr(item.url)}" alt="">
            <button class="cc-gallery-remove" data-idx="${i}" title="Remove">×</button>
            <button class="cc-gallery-set-avatar" data-idx="${i}" title="Use as main avatar">★</button>
        </div>
    `).join('');

    qsa('.cc-gallery-remove', $strip).forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            _additionalAvatars.splice(parseInt(btn.dataset.idx), 1);
            renderGalleryStrip();
        });
    });
    qsa('.cc-gallery-set-avatar', $strip).forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const item = _additionalAvatars[parseInt(btn.dataset.idx)];
            if (item) setAvatarPreview(item.url);
        });
    });
}

// ── Build card from form ───────────────────────────────────────────────────────

function buildCardFromForm() {
    const name      = readField('name').trim();
    const altRaw    = readField('alt-greetings').trim();
    const altGreets = altRaw ? altRaw.split(/\n---\n/).map(s => s.trim()).filter(Boolean) : [];
    const tags      = readField('tags').split(',').map(t => t.trim()).filter(Boolean);

    const coreUd = {
        nickname:             readField('nickname'),
        voiceTone:            readField('voice-tone'),
        speechPatterns:       readField('speech-patterns'),
        species:              readField('species'),
        gender:               readField('gender'),
        age:                  readField('age'),
        height:               readField('height'),
        bodyType:             readField('body-type'),
        skinTone:             readField('skin-tone'),
        hairColor:            readField('hair-color'),
        hairStyle:            readField('hair-style'),
        eyeColor:             readField('eye-color'),
        distinctiveFeatures:  readField('distinctive-features'),
        breastSize:           readField('breast-size'),
        nippleColor:          readField('nipple-color'),
        areolaeSize:          readField('areolae-size'),
        bodyHair:             readField('body-hair'),
        genitalia:            readField('genitalia'),
        otherAdultFeatures:   readField('other-adult'),
        appendToSystem:       readField('append-system'),
        persistentMemory:     readField('persistent-memory'),
        modelOverride:        readField('model-override'),
        systemPromptOverride: readField('system-override'),
        postHistoryOverride:  readField('post-override'),
        enabled:              qs('#cc-enabled')?.checked !== false,
    };

    // Core behavior sliders
    ['dominanceLevel','explicitnessLevel','romanticismLevel','violenceLevel',
     'anxietyLevel','loyaltyLevel','stubbornness','selfEsteemLevel','curiosityLevel','empathyLevel'
    ].forEach(k => {
        const v = readSlider(k);
        if (v !== null) coreUd[k] = v;
    });

    // Extended fields
    const ext = {};
    const EXT_MAP = [
        // Identity
        ['ext-name','name'],['ext-pronouns','pronouns'],['ext-occupation','occupation'],
        ['ext-nationality','nationality'],['ext-aliases','aliases'],['ext-ethnicity','ethnicity'],
        ['ext-birthday','birthday'],['ext-location','location'],['ext-native-lang','nativeLanguage'],
        ['ext-languages','languagesSpoken'],['ext-zodiac','zodiac'],['ext-mbti','mbti'],
        ['ext-enneagram','enneagram'],
        // Face
        ['ext-face-shape','faceShape'],['ext-complexion','complexion'],['ext-jaw','jawType'],
        ['ext-cheekbones','cheekbones'],['ext-forehead','foreheadType'],['ext-undertone','skinUndertone'],
        ['ext-skin-texture','skinTexture'],['ext-eye-shape','eyeShape'],['ext-eye-spacing','eyeSpacing'],
        ['ext-eye-detail','eyeDetail'],['ext-eyebrow','eyebrowShape'],['ext-eyelashes','eyelashes'],
        ['ext-nose','noseType'],['ext-lips','lipsType'],['ext-lip-color','lipColor'],
        ['ext-teeth','teethType'],['ext-face-piercings','facePiercings'],['ext-facial-hair','facialHair'],
        // Hair
        ['ext-hair-highlights','hairHighlights'],['ext-hair-length','hairLength'],
        ['ext-hair-texture','hairTexture'],['ext-hair-density','hairDensity'],
        ['ext-hair-dyed','hairDyed'],['ext-hair-fade','hairFade'],['ext-hair-accessories','hairAccessories'],
        // Body
        ['ext-weight','weight'],['ext-shoulder','shoulderWidth'],['ext-waist','waistType'],
        ['ext-leg-type','legType'],['ext-hand-size','handSize'],['ext-posture','posture'],
        ['ext-gait','gait'],['ext-body-markings','bodyMarkings'],['ext-body-piercings','bodyPiercings'],
        ['ext-scent','scent'],['ext-tattoos','tattoos'],['ext-scars','scarsMarks'],
        ['ext-nail-length','nailLength'],['ext-nail-shape','nailShape'],['ext-nail-color','nailColor'],
        ['ext-physical-quirks','physicalQuirks'],
        // Style
        ['ext-style-archetype','styleArchetype'],['ext-outfit','outfitDescription'],
        ['ext-color-palette','colorPalette'],['ext-signature-item','signatureItem'],
        ['ext-footwear','footwear'],['ext-jewelry','jewelry'],['ext-underwear','underwear'],
        ['ext-formal-outfit','formalOutfit'],['ext-combat-outfit','combatOutfit'],
        ['ext-sleepwear','sleepwear'],['ext-swimwear','swimwear'],['ext-eyewear','eyewear'],
        ['ext-carried-items','carriedItems'],['ext-headwear','headwear'],
        ['ext-grooming','groomingStandard'],['ext-makeup-style','makeupStyle'],
        ['ext-lipstick','lipstickColor'],['ext-eye-makeup','eyeMakeup'],
        // Voice
        ['ext-accent','accent'],['ext-catchphrases','catchphrases'],
        ['ext-vocabulary','vocabulary'],['ext-voice-resonance','voiceResonance'],
        ['ext-voice-volume','voiceVolume'],['ext-accent-strength','accentStrength'],
        ['ext-swearing','swearingLevel'],['ext-speech-patterns','speechPatterns'],
        ['ext-laugh-style','laughStyle'],['ext-signature-sounds','signatureSounds'],
        // Personality
        ['ext-core-traits','coreTraits'],['ext-archetype','archetype'],
        ['ext-backstory','backstory'],['ext-secrets','secrets'],['ext-hobbies','hobbies'],
        ['ext-fears','fears'],['ext-desires','desires'],['ext-alignment','alignment'],
        ['ext-attachment','attachmentStyle'],['ext-love-langs','loveLangs'],
        ['ext-conflict-style','conflictStyle'],['ext-mood-baseline','moodBaseline'],
        ['ext-moral-philosophy','moralPhilosophy'],['ext-spirituality','spirituality'],
        ['ext-triggers','triggers'],['ext-pet-peeves','petPeeves'],['ext-comfort-objects','comfortObjects'],
        // Adult
        ['ext-sexual-orientation','sexualOrientation'],['ext-dominant-role','dominantRole'],
        ['ext-chest-type','chestType'],['ext-breast-shape','breastShape'],
        ['ext-buttocks-size','buttocksSize'],['ext-buttocks-shape','buttocksShape'],
        ['ext-intimate-markings','intimateMarkings'],['ext-penis-size','penisSize'],
        ['ext-penis-shape','penisShape'],['ext-erogenous','erogenousZones'],
        ['ext-vocal-response','vocalResponse'],['ext-aftercare','aftercareStyle'],
        ['ext-kinks','kinks'],['ext-fantasies','fantasies'],
        ['ext-hard-limits','hardLimits'],['ext-other-adult','otherAdultFeatures'],
        // AI
        ['ext-context-priority','contextPriority'],['ext-narrative-pov','narrativePOV'],
        ['ext-prose-style','proseStyle'],['ext-response-format','responseFormat'],
        ['ext-response-length','responseLength'],['ext-allowed-topics','allowedTopics'],
        ['ext-forbidden-topics','forbiddenTopics'],['ext-world-rules','worldRules'],
    ];

    EXT_MAP.forEach(([fieldId, extKey]) => {
        const val = readField(fieldId);
        if (val) ext[extKey] = val;
    });

    // Numeric ext sliders
    ['eyeSize','hairShine','muscleTone','bodyFat','verbosity','formality','speechPace',
     'sociabilityLevel','curiosityLevel','impulsivityLevel','anxietyLevel','stubbornness',
     'deceptivenessLevel','narcissismLevel','loyaltyLevel','protectivenessLevel',
     'selfEsteemLevel','empathyLevel','playfulnessLevel','obedienceLevel',
     'jealousyLevel','humorLevel','sadismLevel','libido','stamina','exhibitionism'
    ].forEach(k => {
        const v = readSlider(k);
        if (v !== null) ext[k] = v;
    });

    if (_additionalAvatars.length) {
        coreUd.gallery = _additionalAvatars.map(a => a.url);
    }

    const card = {
        spec: 'chara_card_v2',
        spec_version: readField('spec-version') || '2.0',
        data: {
            name,
            description:              readField('description'),
            personality:              readField('personality'),
            scenario:                 readField('scenario'),
            first_mes:                readField('first-mes'),
            mes_example:              readField('mes-example'),
            alternate_greetings:      altGreets,
            system_prompt:            readField('system-prompt'),
            post_history_instructions:readField('post-history'),
            creator_notes:            readField('creator-notes'),
            creator:                  readField('creator'),
            character_version:        readField('version') || '1.0',
            tags,
            extensions: {
                underdark: { ...coreUd, ext }
            },
            avatar: _avatarDataUrl || null
        }
    };

    const meta = {
        id:          _editId || generateId(name),
        name,
        tagline:     readField('tagline'),
        avatar_path: _avatarDataUrl || null,
        tags,
        card_path:   `data/cards/${slugify(name)}.json`,
    };

    return { card, meta };
}

// ── Validation ────────────────────────────────────────────────────────────────

function validate() {
    const name = readField('name').trim();
    if (!name) {
        switchTab('identity');
        const $n = qs('#cc-name');
        if ($n) { $n.classList.add('cc-shake'); setTimeout(() => $n.classList.remove('cc-shake'), 500); }
        showToast('Name is required.', 'error');
        return false;
    }
    return true;
}

// ── Save to runtime state ─────────────────────────────────────────────────────

async function saveCard(activate = false) {
    if (!validate()) return;
    const { card, meta } = buildCardFromForm();
    if (_editId) meta.id = _editId;

    await saveCharacter(meta, card.data);

    // Sync charOverrides from the newly written card so sims-editor stays in sync.
    // Preserve any sims-editor user edits for fields NOT explicitly authored here,
    // but let the card values win for fields the creator just wrote.
    const ud  = card.data.extensions?.underdark || {};
    const ext = ud.ext || {};
    const existing = state.config?.charOverrides?.[meta.id] || {};
    const existingExt = existing.ext || {};
    // Card values always win — merge card ext on top of any prior ext
    const mergedExt = { ...existingExt, ...ext };
    // Build a full core object from card ud (strip ext/gallery keys)
    const { ext: _e, gallery: _g, ...coreFromCard } = ud;
    setCharOverride(meta.id, { ...existing, ...coreFromCard, ext: mergedExt });

    closeCreator();

    document.dispatchEvent(new CustomEvent('char-creator:saved', { detail: { id: meta.id, activate } }));
    showToast(`${meta.name} ${_editId ? 'updated' : 'created'}.`, 'info');
}

// ── Export as JSON (download) ─────────────────────────────────────────────────

function exportJson() {
    if (!validate()) return;
    const { card, meta } = buildCardFromForm();
    const json = JSON.stringify(card, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    triggerDownload(blob, `${slugify(meta.name) || 'character'}.json`);
    showToast('Exported JSON — drop into data/cards/.', 'info');
}

// ── Export to codebase (both card JSON + index entry snippet) ─────────────────

function exportToCodebase() {
    if (!validate()) return;
    const { card, meta } = buildCardFromForm();

    // Card JSON
    const cardJson = JSON.stringify(card, null, 2);
    triggerDownload(
        new Blob([cardJson], { type: 'application/json' }),
        `${slugify(meta.name)}.json`
    );

    // Index entry (what to add to data/index.json)
    const indexEntry = {
        id:          meta.id,
        name:        meta.name,
        tagline:     meta.tagline || '',
        card_path:   `data/cards/${slugify(meta.name)}.json`,
        avatar_path: isDataUrl(_avatarDataUrl) ? '🎭' : (_avatarDataUrl || '🎭'),
        tags:        meta.tags,
    };
    const indexSnippet = JSON.stringify(indexEntry, null, 2);
    setTimeout(() => {
        triggerDownload(
            new Blob([indexSnippet], { type: 'application/json' }),
            `${slugify(meta.name)}-index-entry.json`
        );
    }, 400);

    showToast('Exported card + index entry. Place card in data/cards/ and merge the entry into data/index.json.', 'info', 6000);
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message, type = 'info', duration = 3500) {
    const $c = qs('#toast-container');
    if (!$c) return;
    const $t = document.createElement('div');
    $t.className = `toast toast--${type}`;
    const icons = { info: 'check-circle', error: 'alert-circle', warn: 'alert-triangle' };
    const esc = s => String(s).replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    $t.innerHTML = `<i data-lucide="${icons[type]||'check-circle'}"></i><span>${esc(message)}</span>`;
    $c.appendChild($t);
    if (window.lucide) window.lucide.createIcons({ nodes: [$t] });
    requestAnimationFrame(() => $t.classList.add('toast--visible'));
    setTimeout(() => {
        $t.classList.remove('toast--visible');
        $t.addEventListener('transitionend', () => $t.remove(), { once: true });
    }, duration);
}

function escAttr(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
