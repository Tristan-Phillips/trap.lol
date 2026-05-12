/**
 * shared-utils.js — Common utilities shared across all Underdark modules.
 * Import from here instead of redefining locally.
 */

export const qs  = (sel, ctx = document) => ctx ? ctx.querySelector(sel) : null;
export const qsa = (sel, ctx = document) => ctx ? [...ctx.querySelectorAll(sel)] : [];

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function slugify(str) {
    return str.toLowerCase().trim()
        .replace(/['']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function generateId(name) {
    return `${slugify(name) || 'char'}-${Date.now().toString(36)}`;
}

export function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function showToast(message, type = 'info', duration = 3500) {
    const $c = qs('#toast-container');
    if (!$c) return;
    const $t = document.createElement('div');
    $t.className = `toast toast--${type}`;
    const icons = { info: 'check-circle', error: 'alert-circle', warn: 'alert-triangle' };
    $t.innerHTML = `<i data-lucide="${icons[type] || 'check-circle'}"></i><span>${esc(message)}</span>`;
    $c.appendChild($t);
    if (window.lucide) window.lucide.createIcons({ nodes: [$t] });
    requestAnimationFrame(() => $t.classList.add('toast--visible'));
    setTimeout(() => {
        $t.classList.remove('toast--visible');
        $t.addEventListener('transitionend', () => $t.remove(), { once: true });
    }, duration);
}
