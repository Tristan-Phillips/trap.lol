# trap.lol — GEMINI.md

## Project Overview
`trap.lol` is a high-aesthetic, sovereign infrastructure dashboard and personal portal. It is built as a **pure vanilla web project** with zero frameworks, zero build steps, and zero dependencies in the runtime core. The project emphasizes self-hosting, decentralization, and "neural uplink" (integrated LLM features).

### Core Philosophy
- **Vanilla Stack:** HTML5, CSS3 (Vanilla), and Modern ES Modules.
- **Data-Driven:** The UI is dynamically generated from JSON manifests located in `glass/data/`.
- **Sovereign & Local:** Focuses on client-side execution and local storage (keys and sessions stay in the browser).
- **Aesthetic:** High-fidelity cyberpunk/dark-terminal aesthetic defined in `glass/style/modules/`.

## Architecture & Technologies
- **Frontend:** Vanilla JS (ES Modules)
- **Styling:** Modular CSS using CSS Variables for theme management.
- **Dependencies (Shards):** 
  - `Lucide` (Icons)
  - `Marked` (Markdown parsing)
  - `DOMPurify` (XSS protection)
  - *Note: These are loaded as "shards" with fallback mechanisms in `core.js`.*
- **LLM Integration:** Built-in "Neural Uplink" chat interface supporting Nano-GPT and other OpenAI-compatible APIs.

## Directory Structure
- `glass/data/`: JSON manifests for all site content (links, tools, bots, LLM config).
- `glass/script/`: Core logic and modular JS components.
- `glass/style/`: Modular CSS files (Layout, Components, Neural Uplink, etc.).
- `shards/`: Local copies of external libraries for offline/fallback use.
- `art/`, `guide/`, `radar/`, `playground/`: Sub-apps or dedicated sections within the portal.

## Building and Running
Since this project has **zero build steps**, you can run it using any static file server.

### Local Development
1. Clone the repository.
2. Start a local server (e.g., using Python, Node, or VS Code Live Server):
   ```bash
   # Using Python
   python -m http.server 8000
   
   # Using Node (npx)
   npx serve .
   ```
3. Open `http://localhost:8000` in your browser.

## Development Conventions
- **No Frameworks:** Do not introduce React, Vue, or Tailwind. Stick to standard Web APIs.
- **Modular JS:** All new logic should be added as ES Modules in `glass/script/modules/` and imported where needed.
- **Config-First:** UI changes should ideally be driven by modifying `glass/data/*.json` rather than hardcoding content in HTML.
- **Naming Convention:** Use `$variableName` for DOM elements in JavaScript (e.g., `const $container = document.getElementById(...)`).
- **Styles:** Use the existing CSS variable system in `variables.css` for colors and spacing to maintain consistency.
