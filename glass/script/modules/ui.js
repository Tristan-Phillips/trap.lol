import { config, hostingData, toolsData, botsData, extData, guideData, appsData, llmData, fetchJSON, esc, renderError, globalRouter, IS_TOUCH } from './core.js';
import { initTunnelLight } from './tunnel-light.js';

export function renderUI() {

  // ── 2. Header ────────────────────────────────────────────────────────────
  const $eyebrow = document.getElementById("header-eyebrow");
  const $title = document.getElementById("header-title");
  const $subtitle = document.getElementById("header-subtitle");
  if ($eyebrow) $eyebrow.textContent = config.site.eyebrow;
  if ($title) {
    $title.textContent = config.site.title;
    $title.setAttribute("data-text", config.site.title);
  }
  if ($subtitle) $subtitle.textContent = config.site.tagline;

  // ── 2b. Meta / OG tags ───────────────────────────────────────────────────
  const $ogTitle = document.getElementById("og-title");
  const $ogDescription = document.getElementById("og-description");
  const $ogUrl = document.getElementById("og-url");
  const $metaDesc = document.querySelector('meta[name="description"]');
  const ogTagline = config.site.tagline || "";
  const ogDomain = config.site.domain || "";
  if ($ogTitle) $ogTitle.setAttribute("content", config.site.title);
  if ($ogDescription) $ogDescription.setAttribute("content", ogTagline);
  if ($ogUrl) $ogUrl.setAttribute("content", `https://${ogDomain}`);
  if ($metaDesc) $metaDesc.setAttribute("content", ogTagline);
  document.title = `${config.site.title} // uplink`;

  // ── 3. Footer ────────────────────────────────────────────────────────────
  const $footerDomain = document.getElementById("footer-domain");
  const $footerTagline = document.getElementById("footer-tagline");
  const $footerCopy = document.getElementById("footer-copy");
  if ($footerDomain) $footerDomain.textContent = config.site.domain;
  if ($footerTagline) $footerTagline.textContent = config.site.tagline;
  if ($footerCopy)
    $footerCopy.textContent = `© ${new Date().getFullYear()} ${config.site.author}`;

  // ── 4. Sovereign Nodes ───────────────────────────────────────────────────
  const $hostGrid = document.getElementById("hosting-grid");
  if ($hostGrid && hostingData.manifest) {
    try {
      let html = "";
      Object.values(hostingData.manifest).forEach((node) => {
        const statusClass = esc(node.status || "online");
        
        // Register to Global Router
        if (node.shortcut) {
          globalRouter.set(node.shortcut.toLowerCase(), { type: 'link', payload: node.url });
        }

        const sourceLink = node.source
          ? `<a href="${esc(node.source)}" target="_blank" rel="noopener" class="card-primary__source" aria-label="View ${esc(node.hosting)} source"><i data-lucide="git-branch"></i> Source</a>`
          : "";

        html += `
          <div class="card-primary-wrap">
            <a href="${esc(node.url)}" target="_blank" rel="noopener" class="card-primary" aria-label="${esc(node.name)} — ${esc(node.hosting)}">
              <i data-lucide="${esc(node.icon)}"></i>
              <div class="card-primary__body">
                <span class="card-primary__sub">${esc(node.hosting)}</span>
              </div>
              <div class="card-primary__status ${statusClass}"></div>
            </a>
            ${sourceLink}
          </div>
        `;
      });
      $hostGrid.innerHTML = html;
    } catch (e) {
      renderError($hostGrid, "Failed to render hosting nodes.");
      console.error("[render] hosting:", e);
    }
  }

  // ── 5. Ordnance Depot ────────────────────────────────────────────────────
  const $toolsContainer = document.getElementById("tools-container");
  if ($toolsContainer && toolsData.manifest) {
    try {
      const tools = Object.values(toolsData.manifest);
      let cards = "";
      tools.forEach((tool) => {

        // Register atomic command to Global Router
        if (tool.shortcut) {
          globalRouter.set(tool.shortcut.toLowerCase(), { type: 'copy', payload: tool.install_cmd });
        }

        cards += `
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
          </div>
        `;
      });

      // Wrap grid in a <details> for collapse with animated reveal
      const $details = document.createElement('details');
      $details.className = 'tools-details';
      $details.open = true;
      $details.innerHTML = `
        <summary class="tools-summary">
          <svg class="tools-summary__chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          <span class="tools-summary__count">${tools.length} payloads</span>
        </summary>
        <div class="tools-details__body">
          <div class="tools-details__body-inner">
            <div class="tools-grid">${cards}</div>
          </div>
        </div>
      `;
      $toolsContainer.appendChild($details);
    } catch (e) {
      renderError($toolsContainer, "Failed to render ordnance depot.");
      console.error("[render] tools:", e);
    }
  }

  // ── 6. Drone Fleet ───────────────────────────────────────────────────────
  const $botsContainer = document.getElementById("bots-container");
  if ($botsContainer && botsData.manifest) {
    try {
      let html = "";
      Object.values(botsData.manifest).forEach((bot) => {
        
        // Register to Global Router only if an active URL exists
        if (bot.shortcut && bot.chat_url) {
          globalRouter.set(bot.shortcut.toLowerCase(), { type: 'link', payload: bot.chat_url });
        }

        const botTooltipId = `bot-tip-${esc(bot.name.toLowerCase().replace(/\s+/g, '-'))}`;
        html += `
          <div class="bot-profile">
            <div class="bot-avatar" role="img" aria-label="${esc(bot.name)}" aria-describedby="${botTooltipId}">
              <i data-lucide="${esc(bot.icon)}"></i>
              <div class="bot-status ${esc(bot.status)}"></div>
            </div>
            <div class="agent-tooltip" id="${botTooltipId}" role="tooltip">
              <span class="agent-id">ID: ${esc(bot.name.toUpperCase())} ${bot.shortcut ? `[${esc(bot.shortcut)}]` : ""}</span>
              <p>${esc(bot.description)}</p>
            </div>
            <span class="bot-name">${esc(bot.name)}</span>
            <div class="bot-actions">
              ${bot.chat_url ? `<a href="${esc(bot.chat_url)}" target="_blank" rel="noopener" class="bot-btn bot-btn--chat" aria-label="Message ${esc(bot.name)} on Telegram"><i data-lucide="message-circle"></i></a>` : ""}
              <a href="${esc(bot.repo_url)}" target="_blank" rel="noopener" class="bot-btn bot-btn--code" aria-label="View ${esc(bot.name)} source code">
                <i data-lucide="git-branch"></i>
              </a>
            </div>
          </div>
        `;
      });
      $botsContainer.innerHTML = html;
    } catch (e) {
      renderError($botsContainer, "Failed to render drone fleet.");
      console.error("[render] bots:", e);
    }
  }

  // ── 7. Signal Mesh ───────────────────────────────────────────────────────
  const $extContainer = document.getElementById("extlinks-container");

  if ($extContainer && extData) {
    try {
      let html = "";
      let idx = 0;
      
      // Parse the Object Hash Map dynamically
      for (const [catKey, category] of Object.entries(extData)) {
        let linksHTML = "";
        const visualClass = esc(category.visual_class || "");

        Object.values(category.manifest).forEach((link) => {
          // Add to Global Keystroke Router
          globalRouter.set(link.shortcut.toLowerCase(), { type: 'link', payload: link.url });

          linksHTML += `
          <a href="${esc(link.url)}" target="_blank" rel="noopener" class="item-ext" aria-label="${esc(link.shortcut)}: ${esc(link.name)}">
            <span class="ext-shortcut">${esc(link.shortcut)}</span>
            <span class="ext-name">${esc(link.name)}</span>
            <div class="tooltip-data" role="tooltip">
              <span class="trust-badge trust-badge--${esc(link.trust_level.toLowerCase())}">[${esc(link.trust_level)}]</span>
              <span>${esc(link.info)}</span>
            </div>
          </a>`;
        });

        const catTitle = esc(category.category);
        const catId    = `ext-cat-${idx}`;
        idx++;

        html += `
        <div class="ext-category ${visualClass}" id="${catId}">
          <button class="ext-category__toggle" aria-expanded="false" aria-controls="${catId}-body">
            <span class="ext-category__key">${esc(catKey)}</span>
            <span class="ext-category__label">${catTitle}</span>
            <span class="ext-category__count">${Object.keys(category.manifest).length}</span>
            <i data-lucide="chevron-down" class="ext-category__chevron"></i>
          </button>
          <div class="ext-category__body" id="${catId}-body" role="region">
            <div class="ext-category__body-inner">
              <div class="ext-list">
                ${linksHTML}
              </div>
            </div>
          </div>
        </div>`;
      }
      $extContainer.innerHTML = html;
    } catch (e) {
      renderError($extContainer, "Failed to render Signal Mesh.");
      console.error("[render] extlinks:", e);
    }
  }

  // ── 7b. Accordion overlay toggle ─────────────────────────────────────────
  if ($extContainer) {
    function positionOverlay($cat) {
      const $body         = $cat.querySelector(".ext-category__body");
      const containerRect = $extContainer.getBoundingClientRect();
      const catRect       = $cat.getBoundingClientRect();
      // Offset left relative to the card, clamped so the overlay never leaves the container
      const leftOffset = containerRect.left - catRect.left;
      $body.style.left  = `${leftOffset}px`;
      $body.style.width = `${containerRect.width}px`;
      // Ensure overlay doesn't overflow viewport bottom
      const spaceBelow = window.innerHeight - catRect.bottom;
      const overlayH   = Math.min(400, spaceBelow - 8);
      $body.style.maxHeight = overlayH > 80 ? `${overlayH}px` : "80vh";
      $body.style.overflowY = "auto";
    }

    function closeAll() {
      $extContainer.querySelectorAll(".ext-category--open").forEach(($open) => {
        $open.classList.remove("ext-category--open");
        $open.querySelector(".ext-category__toggle").setAttribute("aria-expanded", "false");
      });
    }

    $extContainer.addEventListener("click", (e) => {
      const $btn = e.target.closest(".ext-category__toggle");
      if (!$btn) return;
      const $cat   = $btn.closest(".ext-category");
      const isOpen = $cat.classList.contains("ext-category--open");

      closeAll();
      if (!isOpen) {
        if (window.innerWidth > 768) positionOverlay($cat);
        $cat.classList.add("ext-category--open");
        $btn.setAttribute("aria-expanded", "true");
      }
    });

    document.addEventListener("click", (e) => {
      if (!$extContainer.contains(e.target)) closeAll();
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth <= 768) {
        $extContainer.querySelectorAll(".ext-category__body").forEach(($b) => {
          $b.style.left = "";
          $b.style.width = "";
          $b.style.maxHeight = "";
          $b.style.overflowY = "";
        });
      }
    }, { passive: true });

    $extContainer.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeAll(); return; }
      if (e.key !== "Enter" && e.key !== " ") return;
      const $btn = e.target.closest(".ext-category__toggle");
      if (!$btn) return;
      e.preventDefault();
      $btn.click();
    });
  }

  // ── 8. Sacred Codex ──────────────────────────────────────────────────────
  const $guidesTrack = document.getElementById("guides-track");
  // Assuming guides.json remains a flat array for now, otherwise update to manifest extraction
  if ($guidesTrack && guideData) {
    try {
      let html = "";
      const flipHint = IS_TOUCH ? "tap to flip" : "hover to flip";
      
      const guidesArray = Array.isArray(guideData) ? guideData : (guideData.manifest ? Object.values(guideData.manifest) : []);

      guidesArray.forEach((guide) => {
        html += `
          <div class="flip-card" tabindex="0" aria-label="${esc(guide.title)} guide">
            <div class="flip-card__inner">
              <div class="flip-card__front">
                <i data-lucide="${esc(guide.icon)}" class="flip-card__icon"></i>
                <h3 class="flip-card__title">${esc(guide.title)}</h3>
                <div class="flip-card__meta">ETA: ${esc(guide.read_time)}</div>
                <div class="flip-card__hint">${flipHint}</div>
              </div>
              <div class="flip-card__back">
                <h4 class="flip-card__back-title">
                  <i data-lucide="${esc(guide.icon)}"></i>${esc(guide.title)}
                </h4>
                <p class="flip-card__back-desc">${esc(guide.description)}</p>
                <div class="flip-card__back-meta">
                  <span>ETA: ${esc(guide.read_time)}</span>
                  <a href="guide/?md=${esc(guide.file)}" class="flip-card__read-btn">
                    <i data-lucide="external-link"></i> Read Guide
                  </a>
                </div>
              </div>
            </div>
          </div>
        `;
      });
      $guidesTrack.innerHTML = html;
    } catch (e) {
      renderError($guidesTrack, "Failed to render codex.");
      console.error("[render] guides:", e);
    }
  }

  // ── 8b. App Uplinks ──────────────────────────────────────────────────────
  const $appsGrid = document.getElementById("apps-grid");
  if ($appsGrid && appsData?.manifest) {
    try {
      let html = "";
      Object.values(appsData.manifest).forEach((app) => {
        const statusClass = esc(app.status || "planned");
        const statusLabel = { live: "LIVE", wip: "WIP", planned: "PLANNED" }[app.status] ?? "—";
        const tagsHtml = (app.tags ?? [])
          .map(t => `<span class="app-card__tag">${esc(t)}</span>`)
          .join("");
        const keyBadge = app.keyed
          ? `<span class="app-card__keyed" title="Requires your own API key"><i data-lucide="key-round"></i> API key</span>`
          : `<span class="app-card__keyed app-card__keyed--free" title="No key required"><i data-lucide="unlock"></i> No key</span>`;
        const isLive = app.status === "live";
        const href   = isLive ? esc(app.path) : "#";

        html += `
          <a
            href="${href}"
            class="app-card app-card--${statusClass}"
            aria-label="${esc(app.name)}"
            ${!isLive ? 'aria-disabled="true" tabindex="0"' : ""}
          >
            <div class="app-card__header">
              <i data-lucide="${esc(app.icon)}" class="app-card__icon"></i>
              <span class="app-card__name">${esc(app.name)}</span>
              <span class="app-card__status app-card__status--${statusClass}">${statusLabel}</span>
            </div>
            <p class="app-card__desc">${esc(app.description)}</p>
            <div class="app-card__footer">
              <div class="app-card__tags">${tagsHtml}</div>
              ${keyBadge}
            </div>
          </a>`;
      });
      $appsGrid.innerHTML = html;

      // Prevent navigation on non-live apps while still being keyboard-accessible
      $appsGrid.addEventListener("click", (e) => {
        const $a = e.target.closest(".app-card");
        if ($a && $a.getAttribute("aria-disabled") === "true") e.preventDefault();
      });
      $appsGrid.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const $a = e.target.closest(".app-card");
        if ($a && $a.getAttribute("aria-disabled") === "true") e.preventDefault();
      });
    } catch (e) {
      renderError($appsGrid, "Failed to render app uplinks.");
      console.error("[render] apps:", e);
    }
  }

  // ── 8c. Uplink Launchpad ─────────────────────────────────────────────────
  renderUplinkLaunchpad();

  // ── 8d. Social Signal Cluster ────────────────────────────────────────────
  renderSocialCluster();

  // ── 9. Init Lucide icons ─────────────────────────────────────────────────
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  } else {
    console.warn("[lucide] library not available — icons will not render.");
  }

  // ── 9b. Tunnel light — after all HTML + icons are in the DOM ─────────────
  requestAnimationFrame(() => initTunnelLight());

  // ── 9c. Carousel arrow initial state (after layout) ──────────────────────
  requestAnimationFrame(updateArrows);

  // ── 10. Copy-to-clipboard (Ordnance Depot) ───────────────────────────────
  document.addEventListener("click", (e) => {
    const $btn = e.target.closest(".tool-entry__copy");
    if (!$btn) return;
    const cmd = $btn.dataset.cmd;
    navigator.clipboard
      .writeText(cmd)
      .then(() => {
        $btn.classList.add("tool-entry__copy--copied");
        setTimeout(
          () => $btn.classList.remove("tool-entry__copy--copied"),
          1800,
        );
      })
      .catch(() => {
        console.warn("[clipboard] write failed");
      });
  });

  // ── 11. Carousel arrows (Sacred Codex) ───────────────────────────────────
  const $track = document.getElementById("guides-track");
  const $btnPrev = document.querySelector(".carousel__arrow--prev");
  const $btnNext = document.querySelector(".carousel__arrow--next");

  function scrollCarousel(dir) {
    if (!$track) return;
    const cardWidth = $track.querySelector(".flip-card")?.offsetWidth + 16 || 276;
    $track.scrollBy({ left: dir * cardWidth, behavior: "smooth" });
  }

  if ($btnPrev) $btnPrev.addEventListener("click", () => scrollCarousel(-1));
  if ($btnNext) $btnNext.addEventListener("click", () => scrollCarousel(1));

  function updateArrows() {
    if (!$track || !$btnPrev || !$btnNext) return;
    $btnPrev.classList.toggle("carousel__arrow--hidden", $track.scrollLeft <= 0);
    $btnNext.classList.toggle(
      "carousel__arrow--hidden",
      $track.scrollLeft + $track.clientWidth >= $track.scrollWidth - 2,
    );
  }
  if ($track) {
    $track.addEventListener("scroll", updateArrows, { passive: true });
  }

  // ── 12. Flip cards — touch + keyboard ───────────────────────────────────
  document.addEventListener("click", (e) => {
    const $card = e.target.closest(".flip-card");
    if (!$card) return;
    if (IS_TOUCH) $card.classList.toggle("flip-card--flipped");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const $card = document.activeElement?.closest(".flip-card");
      if ($card) {
        e.preventDefault();
        $card.classList.toggle("flip-card--flipped");
      }
    }
  });

  // ── 13. Scroll-to-top ────────────────────────────────────────────────────
  const $scrollTop = document.getElementById("scroll-top");
  if ($scrollTop) {
    let scrollRaf;
    window.addEventListener(
      "scroll",
      () => {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
          $scrollTop.classList.toggle("hidden", window.scrollY < 400);
          scrollRaf = null;
        });
      },
      { passive: true },
    );
    $scrollTop.addEventListener("click", () =>
      window.scrollTo({ top: 0, behavior: "smooth" }),
    );
  }

  // ── 14b. Tooltip positioning ─────────────────────────────────────────────
  if (!IS_TOUCH) {
    document.addEventListener("mouseover", (e) => {
      const $link = e.target.closest(".item-ext");
      if (!$link) return;
      const $tip = $link.querySelector(".tooltip-data");
      if (!$tip) return;

      const rect  = $link.getBoundingClientRect();
      const tipW  = 260;
      const tipH  = 80;
      const gap   = 8;

      const idealLeft = rect.left + 44;
      const left = Math.min(idealLeft, window.innerWidth - tipW - gap);
      const spaceAbove = rect.top;
      const top = spaceAbove > tipH + gap ? rect.top : rect.bottom + gap;

      $tip.style.left      = `${Math.max(gap, left)}px`;
      $tip.style.top       = `${top}px`;
      $tip.style.transform = spaceAbove > tipH + gap ? "translateY(-110%)" : "translateY(0)";
    });
  }

  

  // ── 14. Global Terminal Keystroke Routing (Desktop) ──────────────────────
  if (!IS_TOUCH) {
    let keyBuffer = "";
    let cmdTimeout;
    const $cmdOverlay = document.getElementById("cmd-overlay");
    const $cmdText = document.getElementById("cmd-text");

    document.addEventListener("keydown", (e) => {
      if (
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.tagName === "BUTTON" ||
        e.ctrlKey || e.metaKey || e.altKey
      )
        return;
      
      if (!/^[a-zA-Z0-9]$/.test(e.key)) return;

      keyBuffer += e.key.toLowerCase();
      $cmdText.textContent = keyBuffer.toUpperCase();
      $cmdOverlay.classList.remove("hidden");

      if (globalRouter.has(keyBuffer)) {
        const action = globalRouter.get(keyBuffer);
        $cmdText.style.color = "#fff";
        
        if (action.type === "link") {
          $cmdText.textContent = "ROUTING...";
          setTimeout(() => {
            window.open(action.payload, "_blank");
            resetBuffer();
          }, 300);
        } else if (action.type === "copy") {
          $cmdText.textContent = "PAYLOAD COPIED";
          navigator.clipboard.writeText(action.payload).catch(err => console.error("Clipboard write failed:", err));
          setTimeout(resetBuffer, 800);
        }
      } else if (keyBuffer.length >= 2) {
        // If buffer is 2 characters and invalid, reset to prevent locking
        setTimeout(resetBuffer, 500);
      }

      clearTimeout(cmdTimeout);
      cmdTimeout = setTimeout(resetBuffer, 2000);
    });

    function resetBuffer() {
      keyBuffer = "";
      $cmdOverlay.classList.add("hidden");
      $cmdText.style.color = "var(--accent)";
    }
  }

}

/* ═══════════════════════════════════════════════
   ── Uplink Launchpad ─────────────────────────
   Live telemetry + prompt probe. Hands off to
   /playground/?q=…&agent=… for prefill-only flow.
   ═══════════════════════════════════════════════ */
function renderUplinkLaunchpad() {
  const $root = document.getElementById("uplink-launch");
  if (!$root || !llmData || !llmData.routing_table) return;

  const $telemetry    = document.getElementById("uplink-telemetry");
  const $agentSelect  = document.getElementById("uplink-agent");
  const $modelPreview = document.getElementById("uplink-model-preview");
  const $prompt       = document.getElementById("uplink-prompt");
  const $form         = document.getElementById("uplink-probe");
  const $signalDot    = document.getElementById("uplink-signal-dot");
  const $signalLabel  = document.getElementById("uplink-signal-label");
  const $eyebrow      = $signalDot?.parentElement;

  // ── Telemetry ───────────────────────────────────────────────────────────
  try {
    const familyCount = Array.isArray(llmData._index) ? llmData._index.length : 0;
    const models      = Object.values(llmData.routing_table);
    const modelCount  = models.length;
    const subCount    = models.filter(m => !m.pay_per_token).length;
    const paidCount   = modelCount - subCount;
    const defaultId   = llmData.default_routing;
    const defaultLbl  = llmData.routing_table[defaultId]?.label ?? defaultId ?? "—";
    const defaultProv = llmData.routing_table[defaultId]?.provider ?? "";

    $modelPreview.textContent = defaultLbl;
    $modelPreview.title       = defaultProv ? `${defaultLbl} · ${defaultProv}` : defaultLbl;

    $telemetry.innerHTML = `
      <div class="uplink-tele">
        <span class="uplink-tele__label"><i data-lucide="layers"></i> models</span>
        <span class="uplink-tele__value uplink-tele__value--accent">${modelCount}</span>
        <span class="uplink-tele__sub">${familyCount} families</span>
      </div>
      <div class="uplink-tele">
        <span class="uplink-tele__label"><i data-lucide="zap"></i> default</span>
        <span class="uplink-tele__value uplink-tele__value--cyan" title="${esc(defaultLbl)}">${esc(defaultLbl)}</span>
        <span class="uplink-tele__sub">${esc(defaultProv)}</span>
      </div>
      <div class="uplink-tele">
        <span class="uplink-tele__label"><i data-lucide="infinity"></i> subscription</span>
        <span class="uplink-tele__value uplink-tele__value--green">${subCount}</span>
        <span class="uplink-tele__sub">included</span>
      </div>
      <div class="uplink-tele">
        <span class="uplink-tele__label"><i data-lucide="coins"></i> pay-per-token</span>
        <span class="uplink-tele__value uplink-tele__value--warm">${paidCount}</span>
        <span class="uplink-tele__sub">metered</span>
      </div>
      <div class="uplink-tele">
        <span class="uplink-tele__label"><i data-lucide="user-cog"></i> agents</span>
        <span class="uplink-tele__value" id="uplink-tele-agent-count">…</span>
        <span class="uplink-tele__sub">personas</span>
      </div>
    `;
  } catch (e) {
    renderError($telemetry, "Telemetry offline.");
    console.error("[uplink] telemetry:", e);
  }

  // ── Uplink mode probe ───────────────────────────────────────────────────
  // NOTE: API keys are session-scoped inside the playground (never written
  // to localStorage by design — see llm-auth.js). So the hub cannot observe
  // key state. We only distinguish PROXY MODE vs DIRECT MODE here.
  const llmCfg     = config.llm ?? {};
  const PROXY_MODE = !!(llmCfg.api_base && !llmCfg.api_base.includes("nano-gpt.com"));

  if (PROXY_MODE) {
    if ($signalDot)   $signalDot.dataset.state = "proxy";
    if ($eyebrow)     $eyebrow.dataset.state   = "proxy";
    if ($signalLabel) $signalLabel.textContent = "SOVEREIGN PROXY";
  } else {
    if ($signalDot)   $signalDot.dataset.state = "armed";
    if ($eyebrow)     $eyebrow.dataset.state   = "armed";
    if ($signalLabel) $signalLabel.textContent = "UPLINK READY";
  }

  // ── Agent roster ────────────────────────────────────────────────────────
  (async () => {
    const $agentCountCell = document.getElementById("uplink-tele-agent-count");
    try {
      const filenames = await fetchJSON("glass/data/llm-agents/index.json");
      if (!Array.isArray(filenames) || !filenames.length) {
        if ($agentCountCell) $agentCountCell.textContent = "0";
        return;
      }
      const results = await Promise.allSettled(
        filenames
          .filter(f => f.replace(/\.json$/i, "") !== "default")
          .map(f => fetchJSON(`glass/data/llm-agents/${f}`).then(card => ({ f, card })))
      );
      let added = 0;
      results.forEach((r) => {
        if (r.status !== "fulfilled") return;
        const { f, card } = r.value;
        const data = card.spec ? card.data : card;
        const id   = f.replace(/\.json$/i, "");
        const name = data.name ?? id;
        const opt  = document.createElement("option");
        opt.value = id;
        opt.textContent = name;
        if (data.tags?.length) opt.title = data.tags.join(", ");
        $agentSelect.appendChild(opt);
        added++;
      });
      if ($agentCountCell) $agentCountCell.textContent = String(added);
    } catch (e) {
      if ($agentCountCell) $agentCountCell.textContent = "0";
      console.warn("[uplink] agent roster unavailable:", e.message);
    }
  })();

  // ── Auto-resize prompt textarea ─────────────────────────────────────────
  $prompt.addEventListener("input", () => {
    $prompt.style.height = "auto";
    $prompt.style.height = Math.min($prompt.scrollHeight, 160) + "px";
  });

  // ── Enter-to-transmit (Shift+Enter = newline) ───────────────────────────
  $prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $form.requestSubmit();
    }
  });

  // ── Submit — hand off to /playground/ with URL params ───────────────────
  $form.addEventListener("submit", (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    const text   = $prompt.value.trim();
    const agent  = $agentSelect.value;
    if (text)  params.set("q", text);
    if (agent) params.set("agent", agent);
    const qs   = params.toString();
    const href = qs ? `/playground/?${qs}` : "/playground/";
    window.location.href = href;
  });
}

/* ═══════════════════════════════════════════════
   ── Social Signal Cluster ─────────────────────
   Fixed floating orbital node group. Reads
   config.socials and bursts open on click.
   ═══════════════════════════════════════════════ */
function renderSocialCluster() {
  const $root = document.getElementById("social-cluster");
  if (!$root || !config?.socials) return;

  // Per-platform identity map
  const PLATFORM = {
    github:  { label: "GITHUB",  accent: "var(--social-github-accent)",  glow: "var(--social-github-glow)",  subtle: "var(--social-github-subtle)",  icon: "github" },
    youtube: { label: "YOUTUBE", accent: "var(--social-youtube-accent)", glow: "var(--social-youtube-glow)", subtle: "var(--social-youtube-subtle)", icon: "youtube" },
    kick:    { label: "KICK",    accent: "var(--social-kick-accent)",    glow: "var(--social-kick-glow)",    subtle: "var(--social-kick-subtle)",    icon: "radio" },
    "ko-fi": { label: "KO-FI",  accent: "var(--social-kofi-accent)",   glow: "var(--social-kofi-glow)",   subtle: "var(--social-kofi-subtle)",   icon: "coffee" },
  };

  // Node arc layout — strict quarter-circle, r=110px, 90°→0° in 30° steps.
  // All buttons are 40px — minimum edge-to-edge gap at 30° step on r=110: ~57px. No overlap.
  const R = 110;
  const ARC = [90, 60, 30, 0].map(deg => {
    const rad = deg * Math.PI / 180;
    return {
      x: `${Math.round(R * Math.cos(rad))}px`,
      y: `${-Math.round(R * Math.sin(rad))}px`,
    };
  });

  const socials = Object.entries(config.socials);

  // Build nodes HTML
  let nodesHTML = "";
  socials.forEach(([key, url], i) => {
    const p     = PLATFORM[key] || { label: key.toUpperCase(), accent: "var(--accent)", glow: "var(--accent-glow)", subtle: "var(--accent-subtle)", icon: "external-link" };
    const arc   = ARC[i] || ARC[ARC.length - 1];
    const delay = `${i * 35}ms`;

    nodesHTML += `
      <div
        class="social-node"
        style="--sc-x:${arc.x};--sc-y:${arc.y};--sc-delay:${delay};--sc-node-accent:${p.accent};--sc-node-glow:${p.glow};--sc-node-subtle:${p.subtle};"
        data-platform="${esc(key)}"
      >
        <a
          href="${esc(url)}"
          target="_blank"
          rel="noopener noreferrer"
          class="social-node__btn"
          aria-label="${esc(p.label)} — ${esc(url)}"
          tabindex="-1"
        >
          <i data-lucide="${esc(p.icon)}"></i>
          <span class="social-node__pip" aria-hidden="true"></span>
        </a>
        <span class="social-node__label" aria-hidden="true">${esc(p.label)}</span>
      </div>`;
  });

  $root.innerHTML = `
    <button
      class="social-cluster__nucleus"
      aria-expanded="false"
      aria-controls="social-cluster-nodes"
      aria-label="Toggle social links"
    >
      <span class="social-cluster__grain" aria-hidden="true"></span>
      <span class="social-cluster__scan"  aria-hidden="true"></span>
      <span class="social-cluster__burst" aria-hidden="true"></span>
      <span class="social-cluster__nucleus-glyph" aria-hidden="true">//</span>
    </button>
    <div class="social-cluster__nodes" id="social-cluster-nodes" aria-hidden="true">
      ${nodesHTML}
    </div>
  `;

  const $nucleus = $root.querySelector(".social-cluster__nucleus");
  const $nodes   = $root.querySelector(".social-cluster__nodes");

  function open() {
    $root.classList.add("social-cluster--open");
    $nucleus.setAttribute("aria-expanded", "true");
    $nodes.setAttribute("aria-hidden", "false");
    // Make node links keyboard-reachable
    $nodes.querySelectorAll(".social-node__btn").forEach(a => a.removeAttribute("tabindex"));
  }

  function close() {
    $root.classList.remove("social-cluster--open");
    $nucleus.setAttribute("aria-expanded", "false");
    $nodes.setAttribute("aria-hidden", "true");
    $nodes.querySelectorAll(".social-node__btn").forEach(a => a.setAttribute("tabindex", "-1"));
  }

  function toggle() {
    $root.classList.contains("social-cluster--open") ? close() : open();
  }

  $nucleus.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });

  $nucleus.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!$root.contains(e.target)) close();
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $root.classList.contains("social-cluster--open")) close();
  });
}
