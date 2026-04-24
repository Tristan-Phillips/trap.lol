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
   PULL — RNG GACHA WITH RARITY + PITY
   ══════════════════════════════════════════════════
   Rarity tiers — player sees the tier AFTER the roll resolves.
   The count revealed is random within each tier's range.
   Pity silently adjusts weights; nothing is telegraphed.

   TRACE   — teal/green  — weight 50  — 3–6   imgs  — "a whisper through the sand"
   VEIL    — blue        — weight 28  — 6–10  imgs  — "something peers back"
   CIPHER  — purple      — weight 15  — 10–16 imgs  — "the seal is warm"
   SPICE   — gold        — weight  6  — 16–24 imgs  — "you found the source"
   ABYSS   — crimson     — weight  1  — all   imgs  — "there is no floor"

   Pity rules (silent, never displayed):
   • After 4 consecutive pulls below CIPHER, next pull is at minimum CIPHER.
   • After 7 consecutive pulls below SPICE,  next pull is at minimum SPICE.
   These floors reset once a qualifying tier lands.
*/
const TIERS = {
  TRACE:  {
    id: "trace",  weight: 50, min: 3,   max: 6,
    icon: "droplets",   color: "#2dd4a0",
    copy:    ["peek", "just a taste", "open one eye", "barely"],
    reveal:  ["a tremor in the dune", "something exhaled", "the sand shifted", "noticed"],
    whisper: ["you were not supposed to look", "stop. or don't.", "the air is different here", "hush"],
  },
  VEIL:   {
    id: "veil",   weight: 28, min: 6,   max: 10,
    icon: "eye",         color: "#5b8ef0",
    copy:    ["look closer", "pull it back", "go on", "you want to"],
    reveal:  ["the veil lifted", "more than expected", "it saw you too", "familiar"],
    whisper: ["don't tell anyone", "this is becoming a habit", "again?", "quietly now"],
  },
  CIPHER: {
    id: "cipher", weight: 15, min: 10,  max: 16,
    icon: "lock-keyhole", color: "#a855f7",
    copy:    ["crack it", "you shouldn't", "forbidden", "break the wax"],
    reveal:  ["the cipher broke open", "sealed no longer", "contraband", "you cracked it"],
    whisper: ["your pulse just changed", "warm hands on cold glass", "they'd kill for this", "breathe"],
  },
  SPICE:  {
    id: "spice",  weight: 6,  min: 16,  max: 24,
    icon: "flame",       color: "#f4a830",
    copy:    ["the source", "take it all", "melt into it", "burn"],
    reveal:  ["the spice flows", "golden ruin", "worth the risk", "intoxicating"],
    whisper: ["your eyes have changed colour", "there is no going back", "you knew this would happen", "gorgeous"],
  },
  ABYSS:  {
    id: "abyss",  weight: 1,  min: 999, max: 999,
    icon: "skull",       color: "#c41a1a",
    copy:    ["everything", "dissolve"],
    reveal:  ["total dissolution", "the floor is gone", "consumed", "there is no surface"],
    whisper: ["", ""],
  },
};

const TIER_ORDER = ["TRACE", "VEIL", "CIPHER", "SPICE", "ABYSS"];

/* Pity counters */
let pullCount        = 0;   /* total pulls made */
let sinceGeCipher    = 0;   /* pulls since last CIPHER or better */
let sinceGeSpice     = 0;   /* pulls since last SPICE or better */
let visibleCount     = 0;

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* Roll rarity tier — applies pity floors silently */
function rollTier() {
  const remaining = filtered.length - visibleCount;
  if (remaining <= 0) return null;

  /* Pity: force minimum tier if thresholds hit */
  let minTier = 0;
  if (sinceGeCipher >= 4) minTier = 2; /* at least CIPHER */
  if (sinceGeSpice  >= 7) minTier = 3; /* at least SPICE  */
  /* ABYSS special: if all remaining fits in a small pull, offer ABYSS sooner */
  if (remaining <= 8 && pullCount >= 2) minTier = Math.max(minTier, 4);

  /* Build weighted pool respecting minimum tier */
  const pool = [];
  TIER_ORDER.forEach((key, idx) => {
    if (idx < minTier) return;
    const t = TIERS[key];
    for (let i = 0; i < t.weight; i++) pool.push(key);
  });

  const rolledKey = pool[Math.floor(Math.random() * pool.length)];
  const tier      = TIERS[rolledKey];
  const tierIdx   = TIER_ORDER.indexOf(rolledKey);

  /* Update pity counters */
  if (tierIdx >= 2) sinceGeCipher = 0; else sinceGeCipher++;
  if (tierIdx >= 3) sinceGeSpice  = 0; else sinceGeSpice++;

  /* Calculate chunk */
  const count = tier.min >= 999
    ? remaining
    : Math.min(tier.min + Math.floor(Math.random() * (tier.max - tier.min + 1)), remaining);

  return { key: rolledKey, tier, count };
}

/* ══════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", async () => {
  /* Gate on the same media query the CSS uses — correctly handles BT mice,
     S-Pen, Apple Pencil with hover, and ignores pure-touch devices. */
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  if (finePointer.matches) initCursor();
  /* Re-evaluate if device changes (e.g. BT mouse connected mid-session) */
  finePointer.addEventListener("change", e => { if (e.matches) initCursor(); });
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
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function applyFilter(filter) {
  activeFilter = filter;
  filtered = shuffle(filter === "all"
    ? [...manifest]
    : manifest.filter(p => p.medium === filter));
  visibleCount  = 0;
  pullCount     = 0;
  sinceGeCipher = 0;
  sinceGeSpice  = 0;
  renderGrid();
}

function renderGrid() {
  const old = qs("#pull-zone");
  if (old) old.remove();

  const $grid = qs("#art-grid");
  $grid.innerHTML = "";

  if (!filtered.length) {
    $grid.innerHTML = `<span class="art-grid--empty">[ no signal ]</span>`;
    return;
  }

  /* Initial load: 18 fixed, no tier, no fanfare */
  visibleCount = Math.min(18, filtered.length);

  const frag = document.createDocumentFragment();
  for (let i = 0; i < visibleCount; i++) frag.appendChild(makeCard(filtered[i], i));
  $grid.appendChild(frag);

  if (typeof lucide !== "undefined") lucide.createIcons();
  initCardEntrance();
  renderPullZone();
}

function renderPullZone() {
  const old = qs("#pull-zone");
  if (old) old.remove();

  const remaining = filtered.length - visibleCount;
  if (remaining <= 0) return;

  /* Pre-roll copy is always generic — rarity is unknown until the pull */
  const preWhisper = pickRandom([
    "something waits beneath the fold",
    "don't look if you can't handle it",
    "you already know you're going to",
    "the surface is a lie",
    "reach in",
  ]);

  const $zone = document.createElement("div");
  $zone.id        = "pull-zone";
  $zone.className = "pull-zone";

  $zone.innerHTML = `
    <div class="pull-zone__scan" aria-hidden="true">
      <span class="pull-zone__scan-line"></span>
      <span class="pull-zone__scan-line"></span>
      <span class="pull-zone__scan-line"></span>
    </div>

    <button class="pull-btn" id="pull-btn" aria-label="Reveal more artwork">
      <span class="pull-btn__bg"        aria-hidden="true"></span>
      <span class="pull-btn__halo"      aria-hidden="true"></span>
      <span class="pull-btn__inner">
        <span class="pull-btn__rarity-wrap" aria-hidden="true">
          <i data-lucide="help-circle" class="pull-btn__rarity-icon"></i>
        </span>
        <span class="pull-btn__cta">reach in</span>
        <span class="pull-btn__count-wrap">
          <span class="pull-btn__count">?</span>
          <span class="pull-btn__count-label">fragments</span>
        </span>
      </span>
      <span class="pull-btn__sweep" aria-hidden="true"></span>
    </button>

    <p class="pull-zone__whisper" id="pull-whisper">${preWhisper}</p>
    <p class="pull-zone__remain"  id="pull-remain" aria-label="${remaining} images remaining">${remaining} in the dark</p>
  `;

  qs("#art-grid").after($zone);
  requestAnimationFrame(() => $zone.classList.add("pull-zone--visible"));

  qs("#pull-btn").addEventListener("click", executePull);
}

function executePull() {
  const $btn     = qs("#pull-btn");
  const $zone    = qs("#pull-zone");
  const $whisper = qs("#pull-whisper");
  const $count   = $btn && $btn.querySelector(".pull-btn__count");
  const $cta     = $btn && $btn.querySelector(".pull-btn__cta");
  const $icon    = $btn && $btn.querySelector(".pull-btn__rarity-icon");

  if (!$btn || $btn.disabled) return;
  $btn.disabled = true;
  $btn.classList.add("pull-btn--rolling");

  /* Spin glyphs while rolling */
  const GLYPHS = ["✦", "◈", "⬡", "✧", "◆", "⬟", "✵", "✴"];
  let gf = 0;
  const spin = setInterval(() => {
    if ($count) $count.textContent = GLYPHS[gf++ % GLYPHS.length];
  }, 60);

  /* Whisper cycles while rolling */
  const ROLLING_WHISPERS = [
    "reaching…", "finding…", "it knows…", "hold still…", "almost…",
  ];
  let wf = 0;
  const wSpin = setInterval(() => {
    if ($whisper) $whisper.textContent = ROLLING_WHISPERS[wf++ % ROLLING_WHISPERS.length];
  }, 200);

  /* Roll happens NOW — result hidden until timeout */
  const result = rollTier();

  setTimeout(() => {
    clearInterval(spin);
    clearInterval(wSpin);

    if (!result) { renderPullZone(); return; }

    const { tier, count } = result;

    /* Reveal rarity — update button styling */
    $btn.classList.remove("pull-btn--rolling");
    $btn.classList.add(`pull-btn--${tier.id}`, "pull-btn--revealed");
    if ($zone) $zone.classList.add(`pull-zone--${tier.id}`);

    /* Swap icon to tier icon */
    if ($icon) {
      $icon.setAttribute("data-lucide", tier.icon);
      if (typeof lucide !== "undefined") lucide.createIcons({ nodes: [$icon.parentElement] });
    }

    /* Show count + tier copy */
    if ($count) $count.textContent = `+${count}`;
    if ($cta)   $cta.textContent   = pickRandom(tier.copy);
    if ($whisper) $whisper.textContent = pickRandom(tier.reveal);

    /* Flash the rarity colour across the zone */
    flashRarity($zone, tier.color);

    /* Inject cards after reading the reveal */
    setTimeout(() => {
      const $grid = qs("#art-grid");
      const start = visibleCount;
      const end   = start + count;
      const frag  = document.createDocumentFragment();

      for (let i = start; i < end; i++) frag.appendChild(makeCard(filtered[i], i));
      $grid.appendChild(frag);

      visibleCount = end;
      pullCount++;

      if (typeof lucide !== "undefined") lucide.createIcons();
      initCardEntrance();

      /* Scroll so first new card just enters view */
      const firstNew = $grid.querySelectorAll(".art-card")[start];
      if (firstNew) firstNew.scrollIntoView({ behavior: "smooth", block: "nearest" });

      renderPullZone();
    }, 480);
  }, 780);
}

/* Brief colour flash behind the zone on reveal */
function flashRarity($zone, color) {
  if (!$zone) return;
  const $flash = document.createElement("span");
  $flash.className = "pull-zone__flash";
  $flash.style.setProperty("--flash-color", color);
  $zone.appendChild($flash);
  $flash.addEventListener("animationend", () => $flash.remove());
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
  /* Tag portrait images once dimensions are known — CSS uses this on single-column only */
  $thumb.addEventListener("load", () => {
    if ($thumb.naturalHeight > $thumb.naturalWidth) $card.classList.add("art-card--portrait");
  }, { once: true });

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
  document.body.classList.add("lb-open");
  document.body.style.overflow = "hidden";
  /* Defer focus so the entrance animation has started */
  requestAnimationFrame(() => qs("#lb-close").focus());
}

function closeLightbox() {
  _lb_open = false;
  const $lb = qs("#lightbox");
  $lb.classList.add("hidden");
  $lb.setAttribute("aria-hidden", "true");
  document.body.classList.remove("lb-open");
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

  /* ── Swipe gestures ──────────────────────────────────────────────
     Horizontal: navigate prev/next (existing behaviour)
     Vertical ↓ : drag-to-dismiss — live drag on the inner, close on release
     The panel scroll area is excluded so the user can still scroll metadata.
  ─────────────────────────────────────────────────────────────── */
  const $lb     = qs("#lightbox");
  const $inner  = qs(".lightbox__inner");
  let _tx = null, _ty = null;
  let _dragging = false;

  $lb.addEventListener("touchstart", e => {
    /* Don't hijack scrollable panel touches */
    if (e.target.closest(".lightbox__panel")) return;
    _tx = e.touches[0].clientX;
    _ty = e.touches[0].clientY;
    _dragging = false;
  }, { passive: true });

  $lb.addEventListener("touchmove", e => {
    if (_ty === null) return;
    /* Don't hijack panel scroll */
    if (e.target.closest(".lightbox__panel")) return;
    const dy = e.touches[0].clientY - _ty;
    const dx = e.touches[0].clientX - _tx;
    /* Only activate vertical drag if motion is more downward than horizontal */
    if (!_dragging && Math.abs(dy) < 8) return;
    if (!_dragging && Math.abs(dx) > Math.abs(dy)) return; /* horizontal wins → let nav handle */
    if (dy < 0) return; /* no upward drag */
    _dragging = true;
    /* Live drag: translate inner and dim the backdrop */
    const progress = Math.min(dy / 260, 1);
    $inner.style.transform  = `translateY(${dy * 0.72}px) scale(${1 - progress * 0.06})`;
    $inner.style.opacity    = String(1 - progress * 0.55);
    $inner.style.transition = "none";
    $lb.style.background    = `rgba(4, 2, 8, ${0.97 - progress * 0.55})`;
  }, { passive: true });

  $lb.addEventListener("touchend", e => {
    if (_tx === null || _ty === null) return;
    const dx = e.changedTouches[0].clientX - _tx;
    const dy = e.changedTouches[0].clientY - _ty;

    if (_dragging) {
      /* Dismiss if dragged > 100px down or released with enough velocity */
      if (dy > 100) {
        /* Animate out then close */
        $inner.style.transition = "transform 0.22s cubic-bezier(0.4, 0, 1, 1), opacity 0.22s ease";
        $inner.style.transform  = "translateY(100%) scale(0.94)";
        $inner.style.opacity    = "0";
        setTimeout(() => {
          closeLightbox();
          /* Reset inline styles after close */
          $inner.style.transform  = "";
          $inner.style.opacity    = "";
          $inner.style.transition = "";
          $lb.style.background    = "";
        }, 220);
      } else {
        /* Snap back */
        $inner.style.transition = "transform 0.35s cubic-bezier(0.34, 1.3, 0.64, 1), opacity 0.25s ease";
        $inner.style.transform  = "";
        $inner.style.opacity    = "";
        $lb.style.background    = "";
        /* Clean up transition after snap */
        setTimeout(() => { $inner.style.transition = ""; }, 360);
      }
    } else if (!_dragging && Math.abs(dx) > 50 && Math.abs(dy) < 60) {
      /* Horizontal swipe — navigate */
      navigate(dx < 0 ? 1 : -1);
    }

    _tx = null; _ty = null; _dragging = false;
  }, { passive: true });
}

/* ══════════════════════════════════════════════════
   CURSOR ORB
══════════════════════════════════════════════════ */
function initCursor() {
  const $orb = qs("#cursor-orb");
  if (!$orb) return;

  /* Guard: only run once even if matchMedia fires multiple times */
  if ($orb.dataset.init) return;
  $orb.dataset.init = "1";

  let mx = -100, my = -100;
  let ax = -100, ay = -100;
  let raf;
  let visible = false;

  function show() {
    if (visible) return;
    visible = true;
    $orb.style.opacity = "1";
  }
  function hide() {
    visible = false;
    $orb.style.opacity = "0";
  }

  document.addEventListener("mousemove", e => {
    mx = e.clientX;
    my = e.clientY;
    show(); /* reveal on first actual pointer movement */
  }, { passive: true });

  document.addEventListener("mousedown", () => $orb.classList.add("pressed"));
  document.addEventListener("mouseup",   () => $orb.classList.remove("pressed"));

  document.addEventListener("mouseover", e => {
    $orb.classList.toggle("hovering",
      !!e.target.closest("a, button, [role=button], label, .art-card, .lightbox__nav, .lightbox__close, .filter-btn, .back-link"));
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

  document.addEventListener("mouseleave", hide);
  document.addEventListener("mouseenter", () => { show(); if (!raf) raf = requestAnimationFrame(tick); });
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
