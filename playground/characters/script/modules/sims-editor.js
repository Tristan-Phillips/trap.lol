/**
 * sims-editor.js — Full Sims-style character config editor.
 * Manages the #modal-sims-editor overlay with body-map hotspots,
 * chip selectors, sliders with live descriptions, quick colour swatches,
 * random field generation, and real-time state persistence.
 */

import { getCharOverride, setCharOverride, defaultCharOverride, state, saveState } from './state.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
const qs  = (sel, ctx = document) => ctx.querySelector(sel);
const qsa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Field map: data-spo → override key (most map 1:1; some are new extended fields) ──
// Extended keys beyond defaultCharOverride are serialised under charOverride.ext
const EXT_KEYS = new Set([
    'name',
    'pronouns', 'occupation', 'nationality', 'tagsRaw',
    'faceShape', 'complexion', 'eyeShape', 'noseType', 'lipsType',
    'facialHair', 'facePiercings',
    'hairHighlights', 'hairLength', 'hairTexture', 'hairShine', 'hairAccessories',
    'weight', 'muscleTone', 'bodyFat', 'shoulderWidth', 'waistType',
    'bodyMarkings', 'bodyPiercings', 'nails', 'scent',
    'styleArchetype', 'outfitDescription', 'colorPalette', 'signatureItem',
    'footwear', 'jewelry', 'underwear',
    'accent', 'catchphrases', 'verbosity', 'formality', 'vocabulary',
    'coreTraits', 'archetype', 'fears', 'desires', 'alignment',
    'backstory', 'secrets', 'hobbies',
    'empathyLevel', 'playfulnessLevel', 'obedienceLevel', 'jealousyLevel',
    'humorLevel', 'sadismLevel',
    'breastShape', 'buttocksSize', 'buttocksShape', 'intimateMarkings',
    'sexualOrientation', 'kinks', 'hardLimits',
    'eyeSize',
]);

// Slider descriptors — maps value ranges to human-readable strings
const SLIDER_DESCS = {
    dominanceLevel: [
        [0,  15,  'Deeply submissive — anticipates and defers to every wish.'],
        [16, 30,  'Mostly submissive — prefers following over leading.'],
        [31, 45,  'Slightly passive — cooperative and accommodating.'],
        [46, 55,  'Balanced — neither dominant nor submissive.'],
        [56, 70,  'Quietly assertive — holds their ground when it counts.'],
        [71, 85,  'Dominant — takes charge, expects compliance.'],
        [86, 100, 'Strongly dominant — commands the room; expects total deference.'],
    ],
    explicitnessLevel: [
        [0,  15,  'Fade-to-black — all intimacy implied, never shown.'],
        [16, 30,  'Tasteful — emotional intimacy, minimal physical detail.'],
        [31, 45,  'Suggestive — clearly sensual but not graphic.'],
        [46, 55,  'Moderate — sensual with some explicit description.'],
        [56, 70,  'Mature — graphic detail when appropriate.'],
        [71, 85,  'Explicit — detailed and unapologetic.'],
        [86, 100, 'Fully explicit — maximally graphic; nothing is left implied.'],
    ],
    romanticismLevel: [
        [0,  15,  'Ice cold — purely transactional, no emotion.'],
        [16, 30,  'Distant — little warmth or affection expressed.'],
        [31, 45,  'Reserved — subtle hints of feeling, rarely shown.'],
        [46, 55,  'Warm — comfortable with affection in the right moment.'],
        [56, 70,  'Romantic — openly expresses care and passion.'],
        [71, 85,  'Intensely romantic — emotionally vivid and passionate.'],
        [86, 100, 'Achingly passionate — all-consuming devotion and desire.'],
    ],
    violenceLevel: [
        [0,  15,  'Non-violent — conflict is verbal or emotional only.'],
        [16, 30,  'Low — fights happen but remain brief and undescribed.'],
        [31, 45,  'Moderate — combat is present but not savoured.'],
        [46, 55,  'Visceral — fights are detailed and impactful.'],
        [56, 70,  'Graphic — injuries and violence described in full.'],
        [71, 85,  'Very graphic — gore and brutality included freely.'],
        [86, 100, 'Extreme — maximally graphic, visceral, and unrestrained.'],
    ],
    empathyLevel: [
        [0,  20,  'Predatory — treats others as objects or tools.'],
        [21, 40,  'Callous — aware of emotions but largely indifferent.'],
        [41, 60,  'Moderate — reacts to obvious emotional cues.'],
        [61, 80,  'Empathic — perceptive and genuinely caring.'],
        [81, 100, 'Deeply empathic — attuned to subtle emotional currents; highly nurturing.'],
    ],
    playfulnessLevel: [
        [0,  20,  'Grave / serious — all business, no nonsense.'],
        [21, 40,  'Restrained — rare flashes of humor under heavy situations.'],
        [41, 60,  'Balanced — professional but can laugh.'],
        [61, 80,  'Playful — enjoys banter and light teasing.'],
        [81, 100, 'Mischievous — incorrigibly playful; everything is a game.'],
    ],
    obedienceLevel: [
        [0,  20,  'Defiant — pushes back on nearly every request.'],
        [21, 40,  "Willful — follows if they agree; resists if they don't."],
        [41, 60,  'Neutral — picks battles, generally cooperative.'],
        [61, 80,  'Compliant — prefers to please and follow instructions.'],
        [81, 100, 'Eager to please — almost never refuses; prioritizes compliance.'],
    ],
    jealousyLevel: [
        [0,  20,  'Unattached — no possessiveness whatsoever.'],
        [21, 40,  'Mildly territorial — slight tension around rivals.'],
        [41, 60,  'Noticeably jealous — expresses it but stays controlled.'],
        [61, 80,  'Strongly possessive — overt jealousy and controlling tendencies.'],
        [81, 100, 'Obsessively possessive — clinging, threatening, potentially dangerous.'],
    ],
    humorLevel: [
        [0,  20,  'Humorless — utterly devoid of levity.'],
        [21, 40,  'Dry wit — occasional deadpan remarks.'],
        [41, 60,  'Average — laughs at the right moments.'],
        [61, 80,  'Witty — quick with a quip or clever observation.'],
        [81, 100, 'Comedic — relentlessly funny; jokes even in dire situations.'],
    ],
    sadismLevel: [
        [0,  10,  'Essentially gentle — pain is the last resort.'],
        [11, 25,  'Firm — can inflict discomfort when necessary, without pleasure.'],
        [26, 45,  'Indifferent — neither enjoys nor avoids causing pain.'],
        [46, 65,  'Casually cruel — enjoys small cruelties and power games.'],
        [66, 85,  'Sadistic — takes visible pleasure in the suffering of others.'],
        [86, 100, 'Deeply sadistic — cruelty is a core motivator and pleasure source.'],
    ],
    verbosity: [
        [1, 3,   'Terse — one-liners and clipped responses only.'],
        [4, 6,   'Measured — says what needs saying, nothing more.'],
        [7, 8,   'Expansive — enjoys explaining and describing in detail.'],
        [9, 10,  'Verbose — elaborate, often digressive responses.'],
    ],
    formality: [
        [1, 3,   'Crude / street casual — zero filter.'],
        [4, 6,   'Conversational — relaxed, everyday speech.'],
        [7, 8,   'Polished — correct grammar, professional register.'],
        [9, 10,  'Formal / archaic — precise, elegant, elevated speech.'],
    ],
    eyeSize: [
        [1, 3,   'Narrow / sleepy eyes.'],
        [4, 6,   'Average eye size.'],
        [7, 8,   'Wide, expressive eyes.'],
        [9, 10,  'Striking, very large eyes.'],
    ],
    muscleTone: [
        [1, 3,   'Soft — no visible muscle definition.'],
        [4, 6,   'Average — some tone, not remarkable.'],
        [7, 8,   'Toned — visible definition.'],
        [9, 10,  'Chiseled — extremely well-defined musculature.'],
    ],
    bodyFat: [
        [1, 2,   'Very lean / skeletal.'],
        [3, 4,   'Athletic — low body fat.'],
        [5, 6,   'Average body composition.'],
        [7, 8,   'Soft / full figure.'],
        [9, 10,  'Voluptuous / heavy set.'],
    ],
    hairShine: [
        [1, 3,   'Dull / dry — little to no shine.'],
        [4, 6,   'Healthy — normal shine.'],
        [7, 8,   'Glossy — catches the light.'],
        [9, 10,  'Lustrous — almost mirror-like sheen.'],
    ],
};

function getSliderDesc(key, val) {
    const ranges = SLIDER_DESCS[key];
    if (!ranges) return '';
    const v = parseFloat(val);
    for (const [lo, hi, text] of ranges) {
        if (v >= lo && v <= hi) return text;
    }
    return '';
}

// ── Randomisation pools ───────────────────────────────────────────────────────
const RAND = {
    species:       ['Human','Elf','Half-Elf','Tiefling','Android','Vampire','Werewolf','Demon','Fae','Orc'],
    gender:        ['Woman','Man','Non-binary','Genderfluid','Agender'],
    pronouns:      ['she/her','he/him','they/them','she/they','he/they'],
    hairLength:    ['short','medium','long','very-long'],
    hairStyle:     ['straight','wavy','curly','braided','ponytail','messy','bun','undercut'],
    bodyType:      ['slender','lean','average','athletic','muscular','curvy','full-figured'],
    eyeColor:      ['dark brown','warm amber','ice blue','forest green','silver-grey','violet','gold','crimson'],
    skinTone:      ['pale alabaster','warm beige','golden tan','rich brown','deep umber','cool ivory'],
    hairColor:     ['raven black','dark brown','chestnut','auburn','warm blonde','platinum','silver','fire red','cobalt blue','deep violet'],
    archetype:     ['noble-rogue','broken-hero','seducer','trickster','caretaker','tsundere','kuudere','rebel'],
    alignment:     ['chaotic-good','neutral-good','chaotic-neutral','true-neutral','lawful-neutral'],
    voiceTone:     ['husky','low','melodic','raspy','soft','gravelly'],
    styleArchetype:['cyberpunk','gothic','streetwear','elegant','leather','casual','minimalist'],
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function randomiseFields(targetObj) {
    const r = {};
    r.species   = pick(RAND.species);
    r.gender    = pick(RAND.gender);
    r.pronouns  = pick(RAND.pronouns);
    r.age       = String(18 + Math.floor(Math.random() * 42));
    r.hairLength  = pick(RAND.hairLength);
    r.hairStyle   = pick(RAND.hairStyle);
    r.bodyType    = pick(RAND.bodyType);
    r.eyeColor    = pick(RAND.eyeColor);
    r.skinTone    = pick(RAND.skinTone);
    r.hairColor   = pick(RAND.hairColor);
    r.archetype   = pick(RAND.archetype);
    r.alignment   = pick(RAND.alignment);
    r.voiceTone   = pick(RAND.voiceTone);
    r.styleArchetype = pick(RAND.styleArchetype);
    r.dominanceLevel    = Math.floor(Math.random() * 100);
    r.explicitnessLevel = Math.floor(Math.random() * 100);
    r.romanticismLevel  = Math.floor(Math.random() * 100);
    r.violenceLevel     = Math.floor(Math.random() * 60);
    r.empathyLevel      = 20 + Math.floor(Math.random() * 60);
    r.playfulnessLevel  = 20 + Math.floor(Math.random() * 60);
    r.obedienceLevel    = 20 + Math.floor(Math.random() * 60);
    r.muscleTone        = 2 + Math.floor(Math.random() * 7);
    r.bodyFat           = 2 + Math.floor(Math.random() * 7);
    r.verbosity         = 3 + Math.floor(Math.random() * 6);
    r.formality         = 2 + Math.floor(Math.random() * 8);
    return r;
}

// ── Region → panel mapping ────────────────────────────────────────────────────
const REGION_TO_CAT = {
    head:      'face',
    neck:      'face',
    shoulders: 'body',
    chest:     'adult',
    arms:      'body',
    abdomen:   'body',
    hips:      'adult',
    legs:      'body',
};

// ── Main export ───────────────────────────────────────────────────────────────
export function initSimsEditor() {
    const $modal = qs('#modal-sims-editor');
    if (!$modal) return;

    let activeCharId = null;
    let pendingChanges = {};   // accumulates unsaved field changes

    // ── Open / Close ──────────────────────────────────────────────────────────
    function open(charId) {
        activeCharId  = charId;
        pendingChanges = {};

        const char = state.loadedCharacters[charId];
        const meta = state.characters.find(c => c.id === charId);

        // Badge
        const badge = qs('#sims-char-name-badge');
        if (badge) badge.textContent = char?.name || meta?.name || '—';

        // Load override into fields
        const override = getCharOverride(charId);
        // Build merged ext object (extended keys stored under override.ext)
        const ext = override.ext || {};
        loadAllFields({ ...override, ...ext });

        // Avatar
        const avatar = meta?.avatar_path || char?.avatar || null;
        const $img = qs('#sims-avatar-img');
        if ($img) {
            $img.style.backgroundImage = avatar ? `url(${avatar})` : 'none';
            $img.classList.toggle('has-image', !!avatar);
        }

        // Reset to identity panel
        switchCat('identity');

        // Sync save status
        setSaveStatus('');

        $modal.hidden = false;
        if (window.lucide) window.lucide.createIcons();
    }

    function close() {
        $modal.hidden = true;
        activeCharId  = null;
        pendingChanges = {};
    }

    // ── Category Switching ────────────────────────────────────────────────────
    function switchCat(cat) {
        qsa('.sims-cat-btn').forEach(btn => {
            const active = btn.dataset.cat === cat;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', active);
        });
        qsa('.sims-panel').forEach(panel => {
            panel.hidden = panel.dataset.panel !== cat;
        });
    }

    qsa('.sims-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => switchCat(btn.dataset.cat));
    });

    // ── Body Map Hotspots ─────────────────────────────────────────────────────
    const $tooltip = qs('#sims-region-tooltip');
    const REGION_LABELS = {
        head: 'Face & Head', neck: 'Face & Head', shoulders: 'Body & Physique',
        chest: 'Adult / NSFW', arms: 'Body & Physique', abdomen: 'Body & Physique',
        hips: 'Adult / NSFW', legs: 'Body & Physique',
    };

    qsa('.sims-region').forEach(el => {
        const region = el.dataset.region;
        if (!region) return;

        el.addEventListener('mouseenter', e => {
            if ($tooltip) {
                $tooltip.textContent = REGION_LABELS[region] || region;
                $tooltip.style.opacity = '1';
                $tooltip.style.pointerEvents = 'none';
            }
        });
        el.addEventListener('mouseleave', () => {
            if ($tooltip) $tooltip.style.opacity = '0';
        });
        el.addEventListener('click', () => {
            const cat = REGION_TO_CAT[region];
            if (cat) switchCat(cat);
        });
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const cat = REGION_TO_CAT[region];
                if (cat) switchCat(cat);
            }
        });
    });

    // Highlight active panel's body region(s)
    function highlightRegions(cat) {
        const catToRegions = {
            face:    ['head', 'neck'],
            hair:    ['head'],
            body:    ['shoulders', 'arms', 'abdomen', 'legs'],
            adult:   ['chest', 'hips'],
        };
        const active = catToRegions[cat] || [];
        qsa('.sims-region').forEach(el => {
            el.classList.toggle('sims-region--active', active.includes(el.dataset.region));
        });
    }

    qsa('.sims-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => highlightRegions(btn.dataset.cat));
    });

    // ── Chip Selectors ────────────────────────────────────────────────────────
    function initChipGroups() {
        qsa('.sims-chip-group').forEach($group => {
            $group.addEventListener('click', e => {
                const chip = e.target.closest('.sims-chip');
                if (!chip || chip.disabled) return;
                const key = $group.dataset.spo;
                if (!key) return;

                // Toggle vs single-select
                const val = chip.dataset.val;
                const wasActive = chip.classList.contains('active');

                // Single-select (deselect others)
                qsa('.sims-chip', $group).forEach(c => c.classList.remove('active'));
                if (!wasActive) chip.classList.add('active');

                const newVal = wasActive ? '' : val;
                recordChange(key, newVal);
            });
        });
    }

    function setChipValue(key, val) {
        const $group = qs(`.sims-chip-group[data-spo="${key}"]`);
        if (!$group) return;
        qsa('.sims-chip', $group).forEach(chip => {
            chip.classList.toggle('active', chip.dataset.val === val);
        });
    }

    // ── Range Sliders ─────────────────────────────────────────────────────────
    function initSliders() {
        qsa('.sims-range').forEach($range => {
            const key = $range.dataset.spo;
            if (!key) return;

            $range.addEventListener('input', () => {
                const v = parseFloat($range.value);
                // Update badge
                const $badge = qs(`#sims-val-${key}`);
                if ($badge) $badge.textContent = Number.isInteger(v) ? v : v.toFixed(2);
                // Update description
                const $desc = qs(`#sims-desc-${key}`);
                if ($desc) $desc.textContent = getSliderDesc(key, v) || '';
                // Record
                recordChange(key, v);
            });
        });
    }

    function setSliderValue(key, val) {
        const $range = qs(`.sims-range[data-spo="${key}"]`);
        if ($range) {
            $range.value = val;
            const $badge = qs(`#sims-val-${key}`);
            const v = parseFloat(val);
            if ($badge) $badge.textContent = Number.isInteger(v) ? v : v.toFixed(2);
            const $desc = qs(`#sims-desc-${key}`);
            if ($desc) $desc.textContent = getSliderDesc(key, v) || '';
        }
    }

    // ── Text inputs & textareas ───────────────────────────────────────────────
    function initTextFields() {
        qsa('.sims-input, .sims-textarea, .sims-select').forEach($el => {
            const key = $el.dataset.spo;
            if (!key) return;
            $el.addEventListener('input', debounce(() => {
                recordChange(key, $el.value);
            }, 250));
        });
    }

    // ── Quick colour swatches ─────────────────────────────────────────────────
    function initSwatches() {
        // Skin tone swatches → skinTone text field
        qsa('#sims-skin-swatches .sims-color-dot:not(.sims-color-dot--custom)').forEach(btn => {
            btn.addEventListener('click', () => {
                const colorName = btn.title;
                setTextValue('skinTone', colorName);
                recordChange('skinTone', colorName);
                markActiveSwatchInGroup(qs('#sims-skin-swatches'), btn);
            });
        });

        // Hair swatches → hairColor text field
        qsa('#sims-hair-swatches .sims-color-dot:not(.sims-color-dot--custom)').forEach(btn => {
            btn.addEventListener('click', () => {
                const colorName = btn.title;
                setTextValue('hairColor', colorName);
                recordChange('hairColor', colorName);
                markActiveSwatchInGroup(qs('#sims-hair-swatches'), btn);
            });
        });

        // Eye swatches → eyeColor text field
        qsa('#sims-eye-swatches .sims-color-dot:not(.sims-color-dot--custom)').forEach(btn => {
            btn.addEventListener('click', () => {
                const colorName = btn.title;
                setTextValue('eyeColor', colorName);
                recordChange('eyeColor', colorName);
                markActiveSwatchInGroup(qs('#sims-eye-swatches'), btn);
            });
        });

        // Custom colour buttons → native color picker
        qsa('.sims-color-dot--custom').forEach(btn => {
            const target = btn.dataset.swatchTarget;
            btn.addEventListener('click', () => {
                const inp = document.createElement('input');
                inp.type = 'color';
                inp.style.position = 'fixed';
                inp.style.opacity  = '0';
                inp.style.pointerEvents = 'none';
                document.body.appendChild(inp);
                inp.click();
                inp.addEventListener('input', () => {
                    setTextValue(target, inp.value);
                    recordChange(target, inp.value);
                });
                inp.addEventListener('change', () => {
                    document.body.removeChild(inp);
                });
            });
        });
    }

    function markActiveSwatchInGroup($group, activeBtn) {
        qsa('.sims-color-dot', $group).forEach(b => b.classList.remove('active'));
        activeBtn.classList.add('active');
    }

    // ── Field read/write helpers ──────────────────────────────────────────────
    function setTextValue(key, val) {
        const $el = qs(`[data-spo="${key}"].sims-input, [data-spo="${key}"].sims-textarea`);
        if ($el) $el.value = val;
    }

    function loadAllFields(data) {
        // Text / textarea / select
        qsa('[data-spo].sims-input, [data-spo].sims-textarea, [data-spo].sims-select').forEach($el => {
            const key = $el.dataset.spo;
            if (key in data && data[key] !== undefined) {
                $el.value = data[key];
            } else {
                $el.value = '';
            }
        });

        // Chips
        qsa('.sims-chip-group[data-spo]').forEach($group => {
            const key = $group.dataset.spo;
            const val = key in data ? data[key] : '';
            setChipValue(key, val);
        });

        // Sliders
        qsa('.sims-range[data-spo]').forEach($range => {
            const key = $range.dataset.spo;
            if (key in data && data[key] !== undefined) {
                setSliderValue(key, data[key]);
            }
        });

        // Populate sims model select from global model select options
        const $globalModel = qs('#model-select');
        const $simsModel   = qs('#sims-model-select');
        if ($globalModel && $simsModel) {
            const opts = $globalModel.innerHTML;
            if (!$simsModel.options.length || $simsModel.options.length <= 1) {
                $simsModel.innerHTML = '<option value="">— Use global model —</option>' + opts;
            }
            $simsModel.value = data.modelOverride || '';
        }
    }

    // ── Change recorder & auto-save ───────────────────────────────────────────
    function recordChange(key, val) {
        pendingChanges[key] = val;
        setSaveStatus('Unsaved changes…');
        autoSave();
    }

    const autoSave = debounce(() => {
        if (!activeCharId) return;
        flushChanges();
    }, 800);

    function flushChanges() {
        if (!activeCharId || !Object.keys(pendingChanges).length) return;

        // Split pending into core fields and ext fields
        const coreFields = {};
        const extFields  = {};

        const coreKeys = Object.keys(defaultCharOverride());

        for (const [k, v] of Object.entries(pendingChanges)) {
            if (coreKeys.includes(k)) {
                coreFields[k] = v;
            } else {
                extFields[k] = v;
            }
        }

        // Load existing override to preserve ext
        const existing = getCharOverride(activeCharId);
        const newExt = { ...(existing.ext || {}), ...extFields };

        setCharOverride(activeCharId, { ...coreFields, ext: newExt });
        pendingChanges = {};
        setSaveStatus('Saved ✓');
        setTimeout(() => setSaveStatus(''), 2500);
    }

    function setSaveStatus(msg) {
        const $s = qs('#sims-save-status');
        if ($s) $s.textContent = msg;
    }

    // ── Stat pills (live preview) ─────────────────────────────────────────────
    function updateStatPills() {
        if (!activeCharId) return;
        const override = getCharOverride(activeCharId);
        const ext = override.ext || {};
        const all = { ...override, ...ext };

        const pills = [
            all.species    && { icon: '⚗', label: all.species },
            all.gender     && { icon: '♾', label: all.gender },
            all.age        && { icon: '🕰', label: `Age ${all.age}` },
            all.height     && { icon: '↕', label: all.height },
            all.bodyType   && { icon: '◈', label: all.bodyType },
            all.eyeColor   && { icon: '👁', label: all.eyeColor },
        ].filter(Boolean);

        const $pills = qs('#sims-stat-pills');
        if (!$pills) return;
        $pills.innerHTML = pills.map(p =>
            `<span class="sims-stat-pill"><span class="sims-stat-pill__icon">${p.icon}</span>${p.label}</span>`
        ).join('');
    }

    // Update pills on any input change
    const updatePillsDebounced = debounce(updateStatPills, 600);
    $modal.addEventListener('input', updatePillsDebounced);

    // ── Randomise ─────────────────────────────────────────────────────────────
    qs('#sims-random-btn')?.addEventListener('click', () => {
        if (!activeCharId) return;
        const rnd = randomiseFields();
        // Merge into pending and load to UI
        for (const [k, v] of Object.entries(rnd)) {
            pendingChanges[k] = v;
        }
        loadAllFields({ ...getCharOverride(activeCharId), ...(getCharOverride(activeCharId).ext || {}), ...rnd });
        setSaveStatus('Randomised — unsaved');
        autoSave();
    });

    // ── Reset ─────────────────────────────────────────────────────────────────
    qs('#sims-reset-btn')?.addEventListener('click', () => {
        if (!activeCharId) return;
        const def = defaultCharOverride();
        setCharOverride(activeCharId, { ...def, ext: {} });
        loadAllFields(def);
        pendingChanges = {};
        setSaveStatus('Reset to defaults ✓');
        setTimeout(() => setSaveStatus(''), 2500);
    });

    // ── Apply ─────────────────────────────────────────────────────────────────
    qs('#sims-apply-btn')?.addEventListener('click', () => {
        flushChanges();
        close();
    });

    // ── Cancel ────────────────────────────────────────────────────────────────
    qs('#sims-cancel-btn')?.addEventListener('click', close);
    qs('#sims-close-btn')?.addEventListener('click', close);
    qs('.modal__backdrop', $modal)?.addEventListener('click', close);

    // Escape key
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !$modal.hidden) close();
    });

    // ── Init interactions ─────────────────────────────────────────────────────
    initChipGroups();
    initSliders();
    initTextFields();
    initSwatches();

    // ── Public API ────────────────────────────────────────────────────────────
    return { open, close };
}
