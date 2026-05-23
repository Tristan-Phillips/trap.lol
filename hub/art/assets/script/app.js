/* trap.lol/art — ECHOES
   Gallery script. Data-driven. No frameworks.
   GPL-3.0 — trap.lol */

const DATA_PATH = "assets/data/detention.json";

const LUCIDE_CDN   = "https://cdn.trap.lol/shards/lucide.min.js";
const LUCIDE_LOCAL = "/assets/shards/lucide.min.js";
const LUCIDE_PUB   = "https://unpkg.com/lucide@latest/dist/umd/lucide.min.js";

/* ── State ── */
let manifest    = [];
let filtered    = [];
let currentIdx  = 0;
let _lb_open    = false;
let activeFilter = "all";

/* ── Selection state ── */
const selected = new Map(); /* _id → piece */

/* ── NSFW state ── */
let nsfwUnlocked = false;

/* ── Image viewer transform state ── */
const VIEW = {
  scale:   1,
  tx:      0,      /* translate X (px) */
  ty:      0,      /* translate Y (px) */
  rot:     0,      /* rotation in degrees */
  flipH:   false,
  flipV:   false,
  fill:    false,  /* fill vs contain */
};

/* Clamp limits */
const ZOOM_MIN   = 0.15;
const ZOOM_MAX   = 8;
const ZOOM_STEP  = 0.25;  /* keyboard / button step */
const ZOOM_WHEEL = 0.12;  /* wheel sensitivity */

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
  bindToolbar();
  initPan();
  initWheel();
  initPinch();
  initSelPanel();
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
          medium:      a.type || m.medium || null,
          nsfw:        m.nsfw === true || a.nsfw === true,
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
  activeFilter  = filter;
  nsfwUnlocked  = filter === "nsfw";
  filtered = shuffle(
    filter === "all"   ? [...manifest] :
    filter === "nsfw"  ? manifest.filter(p => p.nsfw) :
    manifest.filter(p => p.medium === filter)
  );
  visibleCount  = 0;
  pullCount     = 0;
  sinceGeCipher = 0;
  sinceGeSpice  = 0;
  renderGrid();
}

async function renderGrid() {
  const old = qs("#pull-zone");
  if (old) old.remove();

  _gridColCursor = 0;

  const $grid = qs("#art-grid");
  $grid.innerHTML = "";

  if (!filtered.length) {
    $grid.innerHTML = `<span class="art-grid--empty">[ no signal ]</span>`;
    return;
  }

  /* Initial load: 18 fixed, no tier, no fanfare */
  visibleCount = Math.min(18, filtered.length);

  /* Probe orientations before injecting so spans are set before DOM placement */
  const orientations = await Promise.all(
    filtered.slice(0, visibleCount).map(p => probeOrientation(p.thumb || p.src || ""))
  );
  const spans = resolveSpans(orientations);

  const frag = document.createDocumentFragment();
  for (let i = 0; i < visibleCount; i++) frag.appendChild(makeCard(filtered[i], i, spans[i]));
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

async function executeFloodPull() {
  const $btn  = qs("#pull-btn");
  const $zone = qs("#pull-zone");
  if (!$btn || $btn.disabled) return;

  const remaining = filtered.length - visibleCount;
  if (remaining <= 0) return;

  $btn.disabled = true;

  const FLOOD_TIER = {
    id: "abyss", icon: "skull", color: "#c41a1a",
    copy: ["everything"], reveal: ["total dissolution"],
  };

  const $grid = qs("#art-grid");
  const start = visibleCount;
  const end   = filtered.length;

  const orientations = await Promise.all(
    filtered.slice(start, end).map(p => probeOrientation(p.thumb || p.src || ""))
  );
  const spans = resolveSpans(orientations);

  const frag = document.createDocumentFragment();
  const $divider = makePullDivider(FLOOD_TIER, end);
  frag.appendChild($divider);

  for (let i = start; i < end; i++) frag.appendChild(makeCard(filtered[i], i, spans[i - start]));
  $grid.appendChild(frag);

  visibleCount = end;
  pullCount++;

  if (typeof lucide !== "undefined") lucide.createIcons({ nodes: [$divider] });
  if (typeof lucide !== "undefined") lucide.createIcons();
  initCardEntrance();

  $divider.scrollIntoView({ behavior: "smooth", block: "start" });

  if ($zone) $zone.remove();
}

function executePull(e) {
  if (e && e.shiftKey) { executeFloodPull(); return; }

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

    /* Inject cards after reading the reveal — probe orientations first so
       grid-column spans are set before insertion (no reflow after paint) */
    setTimeout(async () => {
      const $grid = qs("#art-grid");
      const start = visibleCount;
      const end   = start + count;

      const orientations = await Promise.all(
        filtered.slice(start, end).map(p => probeOrientation(p.thumb || p.src || ""))
      );
      const spans = resolveSpans(orientations);

      const frag = document.createDocumentFragment();

      /* Divider spans the full grid width, sits above the new batch */
      const $divider = makePullDivider(tier, end);
      frag.appendChild($divider);

      for (let i = start; i < end; i++) frag.appendChild(makeCard(filtered[i], i, spans[i - start]));
      $grid.appendChild(frag);

      visibleCount = end;
      pullCount++;

      if (typeof lucide !== "undefined") lucide.createIcons({ nodes: [$divider] });
      if (typeof lucide !== "undefined") lucide.createIcons();
      initCardEntrance();

      /* Scroll to the divider so the user sees the boundary clearly */
      $divider.scrollIntoView({ behavior: "smooth", block: "start" });

      renderPullZone();
    }, 480);
  }, 780);
}

/* Pull divider — spans full grid row, shows tier color + running total */
function makePullDivider(tier, totalRevealed) {
  const $div = document.createElement("div");
  $div.className = `pull-divider pull-divider--${tier.id}`;
  $div.setAttribute("aria-hidden", "true");
  $div.style.setProperty("--divider-color", tier.color);

  $div.innerHTML = `
    <span class="pull-divider__line pull-divider__line--left"></span>
    <span class="pull-divider__label">
      <span class="pull-divider__icon"><i data-lucide="${tier.icon}"></i></span>
      <span class="pull-divider__count">${totalRevealed}</span>
      <span class="pull-divider__word">fragments</span>
    </span>
    <span class="pull-divider__line pull-divider__line--right"></span>
  `;
  return $div;
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

/* Probe image dimensions without inserting into DOM.
   Resolves immediately if the browser already has the image cached. */
function probeOrientation(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve(img.naturalWidth > img.naturalHeight * 1.15 ? "landscape" : "portrait");
    img.onerror = () => resolve("portrait");
    img.src = url;
  });
}

/* Tracks column cursor across all batches so pulls continue correctly */
let _gridColCursor = 0;

/* Given an array of orientations, return column spans (1 or 2 max).
   Landscape gets span 2 when ≥2 cols remain in the row.
   When only 1 col remains it falls back to span 1 — cropped cover,
   no empty cells, never stretches to 3. */
function resolveSpans(orientations, cols = 3) {
  const spans = [];

  for (let i = 0; i < orientations.length; i++) {
    const isLand = orientations[i] === "landscape";
    const remaining = cols - (_gridColCursor % cols);

    if (!isLand || remaining === 1) {
      spans.push(1);
      _gridColCursor += 1;
    } else {
      spans.push(2);
      _gridColCursor += 2;
    }
  }
  return spans;
}

function makeCard(piece, idx, span = 1) {
  const $card = document.createElement("div");
  $card.className = "art-card";
  if (span === 2) $card.classList.add("art-card--landscape");
  if (span === 3) $card.classList.add("art-card--full");
  $card.setAttribute("tabindex", "0");
  $card.setAttribute("role", "button");
  $card.setAttribute("aria-label", piece._id ? `View ${piece._id}` : "View artwork");
  $card.dataset.idx = idx;
  $card.dataset.id  = piece._id || "";

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

  /* NSFW veil — injected when piece is marked nsfw and unlock is off */
  if (piece.nsfw) {
    $card.dataset.nsfw = "1";
    if (!nsfwUnlocked) {
      const $veil = makeVeil();
      $card.appendChild($veil);
    }
  }

  $card.addEventListener("click", e => {
    if (e.shiftKey) { e.preventDefault(); toggleSelect(piece, $card); return; }
    /* If veil is present, first click reveals — second click opens lightbox */
    const $v = $card.querySelector(".art-card__veil");
    if ($v) { e.preventDefault(); revealVeil($card, $v); return; }
    openLightbox(idx);
  });
  $card.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const $v = $card.querySelector(".art-card__veil");
      if ($v) { revealVeil($card, $v); return; }
      openLightbox(idx);
    }
  });

  return $card;
}

/* Immersive card entrance — staggered reveal with a chromatic shimmer sweep.
   Each card fades + rises, then a diagonal light streak passes over it once. */
function initCardEntrance() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    qsa(".art-card").forEach($c => $c.classList.add("visible"));
    return;
  }

  const pending = qsa(".art-card:not(.visible)");
  let batchIdx = 0;

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const $card = entry.target;
      const delay = Number($card.dataset.batchIdx ?? 0) * 70;
      const capped = Math.min(delay, 560);

      setTimeout(() => {
        $card.classList.add("visible");
        /* Inject a one-shot shimmer element that self-removes */
        const $shimmer = document.createElement("span");
        $shimmer.className = "art-card__shimmer";
        $shimmer.setAttribute("aria-hidden", "true");
        $card.appendChild($shimmer);
        $shimmer.addEventListener("animationend", () => $shimmer.remove(), { once: true });
      }, capped);

      obs.unobserve($card);
    });
  }, { threshold: 0.04 });

  pending.forEach($c => {
    $c.dataset.batchIdx = batchIdx++;
    obs.observe($c);
  });
}

/* ══════════════════════════════════════════════════
   LIGHTBOX
══════════════════════════════════════════════════ */
function openLightbox(idx) {
  currentIdx = idx;
  _lb_open = true;
  resetView(false);
  /* Start with panel collapsed — user can open it via toggle or [ I ] */
  const $inner = qs(".lightbox__inner");
  if ($inner) $inner.classList.add("lb-panel-collapsed");
  const $toggle = qs("#lb-panel-toggle");
  if ($toggle) $toggle.setAttribute("aria-label", "Show info panel");
  populateLightbox(filtered[idx]);
  const $lb = qs("#lightbox");
  $lb.classList.remove("hidden");
  $lb.removeAttribute("aria-hidden");
  document.body.classList.add("lb-open");
  document.body.style.overflow = "hidden";
  showToolbar();
  requestAnimationFrame(() => qs("#lb-close").focus());
}

function closeLightbox() {
  _lb_open = false;
  const $lb = qs("#lightbox");
  $lb.classList.add("hidden");
  $lb.setAttribute("aria-hidden", "true");
  document.body.classList.remove("lb-open");
  document.body.style.overflow = "";
  hideToolbar();
}

function navigate(dir) {
  currentIdx = (currentIdx + dir + filtered.length) % filtered.length;
  resetView(false);
  /* Brief toolbar pulse on nav to signal state cleared */
  const $tb = qs("#lb-toolbar");
  if ($tb) {
    $tb.classList.add("lb-toolbar--nav-flash");
    setTimeout(() => $tb.classList.remove("lb-toolbar--nav-flash"), 220);
  }
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
  const $panel  = qs("#lb-panel");
  const $toggle = qs("#lb-panel-toggle");
  $panel.classList.toggle("lightbox__panel--hidden", !hasContent);
  if ($toggle) $toggle.style.display = hasContent ? "" : "none";
}

/* ══════════════════════════════════════════════════
   IMAGE MANIPULATION ENGINE
   Manages: zoom, pan, rotate, flip, fill/fit
   All transforms compose on #lb-viewport.
   Pan bounds clamp to prevent empty-space drift.
══════════════════════════════════════════════════ */

/* Keyboard pan step — 80px base, scaled down at higher zoom so movement
   feels constant in image-space rather than viewport-space. */
function panStep() { return Math.max(20, 80 / VIEW.scale); }

function applyTransform(animated = true) {
  const $vp   = qs("#lb-viewport");
  const $wrap = qs("#lb-wrap");
  const $tb   = qs("#lb-toolbar");
  if (!$vp) return;

  const scaleX = VIEW.scale * (VIEW.flipH ? -1 : 1);
  const scaleY = VIEW.scale * (VIEW.flipV ? -1 : 1);

  $vp.classList.toggle("lb-dragging", !animated);
  $vp.classList.toggle("lb-fill", VIEW.fill);
  $vp.style.transform =
    `translate(${VIEW.tx}px, ${VIEW.ty}px) rotate(${VIEW.rot}deg) scale(${scaleX}, ${scaleY})`;

  if ($wrap) {
    $wrap.classList.toggle("lb-can-pan", VIEW.scale > 1);
  }

  const pct = Math.round(VIEW.scale * 100);
  const $zl = qs("#lbt-zoom-pct");
  if ($zl) $zl.textContent = pct + "%";
  if ($tb) $tb.classList.toggle("lb-toolbar--zoomed", VIEW.scale !== 1);

  const $flipH  = qs("#lbt-flip-h");
  const $flipV  = qs("#lbt-flip-v");
  const $fit    = qs("#lbt-fit");
  const $reset  = qs("#lbt-reset");
  if ($flipH) $flipH.classList.toggle("lb-tool--active", VIEW.flipH);
  if ($flipV) $flipV.classList.toggle("lb-tool--active", VIEW.flipV);
  if ($fit)   $fit.classList.toggle("lb-tool--active", VIEW.fill);
  /* Dim reset when already at default state — signals nothing to undo */
  const isDefault = VIEW.scale === 1 && VIEW.tx === 0 && VIEW.ty === 0 &&
                    VIEW.rot === 0 && !VIEW.flipH && !VIEW.flipV && !VIEW.fill;
  if ($reset) $reset.classList.toggle("lb-tool--dim", isDefault);
}

function clampPan() {
  const $wrap = qs("#lb-wrap");
  if (!$wrap) return;
  const W = $wrap.offsetWidth;
  const H = $wrap.offsetHeight;
  /* When rotated 90/270°, the image's natural axes are transposed.
     Use the diagonal of the rotated bounding box as the pan budget so
     the user can't drag into black space at non-0° orientations. */
  const rad = (VIEW.rot % 360) * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const effectiveW = W * cos + H * sin;
  const effectiveH = W * sin + H * cos;
  const maxX = Math.max(0, (effectiveW * (VIEW.scale - 1)) / 2);
  const maxY = Math.max(0, (effectiveH * (VIEW.scale - 1)) / 2);
  VIEW.tx = Math.min(maxX, Math.max(-maxX, VIEW.tx));
  VIEW.ty = Math.min(maxY, Math.max(-maxY, VIEW.ty));
}

function resetView(animated = true) {
  VIEW.scale = 1;
  VIEW.tx    = 0;
  VIEW.ty    = 0;
  VIEW.rot   = 0;
  VIEW.flipH = false;
  VIEW.flipV = false;
  VIEW.fill  = false;
  applyTransform(animated);
}

function zoomAt(newScale, focalX, focalY) {
  const $wrap = qs("#lb-wrap");
  if (!$wrap) return;
  newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newScale));
  const rect = $wrap.getBoundingClientRect();
  const ox   = focalX - rect.left - rect.width  / 2;
  const oy   = focalY - rect.top  - rect.height / 2;
  const ratio = newScale / VIEW.scale;
  VIEW.tx     = ox - (ox - VIEW.tx) * ratio;
  VIEW.ty     = oy - (oy - VIEW.ty) * ratio;
  VIEW.scale  = newScale;
  clampPan();
  applyTransform(false);
  updateZoomUI(newScale);
}

function zoomCentre(delta) {
  const $wrap = qs("#lb-wrap");
  if (!$wrap) return;
  const rect = $wrap.getBoundingClientRect();
  zoomAt(VIEW.scale + delta, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

let _toastTimer   = null;
let _toastPending = false;
function updateZoomUI(scale) {
  const pct = Math.round(scale * 100);
  const $t  = qs("#lb-zoom-toast");
  if (!$t) return;
  /* Update the text immediately so it's current when the toast fires */
  $t.textContent = pct + "%";
  /* Debounce: only play the pop animation once the user pauses zooming.
     While actively scrolling we clear-and-reset so animation fires on settle,
     not on every wheel tick. */
  clearTimeout(_toastTimer);
  if (_toastPending) {
    /* Already showing — just keep the timer alive, don't restart the animation */
    _toastTimer = setTimeout(() => {
      $t.classList.remove("lb-zoom-toast--show");
      _toastPending = false;
    }, 700);
    return;
  }
  /* First tick of a new zoom gesture — wait briefly before showing */
  _toastTimer = setTimeout(() => {
    $t.classList.remove("lb-zoom-toast--show");
    void $t.offsetWidth; /* reflow to restart animation */
    $t.classList.add("lb-zoom-toast--show");
    _toastPending = true;
    _toastTimer = setTimeout(() => {
      $t.classList.remove("lb-zoom-toast--show");
      _toastPending = false;
    }, 700);
  }, 80);
}

function togglePanel() {
  const $inner  = qs(".lightbox__inner");
  const $toggle = qs("#lb-panel-toggle");
  if (!$inner) return;
  const collapsed = $inner.classList.toggle("lb-panel-collapsed");
  if ($toggle) $toggle.setAttribute("aria-label", collapsed ? "Show info panel" : "Hide info panel");
}

let _tbTimer = null;
function showToolbar() {
  const $tb = qs("#lb-toolbar");
  if (!$tb) return;
  clearTimeout(_tbTimer);
  $tb.classList.add("lb-toolbar--visible");
}
function hideToolbar() {
  const $tb = qs("#lb-toolbar");
  if (!$tb) return;
  $tb.classList.remove("lb-toolbar--visible");
}

function initPan() {
  const $wrap = qs("#lb-wrap");
  if (!$wrap) return;
  let dragging = false, startX, startY, originTx, originTy;

  $wrap.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    if (e.target.closest(".lb-toolbar, .lightbox__nav, .lightbox__close")) return;
    if (VIEW.scale <= 1) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    originTx = VIEW.tx; originTy = VIEW.ty;
    $wrap.classList.add("lb-panning");
    e.preventDefault();
  });

  window.addEventListener("mousemove", e => {
    if (!dragging) return;
    VIEW.tx = originTx + (e.clientX - startX);
    VIEW.ty = originTy + (e.clientY - startY);
    clampPan();
    applyTransform(false);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    const $w = qs("#lb-wrap");
    if ($w) $w.classList.remove("lb-panning");
  });

  /* Double-click resets view */
  $wrap.addEventListener("dblclick", e => {
    if (e.target.closest(".lb-toolbar, .lightbox__nav, .lightbox__close")) return;
    resetView(true);
    updateZoomUI(1);
  });
}

function initWheel() {
  const $wrap = qs("#lb-wrap");
  if (!$wrap) return;
  $wrap.addEventListener("wheel", e => {
    e.preventDefault();
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 32;
    if (e.deltaMode === 2) delta *= $wrap.offsetHeight;
    const dir  = delta > 0 ? -1 : 1;
    const step = ZOOM_WHEEL * (e.ctrlKey ? 2 : 1);
    zoomAt(VIEW.scale * (1 + dir * step), e.clientX, e.clientY);
  }, { passive: false });
}

function initPinch() {
  const $wrap = qs("#lb-wrap");
  if (!$wrap) return;
  let lastDist = null, lastMidX = null, lastMidY = null;
  let panStartX = null, panStartY = null, panOriTx = null, panOriTy = null;
  let isPinching = false;

  const ptDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  const ptMid  = (t1, t2) => ({
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  });

  $wrap.addEventListener("touchstart", e => {
    if (e.target.closest(".lightbox__panel, .lb-toolbar, .lightbox__nav, .lightbox__close")) return;
    if (e.touches.length === 2) {
      isPinching = true;
      lastDist = ptDist(e.touches[0], e.touches[1]);
      const m = ptMid(e.touches[0], e.touches[1]);
      lastMidX = m.x; lastMidY = m.y;
    } else if (e.touches.length === 1 && VIEW.scale > 1) {
      panStartX = e.touches[0].clientX;
      panStartY = e.touches[0].clientY;
      panOriTx  = VIEW.tx;
      panOriTy  = VIEW.ty;
    }
  }, { passive: true });

  $wrap.addEventListener("touchmove", e => {
    if (e.target.closest(".lightbox__panel, .lb-toolbar")) return;
    if (e.touches.length === 2 && isPinching) {
      e.preventDefault();
      const d = ptDist(e.touches[0], e.touches[1]);
      const m = ptMid(e.touches[0], e.touches[1]);
      if (lastDist) zoomAt(VIEW.scale * (d / lastDist), m.x, m.y);
      if (lastMidX !== null) {
        VIEW.tx += m.x - lastMidX;
        VIEW.ty += m.y - lastMidY;
        clampPan();
        applyTransform(false);
      }
      lastDist = d; lastMidX = m.x; lastMidY = m.y;
    } else if (e.touches.length === 1 && VIEW.scale > 1 && panStartX !== null) {
      e.preventDefault();
      VIEW.tx = panOriTx + (e.touches[0].clientX - panStartX);
      VIEW.ty = panOriTy + (e.touches[0].clientY - panStartY);
      clampPan();
      applyTransform(false);
    }
  }, { passive: false });

  $wrap.addEventListener("touchend", e => {
    if (e.touches.length < 2) { lastDist = null; lastMidX = null; lastMidY = null; isPinching = false; }
    if (e.touches.length === 0) { panStartX = null; panStartY = null; }
  }, { passive: true });
}

function bindToolbar() {
  const btn = id => qs(`#${id}`);
  btn("lbt-zoom-in").addEventListener("click",  () => { zoomCentre(+ZOOM_STEP); });
  btn("lbt-zoom-out").addEventListener("click", () => { zoomCentre(-ZOOM_STEP); });
  btn("lbt-rot-ccw").addEventListener("click",  () => { VIEW.rot = (VIEW.rot - 90 + 360) % 360; applyTransform(true); });
  btn("lbt-rot-cw").addEventListener("click",   () => { VIEW.rot = (VIEW.rot + 90) % 360; applyTransform(true); });
  btn("lbt-flip-h").addEventListener("click",   () => { VIEW.flipH = !VIEW.flipH; applyTransform(true); });
  btn("lbt-flip-v").addEventListener("click",   () => { VIEW.flipV = !VIEW.flipV; applyTransform(true); });
  btn("lbt-fit").addEventListener("click",      () => { VIEW.fill = !VIEW.fill; applyTransform(true); });
  btn("lbt-reset").addEventListener("click",    () => { resetView(true); updateZoomUI(1); });
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

  qs("#lb-panel-toggle").addEventListener("click", togglePanel);

  qs("#lightbox").addEventListener("click", e => {
    if (e.target === qs("#lightbox")) closeLightbox();
  });

  document.addEventListener("keydown", e => {
    if (!_lb_open) return;
    /* Don't fire nav/close if modifier keys are held (e.g. browser shortcuts) */
    const noMod = !e.ctrlKey && !e.metaKey && !e.altKey;

    if (e.key === "Escape") { closeLightbox(); return; }
    if ((e.key === "i" || e.key === "I") && noMod) { togglePanel(); return; }

    /* Navigation — only when not zoomed in (zoomed: arrow keys pan instead) */
    if (noMod && VIEW.scale <= 1) {
      if (e.key === "ArrowLeft")  { navigate(-1); return; }
      if (e.key === "ArrowRight") { navigate(1);  return; }
    }

    /* Image manipulation shortcuts */
    if (noMod) {
      switch (e.key) {
        case "+": case "=": e.preventDefault(); zoomCentre(+ZOOM_STEP); break;
        case "-": case "_": e.preventDefault(); zoomCentre(-ZOOM_STEP); break;
        case "0":           e.preventDefault(); resetView(true); updateZoomUI(1); break;
        case "q": case "Q": e.preventDefault();
          VIEW.rot = (VIEW.rot - 90 + 360) % 360; applyTransform(true); break;
        case "e": case "E": e.preventDefault();
          VIEW.rot = (VIEW.rot + 90) % 360; applyTransform(true); break;
        case "h": case "H": e.preventDefault();
          VIEW.flipH = !VIEW.flipH; applyTransform(true); break;
        case "v": case "V": e.preventDefault();
          VIEW.flipV = !VIEW.flipV; applyTransform(true); break;
        case "f": case "F": e.preventDefault();
          VIEW.fill = !VIEW.fill; applyTransform(true); break;
        /* Arrow pan when zoomed — step scales with zoom so it feels consistent */
        case "ArrowLeft":  if (VIEW.scale > 1) { e.preventDefault(); VIEW.tx -= panStep(); clampPan(); applyTransform(true); } break;
        case "ArrowRight": if (VIEW.scale > 1) { e.preventDefault(); VIEW.tx += panStep(); clampPan(); applyTransform(true); } break;
        case "ArrowUp":    if (VIEW.scale > 1) { e.preventDefault(); VIEW.ty -= panStep(); clampPan(); applyTransform(true); } break;
        case "ArrowDown":  if (VIEW.scale > 1) { e.preventDefault(); VIEW.ty += panStep(); clampPan(); applyTransform(true); } break;
      }
    }
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
    if (e.target.closest(".lightbox__panel, .lb-toolbar, .lightbox__nav, .lightbox__close")) return;
    /* When zoomed, single-touch is handled by initPinch for panning — don't also start a dismiss drag */
    if (VIEW.scale > 1 || e.touches.length > 1) return;
    _tx = e.touches[0].clientX;
    _ty = e.touches[0].clientY;
    _dragging = false;
  }, { passive: true });

  $lb.addEventListener("touchmove", e => {
    if (_ty === null) return;
    if (e.target.closest(".lightbox__panel, .lb-toolbar")) return;
    if (VIEW.scale > 1) { _tx = null; _ty = null; return; } /* cede to pan handler */
    const dy = e.touches[0].clientY - _ty;
    const dx = e.touches[0].clientX - _tx;
    if (!_dragging && Math.abs(dy) < 8) return;
    if (!_dragging && Math.abs(dx) > Math.abs(dy)) return;
    if (dy < 0) return;
    _dragging = true;
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
      if (dy > 100) {
        $inner.style.transition = "transform 0.22s cubic-bezier(0.4, 0, 1, 1), opacity 0.22s ease";
        $inner.style.transform  = "translateY(100%) scale(0.94)";
        $inner.style.opacity    = "0";
        setTimeout(() => {
          closeLightbox();
          $inner.style.transform  = "";
          $inner.style.opacity    = "";
          $inner.style.transition = "";
          $lb.style.background    = "";
        }, 220);
      } else {
        $inner.style.transition = "transform 0.35s cubic-bezier(0.34, 1.3, 0.64, 1), opacity 0.25s ease";
        $inner.style.transform  = "";
        $inner.style.opacity    = "";
        $lb.style.background    = "";
        setTimeout(() => { $inner.style.transition = ""; }, 360);
      }
    } else if (!_dragging && Math.abs(dx) > 50 && Math.abs(dy) < 60 && VIEW.scale <= 1) {
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
   SELECTION PANEL
══════════════════════════════════════════════════ */
function toggleSelect(piece, $card) {
  const id = piece._id;
  if (selected.has(id)) {
    selected.delete(id);
    $card.classList.remove("art-card--selected");
  } else {
    selected.set(id, piece);
    $card.classList.add("art-card--selected");
    /* Micro-pulse on the card to confirm selection */
    $card.classList.add("art-card--select-pulse");
    $card.addEventListener("animationend", () => $card.classList.remove("art-card--select-pulse"), { once: true });
  }
  renderSelPanel();
}

function renderSelPanel() {
  const $panel = qs("#sel-panel");
  const $list  = qs("#sel-list");
  const $count = qs("#sel-count");

  if (selected.size === 0) {
    $panel.hidden = true;
    return;
  }

  $panel.hidden = false;
  $count.textContent = selected.size;
  $list.innerHTML = "";

  selected.forEach((piece, id) => {
    const $li = document.createElement("li");
    $li.className = "sel-item";

    const $thumb = document.createElement("img");
    $thumb.className = "sel-item__thumb";
    $thumb.src = piece.thumb || piece.src || "";
    $thumb.alt = "";
    $thumb.loading = "lazy";

    const $id = document.createElement("span");
    $id.className = "sel-item__id";
    $id.textContent = id;

    const $rm = document.createElement("button");
    $rm.className = "sel-item__remove";
    $rm.setAttribute("aria-label", `Remove ${id}`);
    $rm.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    $rm.addEventListener("click", () => {
      selected.delete(id);
      /* deselect the card in the grid */
      const $card = qs(`.art-card[data-id="${CSS.escape(id)}"]`);
      if ($card) $card.classList.remove("art-card--selected");
      renderSelPanel();
    });

    $li.append($thumb, $id, $rm);
    $list.appendChild($li);
  });
}

/* ── NSFW Veil ──────────────────────────────── */
function makeVeil() {
  const $veil = document.createElement("div");
  $veil.className = "art-card__veil";
  $veil.setAttribute("aria-label", "Sensitive content — click to reveal");
  $veil.innerHTML = `
    <span class="art-card__veil-ribbon" aria-hidden="true">
      <span class="art-card__veil-sigil">✦</span>
      <span class="art-card__veil-text">SENSITIVE</span>
      <span class="art-card__veil-sigil">✦</span>
    </span>
    <span class="art-card__veil-hint" aria-hidden="true">click to unveil</span>
    <span class="art-card__veil-particles" aria-hidden="true"></span>
  `;
  return $veil;
}

function revealVeil($card, $veil) {
  $veil.classList.add("art-card__veil--unwrapping");
  $veil.addEventListener("animationend", () => {
    $veil.remove();
    /* Not auto — user explicitly clicked, so survives re-lock */
    $card.classList.add("art-card--nsfw-revealed");
    $card.classList.remove("art-card--nsfw-auto");
  }, { once: true });
}


function initSelPanel() {
  qs("#sel-clear").addEventListener("click", () => {
    selected.clear();
    qsa(".art-card--selected").forEach($c => $c.classList.remove("art-card--selected"));
    renderSelPanel();
  });

  qs("#sel-copy").addEventListener("click", () => {
    const ids = [...selected.keys()].join("\n");
    navigator.clipboard.writeText(ids).then(() => {
      const $lbl = qs("#sel-copy-label");
      $lbl.textContent = "Copied!";
      setTimeout(() => { $lbl.textContent = "Copy IDs"; }, 1800);
    });
  });
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
