# The Underdark — GEMINI.md

## Project Overview
`The Underdark` is a high-aesthetic, framework-free roleplay interface and character management system within the `trap.lol` ecosystem. It enables immersive interaction with AI-driven characters using a modular prompt engineering engine and local-first data persistence.

### Core Philosophy
- **Immersive Roleplay:** Focused on third-person limited present tense narrative, vivid sensory detail, and deep character consistency.
- **Local Sovereignty:** Character cards, chat history, and lorebooks are stored in the browser (`localStorage` and `IndexedDB`).
- **Config-Driven Depth:** Character behavior is modulated through complex JSON manifests and a "Sims-style" visual editor.

## Key Technologies
- **LLM Engine:** Custom payload builder in `script/modules/llm-engine.js` integrating with the **Nano-GPT** API.
- **Prompt Engineering:** Supports graduated behavioral sliders, physical anchors, voice patterns, and recursive summarization for context management.
- **Data Specs:** Adheres to the **SillyTavern / Character Card V2** JSON specification for character interoperability.
- **Styling:** Modular vanilla CSS with a cyberpunk/dark-terminal aesthetic.

## Directory Structure
- `data/cards/`: Character definitions (JSON). Follows `chara_card_v2` spec.
- `data/lorebooks/`: World-building entries (JSON) triggered by keyword matching in chat history.
- `script/modules/`:
  - `llm-engine.js`: Assembly of system prompts, context management (sliding/summarize), and streaming.
  - `lorebook.js`: Keyword scanning and dynamic lore injection.
  - `sims-editor.js`: Visual character trait editor.
  - `state.js`: Global state, session management, and persistence.
  - `parser-v2.js`: Markdown and `<think>` tag processing.
- `style/`: Project-specific aesthetic overrides and component styles.

## Development Conventions
- **Macro Usage:** Always use `{{char}}` and `{{user}}` placeholders in character cards and prompts.
- **State Management:** Mutate state through helpers in `state.js` to ensure consistent persistence to `localStorage`.
- **Token Estimation:** Uses a heuristic of 4 characters per token for budget management.
- **Thought Processing:** Support for `<think>` tags (inner monologue) which are stripped from the main display but can be rendered as collapsible asides.
- **Physical Anchors:** Physical description fields are injected into the system prompt to maintain visual consistency across long sessions.

## Building and Running
This is a **pure vanilla project** with no build steps.
1. Serve the root directory using any static file server (e.g., `npx serve .` or `python -m http.server`).
2. Access via `http://localhost:[port]/playground/characters/index.html`.
3. Requires a Nano-GPT API key for LLM functionality (configured via the in-app Terminal).

## Character Spec (V2)
New character cards should include:
- `name`, `description`, `personality`, `scenario`.
- `first_mes` (Opening message).
- `mes_example` (Dialogue examples using `<START>` separators).
- `system_prompt` & `post_history_instructions` for tone control.
