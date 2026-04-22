/* trap.lol/art — ECHOES
   Gallery script. Data-driven. No frameworks.
   GPL-3.0 — trap.lol */

const DATA_PATH = "glass/data/detention.json";

const LUCIDE_CDN   = "https://cdn.trap.lol/shards/lucide.min.js";
const LUCIDE_LOCAL = "/shards/lucide.min.js";
const LUCIDE_PUB   = "https://unpkg.com/lucide@latest/dist/umd/lucide.min.js";

/* ── State ── */
let manifest    = [];
let filtered    = [];
let currentIdx  = 0;
let _lb_open    = false;
let activeFilter = "all";

/* ══════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", async () => {
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (!isTouch) initCursor();
  initParticles();
  await loadShard();
  await loadData();
  bindUI();
});

/* ── Shard loader ── */
function loadShard() {
  return new Promise(resolve => {
    function tryLoad(src, fallbacks) {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => fallbacks.length ? tryLoad(fallbacks[0], fallbacks.slice(1)) : resolve();
      document.head.appendChild(s);
    }
    tryLoad(LUCIDE_CDN, [LUCIDE_LOCAL, LUCIDE_PUB]);
  });
}

/* ── Fetch + populate header ── */
async function loadData() {
  try {
    const res = await fetch(DATA_PATH);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();

    const meta = data.meta || {};
    const site = meta.site || {};
    const baseUrl = (meta.baseUrl || "").replace(/\/$/, "");

    qs("#art-eyebrow").textContent  = site.eyebrow  || "";
    qs("#art-title").textContent    = site.title     || "ECHOES";
    qs("#art-subtitle").textContent = site.subtitle  || "";

    /* Flatten all collections into one manifest, resolving URLs and
       normalising fields so the rest of the pipeline is format-agnostic. */
    manifest = (data.collections || []).flatMap(col =>
      (col.artifacts || []).map(a => {
        const m = a.metadata || {};
        return {
          _id:         a.compositeId || a.id,
          thumb:       baseUrl ? `${baseUrl}/${a.src.small}`    : a.src.small,
          src:         baseUrl ? `${baseUrl}/${a.src.original}` : a.src.original,
          tags:        Array.isArray(a.tags) ? a.tags : [],
          uploadDate:  a.uploadDate  || null,
          collection:  col.name      || col.id,
          /* metadata fields */
          medium:      m.medium      || null,
          description: m.description || null,
          verse:       m.verse       || null,
          stats: (m.mood != null || m.chaos != null) ? {
            mood:  m.mood  ?? null,
            chaos: m.chaos ?? null,
          } : null,
        };
      })
    );

    applyFilter(activeFilter);
  } catch (e) {
    console.error("[echoes] Failed to load detention.json:", e);
    qs("#art-grid").innerHTML =
      `<span class="art-grid--empty">[ signal lost — reload to retry ]</span>`;
  }
}

/* ══════════════════════════════════════════════════
   RENDER
══════════════════════════════════════════════════ */
function applyFilter(filter) {
  activeFilter = filter;
  filtered = filter === "all"
    ? [...manifest]
    : manifest.filter(p => p.medium === filter);
  renderGrid();
}

function renderGrid() {
  const $grid = qs("#art-grid");
  $grid.innerHTML = "";

  if (!filtered.length) {
    $grid.innerHTML = `<span class="art-grid--empty">[ no signal ]</span>`;
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach((piece, i) => frag.appendChild(makeCard(piece, i)));
  $grid.appendChild(frag);

  if (typeof lucide !== "undefined") lucide.createIcons();
  initCardEntrance();
}

function makeCard(piece, idx) {
  const $card = document.createElement("div");
  $card.className = "art-card";
  $card.setAttribute("tabindex", "0");
  $card.setAttribute("role", "button");
  $card.setAttribute("aria-label", `Open artwork ${idx + 1}`);
  $card.dataset.idx = idx;

  const $thumb = document.createElement("img");
  $thumb.className = "art-card__thumb";
  $thumb.loading = "lazy";
  $thumb.decoding = "async";
  $thumb.alt = "";
  $thumb.src = piece.thumb || piece.src || "";

  const $medIcon = document.createElement("div");
  $medIcon.className = "art-card__medium-icon";
  $medIcon.setAttribute("aria-hidden", "true");
  $medIcon.innerHTML = piece.medium === "digital"
    ? `<i data-lucide="monitor" style="width:12px;height:12px;"></i>`
    : `<i data-lucide="pen-tool" style="width:12px;height:12px;"></i>`;

  const $overlay = document.createElement("div");
  $overlay.className = "art-card__overlay";
  $overlay.setAttribute("aria-hidden", "true");

  if (piece.tags?.length) {
    const $tags = document.createElement("div");
    $tags.className = "art-card__tags";
    piece.tags.slice(0, 3).forEach(t => {
      const $t = document.createElement("span");
      $t.className = "art-card__tag";
      $t.textContent = t;
      $tags.appendChild($t);
    });
    $overlay.appendChild($tags);
  }

  $card.append($thumb, $medIcon, $overlay);

  $card.addEventListener("click", () => openLightbox(idx));
  $card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLightbox(idx); }
  });

  return $card;
}

/* Staggered entrance via IntersectionObserver */
function initCardEntrance() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    qsa(".art-card").forEach($c => $c.classList.add("visible"));
    return;
  }

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const $card = entry.target;
      const delay = Number($card.dataset.idx) * 45;
      setTimeout(() => $card.classList.add("visible"), Math.min(delay, 400));
      obs.unobserve($card);
    });
  }, { threshold: 0.08 });

  qsa(".art-card").forEach($c => obs.observe($c));
}

/* ══════════════════════════════════════════════════
   LIGHTBOX
══════════════════════════════════════════════════ */
function openLightbox(idx) {
  currentIdx = idx;
  _lb_open = true;
  populateLightbox(filtered[idx]);
  const $lb = qs("#lightbox");
  $lb.classList.remove("hidden");
  $lb.removeAttribute("aria-hidden");
  qs("#lb-close").focus();
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  _lb_open = false;
  const $lb = qs("#lightbox");
  $lb.classList.add("hidden");
  $lb.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function navigate(dir) {
  currentIdx = (currentIdx + dir + filtered.length) % filtered.length;
  populateLightbox(filtered[currentIdx]);
}

function populateLightbox(piece) {
  if (!piece) return;

  /* image fade */
  const $img = qs("#lb-img");
  $img.classList.add("loading");
  $img.onload  = () => $img.classList.remove("loading");
  $img.onerror = () => $img.classList.remove("loading");
  $img.src = piece.src || piece.thumb || "";
  $img.alt = "";

  qs("#lb-download").href = $img.src;

  /* tags */
  const $tags = qs("#lb-tags");
  $tags.innerHTML = "";
  (piece.tags || []).forEach(t => {
    const $t = document.createElement("span");
    $t.className = "lb-tag";
    $t.textContent = t;
    $tags.appendChild($t);
  });

  /* medium */
  const $med = qs("#lb-medium");
  $med.innerHTML = "";
  if (piece.medium) {
    const $dot = document.createElement("span");
    $dot.className = "lb-medium-dot";
    $med.appendChild($dot);
    $med.appendChild(document.createTextNode(piece.medium.toUpperCase()));
  }

  /* description */
  qs("#lb-desc").textContent  = piece.description || "";
  qs("#lb-verse").textContent = piece.verse || "";

  /* stats */
  const $stats = qs("#lb-stats");
  $stats.innerHTML = "";
  const s = piece.stats;
  if (s) {
    if (s.mood) {
      const $row = document.createElement("div");
      $row.className = "lb-stat";
      $row.innerHTML = `
        <span class="lb-stat__key">
          <i data-lucide="activity" style="width:11px;height:11px;"></i>
          mood
        </span>
        <span class="lb-stat__val">${esc(s.mood)}</span>`;
      $stats.appendChild($row);
    }

    if (typeof s.chaos === "number") {
      const pct = Math.min(100, Math.max(0, s.chaos));
      const $row = document.createElement("div");
      $row.innerHTML = `
        <div class="lb-stat">
          <span class="lb-stat__key">
            <i data-lucide="zap" style="width:11px;height:11px;"></i>
            chaos
          </span>
          <span class="lb-stat__val">${esc(String(pct))}%</span>
        </div>
        <div class="lb-chaos-bar">
          <div class="lb-chaos-fill" style="width:${pct}%"></div>
        </div>`;
      $stats.appendChild($row);
    }
  }

  if (typeof lucide !== "undefined") lucide.createIcons({ nodes: [$stats, $med] });

  /* hide panel when there is no metadata to show */
  const hasContent =
    (piece.tags && piece.tags.length > 0) ||
    piece.medium ||
    piece.description ||
    piece.verse ||
    piece.stats;
  const $panel = qs("#lb-panel");
  $panel.classList.toggle("lightbox__panel--hidden", !hasContent);
}

/* ══════════════════════════════════════════════════
   UI BINDINGS
══════════════════════════════════════════════════ */
function bindUI() {
  qsa(".filter-btn").forEach($btn => {
    $btn.addEventListener("click", () => {
      qsa(".filter-btn").forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      $btn.classList.add("active");
      $btn.setAttribute("aria-pressed", "true");
      applyFilter($btn.dataset.filter);
    });
  });

  qs("#lb-close").addEventListener("click", closeLightbox);
  qs("#lb-prev").addEventListener("click", () => navigate(-1));
  qs("#lb-next").addEventListener("click", () => navigate(1));

  qs("#lightbox").addEventListener("click", e => {
    if (e.target === qs("#lightbox")) closeLightbox();
  });

  document.addEventListener("keydown", e => {
    if (!_lb_open) return;
    if (e.key === "Escape")     closeLightbox();
    if (e.key === "ArrowLeft")  navigate(-1);
    if (e.key === "ArrowRight") navigate(1);
  });

  /* swipe */
  let _tx = null;
  qs("#lightbox").addEventListener("touchstart", e => {
    _tx = e.touches[0].clientX;
  }, { passive: true });
  qs("#lightbox").addEventListener("touchend", e => {
    if (_tx === null) return;
    const dx = e.changedTouches[0].clientX - _tx;
    if (Math.abs(dx) > 50) navigate(dx < 0 ? 1 : -1);
    _tx = null;
  }, { passive: true });
}

/* ══════════════════════════════════════════════════
   CURSOR ORB
══════════════════════════════════════════════════ */
function initCursor() {
  const $orb = qs("#cursor-orb");
  if (!$orb) return;

  let mx = -100, my = -100;
  let ax = -100, ay = -100;
  let raf;

  document.addEventListener("mousemove", e => { mx = e.clientX; my = e.clientY; }, { passive: true });
  document.addEventListener("mousedown", () => $orb.classList.add("pressed"));
  document.addEventListener("mouseup",   () => $orb.classList.remove("pressed"));

  document.addEventListener("mouseover", e => {
    $orb.classList.toggle("hovering",
      !!e.target.closest("a, button, [role=button], label, .art-card"));
  });

  function lerp(a, b, t) { return a + (b - a) * t; }

  function tick() {
    ax = lerp(ax, mx, 0.13);
    ay = lerp(ay, my, 0.13);
    $orb.style.left = ax + "px";
    $orb.style.top  = ay + "px";
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  document.addEventListener("mouseleave", () => {
    cancelAnimationFrame(raf);
    $orb.style.opacity = "0";
  });
  document.addEventListener("mouseenter", () => {
    $orb.style.opacity = "1";
    raf = requestAnimationFrame(tick);
  });
}

/* ══════════════════════════════════════════════════
   PARTICLE CANVAS
══════════════════════════════════════════════════ */
function initParticles() {
  const $c = qs("#particle-canvas");
  if (!$c) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    $c.style.display = "none";
    return;
  }

  const ctx = $c.getContext("2d");
  let W, H, particles, raf;
  let paused = false;

  function resize() {
    W = $c.width  = window.innerWidth;
    H = $c.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize, { passive: true });

  /* pause when tab hidden */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      paused = true;
      cancelAnimationFrame(raf);
    } else {
      paused = false;
      raf = requestAnimationFrame(draw);
    }
  });

  const COLORS = [
    "rgba(190,41,236,",
    "rgba(244,168,48,",
    "rgba(196,86,42,",
    "rgba(139,92,246,",
  ];

  function mkParticle(fromBottom = false) {
    return {
      x: Math.random() * W,
      y: fromBottom ? H + 4 : Math.random() * H,
      r: 0.4 + Math.random() * 1.3,
      vx: (Math.random() - 0.5) * 0.16,
      vy: -0.05 - Math.random() * 0.14,
      alpha: 0.1 + Math.random() * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 0,
      maxLife: 200 + Math.random() * 220,
    };
  }

  particles = Array.from({ length: 52 }, () => mkParticle(false));

  function draw() {
    if (paused) return;
    ctx.clearRect(0, 0, W, H);

    particles.forEach((p, i) => {
      p.life++;
      p.x += p.vx;
      p.y += p.vy;

      const t = p.life / p.maxLife;
      const fade = t < 0.15 ? t / 0.15 : t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color + (p.alpha * fade) + ")";
      ctx.fill();

      if (p.life >= p.maxLife || p.x < -10 || p.x > W + 10 || p.y < -10) {
        particles[i] = mkParticle(true);
      }
    });

    raf = requestAnimationFrame(draw);
  }

  raf = requestAnimationFrame(draw);
}

/* ══════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════ */
function qs(sel)  { return document.querySelector(sel); }
function qsa(sel) { return document.querySelectorAll(sel); }

function esc(str) {
  return String(str)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}
