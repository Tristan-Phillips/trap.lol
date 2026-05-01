/**
 * storage.js — IndexedDB wrapper for large blobs.
 * Keeps avatar data URLs and session histories out of localStorage (5-10MB limit).
 * All localStorage usage for small metadata remains in state.js unchanged.
 */

const DB_NAME    = 'underdark_db';
const DB_VERSION = 1;
const STORE_BLOBS = 'blobs';   // key: string, value: any (avatar data URLs, etc.)

let _db = null;

function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_BLOBS)) {
                db.createObjectStore(STORE_BLOBS);
            }
        };
        req.onsuccess = e => { _db = e.target.result; resolve(_db); };
        req.onerror   = e => reject(e.target.error);
    });
}

export async function idbSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE_BLOBS, 'readwrite');
        const req = tx.objectStore(STORE_BLOBS).put(value, key);
        req.onsuccess = () => resolve();
        req.onerror   = e => reject(e.target.error);
    });
}

export async function idbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE_BLOBS, 'readonly');
        const req = tx.objectStore(STORE_BLOBS).get(key);
        req.onsuccess = e => resolve(e.target.result ?? null);
        req.onerror   = e => reject(e.target.error);
    });
}

export async function idbDelete(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE_BLOBS, 'readwrite');
        const req = tx.objectStore(STORE_BLOBS).delete(key);
        req.onsuccess = () => resolve();
        req.onerror   = e => reject(e.target.error);
    });
}

export async function idbClear() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE_BLOBS, 'readwrite');
        const req = tx.objectStore(STORE_BLOBS).clear();
        req.onsuccess = () => resolve();
        req.onerror   = e => reject(e.target.error);
    });
}

// ── Avatar helpers ─────────────────────────────────────────────────────────────
// Avatars are stored under key `avatar:<charId>` so they don't bloat localStorage.
// The character card's `.avatar` field stores the key reference ("idb:<charId>")
// rather than the raw data URL.

const AVATAR_PREFIX = 'avatar:';

export async function saveAvatar(charId, dataUrl) {
    if (!dataUrl) return;
    await idbSet(`${AVATAR_PREFIX}${charId}`, dataUrl);
}

export async function loadAvatar(charId) {
    return idbGet(`${AVATAR_PREFIX}${charId}`);
}

export async function deleteAvatar(charId) {
    return idbDelete(`${AVATAR_PREFIX}${charId}`);
}

// ── Avatar resolution ──────────────────────────────────────────────────────────
// Given a character id and its stored avatar field value, resolve the actual
// data URL or path string to display. Call this when rendering avatars.
export async function resolveAvatar(charId, storedValue) {
    if (!storedValue) return null;
    if (storedValue.startsWith('idb:')) {
        return loadAvatar(charId);
    }
    return storedValue;
}

// Check if a string is a raw base64 data URL (should be migrated to IDB)
export function isDataUrl(str) {
    return typeof str === 'string' && str.startsWith('data:');
}
