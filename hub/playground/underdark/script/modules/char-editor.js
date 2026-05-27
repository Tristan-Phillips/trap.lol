/**
 * char-editor.js — Unified character editor.
 * Merges char-creator.js + sims-editor.js into a single modal (#modal-char-editor).
 * Left sidebar: avatar + gallery + quick fields + body-map + swatches + stat pills.
 * Right area: vertical tab nav + detail panels covering all card + override fields.
 */

import { state, saveCharacter, deleteCharacter, getCharOverride, setCharOverride, defaultCharOverride, saveState } from './state.js?v=3';
import { normalizeData } from './parser-v2.js?v=4';
import { saveAvatar, loadAvatar, isDataUrl } from './storage.js?v=3';
import { qs, qsa, esc, debounce, slugify, generateId, pick, showToast } from './shared-utils.js?v=4';

// ── Editor-scoped DOM helpers (scoped to the modal) ───────────────────────────

const $modal = () => qs('#modal-char-editor');

function $q(sel) { return qs(sel, $modal()); }
function $qa(sel) { return qsa(sel, $modal()); }

function readField(id, fallback = '') {
    const el = qs(`#ce-${id}`);
    return el ? el.value : fallback;
}

function setField(id, val) {
    const el = qs(`#ce-${id}`);
    if (el) el.value = (val == null ? '' : val);
}

function readSlider(key) {
    const el = qs(`#ce-sl-${key}`);
    return el ? parseFloat(el.value) : null;
}

function setSlider(key, val) {
    const el = qs(`#ce-sl-${key}`);
    if (!el) return;
    el.value = val;
    syncSliderBadge(key, val);
}

// ── Slider descriptors ────────────────────────────────────────────────────────

const SLIDER_DESCS = {
    dominanceLevel: [[0,15,'Deeply submissive'],[16,30,'Mostly submissive'],[31,45,'Slightly passive'],[46,55,'Balanced'],[56,70,'Quietly assertive'],[71,85,'Dominant'],[86,100,'Strongly dominant']],
    explicitnessLevel: [[0,15,'Fade-to-black'],[16,30,'Tasteful'],[31,45,'Suggestive'],[46,55,'Moderate'],[56,70,'Mature'],[71,85,'Explicit'],[86,100,'Fully explicit']],
    romanticismLevel: [[0,15,'Ice cold'],[16,30,'Distant'],[31,45,'Reserved'],[46,55,'Warm'],[56,70,'Romantic'],[71,85,'Intensely romantic'],[86,100,'Achingly passionate']],
    violenceLevel: [[0,15,'Non-violent'],[16,30,'Low'],[31,45,'Moderate'],[46,55,'Visceral'],[56,70,'Graphic'],[71,85,'Very graphic'],[86,100,'Extreme']],
    empathyLevel: [[0,20,'Predatory'],[21,40,'Callous'],[41,60,'Moderate'],[61,80,'Empathic'],[81,100,'Deeply empathic']],
    playfulnessLevel: [[0,20,'Grave/serious'],[21,40,'Restrained'],[41,60,'Balanced'],[61,80,'Playful'],[81,100,'Mischievous']],
    obedienceLevel: [[0,20,'Defiant'],[21,40,'Willful'],[41,60,'Neutral'],[61,80,'Compliant'],[81,100,'Eager to please']],
    jealousyLevel: [[0,20,'Unattached'],[21,40,'Mildly territorial'],[41,60,'Noticeably jealous'],[61,80,'Strongly possessive'],[81,100,'Obsessively possessive']],
    humorLevel: [[0,20,'Humorless'],[21,40,'Dry wit'],[41,60,'Average'],[61,80,'Witty'],[81,100,'Comedic']],
    sadismLevel: [[0,10,'Gentle'],[11,25,'Firm'],[26,45,'Indifferent'],[46,65,'Casually cruel'],[66,85,'Sadistic'],[86,100,'Deeply sadistic']],
    verbosity: [[1,3,'Terse'],[4,6,'Measured'],[7,8,'Expansive'],[9,10,'Verbose']],
    formality: [[1,3,'Crude/casual'],[4,6,'Conversational'],[7,8,'Polished'],[9,10,'Formal']],
    speechPace: [[1,2,'Glacially slow'],[3,4,'Unhurried'],[5,6,'Natural'],[7,8,'Quick'],[9,10,'Rapid-fire']],
    eyeSize: [[1,3,'Narrow/sleepy'],[4,6,'Average'],[7,8,'Wide/expressive'],[9,10,'Striking/large']],
    muscleTone: [[1,3,'Soft'],[4,6,'Average'],[7,8,'Toned'],[9,10,'Chiseled']],
    bodyFat: [[1,2,'Very lean'],[3,4,'Athletic'],[5,6,'Average'],[7,8,'Soft/full'],[9,10,'Voluptuous']],
    hairShine: [[1,3,'Dull/dry'],[4,6,'Healthy'],[7,8,'Glossy'],[9,10,'Lustrous']],
    sociabilityLevel: [[0,15,'Hermit'],[16,30,'Reclusive'],[31,45,'Reserved'],[46,55,'Balanced'],[56,70,'Social'],[71,85,'Gregarious'],[86,100,'Extroverted']],
    curiosityLevel: [[0,20,'Incurious'],[21,40,'Mildly inquisitive'],[41,60,'Averagely curious'],[61,80,'Highly curious'],[81,100,'Insatiably curious']],
    impulsivityLevel: [[0,15,'Calculated'],[16,30,'Deliberate'],[31,45,'Measured'],[46,55,'Balanced'],[56,70,'Reactive'],[71,85,'Impulsive'],[86,100,'Feral impulse']],
    anxietyLevel: [[0,15,'Unflappable'],[16,30,'Serene'],[31,45,'Mildly anxious'],[46,55,'Moderate'],[56,70,'Anxious'],[71,85,'Hypervigilant'],[86,100,'Paranoid']],
    stubbornness: [[0,15,'Malleable'],[16,30,'Open'],[31,45,'Adaptable'],[46,55,'Steady'],[56,70,'Stubborn'],[71,85,'Obstinate'],[86,100,'Immovable']],
    deceptivenessLevel: [[0,15,'Radically honest'],[16,30,'Honest'],[31,45,'Mostly honest'],[46,55,'Situationally deceptive'],[56,70,'Calculated'],[71,85,'Manipulative'],[86,100,'Habitual liar']],
    narcissismLevel: [[0,15,'Self-effacing'],[16,30,'Modest'],[31,45,'Balanced'],[46,55,'Self-centered'],[56,70,'Vain'],[71,85,'Grandiose'],[86,100,'Solipsistic']],
    loyaltyLevel: [[0,15,'Self-serving'],[16,30,'Fickle'],[31,45,'Conditional'],[46,55,'Reliable'],[56,70,'Loyal'],[71,85,'Fiercely loyal'],[86,100,'Absolute loyalty']],
    protectivenessLevel: [[0,20,'Detached'],[21,40,'Cautious protector'],[41,60,'Protective'],[61,80,'Fiercely protective'],[81,100,'Wrathfully protective']],
    selfEsteemLevel: [[0,15,'Self-loathing'],[16,30,'Low self-worth'],[31,45,'Fragile'],[46,55,'Average'],[56,70,'Grounded'],[71,85,'Confident'],[86,100,'Bulletproof']],
    libido: [[1,2,'Asexual/non-sexual'],[3,4,'Low'],[5,6,'Moderate'],[7,8,'High'],[9,10,'Insatiable']],
    stamina: [[1,2,'Very low'],[3,4,'Below average'],[5,6,'Average'],[7,8,'High'],[9,10,'Limitless']],
    exhibitionism: [[1,2,'Deeply private'],[3,4,'Private'],[5,6,'Neutral'],[7,8,'Exhibitionistic'],[9,10,'Craves audience']],
};

function sliderDesc(key, val) {
    const ranges = SLIDER_DESCS[key];
    if (!ranges) return '';
    const v = parseFloat(val);
    for (const [lo, hi, txt] of ranges) { if (v >= lo && v <= hi) return txt; }
    return '';
}

function syncSliderBadge(key, val) {
    const badge = qs(`#ce-sl-badge-${key}`);
    const desc  = qs(`#ce-sl-desc-${key}`);
    const $simsVal  = qs(`#sims-val-${key}`);
    const $simsDesc = qs(`#sims-desc-${key}`);
    const txt = sliderDesc(key, val);
    const num = Number.isInteger(parseFloat(val)) ? String(Math.round(val)) : parseFloat(val).toFixed(2);
    if (badge)     badge.textContent = num;
    if (desc)      desc.textContent  = txt;
    if ($simsVal)  $simsVal.textContent  = num;
    if ($simsDesc) $simsDesc.textContent = txt;
}

// ── EXT_KEYS (fields that live under charOverride.ext) ───────────────────────

const EXT_KEYS = new Set([
    'name','pronouns','occupation','nationality','tagsRaw','aliases','ethnicity','birthday',
    'location','nativeLanguage','languagesSpoken','zodiac','mbti','enneagram',
    'faceShape','complexion','eyeShape','noseType','lipsType','facialHair','facePiercings',
    'jawType','cheekbones','foreheadType','skinUndertone','skinTexture',
    'eyeSize','eyeDetail','eyeSpacing','eyebrowShape','eyelashes','lipColor','teethType',
    'hairHighlights','hairLength','hairTexture','hairShine','hairAccessories',
    'hairDyed','hairDensity','hairFade',
    'weight','muscleTone','bodyFat','shoulderWidth','waistType',
    'bodyMarkings','bodyPiercings','scent','legType','handSize','posture','gait',
    'tattoos','scarsMarks','nailLength','nailShape','nailColor','physicalQuirks',
    'styleArchetype','outfitDescription','colorPalette','signatureItem',
    'footwear','jewelry','underwear','formalOutfit','combatOutfit','sleepwear','swimwear',
    'eyewear','carriedItems','headwear','groomingStandard','makeupStyle','lipstickColor','eyeMakeup',
    'accent','catchphrases','verbosity','formality','vocabulary',
    'voiceResonance','voiceVolume','speechPace','accentStrength','swearingLevel',
    'laughStyle','signatureSounds',
    'coreTraits','archetype','fears','desires','alignment','backstory','secrets','hobbies',
    'attachmentStyle','loveLangs','conflictStyle','moodBaseline',
    'moralPhilosophy','spirituality','triggers','petPeeves','comfortObjects',
    'sociabilityLevel','curiosityLevel','impulsivityLevel','anxietyLevel','stubbornness',
    'deceptivenessLevel','narcissismLevel','loyaltyLevel','protectivenessLevel',
    'selfEsteemLevel','empathyLevel','playfulnessLevel','obedienceLevel',
    'jealousyLevel','humorLevel','sadismLevel',
    'sexualOrientation','dominantRole','libido','stamina','exhibitionism',
    'chestType','breastShape','buttocksSize','buttocksShape','intimateMarkings',
    'penisSize','penisShape','erogenousZones','vocalResponse','aftercareStyle',
    'kinks','fantasies','hardLimits','otherAdultFeatures',
    'contextPriority','narrativePOV','proseStyle','responseFormat','responseLength',
    'allowedTopics','forbiddenTopics','worldRules',
]);

// Flat EXT_MAP for populating / reading all ext fields (id → extKey)
const EXT_MAP = [
    ['ext-name','name'],['ext-pronouns','pronouns'],['ext-occupation','occupation'],
    ['ext-nationality','nationality'],['ext-aliases','aliases'],['ext-ethnicity','ethnicity'],
    ['ext-birthday','birthday'],['ext-location','location'],['ext-native-lang','nativeLanguage'],
    ['ext-languages','languagesSpoken'],['ext-zodiac','zodiac'],['ext-mbti','mbti'],
    ['ext-enneagram','enneagram'],
    ['ext-face-shape','faceShape'],['ext-complexion','complexion'],['ext-jaw','jawType'],
    ['ext-cheekbones','cheekbones'],['ext-forehead','foreheadType'],['ext-undertone','skinUndertone'],
    ['ext-skin-texture','skinTexture'],['ext-eye-shape','eyeShape'],['ext-eye-spacing','eyeSpacing'],
    ['ext-eye-detail','eyeDetail'],['ext-eyebrow','eyebrowShape'],['ext-eyelashes','eyelashes'],
    ['ext-nose','noseType'],['ext-lips','lipsType'],['ext-lip-color','lipColor'],
    ['ext-teeth','teethType'],['ext-face-piercings','facePiercings'],['ext-facial-hair','facialHair'],
    ['ext-hair-highlights','hairHighlights'],['ext-hair-length','hairLength'],
    ['ext-hair-texture','hairTexture'],['ext-hair-density','hairDensity'],
    ['ext-hair-dyed','hairDyed'],['ext-hair-fade','hairFade'],['ext-hair-accessories','hairAccessories'],
    ['ext-weight','weight'],['ext-shoulder','shoulderWidth'],['ext-waist','waistType'],
    ['ext-leg-type','legType'],['ext-hand-size','handSize'],['ext-posture','posture'],
    ['ext-gait','gait'],['ext-body-markings','bodyMarkings'],['ext-body-piercings','bodyPiercings'],
    ['ext-scent','scent'],['ext-tattoos','tattoos'],['ext-scars','scarsMarks'],
    ['ext-nail-length','nailLength'],['ext-nail-shape','nailShape'],['ext-nail-color','nailColor'],
    ['ext-physical-quirks','physicalQuirks'],
    ['ext-style-archetype','styleArchetype'],['ext-outfit','outfitDescription'],
    ['ext-color-palette','colorPalette'],['ext-signature-item','signatureItem'],
    ['ext-footwear','footwear'],['ext-jewelry','jewelry'],['ext-underwear','underwear'],
    ['ext-formal-outfit','formalOutfit'],['ext-combat-outfit','combatOutfit'],
    ['ext-sleepwear','sleepwear'],['ext-swimwear','swimwear'],['ext-eyewear','eyewear'],
    ['ext-carried-items','carriedItems'],['ext-headwear','headwear'],
    ['ext-grooming','groomingStandard'],['ext-makeup-style','makeupStyle'],
    ['ext-lipstick','lipstickColor'],['ext-eye-makeup','eyeMakeup'],
    ['ext-accent','accent'],['ext-catchphrases','catchphrases'],
    ['ext-vocabulary','vocabulary'],['ext-voice-resonance','voiceResonance'],
    ['ext-voice-volume','voiceVolume'],['ext-accent-strength','accentStrength'],
    ['ext-swearing','swearingLevel'],['ext-speech-patterns','speechPatterns'],
    ['ext-laugh-style','laughStyle'],['ext-signature-sounds','signatureSounds'],
    ['ext-core-traits','coreTraits'],['ext-archetype','archetype'],
    ['ext-backstory','backstory'],['ext-secrets','secrets'],['ext-hobbies','hobbies'],
    ['ext-fears','fears'],['ext-desires','desires'],['ext-alignment','alignment'],
    ['ext-attachment','attachmentStyle'],['ext-love-langs','loveLangs'],
    ['ext-conflict-style','conflictStyle'],['ext-mood-baseline','moodBaseline'],
    ['ext-moral-philosophy','moralPhilosophy'],['ext-spirituality','spirituality'],
    ['ext-triggers','triggers'],['ext-pet-peeves','petPeeves'],['ext-comfort-objects','comfortObjects'],
    ['ext-sexual-orientation','sexualOrientation'],['ext-dominant-role','dominantRole'],
    ['ext-chest-type','chestType'],['ext-breast-shape','breastShape'],
    ['ext-buttocks-size','buttocksSize'],['ext-buttocks-shape','buttocksShape'],
    ['ext-intimate-markings','intimateMarkings'],['ext-penis-size','penisSize'],
    ['ext-penis-shape','penisShape'],['ext-erogenous','erogenousZones'],
    ['ext-vocal-response','vocalResponse'],['ext-aftercare','aftercareStyle'],
    ['ext-kinks','kinks'],['ext-fantasies','fantasies'],
    ['ext-hard-limits','hardLimits'],['ext-other-adult','otherAdultFeatures'],
    ['ext-context-priority','contextPriority'],['ext-narrative-pov','narrativePOV'],
    ['ext-prose-style','proseStyle'],['ext-response-format','responseFormat'],
    ['ext-response-length','responseLength'],['ext-allowed-topics','allowedTopics'],
    ['ext-forbidden-topics','forbiddenTopics'],['ext-world-rules','worldRules'],
];

const EXT_SLIDERS = [
    'eyeSize','hairShine','muscleTone','bodyFat','verbosity','formality','speechPace',
    'sociabilityLevel','curiosityLevel','impulsivityLevel','anxietyLevel','stubbornness',
    'deceptivenessLevel','narcissismLevel','loyaltyLevel','protectivenessLevel',
    'selfEsteemLevel','empathyLevel','playfulnessLevel','obedienceLevel',
    'jealousyLevel','humorLevel','sadismLevel','libido','stamina','exhibitionism',
];

// ── Randomisation pools ───────────────────────────────────────────────────────

const RAND = {
    species:        ['Human','Elf','Half-Elf','Tiefling','Android','Vampire','Werewolf','Demon','Fae','Orc'],
    gender:         ['Woman','Man','Non-binary','Genderfluid','Agender'],
    pronouns:       ['she/her','he/him','they/them','she/they','he/they'],
    hairLength:     ['short','medium','long','very-long','buzzed','cropped'],
    hairStyle:      ['straight','wavy','curly','braided','ponytail','messy','bun','undercut','locs','coiled'],
    bodyType:       ['slender','lean','average','athletic','muscular','curvy','full-figured','lithe','petite'],
    eyeColor:       ['dark brown','warm amber','ice blue','forest green','silver-grey','violet','gold','crimson','heterochromatic'],
    skinTone:       ['pale alabaster','warm beige','golden tan','rich brown','deep umber','cool ivory','ashen','dusky'],
    hairColor:      ['raven black','dark brown','chestnut','auburn','warm blonde','platinum','silver','fire red','cobalt blue','deep violet','rose gold','white'],
    archetype:      ['noble-rogue','broken-hero','seducer','trickster','caretaker','tsundere','kuudere','rebel','yandere','loner','protector'],
    alignment:      ['chaotic-good','neutral-good','chaotic-neutral','true-neutral','lawful-neutral','lawful-evil','chaotic-evil'],
    voiceTone:      ['husky','low','melodic','raspy','soft','gravelly','whispery','velvety'],
    styleArchetype: ['cyberpunk','gothic','streetwear','elegant','leather','casual','minimalist','dark-academia','techwear'],
    attachmentStyle:['secure','anxious','avoidant','fearful'],
    moodBaseline:   ['bleak','melancholic','stoic','neutral','warm','volatile','electric','sunny'],
    narrativePOV:   ['first','third-limited'],
    proseStyle:     ['literary','cinematic','punchy','lyrical','minimalist','descriptive'],
    zodiac:         ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'],
};

// ── Body map region → panel mapping ──────────────────────────────────────────

const REGION_TO_CAT = {
    head: 'face', neck: 'face',
    shoulders: 'body', chest: 'adult',
    arms: 'body', abdomen: 'body',
    hips: 'adult', legs: 'body',
};

const REGION_LABELS = {
    head: 'Face & Head', neck: 'Face & Head',
    shoulders: 'Body & Physique', chest: 'Adult / NSFW',
    arms: 'Body & Physique', abdomen: 'Body & Physique',
    hips: 'Adult / NSFW', legs: 'Body & Physique',
};

// ── Module state ──────────────────────────────────────────────────────────────

let _editId            = null;
let _avatarDataUrl     = null;
let _gallery           = [];   // [{ url, label }]
let _pendingChanges    = {};
let _activeCharId      = null;

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tab) {
    qsa('.ce-nav-btn').forEach(b => {
        const match = b.dataset.tab === tab;
        b.classList.toggle('active', match);
        b.setAttribute('aria-selected', match);
    });
    qsa('.ce-panel').forEach(p => { p.hidden = p.dataset.panel !== tab; });
    _highlightRegions(tab);
}

function _highlightRegions(cat) {
    const catToRegions = {
        face: ['head','neck'], hair: ['head'],
        body: ['shoulders','arms','abdomen','legs'], adult: ['chest','hips'],
    };
    const active = catToRegions[cat] || [];
    qsa('.ce-region').forEach(el => {
        el.classList.toggle('ce-region--active', active.includes(el.dataset.region));
    });
}

// ── Header update ─────────────────────────────────────────────────────────────

function updateHeader() {
    const $title = qs('#ce-modal-title');
    const $badge = qs('#ce-char-badge');
    const name   = readField('name') || '—';
    if ($title) $title.textContent = _editId ? 'Edit Character' : 'Create Character';
    if ($badge) $badge.textContent = name;
}

// ── Avatar preview ────────────────────────────────────────────────────────────

function setAvatarPreview(src) {
    _avatarDataUrl = src;
    const $p = qs('#ce-avatar-preview');
    if ($p) { $p.style.backgroundImage = `url(${src})`; $p.classList.add('has-image'); }
    // Also update sims-style preview in sidebar
    const $si = qs('#ce-body-avatar');
    if ($si) { $si.style.backgroundImage = `url(${src})`; $si.classList.toggle('has-image', !!src); }
}

function clearAvatarPreview() {
    _avatarDataUrl = null;
    const $p = qs('#ce-avatar-preview');
    if ($p) { $p.style.backgroundImage = 'none'; $p.classList.remove('has-image'); }
    const $si = qs('#ce-body-avatar');
    if ($si) { $si.style.backgroundImage = 'none'; $si.classList.remove('has-image'); }
}

function readFileAsDataUrl(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
    });
}

// ── Gallery management ────────────────────────────────────────────────────────

function renderGallery() {
    const $grid = qs('#ce-gallery-grid');
    if (!$grid) return;

    if (!_gallery.length) {
        $grid.innerHTML = '<div class="ce-gallery-empty"><i data-lucide="images"></i><span>No images yet</span></div>';
        if (window.lucide) window.lucide.createIcons({ nodes: [$grid] });
        return;
    }

    $grid.innerHTML = _gallery.map((item, i) => `
        <div class="ce-gallery-item ${i === 0 ? 'ce-gallery-item--cover' : ''}" data-idx="${i}">
            <img src="${esc(item.url)}" alt="" loading="lazy">
            <div class="ce-gallery-item__overlay">
                ${i === 0 ? '<span class="ce-gallery-cover-badge">Cover</span>' : ''}
                <div class="ce-gallery-item__actions">
                    <button class="ce-gallery-btn ce-gallery-btn--avatar" data-idx="${i}" title="Use as avatar">⭐</button>
                    ${i !== 0 ? `<button class="ce-gallery-btn ce-gallery-btn--cover" data-idx="${i}" title="Set as cover">🖼</button>` : ''}
                    <button class="ce-gallery-btn ce-gallery-btn--dl" data-idx="${i}" title="Download">⬇</button>
                    <button class="ce-gallery-btn ce-gallery-btn--del" data-idx="${i}" title="Remove">✕</button>
                </div>
            </div>
        </div>
    `).join('');

    // Bind gallery actions
    qsa('.ce-gallery-btn--avatar', $grid).forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            setAvatarPreview(_gallery[parseInt(btn.dataset.idx)].url);
        });
    });
    qsa('.ce-gallery-btn--cover', $grid).forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            const item = _gallery.splice(idx, 1)[0];
            _gallery.unshift(item);
            renderGallery();
            if (_pendingChanges !== null) _pendingChanges['_galleryDirty'] = true;
        });
    });
    qsa('.ce-gallery-btn--del', $grid).forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            _gallery.splice(parseInt(btn.dataset.idx), 1);
            renderGallery();
        });
    });
    qsa('.ce-gallery-btn--dl', $grid).forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const url = _gallery[parseInt(btn.dataset.idx)].url;
            _downloadUrl(url, `gallery-${btn.dataset.idx}.png`);
        });
    });
}

function _downloadUrl(url, filename) {
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
}

function exportAllGallery() {
    _gallery.forEach((item, i) => {
        setTimeout(() => _downloadUrl(item.url, `gallery-${i + 1}.png`), i * 200);
    });
}

// ── Chip groups ───────────────────────────────────────────────────────────────

function initChipGroups() {
    qsa('.ce-chip-group').forEach($group => {
        $group.addEventListener('click', e => {
            const chip = e.target.closest('.ce-chip');
            if (!chip || chip.disabled) return;
            const key = $group.dataset.spo || $group.dataset.key;
            if (!key) return;
            const val = chip.dataset.val;
            const wasActive = chip.classList.contains('active');
            qsa('.ce-chip', $group).forEach(c => c.classList.remove('active'));
            if (!wasActive) chip.classList.add('active');
            const newVal = wasActive ? '' : val;
            _recordChange(key, newVal);
        });
    });
}

function setChipValue(key, val) {
    const $group = qs(`.ce-chip-group[data-spo="${key}"], .ce-chip-group[data-key="${key}"]`);
    if (!$group) return;
    const v = (val ?? '').toString().toLowerCase();
    let matched = false;
    qsa('.ce-chip', $group).forEach(chip => {
        const chipVal = (chip.dataset.val ?? '').toLowerCase();
        const hit = !matched && v && (v === chipVal || v.includes(chipVal) || chipVal.includes(v));
        chip.classList.toggle('active', hit);
        if (hit) matched = true;
    });
}

// ── Range sliders ─────────────────────────────────────────────────────────────

function initSliders() {
    const defaults = defaultCharOverride();
    qsa('.ce-range').forEach($range => {
        const key = $range.dataset.spo || $range.dataset.key;
        if (!key) return;

        $range.addEventListener('input', () => {
            const v = parseFloat($range.value);
            syncSliderBadge(key, v);
            _recordChange(key, v);
        });

        $range.addEventListener('dblclick', () => {
            const def = defaults[key];
            if (def === undefined) return;
            $range.value = def;
            syncSliderBadge(key, parseFloat(def));
            _recordChange(key, parseFloat(def));
        });
    });
    // Also bind the old cc-slider class (present in our unified HTML)
    qsa('.cc-slider').forEach($sl => {
        const key = $sl.dataset.key;
        if (!key) return;
        $sl.addEventListener('input', () => syncSliderBadge(key, $sl.value));
    });
}

// ── Text fields ───────────────────────────────────────────────────────────────

function initTextFields() {
    qsa('[data-spo].ce-input, [data-spo].ce-textarea, [data-spo].ce-select').forEach($el => {
        const key = $el.dataset.spo;
        if (!key) return;
        $el.addEventListener('input', debounce(() => _recordChange(key, $el.value), 250));
    });
}

// ── Colour swatches ───────────────────────────────────────────────────────────

function initSwatches() {
    [
        ['skinTone',  '#ce-skin-swatches'],
        ['hairColor', '#ce-hair-swatches'],
        ['eyeColor',  '#ce-eye-swatches'],
    ].forEach(([field, groupSel]) => {
        const $g = qs(groupSel);
        if (!$g) return;
        qsa('.ce-color-dot:not(.ce-color-dot--custom)', $g).forEach(btn => {
            btn.addEventListener('click', () => {
                const colorName = btn.title;
                _setTextValue(field, colorName);
                _recordChange(field, colorName);
                _markActiveSwatch($g, btn);
            });
        });
        const $custom = qs('.ce-color-dot--custom', $g);
        if ($custom) {
            $custom.addEventListener('click', () => {
                const inp = document.createElement('input');
                inp.type = 'color';
                inp.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
                document.body.appendChild(inp);
                inp.click();
                inp.addEventListener('input', () => { _setTextValue(field, inp.value); _recordChange(field, inp.value); });
                inp.addEventListener('change', () => document.body.removeChild(inp));
            });
        }
    });
}

function _setTextValue(key, val) {
    const $el = qs(`[data-spo="${key}"].ce-input, [data-spo="${key}"].ce-textarea, #ce-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`);
    if ($el) $el.value = val;
    // Also try direct id match
    const direct = qs(`#ce-${key}`);
    if (direct) direct.value = val;
}

function _markActiveSwatch($group, activeBtn) {
    qsa('.ce-color-dot', $group).forEach(b => b.classList.remove('active'));
    activeBtn.classList.add('active');
}

function syncSwatchesFromData(data) {
    [
        ['skinTone',  '#ce-skin-swatches'],
        ['hairColor', '#ce-hair-swatches'],
        ['eyeColor',  '#ce-eye-swatches'],
    ].forEach(([field, groupSel]) => {
        const $g = qs(groupSel);
        if (!$g) return;
        const loaded = (data[field] ?? '').toString().toLowerCase();
        qsa('.ce-color-dot:not(.ce-color-dot--custom)', $g).forEach(btn => btn.classList.remove('active'));
        if (!loaded) return;
        let matched = false;
        qsa('.ce-color-dot:not(.ce-color-dot--custom)', $g).forEach(btn => {
            if (matched) return;
            const title = (btn.title ?? '').toLowerCase();
            if (title && (loaded === title || loaded.includes(title) || title.includes(loaded))) {
                btn.classList.add('active');
                matched = true;
            }
        });
    });
}

// ── Stat pills ────────────────────────────────────────────────────────────────

function updateStatPills() {
    if (!_activeCharId) return;
    const all = getCharOverride(_activeCharId);
    const pills = [
        all.species  && { icon: '⚗', label: all.species },
        all.gender   && { icon: '♾', label: all.gender },
        all.age      && { icon: '🕰', label: `Age ${all.age}` },
        all.height   && { icon: '↕', label: all.height },
        all.bodyType && { icon: '◈', label: all.bodyType },
        all.eyeColor && { icon: '👁', label: all.eyeColor },
    ].filter(Boolean);
    const $pills = qs('#ce-stat-pills');
    if (!$pills) return;
    $pills.innerHTML = pills.map(p =>
        `<span class="ce-stat-pill"><span class="ce-stat-pill__icon">${p.icon}</span>${esc(p.label)}</span>`
    ).join('');
}

const updateStatPillsDebounced = debounce(updateStatPills, 600);

// ── Auto-save / change recording ──────────────────────────────────────────────

function _recordChange(key, val) {
    _pendingChanges[key] = val;
    _setSaveStatus('Unsaved changes…');
    _autoSave();
}

const _autoSave = debounce(() => {
    if (!_activeCharId) return;
    _flushChanges();
}, 800);

function _flushChanges() {
    if (!_activeCharId || !Object.keys(_pendingChanges).length) return;

    const coreKeys = new Set(Object.keys(defaultCharOverride()));
    const coreFields = {};
    const extFields  = {};

    for (const [k, v] of Object.entries(_pendingChanges)) {
        if (k === '_galleryDirty') continue;
        if (coreKeys.has(k)) coreFields[k] = v;
        else extFields[k] = v;
    }

    const stored = state.config?.charOverrides?.[_activeCharId] || {};
    const prevUserEdits = stored._userEdits || { core: {}, ext: {} };
    const newUserEdits = {
        core: { ...prevUserEdits.core, ...coreFields },
        ext:  { ...prevUserEdits.ext,  ...extFields  },
    };
    const newExt = { ...(stored.ext || {}), ...extFields };
    setCharOverride(_activeCharId, { ...coreFields, ext: newExt, _userEdits: newUserEdits });

    // Mirror back to loadedCharacters so char-editor always reads current data
    const card = state.loadedCharacters[_activeCharId];
    if (card) {
        if (!card.extensions)           card.extensions = {};
        if (!card.extensions.underdark) card.extensions.underdark = {};
        const ud = card.extensions.underdark;
        if (!ud.ext) ud.ext = {};
        for (const [k, v] of Object.entries(coreFields)) ud[k] = v;
        for (const [k, v] of Object.entries(extFields))  ud.ext[k] = v;
        // Persist gallery
        ud.gallery = _gallery.map(a => a.url);
        saveState();
    }

    _pendingChanges = {};
    _setSaveStatus('Saved ✓');
    setTimeout(() => _setSaveStatus(''), 2500);
}

function _setSaveStatus(msg) {
    const $s = qs('#ce-save-status');
    if ($s) $s.textContent = msg;
}

// ── Populate form from merged data ────────────────────────────────────────────

async function populateForm(meta, card, charId) {
    // Core card fields
    setField('name',          card.name || '');
    setField('description',   card.description || '');
    setField('personality',   card.personality || '');
    setField('scenario',      card.scenario || '');
    setField('first-mes',     card.first_mes || '');
    setField('mes-example',   card.mes_example || '');
    setField('alt-greetings', (card.alternate_greetings || []).join('\n---\n'));
    setField('system-prompt', card.system_prompt || '');
    setField('post-history',  card.post_history_instructions || '');
    setField('creator-notes', card.creator_notes || '');
    setField('creator',       card.creator || 'trap.lol');
    setField('version',       card.version || card.character_version || '1.0');
    setField('tags',          (meta?.tags || card.tags || []).join(', '));
    setField('tagline',       meta?.tagline || '');
    setField('id-preview',    charId || '');

    const merged = charId ? getCharOverride(charId) : null;
    const ud  = card.extensions?.underdark || {};
    const ov  = merged || ud;
    const ext = merged?.ext || ud.ext || {};

    // Core underdark override fields
    setField('nickname',            ov.nickname             || ud.nickname             || '');
    setField('voice-tone',          ov.voiceTone            || ud.voiceTone            || '');
    setField('speech-patterns',     ov.speechPatterns       || ud.speechPatterns       || '');
    setField('species',             ov.species              || ud.species              || '');
    setField('gender',              ov.gender               || ud.gender               || '');
    setField('age',                 ov.age                  || ud.age                  || '');
    setField('height',              ov.height               || ud.height               || '');
    setField('body-type',           ov.bodyType             || ud.bodyType             || '');
    setField('skin-tone',           ov.skinTone             || ud.skinTone             || '');
    setField('hair-color',          ov.hairColor            || ud.hairColor            || '');
    setField('hair-style',          ov.hairStyle            || ud.hairStyle            || '');
    setField('eye-color',           ov.eyeColor             || ud.eyeColor             || '');
    setField('distinctive-features',ov.distinctiveFeatures  || ud.distinctiveFeatures  || '');
    setField('breast-size',         ov.breastSize           || ud.breastSize           || '');
    setField('nipple-color',        ov.nippleColor          || ud.nippleColor          || '');
    setField('areolae-size',        ov.areolaeSize          || ud.areolaeSize          || '');
    setField('body-hair',           ov.bodyHair             || ud.bodyHair             || '');
    setField('genitalia',           ov.genitalia            || ud.genitalia            || '');
    setField('other-adult',         ov.otherAdultFeatures   || ud.otherAdultFeatures   || '');
    setField('append-system',       ov.appendToSystem       || ud.appendToSystem       || '');
    setField('persistent-memory',   ov.persistentMemory     || ud.persistentMemory     || '');
    setField('model-override',      ov.modelOverride        || ud.modelOverride        || '');
    setField('system-override',     ov.systemPromptOverride || ud.systemPromptOverride || '');
    setField('post-override',       ov.postHistoryOverride  || ud.postHistoryOverride  || '');

    // Core behavior sliders (0–100 range)
    const coreSliders = ['dominanceLevel','explicitnessLevel','romanticismLevel','violenceLevel',
                         'anxietyLevel','loyaltyLevel','stubbornness','selfEsteemLevel','curiosityLevel','empathyLevel'];
    coreSliders.forEach(k => {
        const v = ov[k] ?? ud[k];
        if (v != null) setSlider(k, v);
    });

    const enabledCb = qs('#ce-enabled');
    if (enabledCb) enabledCb.checked = (ov.enabled ?? ud.enabled) !== false;

    // Extended text fields
    EXT_MAP.forEach(([fieldId, extKey]) => {
        const val = (merged != null ? (merged[extKey] ?? ext[extKey]) : ext[extKey]) ?? '';
        setField(fieldId, val);
    });

    // Extended numeric sliders
    EXT_SLIDERS.forEach(k => {
        const v = merged != null ? (merged[k] ?? ext[k]) : ext[k];
        if (v != null) setSlider(k, v);
    });

    // Chip selectors — populate from merged data
    const flatData = { ...ov, ...(ext || {}) };
    qsa('.ce-chip-group[data-spo]').forEach($group => {
        const key = $group.dataset.spo;
        const val = key in flatData ? flatData[key] : '';
        setChipValue(key, val);
    });

    // Populate sims-style model select
    const $globalModel = qs('#model-select');
    const $ceModel     = qs('#ce-model-select');
    if ($globalModel && $ceModel) {
        if (!$ceModel.options.length || $ceModel.options.length <= 1) {
            $ceModel.innerHTML = '<option value="">— Use global model —</option>' + $globalModel.innerHTML;
        }
        $ceModel.value = ov.modelOverride || ud.modelOverride || '';
    }

    // Sync swatches
    syncSwatchesFromData(flatData);

    // Avatar
    if (meta?.avatar_path || card.avatar) {
        let src = meta?.avatar_path || card.avatar;
        if (src && src.startsWith('idb:') && charId) {
            src = await loadAvatar(charId).catch(() => null);
        }
        if (src) setAvatarPreview(src);
    }

    // Gallery
    _gallery = (ud.gallery || []).map(url => ({ url, label: '' }));
    renderGallery();

    updateHeader();
    updateStatPills();
}

// ── Reset form ────────────────────────────────────────────────────────────────

function resetForm() {
    qsa('#modal-char-editor input, #modal-char-editor textarea, #modal-char-editor select').forEach(el => {
        if (el.type === 'file' || el.type === 'checkbox' || el.type === 'radio') return;
        el.value = '';
    });
    qsa('#modal-char-editor input[type=checkbox]').forEach(el => el.checked = false);

    const DEFAULTS = {
        dominanceLevel: 50, explicitnessLevel: 50, romanticismLevel: 50, violenceLevel: 30,
        anxietyLevel: 40, loyaltyLevel: 60, stubbornness: 50, selfEsteemLevel: 55,
        curiosityLevel: 60, empathyLevel: 50,
        verbosity: 5, formality: 5, speechPace: 5,
        eyeSize: 5, hairShine: 5, muscleTone: 5, bodyFat: 5,
        sociabilityLevel: 50, impulsivityLevel: 50, deceptivenessLevel: 30,
        narcissismLevel: 30, protectivenessLevel: 50, playfulnessLevel: 50,
        obedienceLevel: 50, jealousyLevel: 30, humorLevel: 50, sadismLevel: 10,
        libido: 5, stamina: 5, exhibitionism: 5,
    };
    Object.entries(DEFAULTS).forEach(([k, v]) => setSlider(k, v));

    clearAvatarPreview();
    _gallery = [];
    renderGallery();
    setField('id-preview', '');
    setField('version', '1.0');
    setField('creator', 'trap.lol');

    const $spec = qs('#ce-spec-version');
    if ($spec) $spec.value = '2.0';

    qsa('.ce-chip').forEach(c => c.classList.remove('active'));
    _setSaveStatus('');
}

// ── Build card from form ──────────────────────────────────────────────────────

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
        enabled:              qs('#ce-enabled')?.checked !== false,
    };

    const coreSliders = ['dominanceLevel','explicitnessLevel','romanticismLevel','violenceLevel',
                         'anxietyLevel','loyaltyLevel','stubbornness','selfEsteemLevel','curiosityLevel','empathyLevel'];
    coreSliders.forEach(k => { const v = readSlider(k); if (v !== null) coreUd[k] = v; });

    const ext = {};
    EXT_MAP.forEach(([fieldId, extKey]) => {
        const val = readField(fieldId);
        if (val) ext[extKey] = val;
    });
    EXT_SLIDERS.forEach(k => { const v = readSlider(k); if (v !== null) ext[k] = v; });

    if (_gallery.length) coreUd.gallery = _gallery.map(a => a.url);

    const card = {
        spec: 'chara_card_v2',
        spec_version: qs('#ce-spec-version')?.value || '2.0',
        data: {
            name,
            description:               readField('description'),
            personality:               readField('personality'),
            scenario:                  readField('scenario'),
            first_mes:                 readField('first-mes'),
            mes_example:               readField('mes-example'),
            alternate_greetings:       altGreets,
            system_prompt:             readField('system-prompt'),
            post_history_instructions: readField('post-history'),
            creator_notes:             readField('creator-notes'),
            creator:                   readField('creator'),
            character_version:         readField('version') || '1.0',
            tags,
            extensions: { underdark: { ...coreUd, ext } },
            avatar: _avatarDataUrl || null,
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
        switchTab('card');
        const $n = qs('#ce-name');
        if ($n) { $n.classList.add('ce-shake'); setTimeout(() => $n.classList.remove('ce-shake'), 500); }
        showToast('Name is required.', 'error');
        return false;
    }
    return true;
}

// ── Save ──────────────────────────────────────────────────────────────────────

let _saving = false;
async function saveCard(activate = false) {
    if (_saving) return;
    if (!validate()) return;
    _saving = true;
    _setSaveStatus('Saving…');

    const $saveBtns = qsa('#ce-save, #ce-save-activate');
    $saveBtns.forEach(b => { b.disabled = true; });

    try {
        _flushChanges();
        const { card, meta } = buildCardFromForm();
        if (_editId) meta.id = _editId;

        await saveCharacter(meta, card.data);

        const ud  = card.data.extensions?.underdark || {};
        const ext = ud.ext || {};
        const existing = state.config?.charOverrides?.[meta.id] || {};
        const existingExt = existing.ext || {};
        const mergedExt = { ...existingExt, ...ext };
        const { ext: _e, gallery: _g, ...coreFromCard } = ud;
        setCharOverride(meta.id, { ...existing, ...coreFromCard, ext: mergedExt });

        closeEditor();
        document.dispatchEvent(new CustomEvent('char-editor:saved', { detail: { id: meta.id, activate } }));
        showToast(`${meta.name} ${_editId ? 'updated' : 'created'}.`, 'success');
    } catch (err) {
        _setSaveStatus('Save failed');
        showToast(`Save failed: ${err.message}`, 'error', 6000);
    } finally {
        _saving = false;
        $saveBtns.forEach(b => { b.disabled = false; });
    }
}

// ── Export ────────────────────────────────────────────────────────────────────

function exportJson() {
    if (!validate()) return;
    const { card, meta } = buildCardFromForm();
    _triggerDownload(
        new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' }),
        `${slugify(meta.name) || 'character'}.json`
    );
    showToast('Exported JSON.', 'info');
}

function exportToCodebase() {
    if (!validate()) return;
    const { card, meta } = buildCardFromForm();
    _triggerDownload(new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' }), `${slugify(meta.name)}.json`);
    const indexEntry = {
        id: meta.id, name: meta.name, tagline: meta.tagline || '',
        card_path: `data/cards/${slugify(meta.name)}.json`,
        avatar_path: isDataUrl(_avatarDataUrl) ? '🎭' : (_avatarDataUrl || '🎭'),
        tags: meta.tags,
    };
    setTimeout(() => _triggerDownload(new Blob([JSON.stringify(indexEntry, null, 2)], { type: 'application/json' }), `${slugify(meta.name)}-index-entry.json`), 400);
    showToast('Exported card + index entry.', 'info', 6000);
}

function _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
}

// ── Randomise ─────────────────────────────────────────────────────────────────

function randomiseFields() {
    const r = {};
    r.species   = pick(RAND.species);
    r.gender    = pick(RAND.gender);
    r.pronouns  = pick(RAND.pronouns);
    r.age       = String(18 + Math.floor(Math.random() * 42));
    r.zodiac    = pick(RAND.zodiac);
    r.hairLength = pick(RAND.hairLength);
    r.hairStyle  = pick(RAND.hairStyle);
    r.bodyType   = pick(RAND.bodyType);
    r.eyeColor   = pick(RAND.eyeColor);
    r.skinTone   = pick(RAND.skinTone);
    r.hairColor  = pick(RAND.hairColor);
    r.muscleTone = 2 + Math.floor(Math.random() * 7);
    r.bodyFat    = 2 + Math.floor(Math.random() * 7);
    r.styleArchetype = pick(RAND.styleArchetype);
    r.voiceTone  = pick(RAND.voiceTone);
    r.verbosity  = 3 + Math.floor(Math.random() * 6);
    r.formality  = 2 + Math.floor(Math.random() * 8);
    r.speechPace = 3 + Math.floor(Math.random() * 6);
    r.archetype  = pick(RAND.archetype);
    r.alignment  = pick(RAND.alignment);
    r.attachmentStyle = pick(RAND.attachmentStyle);
    r.moodBaseline    = pick(RAND.moodBaseline);
    r.dominanceLevel     = Math.floor(Math.random() * 100);
    r.explicitnessLevel  = Math.floor(Math.random() * 100);
    r.romanticismLevel   = Math.floor(Math.random() * 100);
    r.violenceLevel      = Math.floor(Math.random() * 60);
    r.empathyLevel       = 20 + Math.floor(Math.random() * 60);
    r.playfulnessLevel   = 20 + Math.floor(Math.random() * 60);
    r.obedienceLevel     = 20 + Math.floor(Math.random() * 60);
    r.jealousyLevel      = 10 + Math.floor(Math.random() * 60);
    r.humorLevel         = 20 + Math.floor(Math.random() * 60);
    r.sadismLevel        = Math.floor(Math.random() * 40);
    r.sociabilityLevel   = 20 + Math.floor(Math.random() * 60);
    r.curiosityLevel     = 30 + Math.floor(Math.random() * 60);
    r.impulsivityLevel   = 15 + Math.floor(Math.random() * 60);
    r.anxietyLevel       = 10 + Math.floor(Math.random() * 50);
    r.stubbornness       = 20 + Math.floor(Math.random() * 60);
    r.loyaltyLevel       = 40 + Math.floor(Math.random() * 50);
    r.protectivenessLevel = 20 + Math.floor(Math.random() * 60);
    r.selfEsteemLevel    = 20 + Math.floor(Math.random() * 70);
    r.deceptivenessLevel = Math.floor(Math.random() * 50);
    r.narcissismLevel    = 5 + Math.floor(Math.random() * 50);
    r.narrativePOV = pick(RAND.narrativePOV);
    r.proseStyle   = pick(RAND.proseStyle);
    return r;
}

// ── Open / Close ──────────────────────────────────────────────────────────────

async function openEditor(charId) {
    _editId         = charId || null;
    _activeCharId   = charId || null;
    _avatarDataUrl  = null;
    _gallery        = [];
    _pendingChanges = {};

    resetForm();
    switchTab('card');

    if (charId) {
        const card = state.loadedCharacters[charId];
        const meta = state.characters.find(c => c.id === charId);
        if (!card || !meta) {
            showToast('Character data not found — may have been deleted.', 'error');
            return;
        }
        try {
            if (card.extensions?.underdark) {
                const ud = card.extensions.underdark;
                const { ext: cardExt, ...cardCore } = ud;
                const coreKeys = new Set(Object.keys(defaultCharOverride()));
                const coreFromCard = {};
                const extFromCard  = { ...(cardExt || {}) };
                for (const [k, v] of Object.entries(cardCore)) {
                    if (coreKeys.has(k)) coreFromCard[k] = v;
                    else extFromCard[k] = v;
                }
                const stored = state.config?.charOverrides?.[charId] || {};
                const userEdits = stored._userEdits || {};
                const mergedExt = { ...extFromCard, ...(userEdits.ext || {}) };
                const mergedCore = { ...coreFromCard, ...userEdits.core };
                setCharOverride(charId, { ...mergedCore, ext: mergedExt });
            }
            await populateForm(meta, card, charId);
        } catch (err) {
            showToast(`Failed to load character: ${err.message}`, 'error', 6000);
            console.error('[char-editor] openEditor error:', err);
        }
    }

    const $m = qs('#modal-char-editor');
    if ($m) { $m.hidden = false; if (window.lucide) window.lucide.createIcons(); }
    updateHeader();
}

function closeEditor() {
    const $m = qs('#modal-char-editor');
    if ($m) $m.hidden = true;
    _editId         = null;
    _activeCharId   = null;
    _avatarDataUrl  = null;
    _gallery        = [];
    _pendingChanges = {};
}

// ── Public init ───────────────────────────────────────────────────────────────

export function initCharEditor() {
    const $m = qs('#modal-char-editor');
    if (!$m) return;

    // ── Open triggers ─────────────────────────────────────────────────────────
    qs('#create-character')?.addEventListener('click', () => openEditor(null));

    document.addEventListener('char-editor:open', e => openEditor(e.detail?.charId || null));
    // legacy compat — both old events now open the unified editor
    document.addEventListener('char-creator:open', e => openEditor(e.detail?.charId || null));
    document.addEventListener('sims-editor:open',  e => {
        const id = e.detail?.charId;
        if (!id) return;
        openEditor(id).then(() => switchTab('face'));
    });

    // ── Close / backdrop ──────────────────────────────────────────────────────
    qs('#ce-close')?.addEventListener('click', closeEditor);
    qs('#ce-cancel')?.addEventListener('click', closeEditor);
    qs('.ce-backdrop')?.addEventListener('click', closeEditor);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !$m.hidden) closeEditor();
    });

    // ── Tab nav ───────────────────────────────────────────────────────────────
    qsa('.ce-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // ── Avatar ────────────────────────────────────────────────────────────────
    qs('#ce-avatar-upload-btn')?.addEventListener('click', () => qs('#ce-avatar-file')?.click());
    qs('#ce-avatar-file')?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        setAvatarPreview(await readFileAsDataUrl(file));
        e.target.value = '';
    });
    qs('#ce-avatar-url-btn')?.addEventListener('click', () => {
        const url = qs('#ce-avatar-url-input')?.value.trim();
        if (url) setAvatarPreview(url);
    });
    qs('#ce-avatar-clear')?.addEventListener('click', () => {
        clearAvatarPreview();
        const $u = qs('#ce-avatar-url-input');
        if ($u) $u.value = '';
    });

    // ── Gallery add ───────────────────────────────────────────────────────────
    qs('#ce-gallery-add-btn')?.addEventListener('click', () => qs('#ce-gallery-file')?.click());
    qs('#ce-gallery-file')?.addEventListener('change', async e => {
        for (const file of [...e.target.files]) {
            _gallery.push({ url: await readFileAsDataUrl(file), label: '' });
        }
        renderGallery();
        e.target.value = '';
    });
    qs('#ce-gallery-url-btn')?.addEventListener('click', () => {
        const url = qs('#ce-gallery-url-input')?.value.trim();
        if (!url) return;
        _gallery.push({ url, label: '' });
        renderGallery();
        qs('#ce-gallery-url-input').value = '';
    });
    qs('#ce-gallery-export-all')?.addEventListener('click', exportAllGallery);

    // ── Import card ───────────────────────────────────────────────────────────
    qs('#ce-import-btn')?.addEventListener('click', () => qs('#ce-import-file')?.click());
    qs('#ce-import-file')?.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const { parseCharacterCard } = await import('./parser-v2.js?v=4');
            const card = await parseCharacterCard(file);
            await populateForm(null, card, null);
            showToast('Card imported — review and save.', 'info');
        } catch (err) {
            showToast(`Import failed: ${err.message}`, 'error');
        }
        e.target.value = '';
    });

    // ── Sidebar field syncing (Name+Tagline) ──────────────────────────────────
    const syncPair = (id1, id2) => {
        const el1 = qs(`#ce-${id1}`);
        const el2 = qs(`#ce-${id2}`);
        if (!el1 || !el2) return;
        el1.addEventListener('input', () => { el2.value = el1.value; if (id1 === 'name') updateHeader(); });
        el2.addEventListener('input', () => { el1.value = el2.value; });
    };
    syncPair('name', 'name-tab');
    syncPair('tagline', 'tagline-tab');

    // Auto-generate ID from name (create mode only)
    qs('#ce-name')?.addEventListener('input', debounce(() => {
        if (_editId) return;
        const name = qs('#ce-name').value.trim();
        setField('id-preview', name ? generateId(name) : '');
    }, 300));

    // ── Body map hotspots ─────────────────────────────────────────────────────
    const $tooltip = qs('#ce-region-tooltip');
    qsa('.ce-region').forEach(el => {
        const region = el.dataset.region;
        if (!region) return;
        el.addEventListener('mouseenter', () => {
            if ($tooltip) { $tooltip.textContent = REGION_LABELS[region] || region; $tooltip.style.opacity = '1'; }
        });
        el.addEventListener('mouseleave', () => { if ($tooltip) $tooltip.style.opacity = '0'; });
        el.addEventListener('click', () => { const cat = REGION_TO_CAT[region]; if (cat) switchTab(cat); });
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const cat = REGION_TO_CAT[region]; if (cat) switchTab(cat); }
        });
    });

    // ── Interactions ──────────────────────────────────────────────────────────
    initChipGroups();
    initSliders();
    initTextFields();
    initSwatches();

    // Update stat pills on any input
    $m.addEventListener('input', updateStatPillsDebounced);

    // ── Save / Export ─────────────────────────────────────────────────────────
    qs('#ce-save')?.addEventListener('click',          () => saveCard(false));
    qs('#ce-save-activate')?.addEventListener('click', () => saveCard(true));
    qs('#ce-export-json')?.addEventListener('click',   exportJson);
    qs('#ce-topbar-export')?.addEventListener('click', exportJson);
    qs('#ce-export-codebase')?.addEventListener('click', exportToCodebase);

    // ── Randomise ─────────────────────────────────────────────────────────────
    qs('#ce-random-btn')?.addEventListener('click', () => {
        const rnd = randomiseFields();
        for (const [k, v] of Object.entries(rnd)) _pendingChanges[k] = v;
        const current = _activeCharId ? getCharOverride(_activeCharId) : {};
        const flat = { ...current, ...(current.ext || {}), ...rnd };
        // Apply to text fields via data-spo
        qsa('[data-spo].ce-input, [data-spo].ce-textarea').forEach($el => {
            const key = $el.dataset.spo;
            if (key in rnd) $el.value = rnd[key];
        });
        // Apply chips
        qsa('.ce-chip-group[data-spo]').forEach($g => {
            const key = $g.dataset.spo;
            if (key in rnd) setChipValue(key, rnd[key]);
        });
        // Apply sliders
        for (const [k, v] of Object.entries(rnd)) {
            if (typeof v === 'number') { setSlider(k, v); syncSliderBadge(k, v); }
        }
        _setSaveStatus('Randomised — unsaved');
        _autoSave();
    });

    // ── Reset ─────────────────────────────────────────────────────────────────
    qs('#ce-reset-btn')?.addEventListener('click', () => {
        if (!_activeCharId) return;
        const def = defaultCharOverride();
        setCharOverride(_activeCharId, { ...def, ext: {}, _userEdits: { core: {}, ext: {} } });
        resetForm();
        _pendingChanges = {};
        _setSaveStatus('Reset to defaults ✓');
        setTimeout(() => _setSaveStatus(''), 2500);
    });

    // ── Apply (save overrides without closing) ────────────────────────────────
    qs('#ce-apply-btn')?.addEventListener('click', () => {
        _flushChanges();
        _setSaveStatus('Applied ✓');
    });

    return { open: openEditor, close: closeEditor };
}

