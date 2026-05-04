# The Underdark — Character Cards

## Directory Overview
This directory serves as the primary repository for character definitions (cards) used within `The Underdark` roleplay interface. These JSON files define the identity, behavior, history, and physical appearance of AI-driven characters.

## Data Specification
All files in this directory must adhere to the **SillyTavern / Character Card V2** specification, with additional custom extensions for the Underdark engine.

### Core Schema (V2)
- `spec`: Must be `"chara_card_v2"`.
- `spec_version`: Currently `"2.0"`.
- `data`:
    - `name`: Character's full name.
    - `description`: Physical and background summary.
    - `personality`: Behavioral traits and mental state.
    - `scenario`: The starting context/environment.
    - `first_mes`: The opening message to initiate the roleplay.
    - `mes_example`: Dialogue examples using the `<START>` separator.
    - `system_prompt`: High-level instructions for the LLM to adopt the character's persona.
    - `post_history_instructions`: Tone and style maintenance instructions injected after the chat history.

### Underdark Extensions (`extensions.underdark`)
The project utilizes a custom extension block for granular character modulation:
- **Sliders:** Numerical values (0-100) for traits like `dominanceLevel`, `violenceLevel`, `anxietyLevel`, etc.
- **Physical Anchors:** Detailed fields for `voiceTone`, `skinTone`, `eyeColor`, `distinctiveFeatures`, and `bodyType` to ensure visual consistency.
- **Thought Engine:** Uses `<think>` tags in `mes_example` to represent internal monologue.
- **Overrides:** Character-specific `systemPromptOverride` or `postHistoryOverride` for advanced behavioral tuning.

## Key Files
- `jinx.json`: Reference implementation for a complex, volatile character with heavy use of extensions.
- `alice-liddell.json`: Example of a dark, gothic character focusing on psychological horror and sensory detail.
- `lady-jessica.json`: Example of a high-formality, tactical character.

## Development Conventions
1. **Macros:** Always use `{{char}}` and `{{user}}` placeholders. Never hardcode the user's name.
2. **Third-Person Present:** All character descriptions and message examples should favor third-person limited present tense.
3. **Sensory Depth:** Descriptions should emphasize smells, textures, sounds, and internal monologues (via `<think>` tags).
4. **Validation:** Ensure JSON is valid and escaped properly, especially within the `mes_example` and `first_mes` strings which often contain newlines.
5. **Aesthetic Consistency:** Maintain the "High-Aesthetic / Dark-Terminal" tone established in the main `trap.lol` project.

## Usage
These cards are dynamically loaded by `playground/characters/script/modules/state.js` and parsed for the `llm-engine.js`. To add a new character, simply drop a compliant `.json` file into this directory.
