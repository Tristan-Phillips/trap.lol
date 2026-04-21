/* trap.lol — Glass/Script
   Config-first boot. Fetches all data, injects shards, renders sections.
   GPL-3.0 — trap.lol */

// Purge any stale service workers — the SW layer has been deprecated
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(r => { r.unregister(); console.log("[boot] stale SW unregistered:", r.scope); });
  });
}

export async function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load shard: ${src}`));
    document.head.appendChild(s);
  });
}

export async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json();
}

export function renderError($container, message) {
  $container.innerHTML = `<span class="render-error">ERR: ${esc(message)}</span>`;
}

export function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const IS_TOUCH = "ontouchstart" in window;

// Unified Global Router: Maps 2-char shortcuts to actions (open link vs. copy payload)
export const globalRouter = new Map();


export let config;
export let hostingData, extData, guideData, botsData, toolsData, llmData, appsData;

export async function loadCoreData(base = "") {
// ── 1. Boot: load config, then all data + shard in parallel ─────────────
  try {
    config = await fetchJSON(`${base}glass/data/config.json`);
  } catch (e) {
    console.error("[boot] config.json failed:", e);
    return;
  }

  const safeJSON = (path) => fetchJSON(path).catch(e => {
    console.warn(`[boot] ${path} failed:`, e.message);
    return null;
  });

  ;[hostingData, extData, guideData, botsData, toolsData, llmData, appsData] = await Promise.all([
    safeJSON(`${base}glass/data/hosting.json`),
    safeJSON(`${base}glass/data/extlinks.json`),
    safeJSON(`${base}glass/data/guides.json`),
    safeJSON(`${base}glass/data/bots.json`),
    safeJSON(`${base}glass/data/tools.json`),
    safeJSON(`${base}glass/data/llm.json`),
    safeJSON(`${base}glass/data/apps.json`),
  ]);

  // Load shards — cdn.trap.lol → /shards/ (local dev) → public CDN (live fallback)
  async function loadShardWithFallback(primary, local, pub) {
    try {
      await loadScript(primary);
    } catch (_) {
      console.warn(`[boot] shard failed: ${primary} — trying /shards/`);
      try {
        await loadScript(local);
      } catch (__) {
        console.warn(`[boot] /shards/ unavailable — falling back to public CDN: ${pub}`);
        try { await loadScript(pub); } catch (e) {
          console.error(`[boot] shard unavailable on all sources: ${pub}`, e);
        }
      }
    }
  }

  await Promise.all([
    loadShardWithFallback(config.shards.lucide,    `${base}shards/lucide.min.js`,  "https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"),
    loadShardWithFallback(config.shards.marked,    `${base}shards/marked.min.js`,  "https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.0/marked.min.js"),
    loadShardWithFallback(config.shards.dompurify, `${base}shards/purify.min.js`,  "https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.9/purify.min.js"),
  ]);

  
  return true;
}
