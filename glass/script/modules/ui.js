import { config, hostingData, toolsData, botsData, extData, guideData, appsData, llmData, statstationData, trapData, fetchJSON, esc, renderError, globalRouter, IS_TOUCH } from './core.js';
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
  renderBots();
  renderHosting();
  renderTools();
  renderSignalMesh();
  renderCodex();
  renderUplinkLaunchpad();
  renderSocialStrip();

  // Global initializations
  if (typeof lucide !== "undefined") lucide.createIcons();
  requestAnimationFrame(() => {
    initTunnelLight();
    updateCarouselArrows();
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

function renderHosting() {
  const $wrap = document.getElementById("hosting-grid");
  if (!$wrap || !hostingData?.manifest) return;

  try {
    const tiles = Object.values(hostingData.manifest).map(node => {
      if (node.shortcut) globalRouter.set(node.shortcut.toLowerCase(), { type: 'link', payload: node.url });
      const domain = node.url.replace(/^https?:\/\//, '');
      const isOffline = (node.status || "online") !== "online";
      const srcBtn = node.source
        ? `<a href="${esc(node.source)}" target="_blank" rel="noopener" class="node-tile__src" aria-label="View source" tabindex="0"><i data-lucide="git-branch"></i></a>`
        : "";
      const kbd = node.shortcut
        ? `<kbd class="node-tile__kbd">${esc(node.shortcut)}</kbd>`
        : "";
      return `
        <a href="${esc(node.url)}" target="_blank" rel="noopener"
           class="node-tile"
           aria-label="${esc(node.name)} — ${esc(node.hosting)}">
          <span class="node-tile__status${isOffline ? " offline" : ""}" aria-hidden="true"></span>
          <i data-lucide="${esc(node.icon)}" class="node-tile__icon" aria-hidden="true"></i>
          <span class="node-tile__name">${esc(node.name)}</span>
          <span class="node-tile__sw">${esc(node.hosting)}</span>
          <span class="node-tile__foot">
            <span class="node-tile__domain">${esc(domain)}</span>
            ${kbd}
            ${srcBtn}
          </span>
        </a>`;
    }).join("");

    $wrap.innerHTML = `<div class="node-panel">${tiles}</div>`;
  } catch (e) {
    renderError($wrap, "Hosting nodes offline.");
  }
}

function renderTools() {
  const $container = document.getElementById("tools-container");
  if (!$container || !toolsData?.manifest) return;

  try {
    const tools = Object.values(toolsData.manifest);
    const cards = tools.map(tool => {
      if (tool.shortcut) globalRouter.set(tool.shortcut.toLowerCase(), { type: 'copy', payload: tool.install_cmd });

      return `
        <div class="tool-entry">
          <div class="tool-entry__header">
            <span class="tool-entry__icon"><i data-lucide="${esc(tool.icon)}"></i></span>
            <span class="tool-entry__name">${esc(tool.name)}${tool.shortcut ? `<span class="tool-entry__shortcut">[${esc(tool.shortcut)}]</span>` : ""}</span>
            <span class="tool-entry__target">${esc(tool.target)}</span>
          </div>
          <p class="tool-entry__desc">${esc(tool.description)}</p>
          <div class="tool-entry__cmd">
            <div class="tool-entry__cmd-scroll"><code>${esc(tool.install_cmd)}</code></div>
            <button class="tool-entry__copy" aria-label="Copy install command" data-cmd="${esc(tool.install_cmd)}">
              <i data-lucide="copy"></i>
            </button>
          </div>
          <div class="tool-entry__footer">
            <a href="${esc(tool.repo_url)}" target="_blank" rel="noopener" class="tool-entry__link" aria-label="View ${esc(tool.name)} source">
              <i data-lucide="git-branch"></i> source
            </a>
          </div>
        </div>`;
    }).join("");

    const $details = document.createElement('details');
    $details.className = 'tools-details';
    $details.innerHTML = `
      <summary class="tools-summary">
        <span class="tools-summary__domain">EXEC</span>
        <span class="tools-summary__label">Ordnance Depot</span>
        <span class="tools-summary__meta">${tools.length} payloads</span>
        <span class="tools-summary__status tools-summary__status--sealed">SEALED</span>
        <svg class="tools-summary__chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </summary>
      <div class="tools-details__body">
        <div class="tools-details__body-inner"><div class="tools-grid">${cards}</div></div>
      </div>`;
    
    $details.addEventListener('toggle', () => {
      const $status = $details.querySelector('.tools-summary__status');
      if (!$status) return;
      $status.textContent = $details.open ? 'OPEN' : 'SEALED';
      $status.classList.toggle('tools-summary__status--sealed', !$details.open);
      $status.classList.toggle('tools-summary__status--open', $details.open);
    });
    $container.appendChild($details);
  } catch (e) {
    renderError($container, "Tools offline.");
  }
}

function renderBots() {
  const $container = document.getElementById("bots-container");
  if (!$container || !botsData?.manifest) return;

  document.querySelectorAll('[id^="bot-tip-"]').forEach(el => el.remove());

  try {
    $container.innerHTML = Object.values(botsData.manifest).map(bot => {
      if (bot.shortcut && bot.chat_url) globalRouter.set(bot.shortcut.toLowerCase(), { type: 'link', payload: bot.chat_url });

      const botId = esc(bot.name.toLowerCase().replace(/\s+/g, '-'));
      const tipId = `bot-tip-${botId}`;
      const isOnline = (bot.status || "online") === "online";

      const $tip = document.createElement('div');
      $tip.className = 'agent-tooltip';
      $tip.id = tipId;
      $tip.setAttribute('role', 'tooltip');
      $tip.innerHTML = `<span class="agent-id">ID: ${esc(bot.name.toUpperCase())}${bot.shortcut ? ` [${esc(bot.shortcut)}]` : ""}</span><p>${esc(bot.description)}</p>`;
      document.body.appendChild($tip);

      const kbd = bot.shortcut ? `<kbd class="drone-row__kbd">${esc(bot.shortcut)}</kbd>` : "";
      const chatBtn = bot.chat_url
        ? `<a href="${esc(bot.chat_url)}" target="_blank" rel="noopener" class="drone-row__btn drone-row__btn--chat" aria-label="Message ${esc(bot.name)}"><i data-lucide="message-circle"></i></a>`
        : "";
      const codeBtn = `<a href="${esc(bot.repo_url)}" target="_blank" rel="noopener" class="drone-row__btn drone-row__btn--code" aria-label="View ${esc(bot.name)} source"><i data-lucide="git-branch"></i></a>`;

      return `
        <div class="drone-row" data-tip-id="${tipId}" aria-describedby="${tipId}">
          <span class="drone-row__status${isOnline ? "" : " offline"}" aria-label="${isOnline ? "online" : "offline"}"></span>
          <i data-lucide="${esc(bot.icon)}" class="drone-row__icon" aria-hidden="true"></i>
          <span class="drone-row__name">${esc(bot.name)}</span>
          <span class="drone-row__desc">${esc(bot.description)}</span>
          ${kbd}
          <div class="drone-row__actions">${chatBtn}${codeBtn}</div>
        </div>`;
    }).join("");
  } catch (e) {
    renderError($container, "Drone fleet offline.");
  }
}

function renderSignalMesh() {
  const $container = document.getElementById("extlinks-container");
  if (!$container || !extData) return;

  try {
    $container.innerHTML = Object.entries(extData).map(([catKey, category], idx) => {
      const catId = `ext-cat-${idx}`;
      const links = Object.values(category.manifest).map(link => {
        globalRouter.set(link.shortcut.toLowerCase(), { type: 'link', payload: link.url });
        return `
          <a href="${esc(link.url)}" target="_blank" rel="noopener" class="item-ext" aria-label="${esc(link.shortcut)}: ${esc(link.name)}">
            <span class="ext-shortcut">${esc(link.shortcut)}</span>
            <span class="ext-name">${esc(link.name)}</span>
            <div class="tooltip-data" role="tooltip">
              <span class="trust-badge trust-badge--${esc(link.trust_level.toLowerCase())}">[${esc(link.trust_level)}]</span>
              <span>${esc(link.info)}</span>
            </div>
          </a>`;
      }).join("");

      return `
        <div class="ext-category ${esc(category.visual_class || "")}" id="${catId}">
          <button class="ext-category__toggle" aria-expanded="false" aria-controls="${catId}-body">
            <span class="ext-category__key">${esc(catKey)}</span>
            <span class="ext-category__label">${esc(category.category)}</span>
            <span class="ext-category__count">${Object.keys(category.manifest).length}</span>
            <i data-lucide="chevron-down" class="ext-category__chevron"></i>
          </button>
          <div class="ext-category__body" id="${catId}-body" role="region">
            <div class="ext-category__body-inner"><div class="ext-list">${links}</div></div>
          </div>
        </div>`;
    }).join("");

    initSignalMeshEvents($container);
  } catch (e) {
    renderError($container, "Signal mesh offline.");
  }
}

function initSignalMeshEvents($container) {
  const closeAll = () => {
    $container.querySelectorAll(".ext-category--open").forEach($open => {
      $open.classList.remove("ext-category--open");
      $open.querySelector(".ext-category__toggle").setAttribute("aria-expanded", "false");
    });
  };

  const positionOverlay = ($cat) => {
    const $body = $cat.querySelector(".ext-category__body");
    const containerRect = $container.getBoundingClientRect();
    const catRect = $cat.getBoundingClientRect();
    $body.style.left = `${containerRect.left - catRect.left}px`;
    $body.style.width = `${containerRect.width}px`;
    const spaceBelow = window.innerHeight - catRect.bottom;
    const overlayH = Math.min(400, spaceBelow - 8);
    $body.style.maxHeight = overlayH > 80 ? `${overlayH}px` : "80vh";
  };

  $container.addEventListener("click", (e) => {
    const $btn = e.target.closest(".ext-category__toggle");
    if (!$btn) return;
    const $cat = $btn.closest(".ext-category");
    const isOpen = $cat.classList.contains("ext-category--open");
    closeAll();
    if (!isOpen) {
      if (window.innerWidth > 900) positionOverlay($cat);
      $cat.classList.add("ext-category--open");
      $btn.setAttribute("aria-expanded", "true");
    }
  });

  document.addEventListener("click", (e) => { if (!$container.contains(e.target)) closeAll(); });
  window.addEventListener("resize", () => {
    if (window.innerWidth <= 900) {
      $container.querySelectorAll(".ext-category__body").forEach($b => {
        $b.style.left = $b.style.width = $b.style.maxHeight = "";
      });
    }
  }, { passive: true });
}

function renderCodex() {
  const $track = document.getElementById("guides-track");
  if (!$track || !guideData) return;

  try {
    const flipHint = IS_TOUCH ? "tap to flip" : "hover to flip";
    const guides = Array.isArray(guideData) ? guideData : (guideData.manifest ? Object.values(guideData.manifest) : []);
    
    $track.innerHTML = guides.map(guide => `
      <div class="flip-card" tabindex="0" aria-label="${esc(guide.title)} guide">
        <div class="flip-card__inner">
          <div class="flip-card__front">
            <i data-lucide="${esc(guide.icon)}" class="flip-card__icon"></i>
            <h3 class="flip-card__title">${esc(guide.title)}</h3>
            <div class="flip-card__meta">ETA: ${esc(guide.read_time)}</div>
            <div class="flip-card__hint">${flipHint}</div>
          </div>
          <div class="flip-card__back">
            <h4 class="flip-card__back-title"><i data-lucide="${esc(guide.icon)}"></i>${esc(guide.title)}</h4>
            <p class="flip-card__back-desc">${esc(guide.description)}</p>
            <div class="flip-card__back-meta">
              <span>ETA: ${esc(guide.read_time)}</span>
              <a href="guide/?md=${esc(guide.file)}" class="flip-card__read-btn"><i data-lucide="external-link"></i> Read</a>
            </div>
          </div>
        </div>
      </div>`).join("");
  } catch (e) {
    renderError($track, "Codex offline.");
  }
}

function renderApps() {
  const $grid = document.getElementById("apps-grid");
  if (!$grid || !appsData?.manifest) return;

  try {
    $grid.innerHTML = Object.values(appsData.manifest).map(app => {
      const isLive = (app.status || "planned") === "live";
      const tags = (app.tags ?? []).map(t => `<span class="pg-feature__tag">${esc(t)}</span>`).join("");

      return `
        <a href="${isLive ? esc(app.path) : "#"}" class="pg-feature${isLive ? "" : ' pg-feature--disabled'}" ${!isLive ? 'aria-disabled="true"' : ""}>
          <div class="pg-feature__left">
            <div class="pg-feature__icon-wrap" aria-hidden="true">
              <i data-lucide="${esc(app.icon)}" class="pg-feature__icon"></i>
            </div>
            <div class="pg-feature__body">
              <div class="pg-feature__name">${esc(app.name)}</div>
              <div class="pg-feature__desc">${esc(app.description)}</div>
              <div class="pg-feature__tags">${tags}</div>
            </div>
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
  // Tooltips, Clipboard, Scroll-to-top, Carousel, Terminal
  initClipboard();
  initBotTooltips();
  initScrollTop();
  if (!IS_TOUCH) {
    initExtTooltips();
    initTerminal();
  }
  initFlipCards();
}

function initClipboard() {
  document.addEventListener("click", (e) => {
    const $btn = e.target.closest(".tool-entry__copy");
    if (!$btn || $btn.classList.contains("tool-entry__copy--copied")) return;
    
    navigator.clipboard.writeText($btn.dataset.cmd).then(() => {
      $btn.classList.add("tool-entry__copy--copied");
      const $icon = $btn.querySelector("i");
      if ($icon) $icon.setAttribute("data-lucide", "check");
      if (typeof lucide !== "undefined") lucide.createIcons();
      setTimeout(() => {
        $btn.classList.remove("tool-entry__copy--copied");
        if ($icon) $icon.setAttribute("data-lucide", "copy");
        if (typeof lucide !== "undefined") lucide.createIcons();
      }, 1800);
    });
  });
}

function initBotTooltips() {
  const show = ($p) => {
    const $tip = document.getElementById($p.dataset.tipId);
    if (!$tip) return;
    document.querySelectorAll('.agent-tooltip--visible').forEach(t => t.classList.remove('agent-tooltip--visible'));
    $tip.classList.add('agent-tooltip--visible');
    const r = $p.getBoundingClientRect();
    $tip.style.left = `${Math.max(8, Math.min(r.left + r.width/2 - $tip.offsetWidth/2, window.innerWidth - $tip.offsetWidth - 8))}px`;
    $tip.style.top = `${r.top - $tip.offsetHeight - 12}px`;
  };
  const hide = () => document.querySelectorAll('.agent-tooltip--visible').forEach(t => t.classList.remove('agent-tooltip--visible'));

  document.addEventListener('mouseover', e => { const $p = e.target.closest('.drone-row'); if ($p) show($p); });
  document.addEventListener('mouseout', e => { if (e.target.closest('.drone-row') && !e.relatedTarget?.closest('.drone-row')) hide(); });
  document.addEventListener('click', e => {
    if (e.target.closest('.drone-row__btn')) return;
    const $p = e.target.closest('.drone-row');
    if (!$p) hide(); else show($p);
  });
}

function initScrollTop() {
  const $btn = document.getElementById("scroll-top");
  if (!$btn) return;
  window.addEventListener("scroll", () => $btn.classList.toggle("hidden", window.scrollY < 400), { passive: true });
  $btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

function updateCarouselArrows() {
  const $track = document.getElementById("guides-track");
  const $prev = document.querySelector(".carousel__arrow--prev");
  const $next = document.querySelector(".carousel__arrow--next");
  if (!$track || !$prev || !$next) return;

  const update = () => {
    $prev.classList.toggle("carousel__arrow--hidden", $track.scrollLeft <= 0);
    $next.classList.toggle("carousel__arrow--hidden", $track.scrollLeft + $track.clientWidth >= $track.scrollWidth - 2);
  };

  $prev.onclick = () => $track.scrollBy({ left: -300, behavior: "smooth" });
  $next.onclick = () => $track.scrollBy({ left: 300, behavior: "smooth" });
  $track.onscroll = update;
  update();
}

function initFlipCards() {
  const toggle = (el) => el?.classList.toggle("flip-card--flipped");
  document.addEventListener("click", e => { if (IS_TOUCH) toggle(e.target.closest(".flip-card")); });
  document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && document.activeElement.closest(".flip-card")) toggle(document.activeElement.closest(".flip-card")); });
}

function initExtTooltips() {
  document.addEventListener("mouseover", (e) => {
    const $link = e.target.closest(".item-ext");
    const $tip = $link?.querySelector(".tooltip-data");
    if (!$tip) return;
    const r = $link.getBoundingClientRect();
    const spaceAbove = r.top > 100;
    $tip.style.left = `${Math.max(8, Math.min(r.left + 44, window.innerWidth - 268))}px`;
    $tip.style.top = `${spaceAbove ? r.top : r.bottom + 8}px`;
    $tip.style.transform = spaceAbove ? "translateY(-110%)" : "translateY(0)";
  });
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
    window.location.href = `/playground/${params.toString() ? '?' + params.toString() : ''}`;
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
    $wrap.innerHTML = `<div class="signal-list">${
      Object.values(trapData.manifest).map(item => `
        <a href="${esc(item.path)}" class="signal-entry" aria-label="${esc(item.name)}">
          <span class="signal-entry__dot" aria-hidden="true"></span>
          <i data-lucide="${esc(item.icon)}" class="signal-entry__icon" aria-hidden="true"></i>
          <span class="signal-entry__name">${esc(item.name)}</span>
          <span class="signal-entry__desc">${esc(item.description)}</span>
          <svg class="signal-entry__arrow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </a>`
      ).join("")
    }</div>`;
  } catch (e) {
    renderError($wrap, "Signal offline.");
  }
}
