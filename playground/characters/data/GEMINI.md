# The Underdark — Data & Knowledge Base

## Directory Overview
This directory acts as the central "Knowledge Base" for `The Underdark` roleplay interface. It contains all the structured JSON data required to drive character interactions, world-building, and session context. The system is designed to be fully data-driven; adding or modifying files here directly updates the application's capabilities.

## Structure & Key Files

### Core Manifests (Root)
- **`index.json`**: The master registry. It maps character IDs to their file paths, avatars, tags, and associated lorebooks. The UI uses this to populate the character selection screen.
- **`personas.json`**: Defines the user's role (`{{user}}`). These are archetypal personas (e.g., "The Nameless Wanderer", "The Scholar") that provide a pre-defined `userName` and `userPersona` for the LLM.
- **`scenarios.json`**: A collection of global setting templates (e.g., "Near-Future Cyberpunk", "Dark Fantasy"). These provide a baseline `{{scenario}}` context if the character card does not provide a specific one.

### Subdirectories
- **`cards/`**: Contains Character Card V2 (`chara_card_v2`) JSON files. These are the "souls" of the AI agents, defining their personality, speech patterns, and physical anchors. (See `cards/GEMINI.md` for specific card specs).
- **`lorebooks/`**: Contains world-building data. These files contain "entries" with keywords that, when detected in the chat history, inject relevant context into the LLM's prompt to maintain world consistency.

## Usage & Development

### Adding a New Character
1.  **Create Card**: Add a new `.json` file to `data/cards/` following the V2 spec.
2.  **Register**: Add a new entry to the `characters` array in `index.json`. 
    - Ensure the `id` is unique.
    - Set `card_path` to `data/cards/your-file.json`.
    - (Optional) Link a `lorebook_path` from `data/lorebooks/`.

### Managing Lore
Lorebooks are triggered by keyword matching. To add lore:
1.  Add/Modify a file in `data/lorebooks/`.
2.  Each entry should have a list of `keywords` (case-insensitive) and `content` (the lore to inject).
3.  Higher `priority` values ensure the entry is favored if token limits are reached.

### Personas and Scenarios
- When creating a new user persona in `personas.json`, focus on providing a clear "voice" and "motivation" for the user to help the LLM understand how to interact.
- Scenarios in `scenarios.json` should be broad and descriptive, focusing on the "rules" and "vibe" of the world.

## Conventions
- **JSON Integrity**: All files must be valid JSON. Escaping newlines in long strings (like `first_mes` or `lore content`) is critical.
- **Macro Consistency**: Always use `{{char}}` and `{{user}}` in all data files.
- **Aesthetic**: Maintain the "High-Aesthetic / Dark-Terminal" tone. Descriptions should be visceral and sensory.
