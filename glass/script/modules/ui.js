import { config, hostingData, toolsData, botsData, extData, guideData, esc, renderError, globalRouter, IS_TOUCH } from './core.js';

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
      let html = "";
      Object.values(toolsData.manifest).forEach((tool) => {
        
        // Register atomic command to Global Router
        if (tool.shortcut) {
          globalRouter.set(tool.shortcut.toLowerCase(), { type: 'copy', payload: tool.install_cmd });
        }

        html += `
          <div class="tool-card">
            <div class="tool-card__header">
              <i data-lucide="${esc(tool.icon)}"></i>
              <span class="tool-card__name">${esc(tool.name)}</span>
              ${tool.shortcut ? `<span class="tool-card__shortcut">[${esc(tool.shortcut)}]</span>` : ""}
              <span class="tool-card__target">${esc(tool.target)}</span>
            </div>
            <p class="tool-card__desc">${esc(tool.description)}</p>
            <div class="tool-card__cmd">
              <code>${esc(tool.install_cmd)}</code>
              <button class="tool-card__copy" aria-label="Copy install command" data-cmd="${esc(tool.install_cmd)}">
                <i data-lucide="copy"></i>
              </button>
            </div>
            <a href="${esc(tool.repo_url)}" target="_blank" rel="noopener" class="tool-card__link" aria-label="View ${esc(tool.name)} source on Forgejo">
              <i data-lucide="git-branch"></i> Source
            </a>
          </div>
        `;
      });
      $toolsContainer.innerHTML = html;
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

        html += `
          <div class="bot-profile">
            <div class="bot-avatar" tabindex="0" aria-label="${esc(bot.name)}: ${esc(bot.description)}">
              <i data-lucide="${esc(bot.icon)}"></i>
              <div class="bot-status ${esc(bot.status)}"></div>
            </div>
            <div class="agent-tooltip" role="tooltip">
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
                <div class="ext-zone">
                  <div class="ext-zone-title"><i data-lucide="skull"></i> Undercity</div>
                  ${linksHTML}
                </div>
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
      const $body       = $cat.querySelector(".ext-category__body");
      const containerRect = $extContainer.getBoundingClientRect();
      const catRect       = $cat.getBoundingClientRect();
      $body.style.left  = `${containerRect.left - catRect.left}px`;
      $body.style.width = `${containerRect.width}px`;
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
        positionOverlay($cat);
        $cat.classList.add("ext-category--open");
        $btn.setAttribute("aria-expanded", "true");
      }
    });

    document.addEventListener("click", (e) => {
      if (!$extContainer.contains(e.target)) closeAll();
    });

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

  // ── 9. Init Lucide icons ─────────────────────────────────────────────────
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  } else {
    console.warn("[lucide] library not available — icons will not render.");
  }

  // ── 9b. Carousel arrow initial state (after layout) ──────────────────────
  requestAnimationFrame(updateArrows);

  // ── 10. Copy-to-clipboard (Ordnance Depot) ───────────────────────────────
  document.addEventListener("click", (e) => {
    const $btn = e.target.closest(".tool-card__copy");
    if (!$btn) return;
    const cmd = $btn.dataset.cmd;
    navigator.clipboard
      .writeText(cmd)
      .then(() => {
        $btn.classList.add("tool-card__copy--copied");
        setTimeout(
          () => $btn.classList.remove("tool-card__copy--copied"),
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
