/**
 * storage.js — IndexedDB wrapper for large blobs.
 * Keeps avatar data URLs and session histories out of localStorage (5-10MB limit).
 * All localStorage usage for small metadata remains in state.js unchanged.
 */

const DB_NAME    = 'underdark_db';
const DB_VERSION = 1;
const STORE_BLOBS = 'blobs';   // key: string, value: any (avatar data URLs, etc.)

let _db = null;
let _dbPromise = null;

function openDB() {
    if (_db) return Promise.resolve(_db);
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_BLOBS)) {
                db.createObjectStore(STORE_BLOBS);
            }
        };
        req.onsuccess = e => { _db = e.target.result; _dbPromise = null; resolve(_db); };
        req.onerror   = e => { _dbPromise = null; reject(e.target.error); };
    });
    return _dbPromise;
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

// ── Image blob helpers (gallery + chat image messages) ─────────────────────────
// Stored under key `img:<blobId>` to keep large data URLs out of localStorage.
// References are stored as "idb:img:<blobId>" in history/gallery arrays.

const IMG_PREFIX = 'img:';

export async function saveImageBlob(blobId, dataUrl) {
    await idbSet(`${IMG_PREFIX}${blobId}`, dataUrl);
    return `idb:img:${blobId}`;
}

export async function loadImageBlob(blobId) {
    return idbGet(`${IMG_PREFIX}${blobId}`);
}

export async function deleteImageBlob(blobId) {
    return idbDelete(`${IMG_PREFIX}${blobId}`);
}

export function isIdbImageRef(str) {
    return typeof str === 'string' && str.startsWith('idb:img:');
}

export function idbImageRefId(str) {
    return str.replace(/^idb:img:/, '');
}

// Resolve any value that may be a data URL or idb:img: reference to a data URL.
export async function resolveImageUrl(val) {
    if (!val) return null;
    if (isIdbImageRef(val)) return loadImageBlob(idbImageRefId(val)).catch(() => null);
    return val;
}

// Check if a string is a raw base64 data URL (should be migrated to IDB)
export function isDataUrl(str) {
    return typeof str === 'string' && str.startsWith('data:');
}
