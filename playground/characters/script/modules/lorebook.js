/**
 * lorebook.js
 * Scans chat history for keywords and injects relevant World Info into the LLM payload.
 */

export function scanLorebooks(history, lorebooks) {
    if (!lorebooks || !lorebooks.length) return [];

    // Combine the last few turns to search for keywords
    // Usually, scanning the last 3-5 turns is a good balance between context relevance and performance.
    const recentHistory = history.slice(-5).map(msg => msg.content).join('\n').toLowerCase();
    
    const activeEntries = [];

    lorebooks.forEach(book => {
        // A lorebook might contain multiple entries
        book.entries.forEach(entry => {
            // Check if any keyword matches
            const keywords = entry.keywords || [];
            const isMatch = keywords.some(kw => recentHistory.includes(kw.toLowerCase()));
            
            if (isMatch) {
                // Ensure we don't inject the same entry multiple times
                if (!activeEntries.find(e => e.id === entry.id)) {
                    activeEntries.push(entry);
                }
            }
        });
    });

    return activeEntries;
}

/**
 * UI hook to add a new lorebook.
 */
export function addLorebookEntry(lorebooks, name, keywords, content) {
    const newEntry = {
        id: `lore-${Date.now()}`,
        name,
        keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
        content
    };
    
    // In this basic version, we assume a default "Global" lorebook at index 0.
    if (!lorebooks.length) {
        lorebooks.push({ id: 'lb-0', name: 'Global', entries: [] });
    }
    lorebooks[0].entries.push(newEntry);
    
    return newEntry;
}
