/**
 * main.js — Underdark Bootstrapper
 */
import { initUI } from './modules/ui.js';

function boot() {
    if (window.lucide) window.lucide.createIcons();
    initUI();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
