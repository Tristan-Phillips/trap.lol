# trap.lol — File Structure Ruleset

> Canonical rules for where files live, how directories are named, and how the project is organized.
> Written 2026-05-18 after a full structural audit.
> **Authority:** This file governs. CLAUDE.md defers to it on structure questions. logs.json references it.

---

## 1. Project Topology — The Two Patterns

Every part of this repo falls into one of two patterns. Knowing which pattern applies to a given directory determines every structural decision for it.

### Pattern A — Shared System (`glass/`)

`glass/` is the hub design system. It owns the CSS, the core JS modules, the shared data JSONs, and the markdown content. It is **not an app**. It has no `index.html`. It is a toolbox that pages import from.

```
glass/
  data/       — all content-driving JSON files
  script/     — main.js entry + modules/ subdirectory
  style/       — style.css entry + modules/ subdirectory
  assets/      — static binary assets (images only)
  markdown/    — raw .md files served by /guide/
```

### Pattern B — Self-Contained App (everything else)

Every app is a directory at the repo root with its own `index.html`. Apps own everything they need inside themselves. They may import from `glass/` but they do not reach into other apps.

**Standard app layout:**

```
<app-name>/
  index.html          — the page (always at app root, never nested)
  assets/             — all non-page files for this app
    data/             — JSON data files
    script/           — JS files (if single-file, just app.js; if modular, add modules/)
    style/            — CSS files (if single-file, just style.css)
```

**Modular app layout** (when script or style grows beyond one file):

```
<app-name>/
  index.html
  assets/
    data/
    script/
      main.js         — entry point
      modules/        — named feature modules
    style/
      style.css       — entry point (@import from modules/ if needed)
      modules/        — named CSS modules
```

**Exception — `glass/`-integrated apps** (hub-scale apps that share glass modules):

These use `script/` and `style/` directly at app root (not inside `assets/`) because they import from `../../glass/`. The `assets/` convention only applies to fully self-contained apps.

```
<app-name>/
  index.html
  data/               — app-specific JSON
  script/
    main.js
    modules/
  style/
    style.css
    [modules/]
```

---

## 2. Directory Naming

| Rule | Correct | Wrong |
|------|---------|-------|
| All directory names: lowercase, no spaces | `glass/`, `art/`, `dndm/` | `Art/`, `DnDM/`, `my app/` |
| Multi-word dirs: kebab-case | `llm-agents/`, `scene-codex/` | `llmAgents/`, `SceneCodex/` |
| Internal dirs use semantic names, not generic | `cards/`, `lorebooks/` | `items/`, `stuff/` |
| Subdirectory for large collections | `underdark/data/cards/` | `underdark/data/card-2b.json` (flat) |
| Draft / in-progress data: `_drafts/` | `data/_drafts/` | `data/drafts/`, `data/wip/` |
| The shared design system is always `glass/` | `glass/` | `hub/`, `core/`, `shared/` |
| App assets container is always `assets/` | `assets/` | `public/`, `src/`, `static/` |

---

## 3. File Naming

### HTML
- Entry point is always `index.html`, never named after the app.
- Sub-pages (tool pages, local-only pages) are `index.html` inside a named subdirectory.
  - Correct: `void/new/index.html`
  - Wrong: `void/new-entry.html`

### JavaScript
- Entry point: `main.js`
- Single-file apps (no modules): `app.js`
- Modules: named by feature in kebab-case — `llm-engine.js`, `char-editor.js`, `scene-codex.js`
- No `utils.js` — utility functions belong in a semantically named module (`shared-utils.js` is the exception when truly cross-cutting)
- Module files never have numeric prefixes or version suffixes

### CSS
- Entry point: `style.css`
- Module files: named by concern in kebab-case — `variables.css`, `components.css`, `neural-uplink.css`
- No `_` prefix convention (this is not SASS)
- Module files live in `style/modules/` under the app root

### JSON
- Named by the content domain, lowercase kebab-case: `llm.json`, `apps.json`, `hosting.json`
- Index files for a collection: `index.json`
- Schema definitions: `schema.json`
- Config files: `config.json`
- Do not name files after their consuming page — `llm.json` not `playground-llm.json`
- Temporary/scratch files are not committed — if they exist, move or delete them

### Go / Backend
- Backend services live in `services/<service-name>/`
- Standard Go layout applies within each service

---

## 4. App Placement at Repo Root

Apps are top-level directories. The rule for what gets a top-level slot:

| Gets a top-level dir | Does NOT |
|----------------------|----------|
| Has its own `index.html` (its own URL) | Sub-pages of an app |
| Has its own distinct identity / purpose | Data files, configs |
| Maintained independently | Backend services (use `services/`) |

**Current valid top-level apps:**

```
art/        /art/       — ECHOES gallery
dndm/       /dndm/      — D&D manager
playground/ /playground/ — App hub / Neural Uplink
radar/      /radar/     — Torrent scanner
status/     /status/    — Uplink Sentinel + logs
underdark/  /underdark/ — Roleplay interface
void/       /void/      — Personal transmission log
```

**Pending restructure** (see `tdo.txt`): `dndm/`, `radar/`, `underdark/` should become sub-apps under `playground/`. Until that move is made, they remain top-level.

---

## 5. The `glass/data/` Layer

`glass/data/` is the single data layer for the home page (`/`) and all `glass/`-integrated apps. Rules:

- One JSON per content domain. No duplicate data across files.
- Every JSON in `glass/data/` has a declared owner in `status/logs/logs.json → sources_of_truth`.
- Scratch files, temp exports, and formatter binaries do not live here permanently.

**Files that belong in `glass/data/`:**

```
config.json       — site metadata + CDN shard URLs
apps.json         — public-facing apps listed on the hub
hosting.json      — hosted services / domains
bots.json         — sovereign bot nodes
tools.json        — dev tools manifest
extlinks.json     — categorised external links (Signal Mesh)
guides.json       — guide/markdown manifest
llm.json          — LLM model catalog (single source of truth)
statstation.json  — non-public station services
trap.json         — personal transmissions (art, rants)
llm-agents/       — agent definition subdirectory
  index.json
  schema.json
  <name>.json
```

**Files that do NOT belong in `glass/data/`:**

- Compiled binaries (`formatter` executable)
- Go source files (`formatter.go`) — these belong in `services/` or a dedicated `tools/` dir
- Temp/scratch JSONs (`llmtemp.json`, `llm-gen.json`) — delete when done or move to `.ai/`
- Anything that is not fetched by the frontend

---

## 6. Self-Contained App Rules

Apps in Pattern B (self-contained with `assets/`) must not:
- Import from another app's `assets/` directory
- Reach upward more than one level to `glass/` (allowed: `../../glass/script/modules/`)
- Duplicate data that already exists in `glass/data/`

Apps must:
- Keep their `index.html` at the app root (not inside `assets/`)
- House all runtime data in `assets/data/`
- Not commit dev tools, binaries, or generated outputs to `assets/data/`

---

## 7. `status/` Structure

`status/` is a hub page and data store. `status/index.html` lists all sub-sections; `status/logs/` is the intelligence terminal.

```
status/
  index.html          — Status hub page (minimal, extensible)
  logs/
    index.html        — Logs viewer
    data/
      logs.json       — Site persistent memory / knowledge base
      signal.json     — Mutable companion: tasks, issues, proposals
      structure-ruleset.md  — THIS FILE
```

All non-HTML files under `logs/` live in `logs/data/`. The viewer (`index.html`) fetches them via relative paths (`./data/logs.json`, `./data/signal.json`, `./data/structure-ruleset.md`).

---

## 8. Meta / AI Context Files

```
.ai/
  GEMINI-root.md      — Gemini-specific context for the root/glass system
  GEMINI-underdark.md — Gemini-specific context for The Underdark
  plan-*.md           — Implementation plans (completed plans should be deleted)
  llm-toimplement.json — Feature backlog (kept as scratch; not deployed)
```

`CLAUDE.md` lives at the repo root — this is required by Claude Code and must not be moved.

`.ai/` files are never deployed and never imported by frontend code. They are context documents for LLM sessions only.

Plans in `.ai/plan-*.md` should be deleted once the work is shipped, not accumulated indefinitely.

---

## 9. Root-Level Files

Only the following belong at the repo root:

| File | Purpose |
|------|---------|
| `index.html` | Hub home page |
| `favicon.ico` | Site favicon |
| `CNAME` | GitHub Pages custom domain |
| `.nojekyll` | Disables Jekyll processing |
| `.gitignore` | Git ignore rules |
| `CLAUDE.md` | Claude Code project instructions |
| `README.md` | Human-readable project overview |
| `CHANGELOG.md` | Change log |
| `LICENSE` | License |
| `package.json` | npm scripts for local dev server only |

**Does not belong at root:**
- `tdo.txt` — move to `.ai/tdo.md`
- Any app directory that should be under `playground/` (per `tdo.txt`)
- Any compiled binary or generated file

---

## 10. The `shards/` Directory

`shards/` holds local dev copies of CDN-served libraries (`lucide.min.js`, `marked.min.js`). It is gitignored in production. Rules:
- Never commit files to `shards/`
- Never reference `shards/` in production code paths
- CDN URLs live in `glass/data/config.json → shards`

---

## 11. `void/assets/` Anomaly

The `void/` app has an `assets/data/` directory that is currently empty. The actual data file (`void.json`) lives in `assets/content/` instead. This is a structural anomaly.

**Correct target state:**
```
void/assets/
  data/
    void.json         — move here from assets/content/
  script/
    app.js
  style/
    style.css
```

`assets/content/` should not exist — content data is data, it lives in `assets/data/`.

---

## 12. Violation Register

Known current violations (to be resolved):

| Violation | Location | Rule | Fix |
|-----------|----------|------|-----|
| Compiled binary in data dir | `glass/data/formatter` | §5 | Move to `services/` or delete |
| Go source in data dir | `glass/data/formatter.go` | §5 | Move to `services/` or delete |
| Temp JSON committed | `glass/data/llmtemp.json` | §5 | Delete |
| Scratch JSON committed | `glass/data/llm-gen.json` | §5 | Delete or move to `.ai/` |
| Todo file at repo root | `tdo.txt` | §9 | Move to `.ai/tdo.md` |
| Data in `assets/content/` | `void/assets/content/void.json` | §11 | Move to `void/assets/data/void.json` |
| `guide/` missing | (no `guide/` dir) | §4 | Create per architecture docs |
| Empty `void/assets/data/` | `void/assets/data/` | §11 | Populate after moving void.json |
| `.ai/plan-css-refactor.md` | `.ai/` | §8 | Delete (CSS refactor is shipped) |
| `dndm/`, `radar/`, `underdark/` at root | repo root | §4 | Move under `playground/` (per tdo.txt) |
