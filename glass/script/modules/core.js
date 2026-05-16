/* trap.lol — Core Logic
   Data fetching and shard management.
   GPL-3.0 — trap.lol */

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(r => r.unregister());
  });
}

export async function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Load failed: ${src}`));
    document.head.appendChild(s);
  });
}

export async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status}: ${path}`);
  return res.json();
}

export function renderError($container, message) {
  if (!$container) return;
  $container.innerHTML = `<span class="render-error">ERR: ${esc(message)}</span>`;
}

export function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const IS_TOUCH = "ontouchstart" in window;
export const globalRouter = new Map();

export let config;
export let hostingData, extData, guideData, botsData, toolsData, llmData, appsData, statstationData, trapData;

export async function loadCoreData() {
  try {
    config = await fetchJSON(`/glass/data/config.json`);
  } catch (e) {
    console.error("Config load failed:", e);
    return false;
  }

  const safeJSON = (path) => fetchJSON(path).catch(e => {
    console.warn(`Fetch failed: ${path}`, e.message);
    return null;
  });

  [hostingData, extData, guideData, botsData, toolsData, llmData, appsData, statstationData, trapData] = await Promise.all([
    safeJSON(`/glass/data/hosting.json`),
    safeJSON(`/glass/data/extlinks.json`),
    safeJSON(`/glass/data/guides.json`),
    safeJSON(`/glass/data/bots.json`),
    safeJSON(`/glass/data/tools.json`),
    safeJSON(`/glass/data/llm.json`),
    safeJSON(`/glass/data/apps.json`),
    safeJSON(`/glass/data/statstation.json`),
    safeJSON(`/glass/data/trap.json`),
  ]);

  const loadShard = async (id, local, pub) => {
    const primary = config.shards[id];
    try {
      await loadScript(primary);
    } catch {
      try {
        await loadScript(`/shards/${local}`);
      } catch {
        try {
          await loadScript(pub);
        } catch (e) {
          console.error(`Shard failed: ${id}`, e);
        }
      }
    }
  };

  await Promise.all([
    loadShard("lucide",    "lucide.min.js",  "https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"),
    loadShard("marked",    "marked.min.js",  "https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.0/marked.min.js"),
    loadShard("dompurify", "purify.min.js",  "https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.9/purify.min.js"),
  ]);

  return true;
}
