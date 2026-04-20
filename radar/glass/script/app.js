// --- UPLINK CONFIGURATION ---
const RADAR_URL = 'https://radar.trap.lol'; 
let PROXY_SECRET = '';
let TORBOX_KEY = '';
let globalData = [];
let currentFilter = 'all';

// --- DOM ELEMENTS ---
const authOverlay = document.getElementById('authOverlay');
const mainInterface = document.getElementById('mainInterface');
const resultsGrid = document.getElementById('resultsGrid');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const filterBtns = document.querySelectorAll('.filter-btn');

// --- AUTH LOGIC ---
document.getElementById('authBtn').addEventListener('click', () => {
    PROXY_SECRET = document.getElementById('proxyKeyInput').value.trim();
    TORBOX_KEY = document.getElementById('torboxKeyInput').value.trim();
    
    if (PROXY_SECRET && TORBOX_KEY) {
        authOverlay.classList.remove('active');
        mainInterface.classList.remove('hidden');
        searchInput.focus();
    } else {
        alert('[ DENIED: INCOMPLETE KEY SEQUENCE ]');
    }
});

// --- EVENT LISTENERS ---
document.getElementById('searchBtn').addEventListener('click', executeScan);
searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') executeScan(); });
document.getElementById('vaultBtn').addEventListener('click', accessVault);

sortSelect.addEventListener('change', renderGrid);
filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        filterBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.dataset.filter;
        renderGrid();
    });
});

// --- CORE ENGINE ---
async function executeScan() {
    const query = searchInput.value.trim();
    if (!query) return;

    resultsGrid.innerHTML = `<div class="glitch-text" style="font-size: 1.5rem;">[ PROBING THE DARKNET... ]</div>`;
    
    try {
        const proxyRes = await fetch(`${RADAR_URL}/api/search?q=${encodeURIComponent(query)}`, {
            headers: { 'Authorization': `Bearer ${PROXY_SECRET}` }
        });
        
        if (proxyRes.status === 401) throw new Error('PROXY REJECTED UPLINK. INVALID SECRET.');
        if (!proxyRes.ok) throw new Error('RADAR ANOMALY. CONNECTION SEVERED.');
        
        const items = await proxyRes.json();
        
        if (!items || items.length === 0) {
            resultsGrid.innerHTML = `<div class="sultry-text">[ GHOST TOWN. NOTHING FOUND. ]</div>`;
            return;
        }

        // Extract metadata & filter dead torrents
        globalData = items.map(item => {
            const resMatch = item.title.match(/(2160p|1080p|720p|4k)/i);
            const resolution = resMatch ? resMatch[0].toLowerCase() : 'unknown';
            return {
                ...item,
                resolution: resolution === '4k' ? '2160p' : resolution,
                qualityScore: calculateQuality(item.seeders, resolution)
            };
        }).filter(item => item.seeders > 0);

        // Ping TorBox directly from client for cache verification
        const hashes = globalData.map(i => i.infoHash).join(',');
        let cachedMap = {};
        
        try {
            const cacheRes = await fetch(`https://api.torbox.app/v1/api/torrents/checkcached?hash=${hashes}&format=list`, {
                headers: { 'Authorization': `Bearer ${TORBOX_KEY}` }
            });
            const cacheData = await cacheRes.json();
            if (cacheData.success && cacheData.data) cachedMap = cacheData.data;
        } catch (e) {
            console.warn("TorBox cache ping failed. Assuming uncached.");
        }

        // Apply cache state
        globalData.forEach(item => { item.cached = !!cachedMap[item.infoHash]; });

        renderGrid();
    } catch (error) {
        resultsGrid.innerHTML = `<div class="glitch-text" style="font-size: 1.2rem; color: var(--hot-pink);">[ FATAL: ${error.message} ]</div>`;
    }
}

function calculateQuality(seeders, res) {
    let score = seeders;
    if (res === '2160p') score *= 1.5;
    if (res === '1080p') score *= 1.2;
    return score;
}

function renderGrid() {
    if (!globalData || globalData.length === 0) return;
    resultsGrid.innerHTML = '';

    // 1. Filter
    let displayData = globalData.filter(item => {
        if (currentFilter === 'cached') return item.cached;
        if (currentFilter === '4k') return item.resolution === '2160p';
        if (currentFilter === '1080p') return item.resolution === '1080p';
        return true;
    });

    // 2. Sort
    const sortMode = sortSelect.value;
    displayData.sort((a, b) => {
        if (sortMode === 'seeders') return b.seeders - a.seeders;
        if (sortMode === 'size') return b.size - a.size;
        if (sortMode === 'quality') return b.qualityScore - a.qualityScore;
        return 0;
    });

    const frag = document.createDocumentFragment();

    displayData.forEach(item => {
        const sizeGb = (item.size / 1073741824).toFixed(2);
        const card = document.createElement('div');
        card.className = `card ${item.cached ? 'cached' : ''}`;
        
        card.innerHTML = `
            <div class="card-title">${item.title}</div>
            <div class="badge-row">
                <span class="badge res">${item.resolution.toUpperCase()}</span>
                <span class="badge size">${sizeGb} GB</span>
                <span class="badge seed">Swarm: ${item.seeders}</span>
            </div>
            <div class="action-row">
                <button class="action-btn" onclick="copyMagnet('${item.magnetUrl}')">COPY</button>
                <button class="action-btn primary" onclick="ignitePayload('${item.magnetUrl}')">
                    ${item.cached ? 'STREAM (CACHED)' : 'IGNITE ENGINE'}
                </button>
            </div>
        `;
        frag.appendChild(card);
    });

    resultsGrid.appendChild(frag);
}

// --- VAULT EXTRACTION ---
async function accessVault() {
    resultsGrid.innerHTML = `<div class="glitch-text" style="font-size: 1.5rem; color: var(--acid-cyan);">[ DECRYPTING VAULT CONTENTS... ]</div>`;
    try {
        const res = await fetch('https://api.torbox.app/v1/api/torrents/mylist', {
            headers: { 'Authorization': `Bearer ${TORBOX_KEY}` }
        });
        
        if (res.status === 401) throw new Error('TORBOX REJECTED UPLINK. INVALID API KEY.');
        const vault = await res.json();
        
        resultsGrid.innerHTML = '';
        const frag = document.createDocumentFragment();

        vault.data.forEach(item => {
            const isReady = item.download_finished;
            const card = document.createElement('div');
            card.className = `card ${isReady ? 'cached' : ''}`;
            
            card.innerHTML = `
                <div class="card-title">${item.name}</div>
                <div class="badge-row">
                    <span class="badge size">${(item.size / 1073741824).toFixed(2)} GB</span>
                    <span class="badge seed">${isReady ? 'STATUS: PRIMED' : 'EXTRACTING: ' + (item.progress * 100).toFixed(1) + '%'}</span>
                </div>
                <div class="action-row">
                    ${isReady 
                        ? `<button class="action-btn primary" onclick="getLink('${item.id}', 0)">PULL DIRECT LINK</button>` 
                        : `<button class="action-btn" disabled>AWAITING MASS...</button>`}
                </div>
            `;
            frag.appendChild(card);
        });
        resultsGrid.appendChild(frag);
    } catch (e) {
        resultsGrid.innerHTML = `<div class="glitch-text" style="font-size: 1.2rem; color: var(--hot-pink);">[ ${e.message} ]</div>`;
    }
}

// --- UTILITIES ---
function copyMagnet(magnet) {
    navigator.clipboard.writeText(magnet).then(() => {
        alert('[ MAGNET SECURED. ]');
    });
}

async function ignitePayload(magnet) {
    try {
        const fd = new FormData();
        fd.append('magnet', magnet);
        const res = await fetch('https://api.torbox.app/v1/api/torrents/createtorrent', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TORBOX_KEY}` },
            body: fd
        });
        
        if (res.ok) {
            alert('[ PAYLOAD INJECTED. TORBOX ENGINE IGNITED. ]');
        } else {
            throw new Error('TARGET REJECTED.');
        }
    } catch (e) {
        alert(`[ IGNITION FAILED: ${e.message} ]`);
    }
}

async function getLink(tId, fId) {
    try {
        const res = await fetch(`https://api.torbox.app/v1/api/torrents/requestdl?token=${tId}&file_id=${fId}`, {
            headers: { 'Authorization': `Bearer ${TORBOX_KEY}` }
        });
        const data = await res.json();
        
        if (data.data) {
            navigator.clipboard.writeText(data.data).then(() => {
                alert('[ DIRECT LINK STRIPPED. READY FOR DOWNLOAD. ]');
            });
        }
    } catch (e) { 
        alert('[ LINK EXTRACTION FAILED. ]'); 
    }
}