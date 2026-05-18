# DM MATRIX — Full Specification & Build Plan

> A complete Dungeon Master management suite.
> Built by trap as a surprise gift for their partner.
> Local-first. No backend. No framework. No build step.
> Part of trap.lol but completely standalone — no trap.lol branding visible to the user.

---

## 1. Identity

| Field | Value |
|---|---|
| App name | DM MATRIX |
| URL path | /playground/dndm/ |
| Tab title | DM MATRIX // Campaign Suite |
| Favicon | Rune circle, crimson on near-black |
| Edition | D&D 5th Edition (2014 PHB / SRD) |
| Author | trap (Tristan Phillips) |
| Recipient | Partner (surprise gift) |
| Robots | noindex — keep hidden until reveal |

---

## 2. Philosophy

- **Local-first**: all data lives in the browser (export/import JSON for persistence and portability). No server, no cloud, no accounts.
- **Offline-capable**: the full 5e SRD monster list and spell list ship as bundled JSON files. No API calls required to use the Bestiary or Spellbook.
- **Vanilla stack**: HTML + CSS + vanilla JS (ES modules). No React, Vue, Svelte. No bundler. No Tailwind.
- **Tablet-first**: the primary interaction model is a finger on a large touchscreen (iPad, Surface Pro). Mouse/trackpad is secondary.
- **Atmospheric**: this is not a utility. It is a stage. Every screen should feel like opening an ancient tome in a candlelit dungeon.
- **Complete**: aim to replace every DM's physical reference materials, notes, and session tools in a single tab.

---

## 3. Aesthetic Direction

### 3.1 Visual Register
Dark arcane tome. Physical. Aged. The UI should feel like leather, parchment, iron clasps, and burning candles — not like a SaaS dashboard.

The palette is entirely distinct from trap.lol's violet/gold. This app has its own visual identity.

### 3.2 Colour Palette

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0A0705` | Base background — near-black with deep warm undertone |
| `--bg-panel` | `#110D09` | Panel/card backgrounds |
| `--bg-raised` | `#1A1208` | Elevated surfaces, input backgrounds |
| `--crimson` | `#8B1A1A` | Primary accent — blood red |
| `--crimson-hi` | `#C42B2B` | Bright crimson — hover, active, glows |
| `--gold` | `#C4922A` | Secondary accent — aged gold |
| `--gold-hi` | `#E8B84B` | Bright gold — highlights, runes |
| `--bone` | `#E8DFCF` | Primary text — warm parchment white |
| `--bone-muted` | `#9A8E7A` | Secondary text — aged, faded |
| `--bone-dim` | `#4A4035` | Tertiary text — very faded, almost invisible |
| `--rune` | `rgba(196, 146, 42, 0.15)` | Subtle rune glow, texture overlays |
| `--danger` | `#8B1A1A` | Damage, death, danger states |
| `--safe` | `#3D6B3D` | Healing, safe states |
| `--magic` | `#4A2D6B` | Spell/magic accent |

### 3.3 Typography

| Role | Stack | Use |
|---|---|---|
| Heading | `Georgia, 'Times New Roman', serif` | Section headers, module titles, campaign name |
| Body | `system-ui, -apple-system, sans-serif` | Descriptions, notes, prose |
| Data | `ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace` | HP numbers, AC, stats, dice results, IDs |
| Rune | `Georgia, serif` + letter-spacing + CSS styling | Decorative labels, UI chrome |

Rules:
- All numbers are mono
- All UI chrome labels are uppercase, mono, tracked out
- All narrative/lore content is serif or body
- Never use font weights below 400 for readability on dark backgrounds

### 3.4 Texture System

Applied via CSS pseudo-elements (`::before`, `::after`) and SVG filters:

| Layer | Effect |
|---|---|
| `body::before` | SVG feTurbulence grain at 4% opacity — papyrus/parchment noise |
| `body::after` | Very subtle horizontal scanlines at 1.5% opacity |
| `.panel` | `background: var(--bg-panel)` + `border: 1px solid rgba(196,146,42,0.12)` + inner shadow |
| `.panel::before` | Leather-like noise SVG filter on panel backgrounds |
| Sidebar | Darker, with a right border gradient from `--crimson` to transparent |
| Cards | Box-shadow with warm ambient glow: `0 2px 16px rgba(139,26,26,0.18)` |
| Active nav item | Crimson left border + crimson glow |

### 3.5 Iconography
- Use Lucide icons loaded from `cdn.trap.lol/shards/lucide.min.js` for functional UI icons (consistent with rest of site)
- Decorative rune/D&D icons: CSS-drawn or inline SVG only — no icon library
- Dice faces: Canvas 2D drawn (see Dice module)

### 3.6 Animation Principles
- All animations respect `prefers-reduced-motion` — kill or minimise when set
- Enter animations: `translateY(12px) → 0`, `opacity 0 → 1`, `0.4s ease-out`
- Hover transitions: `0.18s ease-out`
- State changes: `0.3s cubic-bezier(0.25, 0, 0, 1)`
- Glows: `2.5s infinite ease-in-out` breathing pulse
- Welcome screen rune: complex 3s assembly sequence (see Section 6.1)
- No spinning loaders — use opacity pulse or rune-glow pulse

---

## 4. Architecture

### 4.1 File Structure

```
dndm/
├── index.html                        — App shell
├── assets/
│   ├── data/
│   │   ├── SPEC.md                   — This file
│   │   ├── srd-monsters.json         — Full 5e SRD monster list (~300 monsters)
│   │   ├── srd-spells.json           — Full 5e SRD spell list (~500 spells)
│   │   ├── srd-conditions.json       — All 5e conditions with full text
│   │   ├── srd-actions.json          — Action types reference (Action, Bonus Action, Reaction, etc.)
│   │   └── ambient/                  — DM-uploaded audio (gitignored, IndexedDB in browser)
│   ├── script/
│   │   ├── app.js                    — Entry point, boot sequence
│   │   ├── modules/
│   │   │   ├── state.js              — App state, campaign data, localStorage sync
│   │   │   ├── router.js             — Module navigation, mode switching
│   │   │   ├── welcome.js            — Rune circle welcome screen animation
│   │   │   ├── campaign.js           — Campaign overview, NPC tracker, world notes
│   │   │   ├── session.js            — Session log, XP, milestones, events
│   │   │   ├── party.js              — PC cards, HP tracker, conditions, spell slots
│   │   │   ├── combat.js             — Initiative tracker, damage dealer, conditions
│   │   │   ├── bestiary.js           — Monster lookup, stat block viewer, encounter builder
│   │   │   ├── spellbook.js          — Spell lookup, filter, custom spells
│   │   │   ├── atlas.js              — Map storage, fog of war, player display
│   │   │   ├── soundscape.js         — Audio scene manager, upload handler
│   │   │   ├── oracle.js             — LLM rule assistant (nano-gpt)
│   │   │   ├── dice.js               — Canvas 2D dice roller
│   │   │   ├── cheatsheet.js         — Quick reference panel
│   │   │   ├── settings.js           — Export/import, API key, config
│   │   │   ├── player-screen.js      — BroadcastChannel player display
│   │   │   └── util.js               — esc(), fmtDate(), rollDice(), shared helpers
│   └── style/
│       ├── style.css                 — Master CSS file
│       └── modules/                  — Section-specific CSS (imported via @import in style.css)
│           ├── welcome.css
│           ├── sidebar.css
│           ├── combat.css
│           ├── party.css
│           ├── atlas.css
│           ├── bestiary.css
│           ├── spellbook.css
│           ├── oracle.css
│           ├── dice.css
│           └── settings.css
```

### 4.2 Data Model (Campaign JSON)

All campaign data is exportable/importable as a single JSON file. Structure:

```json
{
  "_meta": {
    "version": "1.0.0",
    "created": "YYYY-MM-DD",
    "lastModified": "YYYY-MM-DD",
    "appVersion": "1.0"
  },
  "campaign": {
    "id": "uuid",
    "name": "Campaign Name",
    "setting": "Freeform description",
    "bannerImage": "base64 or null",
    "createdDate": "YYYY-MM-DD",
    "currentSession": 1,
    "xpTotal": 0,
    "notes": ""
  },
  "players": [
    {
      "id": "uuid",
      "name": "Character Name",
      "playerName": "Player Name",
      "class": "Fighter",
      "subclass": "",
      "race": "Human",
      "level": 1,
      "hp": { "current": 10, "max": 10, "temp": 0 },
      "ac": 15,
      "initiative": 2,
      "speed": 30,
      "conditions": [],
      "spellSlotsUsed": 0,
      "spellSlotsMax": 0,
      "deathSaves": { "successes": 0, "failures": 0 },
      "notes": ""
    }
  ],
  "npcs": [
    {
      "id": "uuid",
      "name": "NPC Name",
      "role": "Innkeeper",
      "location": "Waterdeep",
      "relationship": "Friendly",
      "notes": "",
      "alive": true
    }
  ],
  "sessions": [
    {
      "id": "uuid",
      "number": 1,
      "date": "YYYY-MM-DD",
      "title": "Session Title",
      "summary": "",
      "xpAwarded": 0,
      "events": [],
      "notes": ""
    }
  ],
  "lore": {
    "locations": [],
    "factions": [],
    "timeline": [],
    "scratch": ""
  },
  "maps": [
    {
      "id": "uuid",
      "name": "Map Name",
      "imageData": "base64",
      "gridSize": 40,
      "fogGrid": [],
      "markers": [],
      "createdDate": "YYYY-MM-DD"
    }
  ],
  "favouriteMonsters": [],
  "customSpells": [],
  "customMonsters": [],
  "soundscapePresets": [],
  "cheatsheetNotes": ""
}
```

### 4.3 State Model

The app holds one active campaign in memory at a time. All mutations go through `state.js`. On every mutation, the state is serialised to `localStorage` as `dndm_campaign`. On app open, state is hydrated from `localStorage`. Export/import flushes or replaces the full state.

```js
// state.js shape
{
  campaign: { ...campaignData },
  ui: {
    activeModule: 'campaign',     // current sidebar section
    mode: 'prep',                 // 'prep' | 'session'
    sessionActive: false,
    currentSession: null,
    sidebarCollapsed: false,
    settingsOpen: false
  },
  combat: {
    active: false,
    round: 0,
    turn: 0,
    combatants: []               // ephemeral — not persisted between sessions
  },
  dice: {
    history: []                  // last 10 rolls — session only
  }
}
```

### 4.4 Second Display (Player Screen)

Uses the Web `BroadcastChannel` API. No network required.

- DM tab posts messages to channel `dndm-player`
- Player tab (`/playground/dndm/?view=player`) listens and renders the current scene
- Player screen shows: current map (with fog applied), scene title, ambient mode label
- Player screen never shows: HP, conditions, DM notes, secret markers
- DM has an `Atlas` panel to control what the player screen shows

### 4.5 Audio Architecture

- Scene presets are named configs (tavern, dungeon, forest, combat, silence)
- Each preset stores an array of audio sources by URL (uploaded by DM, stored as object URLs in IndexedDB or as base64 in the campaign JSON)
- The `<audio>` element handles playback — loop, crossfade on scene change
- Volume stored per scene in the campaign JSON
- Uploaded files stored in `localStorage` as base64 if small, or IndexedDB if large

---

## 5. Navigation & Modes

### 5.1 Sidebar Sections (in order)

| # | Icon | Label | Module | Available In |
|---|---|---|---|---|
| 1 | scroll | CAMPAIGN | Campaign Overview | Prep + Session |
| 2 | calendar | SESSIONS | Session Manager | Prep + Session |
| 3 | users | PARTY | PC Tracker | Prep + Session |
| 4 | swords | COMBAT | Initiative & Combat | Session only (accessible in prep) |
| 5 | skull | BESTIARY | Monster Lookup | Prep + Session |
| 6 | sparkles | SPELLBOOK | Spell Reference | Prep + Session |
| 7 | map | ATLAS | Maps & Fog | Prep + Session |
| 8 | music | SOUNDSCAPE | Ambience | Session only |
| 9 | message-circle | ORACLE | LLM Rules Assistant | Prep + Session |
| 10 | dice-d6 | DICE | Dice Roller | Session only |
| — | gear | (SETTINGS) | Settings modal | Always |

### 5.2 Prep Mode vs Session Mode

**Prep Mode** — default on app open
- All modules accessible
- No combat tracker active
- Session mode banner not shown
- COMBAT, SOUNDSCAPE, DICE modules show a "Begin Session to unlock" hint

**Session Mode** — activated by "Begin Session X?" modal
- All modules accessible
- Combat tracker active
- Session mode indicator in sidebar header
- Begin Session modal records: session date, session number, optional title
- End Session button in sidebar closes combat, logs session summary prompt

### 5.3 Sidebar Responsive Behaviour

| Breakpoint | Behaviour |
|---|---|
| `≥ 1200px` | Full sidebar with icons + labels |
| `768px – 1199px` | Icon-only strip, labels appear as tooltips on hover/focus |
| `< 768px` | Icon-only strip slides in from left, hamburger icon at top |

---

## 6. Module Specifications

### 6.1 Welcome Screen

Shown on first load if no campaign is saved. Also shown if user navigates to `/playground/dndm/` with no localStorage data.

**Sequence:**
1. Black screen
2. Rune circle: 8 rune glyphs appear one by one around a circle (CSS `@keyframes` + `animation-delay`)
3. Each glyph: fades in + glow pulse (gold, then settles to dim)
4. Center circle draws itself (SVG `stroke-dashoffset` animation)
5. Title "DM MATRIX" fades in, letter-spaced, crimson
6. Subtitle "Campaign Suite // 5th Edition" fades in below
7. "BEGIN" button materialises — press to create first campaign or load existing
8. Total duration: ~3 seconds before button appears
9. After button press: rune circle implodes (scale to 0, opacity to 0), app fades in

**HTML structure:**
```html
<div id="welcome-screen">
  <div class="rune-circle">
    <svg class="rune-ring" ...><!-- circle --></svg>
    <span class="rune" data-index="0">ᚠ</span>
    <!-- 7 more runes -->
  </div>
  <h1 class="welcome-title">DM MATRIX</h1>
  <p class="welcome-sub">Campaign Suite // 5th Edition</p>
  <button class="welcome-begin">BEGIN</button>
</div>
```

**Rune characters (Elder Futhark):** ᚠ ᚢ ᚦ ᚨ ᚱ ᚲ ᚷ ᚹ

### 6.2 Campaign Overview

Top section: Campaign banner image (uploadable, full-width). If none, a generated CSS gradient banner using campaign name initials.

Sections below:
- **Campaign info**: name (editable), setting description (markdown-enabled textarea), current level/XP
- **NPC Tracker**: card grid. Each NPC card: name, role, location, relationship badge (Friendly/Neutral/Hostile/Unknown), alive/dead toggle, expandable notes. New NPC button.
- **Lore Wiki**: tabbed sub-sections (Locations / Factions / Timeline). Each is a list of named entries with notes. New entry buttons.
- **Scratch Pad**: freeform markdown textarea for in-session notes

### 6.3 Session Manager

List of all sessions (reverse chronological). Each session card:
- Session number + date
- Title (editable)
- Summary (markdown textarea)
- XP awarded (number input)
- Events log (tagged entries: DEATH / MILESTONE / KEY DECISION / TREASURE / OTHER)

"Begin Session X" triggers the mode-switch modal (see 5.2).

### 6.4 Party Tracker

Grid of PC cards (2-col on tablet, 3-col on desktop). Each card:

**Header:** Character name, player name, class + level badge  
**HP Section:** Large HP display (current/max), temp HP. Increment/decrement buttons with +/- input. Downed state (HP = 0) triggers death save tracker (3 successes / 3 failures as pips).  
**Stats row:** AC | Initiative | Speed (compact, mono)  
**Conditions:** Pill badges for active conditions. Tap to remove. "Add condition" opens condition picker (all 5e conditions listed).  
**Spell Slots:** If `spellSlotsMax > 0`: simple slot counter (X remaining of Y). Not per-level — just total slots used.  
**Footer:** "Edit" button opens full edit modal for all fields.

### 6.5 Combat (Initiative Tracker)

The combat engine. Session mode only (accessible in prep for testing).

**Roll Initiative:** Each combatant gets an initiative input. "Sort" button orders them descending. Manual drag-to-reorder override after sorting.

**Combatant row fields:**
- Turn indicator (highlight current)
- Name (PCs show as names, monsters show as "Goblin 1", "Goblin 2")
- HP bar (visual) + current/max number
- AC badge
- Condition tags
- Damage button (opens quick damage input)
- Heal button
- Remove from encounter button

**Encounter controls:**
- Add from Party (pulls in PCs)
- Add Monster (opens Bestiary search)
- Add Custom (name + HP only)
- NEXT TURN button (advances tracker, highlights next in order)
- END COMBAT button (clears initiative, logs combat summary to session)

**Round counter:** Visible at top of combat panel.

**Damage Dealer:** Click the damage button → input box for damage value → "Apply" → HP drops. Can select damage type (bludgeoning, slashing, fire, etc.) for resistances/vulnerabilities flag.

### 6.6 Bestiary

**Search bar:** Filter by name, CR, type (beast, undead, humanoid, etc.).

**Monster card (compact list view):**
- Name, type, CR badge, size
- HP (average), AC
- "Add to Encounter" button
- "Favourite" star
- Click to expand full stat block

**Full stat block view:**
Faithful to the official D&D stat block layout. Includes:
- Ability scores + modifiers
- Saving throws, skills, senses
- Damage immunities/resistances/vulnerabilities
- Actions (with attack rolls and damage — clickable to roll)
- Legendary actions (if applicable)
- Description/lore text

**Custom monsters:** "New Monster" button opens a form matching the stat block schema. Saved to campaign JSON.

**Favourites tab:** Shows bookmarked monsters. Campaign-specific.

### 6.7 Spellbook

**Filters:** Class, Level (1-9 + Cantrip), School, Concentration (yes/no), Ritual (yes/no).

**Spell card (compact):**
- Name, level + school badge, casting time
- Range, duration, components
- Click to expand full description

**Custom spells:** Same "New Spell" form as custom monsters. Saved to campaign JSON.

### 6.8 Atlas (Map Manager)

**Map list sidebar:** Thumbnails of all uploaded maps. Click to open. "Upload Map" button.

**Map view:**
- Map image displayed in a scrollable/pinch-zoomable container
- Grid overlay (toggle on/off, adjustable grid size)
- Fog of war layer: grid squares that are dark by default, DM clicks to reveal (toggle square by square)
- "Paint Mode" toggle: click-drag reveals multiple squares at once
- Marker tools: Secret Door, Trap, NPC Location, Custom — placed on map, only visible to DM
- "Player View" button: opens player screen tab with current map (fog applied, no DM markers)

**Player screen (`?view=player`):**
- Fullscreen map display
- Fog applied exactly as DM has set
- Scene title overlay (fades in/out)
- No navigation, no UI chrome — pure atmosphere

### 6.9 Soundscape

Scene presets:
- TAVERN — warm crowd murmur, fire crackling, lute music
- DUNGEON — dripping water, distant echoes, stone ambience
- FOREST — wind, birdsong, leaves
- COMBAT — tense percussion, metal sounds
- SILENCE — no audio

Each preset:
- Custom name (editable)
- Audio source: upload from device (stores as object URL / base64)
- Volume slider (0-100)
- Loop toggle

"Play Scene" button crossfades to the selected scene's audio.

Additional tracks: overlay tracks (rain, fire, crowd) with individual volume sliders on top of the base scene.

### 6.10 Oracle (LLM Rule Assistant)

Pre-system prompt (not user-editable):
```
You are a 5th Edition Dungeons & Dragons rules expert and Dungeon Master consultant.
You answer rules questions, adjudicate edge cases, suggest rulings, and reference the 5e SRD.
You speak with authority and clarity. You do not discuss topics unrelated to D&D 5e.
Keep responses concise and actionable. Format with markdown when helpful.
```

Interface:
- Chat history panel (session-only, not persisted)
- Input box with Enter-to-send
- Model selector (from nano-gpt routing table — same as playground)
- API key input (stored in `localStorage` as `dndm_ng_key`)
- Suggested questions as chips: "How does grappling work?", "What is a concentration spell?", "Explain advantage/disadvantage", "How do death saves work?"

### 6.11 Dice Roller

Canvas 2D illustrated dice. Not physics — illustrated style with flip animation.

Dice available: d4, d6, d8, d10, d12, d20, d100 (percentile)

Interaction:
- Click a die face to roll it
- Modifier input field (+/- flat modifier)
- Multiple dice: "2d6", "3d8" notation input
- Result: large animated number reveal
- History log: last 10 rolls, timestamped, shown below the roller
- ADVANTAGE button: roll 2d20, show both, highlight higher
- DISADVANTAGE button: roll 2d20, show both, highlight lower

Visual style:
- Each die is a canvas element with the appropriate polygon shape
- Face drawn with aged bone/parchment colour, crimson pips
- On roll: die "flips" (CSS rotateX animation) while result is calculated

### 6.12 Cheat Sheet

Available as a collapsible panel from within Session Mode (accessible via a quick-access button in the sidebar during session, or as part of the Combat module).

Contents:
- **Actions reference**: Action, Bonus Action, Reaction, Free Action — what each is, examples
- **Conditions**: all 5e conditions with their mechanical effects (full text from SRD)
- **Cover rules**: half cover (+2 AC/DEX), three-quarters (+5), total (can't be targeted)
- **Grapple/shove rules**: quick reference
- **Custom notes**: freeform text area — DM's own rules reminders, house rules

Rendered from `srd-conditions.json` and `srd-actions.json` data files.

### 6.13 Settings Modal

Gear icon at bottom of sidebar. Opens a full-overlay modal.

Sections:
- **API Key**: nano-gpt key input for Oracle
- **Campaign**: export campaign as JSON, import JSON (with overwrite warning)
- **Display**: grid size default, fog of war opacity, sidebar label toggle
- **About**: version, keyboard shortcuts reference

---

## 7. Second Display (Player Screen)

URL: `/playground/dndm/?view=player`

When this URL is opened in a second tab or window on the same device:
- It connects to `BroadcastChannel('dndm-player')`
- It listens for messages from the DM tab
- It renders whatever the DM has broadcast (current map with fog, scene title, ambient label)
- No UI chrome — full immersive display

DM-side controls (in Atlas module):
- "Launch Player Screen" button opens `window.open('/playground/dndm/?view=player', 'dndm-player')`
- "Send to Player Screen" button broadcasts current map state
- DM markers (secrets, traps) are stripped before broadcasting

Message schema:
```json
{
  "type": "map-update",
  "mapName": "Dungeon Level 1",
  "imageData": "base64...",
  "fogGrid": [[true, false, ...], ...],
  "sceneTitle": "The Chamber of Echoes"
}
```

---

## 8. SRD Data Files

### 8.1 srd-monsters.json
- Source: System Reference Document 5.1 (Creative Commons)
- ~300 monsters
- Schema per monster: name, size, type, subtype, alignment, cr, hp (avg + roll), ac, speed, ability scores, saves, skills, senses, languages, damage_immunities, damage_resistances, damage_vulnerabilities, condition_immunities, actions[], legendary_actions[], special_abilities[], description
- To be sourced from: https://github.com/5e-bits/5e-database (CC license) or Open5e API snapshot

### 8.2 srd-spells.json
- Source: SRD 5.1
- ~300 spells (SRD subset — not the full 500+ PHB list)
- Schema per spell: name, level, school, casting_time, range, components, duration, concentration, ritual, classes[], description, at_higher_levels
- Source: Open5e or 5e-database

### 8.3 srd-conditions.json
- All 14 conditions: Blinded, Charmed, Deafened, Exhaustion, Frightened, Grappled, Incapacitated, Invisible, Paralyzed, Petrified, Poisoned, Prone, Restrained, Stunned, Unconscious
- Schema: name, effects[] (array of effect strings), notes

### 8.4 srd-actions.json
- Action types: Action, Bonus Action, Reaction, Free Action, Movement
- Combat actions: Attack, Cast a Spell, Dash, Disengage, Dodge, Help, Hide, Ready, Search, Use an Object, Improvise
- Special situations: Grapple, Shove, Two-Weapon Fighting, Cover rules
- Schema: name, category, summary, rules_text

---

## 9. Build Phases

### Phase 1 — Visual Shell (START HERE)
**Goal:** A fully atmospheric, visually complete app shell with no working functionality. Every screen looks finished. No dead functionality.

**Tasks:**
- [ ] `index.html` — full app shell, all containers, no content
- [ ] `style/style.css` — full palette, typography, texture system, CSS custom properties
- [ ] Welcome screen: rune circle animation, title, BEGIN button (static, no routing yet)
- [ ] Sidebar: full visual treatment, icon + label, hover states, active state, collapsed state
- [ ] Main content area: panel layout, placeholder content in each section
- [ ] Prep/Session mode toggle: visual treatment only
- [ ] Responsive: tablet (768px+) and desktop (1200px+) both working
- [ ] All section containers present and styled, even if empty

**Deliverable:** Open the app. It looks incredible. Nothing works. That's fine.

### Phase 2 — State & Navigation
**Goal:** The app navigates. Modules load. State is wired.

**Tasks:**
- [ ] `state.js` — campaign state model, localStorage hydration/persistence
- [ ] `router.js` — sidebar navigation, module switching, mode switching
- [ ] Welcome screen logic — new campaign flow, load existing campaign
- [ ] "Begin Session" modal — full flow
- [ ] `util.js` — shared helpers (esc, rollDice, fmtDate, uuid)

**Deliverable:** Click any nav item, that module renders. State persists on reload.

### Phase 3 — SRD Data
**Goal:** Ship the offline data files.

**Tasks:**
- [ ] Source or build `srd-monsters.json` (~300 monsters, correct schema)
- [ ] Source or build `srd-spells.json` (~300 spells, correct schema)
- [ ] Write `srd-conditions.json` (14 conditions, from SRD)
- [ ] Write `srd-actions.json` (all action types and combat actions)
- [ ] Validate all JSON files (schema check, no corrupt entries)

**Deliverable:** All four SRD data files exist and load correctly.

### Phase 4 — Core Session Modules
**Goal:** The modules a DM needs DURING a session are fully functional.

**Tasks:**
- [ ] `party.js` — PC cards, HP increment/decrement, death saves, conditions, spell slots
- [ ] `combat.js` — initiative input, auto-sort, drag reorder, HP tracking, damage/heal, next turn, end combat
- [ ] `cheatsheet.js` — conditions from srd-conditions.json, actions from srd-actions.json, custom notes

**Deliverable:** A DM can run a full combat encounter.

### Phase 5 — Prep Modules
**Goal:** The modules a DM needs BEFORE a session are fully functional.

**Tasks:**
- [ ] `campaign.js` — campaign info, NPC tracker, lore wiki (locations/factions/timeline), scratch pad
- [ ] `session.js` — session list, session cards, XP, events log
- [ ] `bestiary.js` — search, filter, stat block viewer, add to encounter, favourites, custom monsters
- [ ] `spellbook.js` — search, filter, full spell card, custom spells

**Deliverable:** A DM can fully plan and document a campaign.

### Phase 6 — Atlas & Multimedia
**Goal:** Map management and second screen.

**Tasks:**
- [ ] `atlas.js` — map upload, grid overlay, fog of war (grid-toggle), DM markers
- [ ] `player-screen.js` — BroadcastChannel implementation, player view rendering
- [ ] `soundscape.js` — scene presets, audio upload, playback, crossfade

**Deliverable:** DM can show maps to players, manage fog of war, play ambience.

### Phase 7 — LLM & Dice
**Goal:** Oracle and Dice roller functional.

**Tasks:**
- [ ] `oracle.js` — nano-gpt chat, D&D system prompt, model selector, suggested questions
- [ ] `dice.js` — Canvas 2D dice, all dice types, animation, advantage/disadvantage, history

**Deliverable:** DM can ask rules questions and roll dice from the app.

### Phase 8 — Settings & Export
**Goal:** Data persistence and portability complete.

**Tasks:**
- [ ] `settings.js` — export campaign JSON, import campaign JSON, API key storage, display config
- [ ] Full campaign export/import round-trip tested
- [ ] Keyboard shortcut reference in settings

**Deliverable:** Campaign data is fully portable. App can be handed to another device.

### Phase 9 — Polish & Hardening
**Goal:** Ship-quality. Every edge case handled. Every animation tuned.

**Tasks:**
- [ ] All modules: keyboard accessibility (tabindex, Enter/Space, aria-labels)
- [ ] All modules: mobile/tablet touch targets (min 44px)
- [ ] All modules: empty state UI (when no campaign, no monsters found, etc.)
- [ ] Performance: large monster/spell lists virtualised or paginated
- [ ] Error handling: corrupt import JSON, failed audio, failed API call
- [ ] Final visual pass: every module matches the aesthetic spec exactly
- [ ] `prefers-reduced-motion` check on all animations
- [ ] `noindex` meta tag confirmed
- [ ] Add to `glass/data/apps.json` as a planned/live app

---

## 10. Key Constraints & Hard Rules

1. **No backend.** All data lives in the browser. No fetch to a server ever.
2. **No framework.** Vanilla HTML/CSS/JS (ES modules) only.
3. **No bundler.** Files are served as-is.
4. **No npm CDNs.** Lucide loads from `cdn.trap.lol/shards/lucide.min.js`.
5. **SRD only.** Only content from the 5e System Reference Document can be bundled. No PHB-only content.
6. **esc() everywhere.** All JSON data injected into innerHTML must be escaped.
7. **DOMPurify** for any markdown-rendered content (oracle responses, notes with markdown).
8. **Touch-first.** All interactive elements minimum 44px touch target.
9. **No trap.lol branding.** The app is standalone. No uplink node, no trap.lol reference in the UI.
10. **noindex.** `<meta name="robots" content="noindex">` always present.
11. **Export/import is the backup strategy.** Warn users to export regularly — localStorage can be cleared.
12. **BroadcastChannel player screen is same-device only.** Do not imply it works across devices.
13. **Audio is user-supplied.** No copyrighted audio bundled. Scene presets start empty, DM uploads their own.

---

## 11. Keyboard Shortcuts (Session Mode)

| Shortcut | Action |
|---|---|
| `N` | Next turn (combat) |
| `D` | Open damage input for current combatant |
| `H` | Open heal input for current combatant |
| `Space` | Roll initiative (when initiative panel is open) |
| `Ctrl+B` | Open Bestiary |
| `Ctrl+P` | Open Party tracker |
| `Ctrl+D` | Open Dice roller |
| `Ctrl+O` | Open Oracle |
| `Escape` | Close any open modal/overlay |

---

## 12. Open Questions & Decisions Deferred

| Question | Status |
|---|---|
| Spellbook: DM needs to search for spells that their PCs can cast — should each PC have a spell list? | Deferred to Phase 5 — build spellbook first, add per-PC filter later |
| Bestiary: legendary resistance tracking (3/day) in combat | Deferred to Phase 4 polish |
| Atlas: marker icons for map annotations | Decide during Phase 6 |
| Soundscape: crossfade duration | Default 2s, make configurable in settings |
| Welcome screen: should it show a "recent campaign" after first load? | Yes — if localStorage has data, show campaign name on welcome and "CONTINUE" + "NEW CAMPAIGN" options |
| Font loading: should a web font be loaded for headings, or is Georgia sufficient? | Georgia for now. Revisit in Phase 9 polish — Cinzel (Google Fonts) is the backup option. |
| Fog of war: should revealed squares persist between sessions? | Yes — fog state is part of the map data in campaign JSON |
| Multiple campaigns: single active, but switching = export current + import new | Confirmed. Settings will have "Switch Campaign" which is just export + import flow. |

---

## 13. Reference Sources

- 5e SRD (System Reference Document 5.1): https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf
- Open5e API (for sourcing SRD JSON): https://api.open5e.com
- 5e-database (GitHub, CC license): https://github.com/5e-bits/5e-database
- Lucide icons: https://lucide.dev
- BroadcastChannel API: https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
- Web Audio API (for audio crossfade): https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- Canvas 2D API (for dice): https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API

---

## 14. Session Log

| Date | Work Done |
|---|---|
| 2026-05-16 | SPEC.md written. 50-question design session completed. Full spec locked. Phase 1 ready to begin. |
