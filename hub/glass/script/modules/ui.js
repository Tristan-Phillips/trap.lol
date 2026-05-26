import { config, hostingData, botsData, appsData, llmData, statstationData, trapData, fetchJSON, esc, renderError, globalRouter, IS_TOUCH } from './core.js';
import { initTunnelLight } from './tunnel-light.js';

/**
 * Main UI Entry Point
 */
export function renderUI() {
  renderMeta();
  renderHeader();
  renderFooter();
  renderApps();
  renderTrapSection();
  renderInfraGrid();
  renderUplinkLaunchpad();
  renderSocialStrip();

  // Global initializations
  if (typeof lucide !== "undefined") lucide.createIcons();
  requestAnimationFrame(() => {
    initTunnelLight();
    initGlobalListeners();
  });
}

function renderMeta() {
  document.title = `${config.site.title} // uplink`;
  const meta = {
    "description": config.site.tagline,
    "og:title": config.site.title,
    "og:description": config.site.tagline,
    "og:url": `https://${config.site.domain}`
  };

  Object.entries(meta).forEach(([name, content]) => {
    const el = name.startsWith("og:") 
      ? document.getElementById(name.replace(":", "-")) 
      : document.querySelector(`meta[name="${name}"]`);
    if (el) el.setAttribute("content", content || "");
  });
}

function renderHeader() {
  const map = {
    "header-eyebrow": config.site.eyebrow,
    "header-title": config.site.title,
    "header-subtitle": config.site.tagline
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    if (id === "header-title") el.setAttribute("data-text", val);
  });
}

function renderFooter() {
  const map = {
    "footer-domain": config.site.domain,
    "footer-tagline": config.site.tagline,
    "footer-copy": `© ${new Date().getFullYear()} ${config.site.author}`
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });
}

function renderInfraGrid() {
  const $wrap = document.getElementById("infra-grid");
  if (!$wrap) return;

  try {
    const nodeChips = hostingData?.manifest
      ? Object.values(hostingData.manifest).map(node => {
          if (node.shortcut) globalRouter.set(node.shortcut.toLowerCase(), { type: 'link', payload: node.url });
          const isOffline = (node.status || "online") !== "online";
          return `
            <a href="${esc(node.url)}" target="_blank" rel="noopener"
               class="infra-chip infra-chip--node"
               aria-label="${esc(node.name)} — ${esc(node.hosting)}">
              <span class="infra-chip__ring${isOffline ? " offline" : ""}">
                <i data-lucide="${esc(node.icon)}" class="infra-chip__icon" aria-hidden="true"></i>
              </span>
              <span class="infra-chip__label">${esc(node.name)}</span>
              <span class="infra-chip__dot${isOffline ? " offline" : ""}" aria-hidden="true"></span>
            </a>`;
        }).join("")
      : "";

    const botChips = botsData?.manifest
      ? Object.values(botsData.manifest).map(bot => {
          if (bot.shortcut && bot.chat_url) globalRouter.set(bot.shortcut.toLowerCase(), { type: 'link', payload: bot.chat_url });
          const isOnline = (bot.status || "online") === "online";
          const href = bot.chat_url || bot.repo_url;
          return `
            <a href="${esc(href)}" target="_blank" rel="noopener"
               class="infra-chip infra-chip--bot"
               aria-label="${esc(bot.name)} — ${esc(bot.description)}">
              <span class="infra-chip__ring${isOnline ? "" : " offline"}">
                <i data-lucide="${esc(bot.icon)}" class="infra-chip__icon" aria-hidden="true"></i>
              </span>
              <span class="infra-chip__label">${esc(bot.name)}</span>
              <span class="infra-chip__dot${isOnline ? "" : " offline"}" aria-hidden="true"></span>
            </a>`;
        }).join("")
      : "";

    $wrap.innerHTML = `<div class="infra-chips">${nodeChips}${botChips}</div>`;
  } catch (e) {
    renderError($wrap, "Infrastructure offline.");
  }
}

function renderApps() {
  const $grid = document.getElementById("apps-grid");
  if (!$grid || !appsData?.manifest) return;

  try {
    $grid.innerHTML = Object.values(appsData.manifest).map(app => {
      const isLive = (app.status || "planned") === "live";
      const appList = Array.isArray(app.apps) ? app.apps : [];
      const pills = appList.map(n => `<span class="pg-feature__pill">${esc(n)}</span>`).join("");
      const countStr = appList.length ? `${appList.length} apps` : "";

      return `
        <a href="${isLive ? esc(app.path) : "#"}" class="pg-feature${isLive ? "" : ' pg-feature--disabled'}" ${!isLive ? 'aria-disabled="true"' : ""}>
          <div class="pg-feature__icon-wrap" aria-hidden="true">
            <i data-lucide="${esc(app.icon)}" class="pg-feature__icon"></i>
          </div>
          <div class="pg-feature__body">
            <div class="pg-feature__head">
              <span class="pg-feature__name">${esc(app.name)}</span>
              ${countStr ? `<span class="pg-feature__count">${esc(countStr)}</span>` : ""}
            </div>
            <div class="pg-feature__desc">${esc(app.description)}</div>
            ${pills ? `<div class="pg-feature__pills" aria-hidden="true">${pills}</div>` : ""}
          </div>
          <div class="pg-feature__right" aria-hidden="true">
            <span class="pg-feature__enter">enter <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></span>
          </div>
        </a>`;
    }).join("");
  } catch (e) {
    renderError($grid, "Apps offline.");
  }
}

function initGlobalListeners() {
  initScrollTop();
  if (!IS_TOUCH) {
    initTerminal();
  }
}

function initScrollTop() {
  const $btn = document.getElementById("scroll-top");
  if (!$btn) return;
  window.addEventListener("scroll", () => $btn.classList.toggle("hidden", window.scrollY < 400), { passive: true });
  $btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

function initTerminal() {
  let buffer = "";
  let timeout;
  const $overlay = document.getElementById("cmd-overlay");
  const $text = document.getElementById("cmd-text");

  document.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA", "BUTTON"].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey || !/^[a-zA-Z0-9]$/.test(e.key)) return;

    buffer += e.key.toLowerCase();
    $text.textContent = buffer.toUpperCase();
    $overlay.classList.remove("hidden");

    if (globalRouter.has(buffer)) {
      const action = globalRouter.get(buffer);
      $text.style.color = "#fff";
      if (action.type === "link") {
        $text.textContent = "ROUTING...";
        setTimeout(() => { window.open(action.payload, "_blank"); reset(); }, 300);
      } else {
        $text.textContent = "PAYLOAD COPIED";
        navigator.clipboard.writeText(action.payload);
        setTimeout(reset, 800);
      }
    } else if (buffer.length >= 2) setTimeout(reset, 500);

    clearTimeout(timeout);
    timeout = setTimeout(reset, 2000);
  });

  const reset = () => { buffer = ""; $overlay.classList.add("hidden"); $text.style.color = "var(--accent)"; };
}

export function renderUplinkLaunchpad() {
  const $root = document.getElementById("uplink-launch");
  if (!$root || !llmData) return;

  renderTelemetry();
  initLaunchpadSignal();
  initAgentRoster();
  initLaunchpadForm();
}

function renderTelemetry() {
  const $tele = document.getElementById("uplink-telemetry");
  if (!$tele) return;
  const models = Object.values(llmData.routing_table || {});
  const subCount = models.filter(m => m.cost_tier === "Basically Free").length;
  const defaultId = llmData.default_routing;
  const def = llmData.routing_table?.[defaultId] || { label: defaultId || "—", provider: "" };

  const $prev = document.getElementById("uplink-model-preview");
  if ($prev) { $prev.textContent = def.label; $prev.title = def.provider; }

  $tele.innerHTML = `
    <div class="uplink-tele">
      <span class="uplink-tele__label"><i data-lucide="layers"></i> models</span>
      <span class="uplink-tele__value uplink-tele__value--accent">${models.length}</span>
    </div>
    <div class="uplink-tele">
      <span class="uplink-tele__label"><i data-lucide="zap"></i> default</span>
      <span class="uplink-tele__value uplink-tele__value--cyan">${esc(def.label)}</span>
    </div>
    <div class="uplink-tele">
      <span class="uplink-tele__label"><i data-lucide="infinity"></i> sub</span>
      <span class="uplink-tele__value uplink-tele__value--green">${subCount}</span>
    </div>
    <div class="uplink-tele">
      <span class="uplink-tele__label"><i data-lucide="user-cog"></i> agents</span>
      <span class="uplink-tele__value" id="uplink-tele-agent-count">…</span>
    </div>`;
}

function initLaunchpadSignal() {
  const isProxy = config.llm?.api_base && !config.llm.api_base.includes("nano-gpt.com");
  const $dot = document.getElementById("uplink-signal-dot");
  const $lbl = document.getElementById("uplink-signal-label");
  const state = isProxy ? "proxy" : "armed";
  if ($dot) { $dot.dataset.state = state; $dot.parentElement.dataset.state = state; }
  if ($lbl) $lbl.textContent = isProxy ? "SOVEREIGN PROXY" : "UPLINK READY";
}

async function initAgentRoster() {
  const $select = document.getElementById("uplink-agent");
  const $count = document.getElementById("uplink-tele-agent-count");
  if (!$select) return;

  try {
    const files = await fetchJSON("glass/data/llm-agents/index.json");
    const agents = await Promise.allSettled(files.filter(f => !f.startsWith("default")).map(f => fetchJSON(`glass/data/llm-agents/${f}`).then(d => ({f, d}))));
    let count = 0;
    agents.forEach(r => {
      if (r.status !== "fulfilled") return;
      const id = r.value.f.replace(".json", "");
      const data = r.value.d.spec ? r.value.d.data : r.value.d;
      const opt = new Option(data.name || id, id);
      if (data.tags) opt.title = data.tags.join(", ");
      $select.add(opt);
      count++;
    });
    if ($count) $count.textContent = count;
  } catch {
    if ($count) $count.textContent = "0";
  }
}

function initLaunchpadForm() {
  const $form = document.getElementById("uplink-probe");
  const $prompt = document.getElementById("uplink-prompt");
  if (!$form || !$prompt) return;

  $prompt.oninput = () => { $prompt.style.height = "auto"; $prompt.style.height = Math.min($prompt.scrollHeight, 160) + "px"; };
  $prompt.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $form.requestSubmit(); } };
  $form.onsubmit = e => {
    e.preventDefault();
    const params = new URLSearchParams();
    if ($prompt.value.trim()) params.set("q", $prompt.value.trim());
    if (document.getElementById("uplink-agent")?.value) params.set("agent", document.getElementById("uplink-agent").value);
    window.location.href = `/hub/playground/${params.toString() ? '?' + params.toString() : ''}`;
  };
}

// Kept for external callers that may import this name
export function renderSocialCluster() { renderSocialStrip(); }

function renderSocialStrip() {
  // Replace old radial cluster with a compact inline strip in the footer
  const $cluster = document.getElementById("social-cluster");
  if ($cluster) $cluster.remove();

  const $strip = document.getElementById("social-strip");
  if (!$strip || !config?.socials) return;

  const PLATFORMS = {
    github:   { icon: "github",   label: "GitHub" },
    youtube:  { icon: "youtube",  label: "YouTube" },
    kick:     { icon: "radio",    label: "Kick" },
    "ko-fi":  { icon: "coffee",   label: "Ko-Fi" },
    telegram: { icon: "send",     label: "Telegram" }
  };

  $strip.innerHTML = Object.entries(config.socials).map(([key, url]) => {
    const p = PLATFORMS[key] || { icon: "external-link", label: key };
    return `<a href="${esc(url)}" target="_blank" rel="noopener" class="social-strip__link" aria-label="${esc(p.label)}" title="${esc(p.label)}">
      <i data-lucide="${esc(p.icon)}"></i>
    </a>`;
  }).join("");
}

function renderStatstation() {
  const $wrap = document.getElementById("statstation-grid");
  if (!$wrap || !statstationData?.manifest) return;

  try {
    $wrap.innerHTML = `<div class="station-hud">${
      Object.values(statstationData.manifest).map((item, i) => {
        const isOnline = (item.status || "live") === "live";
        const pingClass = isOnline ? "" : " offline";
        const idx = String(i).padStart(2, "0");
        return `
          <a href="${esc(item.path)}" class="station-bar" aria-label="${esc(item.name)}">
            <span class="station-bar__bracket">[${idx}]</span>
            <i data-lucide="${esc(item.icon)}" class="station-bar__icon"></i>
            <span class="station-bar__name">${esc(item.name)}</span>
            <span class="station-bar__desc">${esc(item.description)}</span>
            <span class="station-bar__ping${pingClass}"></span>
          </a>`;
      }).join("")
    }</div>`;
  } catch (e) {
    renderError($wrap, "Station offline.");
  }
}

function renderTrapSection() {
  const $wrap = document.getElementById("trap-grid");
  if (!$wrap || !trapData?.manifest) return;

  try {
    $wrap.innerHTML = Object.values(trapData.manifest).map(item => `
      <a href="${esc(item.path)}" class="void-prose" aria-label="${esc(item.name)} — ${esc(item.description)}">
        <span class="void-prose__text">${esc(item.description)}</span>
      </a>`
    ).join("");
  } catch (e) {
    renderError($wrap, "Signal offline.");
  }
}
