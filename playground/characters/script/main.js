/**
 * main.js
 * Underdark Roleplay Interface — Bootstrapper
 */

import { initUI } from './modules/ui.js';

async function boot() {
    // Initial UI setup
    initUI();
    
    // Initialize Lucide icons
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
