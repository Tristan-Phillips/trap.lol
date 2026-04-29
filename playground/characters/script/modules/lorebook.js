/**
 * lorebook.js — World Info / Lorebook engine.
 * Supports multiple lorebooks, entry priorities, scan-depth config,
 * regex keywords, case sensitivity toggle, and full CRUD.
 */

// ── Entry factory ─────────────────────────────────────────────────────────────
export function createEntry(fields = {}) {
    return {
        id:            `lore-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name:          fields.name          || 'Unnamed Entry',
        keywords:      fields.keywords      || [],   // array of strings
        content:       fields.content       || '',
        priority:      fields.priority      ?? 50,   // 0–100; higher = injected first
        scanDepth:     fields.scanDepth     ?? 0,    // 0 = use global; >0 = override
        caseSensitive: fields.caseSensitive ?? false,
        useRegex:      fields.useRegex      ?? false,
        alwaysOn:      fields.alwaysOn      ?? false, // inject regardless of keyword match
        disabled:      fields.disabled      ?? false,
        comment:       fields.comment       || '',
        insertionOrder: fields.insertionOrder ?? 100  // position within injected lore block
    };
}

// ── Book factory ──────────────────────────────────────────────────────────────
export function createBook(name = 'Global') {
    return {
        id:        `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        enabled:   true,
        scanDepth: 5,    // how many recent history turns to scan
        entries:   []
    };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export function addBook(lorebooks, name = 'New Lorebook') {
    const book = createBook(name);
    lorebooks.push(book);
    return book;
}

export function removeBook(lorebooks, bookId) {
    const idx = lorebooks.findIndex(b => b.id === bookId);
    if (idx >= 0) lorebooks.splice(idx, 1);
}

export function addEntry(lorebooks, bookId, fields = {}) {
    let book = lorebooks.find(b => b.id === bookId);
    if (!book) {
        // Auto-create global book if none
        book = createBook('Global');
        lorebooks.push(book);
    }
    const entry = createEntry(fields);
    book.entries.push(entry);
    return entry;
}

export function updateEntry(lorebooks, bookId, entryId, fields) {
    const book = lorebooks.find(b => b.id === bookId);
    if (!book) return;
    const entry = book.entries.find(e => e.id === entryId);
    if (entry) Object.assign(entry, fields);
}

export function removeEntry(lorebooks, bookId, entryId) {
    const book = lorebooks.find(b => b.id === bookId);
    if (!book) return;
    book.entries = book.entries.filter(e => e.id !== entryId);
}

// ── Scanner ───────────────────────────────────────────────────────────────────
export function scanLorebooks(history, lorebooks, globalScanDepth = 5) {
    if (!lorebooks || !lorebooks.length) return [];

    const active = [];
    const seen   = new Set();

    // Always-on entries first
    lorebooks.forEach(book => {
        if (!book.enabled) return;
        book.entries.forEach(entry => {
            if (entry.disabled) return;
            if (entry.alwaysOn && !seen.has(entry.id)) {
                active.push(entry);
                seen.add(entry.id);
            }
        });
    });

    // Build search corpus from recent history
    lorebooks.forEach(book => {
        if (!book.enabled) return;
        const depth = book.scanDepth || globalScanDepth;
        const corpus = history
            .slice(-depth)
            .map(m => m.content)
            .join('\n');

        book.entries.forEach(entry => {
            if (entry.disabled || seen.has(entry.id)) return;
            if (!entry.keywords.length) return;

            const matched = entry.keywords.some(kw => {
                if (!kw) return false;
                try {
                    if (entry.useRegex) {
                        const flags = entry.caseSensitive ? 'u' : 'iu';
                        return new RegExp(kw, flags).test(corpus);
                    }
                    const haystack = entry.caseSensitive ? corpus : corpus.toLowerCase();
                    const needle   = entry.caseSensitive ? kw : kw.toLowerCase();
                    return haystack.includes(needle);
                } catch (_) {
                    return false;
                }
            });

            if (matched) {
                active.push(entry);
                seen.add(entry.id);
            }
        });
    });

    // Sort by priority desc, then insertionOrder asc
    return active.sort((a, b) =>
        b.priority - a.priority || a.insertionOrder - b.insertionOrder
    );
}

// ── Convenience (legacy compat) ───────────────────────────────────────────────
export function addLorebookEntry(lorebooks, name, keywords, content) {
    const bookId = lorebooks[0]?.id;
    return addEntry(lorebooks, bookId, {
        name,
        keywords: typeof keywords === 'string'
            ? keywords.split(',').map(k => k.trim()).filter(Boolean)
            : keywords,
        content
    });
}
