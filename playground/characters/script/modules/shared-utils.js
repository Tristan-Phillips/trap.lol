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

/**
 * Parse a JSON array out of an LLM response string.
 * Handles markdown code fences, surrounding text, and malformed output.
 * Returns `fallback` (default: []) if parsing fails.
 */
export function parseLLMArray(text, fallback = []) {
    if (!text) return fallback;
    try {
        const stripped = text.replace(/^```[a-z]*\n?/im, '').replace(/```\s*$/m, '').trim();
        const match = stripped.match(/\[[\s\S]*\]/);
        if (!match) return fallback;
        const parsed = JSON.parse(match[0]);
        return Array.isArray(parsed) && parsed.length ? parsed : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Parse any JSON value out of an LLM response string (object or array).
 * Strips markdown fences. Returns `fallback` on failure.
 */
export function parseLLMJson(text, fallback = null) {
    if (!text) return fallback;
    try {
        const stripped = text.replace(/^```[a-z]*\n?/im, '').replace(/```\s*$/m, '').trim();
        return JSON.parse(stripped);
    } catch {
        return fallback;
    }
}

/**
 * Parse a newline-delimited list of options from an LLM response.
 * Strips leading bullets, numbers, quotes. Returns up to `max` non-empty lines.
 */
export function parseLLMLines(text, max = 3) {
    if (!text) return [];
    return text
        .split('\n')
        .map(s => s.trim().replace(/^["""''\-•\d.]+\s*/g, '').replace(/["""'']$/g, '').trim())
        .filter(Boolean)
        .slice(0, max);
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
