/* trap.lol/art — ECHOES
   Gallery script. Data-driven. No frameworks.
   GPL-3.0 — trap.lol */

const DATA_PATH = "glass/data/detention.json";

/* ── CDN shards (fallback chain mirrors main site) ── */
const LUCIDE_CDN    = "https://cdn.trap.lol/shards/lucide.min.js";
const LUCIDE_LOCAL  = "/shards/lucide.min.js";
const LUCIDE_PUB    = "https://unpkg.com/lucide@latest/dist/umd/lucide.min.js";

/* ── State ── */
let manifest = [];      // full loaded array
let filtered = [];      // currently displayed
let currentIdx = 0;     // lightbox index into filtered[]
let _lb_open = false;
let activeFilter = "all";

/* ══════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", async () => {
  initCursor();
  initParticles();
  await loadShard();
  await loadData();
  bindUI();
});

/* ── Shard loader ── */
function loadShard() {
  return new Promise(resolve => {
    function tryLoad(src, next) {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => next ? tryLoad(next[0], next.slice(1)) : resolve();
      document.head.appendChild(s);
    }
    tryLoad(LUCIDE_CDN, [LUCIDE_LOCAL, LUCIDE_PUB]);
  });
}

/* ── Fetch data ── */
async function loadData() {
  try {
    const res = await fetch(DATA_PATH);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();

    const site = data.site || {};
    qs("#art-eyebrow").textContent  = site.eyebrow  || "";
    qs("#art-title").textContent    = site.title     || "ECHOES";
    qs("#art-subtitle").textContent = site.subtitle  || "";

    manifest = Array.isArray(data.manifest) ? data.manifest : [];
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
  filtered.forEach((piece, i) => {
    const $card = makeCard(piece, i);
    frag.appendChild($card);
  });
  $grid.appendChild(frag);

  /* init icons after injection */
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function makeCard(piece, idx) {
  const $card = document.createElement("div");
  $card.className = "art-card";
  $card.setAttribute("tabindex", "0");
  $card.setAttribute("role", "button");
  $card.setAttribute("aria-label", `View artwork ${idx + 1}`);
  $card.dataset.idx = idx;

  /* thumbnail */
  const $thumb = document.createElement("img");
  $thumb.className = "art-card__thumb";
  $thumb.loading = "lazy";
  $thumb.decoding = "async";
  $thumb.alt = "";
  $thumb.src = piece.thumb || piece.src || "";

  /* medium icon top-right */
  const $medIcon = document.createElement("div");
  $medIcon.className = "art-card__medium-icon";
  $medIcon.setAttribute("aria-hidden", "true");
  if (piece.medium === "digital") {
    $medIcon.innerHTML = `<i data-lucide="monitor" style="width:12px;height:12px;"></i>`;
  } else {
    $medIcon.innerHTML = `<i data-lucide="pen-tool" style="width:12px;height:12px;"></i>`;
  }

  /* hover overlay */
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

  /* open lightbox */
  $card.addEventListener("click", () => openLightbox(idx));
  $card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLightbox(idx); }
  });

  return $card;
}

/* ══════════════════════════════════════════════════
   LIGHTBOX
══════════════════════════════════════════════════ */
function openLightbox(idx) {
  currentIdx = idx;
  _lb_open = true;
  populateLightbox(filtered[idx]);
  qs("#lightbox").classList.remove("hidden");
  qs("#lightbox").removeAttribute("aria-hidden");
  qs("#lb-close").focus();
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  _lb_open = false;
  qs("#lightbox").classList.add("hidden");
  qs("#lightbox").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function navigate(dir) {
  const next = (currentIdx + dir + filtered.length) % filtered.length;
  currentIdx = next;
  populateLightbox(filtered[next]);
}

function populateLightbox(piece) {
  if (!piece) return;

  /* image — fade transition */
  const $img = qs("#lb-img");
  $img.classList.add("loading");
  const newSrc = piece.src || piece.thumb || "";
  $img.onload = () => $img.classList.remove("loading");
  $img.onerror = () => $img.classList.remove("loading");
  $img.src = newSrc;
  $img.alt = "";

  /* download link */
  qs("#lb-download").href = newSrc;

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
    const $label = document.createTextNode(piece.medium.toUpperCase());
    $med.appendChild($dot);
    $med.appendChild($label);
  }

  /* description */
  const $desc = qs("#lb-desc");
  $desc.textContent = piece.description || "";

  /* verse */
  const $verse = qs("#lb-verse");
  $verse.textContent = piece.verse || "";

  /* stats */
  const $stats = qs("#lb-stats");
  $stats.innerHTML = "";
  const s = piece.stats;
  if (s) {
    const statDefs = [
      { key: "mood", icon: "activity", label: s.mood },
    ];
    statDefs.forEach(({ key, icon, label }) => {
      if (!label) return;
      const $row = document.createElement("div");
      $row.className = "lb-stat";
      $row.innerHTML = `
        <span class="lb-stat__key">
          <i data-lucide="${esc(icon)}" style="width:12px;height:12px;"></i>
          ${esc(key)}
        </span>
        <span class="lb-stat__val">${esc(String(label))}</span>
      `;
      $stats.appendChild($row);
    });

    /* chaos meter */
    if (typeof s.chaos === "number") {
      const $chaosRow = document.createElement("div");
      $chaosRow.innerHTML = `
        <div class="lb-stat" style="margin-bottom:0.2rem">
          <span class="lb-stat__key">
            <i data-lucide="zap" style="width:12px;height:12px;"></i>
            chaos
          </span>
          <span class="lb-stat__val">${esc(String(s.chaos))}%</span>
        </div>
        <div class="lb-chaos-bar">
          <div class="lb-chaos-fill" style="width: ${Math.min(100, Math.max(0, s.chaos))}%"></div>
        </div>
      `;
      $stats.appendChild($chaosRow);
    }
  }

  if (typeof lucide !== "undefined") lucide.createIcons();
}

/* ══════════════════════════════════════════════════
   UI BINDINGS
══════════════════════════════════════════════════ */
function bindUI() {
  /* filter buttons */
  qsa(".filter-btn").forEach($btn => {
    $btn.addEventListener("click", () => {
      qsa(".filter-btn").forEach(b => b.classList.remove("active"));
      $btn.classList.add("active");
      applyFilter($btn.dataset.filter);
    });
  });

  /* lightbox controls */
  qs("#lb-close").addEventListener("click", closeLightbox);
  qs("#lb-prev").addEventListener("click", () => navigate(-1));
  qs("#lb-next").addEventListener("click", () => navigate(1));

  /* close on backdrop click */
  qs("#lightbox").addEventListener("click", e => {
    if (e.target === qs("#lightbox")) closeLightbox();
  });

  /* keyboard */
  document.addEventListener("keydown", e => {
    if (!_lb_open) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft")  navigate(-1);
    if (e.key === "ArrowRight") navigate(1);
  });

  /* swipe */
  let _touchX = null;
  qs("#lightbox").addEventListener("touchstart", e => { _touchX = e.touches[0].clientX; }, { passive: true });
  qs("#lightbox").addEventListener("touchend", e => {
    if (_touchX === null) return;
    const dx = e.changedTouches[0].clientX - _touchX;
    if (Math.abs(dx) > 50) navigate(dx < 0 ? 1 : -1);
    _touchX = null;
  }, { passive: true });
}

/* ══════════════════════════════════════════════════
   CURSOR ORB
══════════════════════════════════════════════════ */
function initCursor() {
  const $orb = qs("#cursor-orb");
  if (!$orb) return;

  /* hide on touch devices */
  if ("ontouchstart" in window) {
    $orb.style.display = "none";
    document.body.style.cursor = "auto";
    document.querySelectorAll("a,button,[role=button],label").forEach(el => {
      el.style.cursor = "auto";
    });
    return;
  }

  let mx = -100, my = -100;
  let ax = -100, ay = -100;
  let raf;

  document.addEventListener("mousemove", e => { mx = e.clientX; my = e.clientY; }, { passive: true });
  document.addEventListener("mousedown", () => $orb.classList.add("pressed"));
  document.addEventListener("mouseup",   () => $orb.classList.remove("pressed"));

  /* hover detection */
  document.addEventListener("mouseover", e => {
    if (e.target.closest("a,button,[role=button],label,.art-card")) {
      $orb.classList.add("hovering");
    } else {
      $orb.classList.remove("hovering");
    }
  });

  function lerp(a, b, t) { return a + (b - a) * t; }

  function tick() {
    ax = lerp(ax, mx, 0.14);
    ay = lerp(ay, my, 0.14);
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

  /* skip on reduced motion */
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    $c.style.display = "none";
    return;
  }

  const ctx = $c.getContext("2d");
  let W, H, particles;

  function resize() {
    W = $c.width  = window.innerWidth;
    H = $c.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize, { passive: true });

  const COUNT = 55;
  const COLORS = [
    "rgba(190,41,236,",   /* magenta */
    "rgba(244,168,48,",   /* amber */
    "rgba(196,86,42,",    /* rust */
    "rgba(139,92,246,",   /* violet */
  ];

  function mkParticle() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.4 + Math.random() * 1.4,
      vx: (Math.random() - 0.5) * 0.18,
      vy: -0.05 - Math.random() * 0.15,
      alpha: 0.1 + Math.random() * 0.35,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 0,
      maxLife: 180 + Math.random() * 240,
    };
  }

  particles = Array.from({ length: COUNT }, mkParticle);

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach((p, i) => {
      p.life++;
      p.x += p.vx;
      p.y += p.vy;

      /* fade in/out */
      const progress = p.life / p.maxLife;
      const fade = progress < 0.2
        ? progress / 0.2
        : progress > 0.8
          ? 1 - (progress - 0.8) / 0.2
          : 1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color + (p.alpha * fade) + ")";
      ctx.fill();

      if (p.life >= p.maxLife || p.x < -10 || p.x > W + 10 || p.y < -10) {
        particles[i] = mkParticle();
        particles[i].y = H + 5;
      }
    });
    requestAnimationFrame(draw);
  }
  draw();
}

/* ══════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════ */
function qs(sel) { return document.querySelector(sel); }
function qsa(sel) { return document.querySelectorAll(sel); }

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
