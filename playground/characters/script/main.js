/**
 * main.js — Underdark Bootstrapper
 */
import { initUI } from './modules/ui.js?v=112';

function boot() {
    try {
        initUI();
        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        console.error('[underdark] boot failed:', err);
        const esc = s => String(s).replace(/[&<>"']/g, c =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
        document.body.insertAdjacentHTML('afterbegin', 
            `<div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#1a0000;color:#ff6b6b;font:13px monospace;padding:12px 16px;border-bottom:1px solid #ff3333;">
                <strong>Boot error:</strong> ${esc(err.message)}<br>
                <small style="opacity:.7">${esc(err.stack?.split('\n')[1] ?? '')}</small>
             </div>`
        );
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
