/**
 * main.js — Underdark Bootstrapper
 */
import { initUI } from './modules/ui.js';

function boot() {
    initUI();
    // Lucide pass after UI init injects initial icons
    if (window.lucide) window.lucide.createIcons();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
