/**
 * trap.lol // void
 * Feed rendering, spotlight, cursor, scroll reveal.
 */

// ── Cursor ────────────────────────────────────────────────
const $cursor = document.getElementById('v-cursor');
let cx = -100, cy = -100;

document.addEventListener('mousemove', e => {
  cx = e.clientX; cy = e.clientY;
  $cursor.style.left = cx + 'px';
  $cursor.style.top  = cy + 'px';
});

document.addEventListener('mouseleave', () => { $cursor.style.opacity = '0'; });
document.addEventListener('mouseenter', () => { $cursor.style.opacity = '1'; });

function setCursorHover(on) {
  $cursor.classList.toggle('is-hover', on);
}

// ── Data ──────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${y}.${m}.${d}`;
}

function firstChars(text, max = 200) {
  const clean = text
    .replace(/^#+\s+.*/gm, '')   // strip markdown headings
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.lastIndexOf(' ', max);
  return clean.slice(0, cut > 80 ? cut : max) + '…';
}

// Convert plain text (with optional leading # headings) to minimal HTML
function textToHtml(raw) {
  const lines = raw.split('\n');
  const chunks = [];
  let buf = [];

  const flushBuf = () => {
    if (buf.length) {
      chunks.push(`<p>${esc(buf.join(' '))}</p>`);
      buf = [];
    }
  };

  for (const line of lines) {
    const hm = line.match(/^(#{1,3})\s+(.+)/);
    if (hm) {
      flushBuf();
      const tag = `h${hm[1].length + 1}`; // h1→h2, so it doesn't compete with .void-full__title
      chunks.push(`<${tag}>${esc(hm[2])}</${tag}>`);
      continue;
    }

    if (line.trim() === '') {
      flushBuf();
    } else {
      buf.push(line.trim());
    }
  }
  flushBuf();
  return chunks.join('\n');
}

// ── Feed builder ──────────────────────────────────────────
function buildEntry(entry) {
  const article = document.createElement('article');
  article.className = 'void-echo';
  article.setAttribute('role', 'listitem');
  article.setAttribute('tabindex', '0');
  article.setAttribute('aria-label', `Entry: ${entry.title}`);
  article.dataset.id = entry.id;

  const snippet = firstChars(entry.content, 220);

  article.innerHTML = `
    <div class="void-echo__tether" aria-hidden="true"></div>
    <div class="void-echo__meta">
      <span class="void-echo__meta-id">VOID-${esc(entry.id)}</span>
      <span class="void-echo__meta-sep">///</span>
      <span>${esc(fmtDate(entry.date))}</span>
    </div>
    <h2 class="void-echo__title">${esc(entry.title)}</h2>
    <div class="void-echo__snippet">${esc(snippet)}</div>
    <div class="void-echo__lure" aria-hidden="true">
      descend into this
      <span class="void-echo__lure-arrow">→</span>
    </div>
  `;

  article.addEventListener('click', () => openSpotlight(entry));
  article.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openSpotlight(entry);
    }
  });

  article.addEventListener('mouseenter', () => setCursorHover(true));
  article.addEventListener('mouseleave', () => setCursorHover(false));

  return article;
}

function renderFeed(entries) {
  const $list = document.getElementById('void-entries');
  // Newest first
  const sorted = [...entries].sort((a, b) => {
    if (a.date > b.date) return -1;
    if (a.date < b.date) return 1;
    return (b.index ?? 0) - (a.index ?? 0);
  });

  sorted.forEach(e => $list.appendChild(buildEntry(e)));
  initReveal();
}

// ── Scroll reveal ─────────────────────────────────────────
function initReveal() {
  const obs = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

  document.querySelectorAll('.void-echo').forEach(el => obs.observe(el));
}

// ── Spotlight ─────────────────────────────────────────────
const $spotlight = document.getElementById('void-spotlight');
const $curtain   = document.getElementById('void-curtain');
const $content   = document.getElementById('void-spotlight-content');
const $esc       = document.getElementById('void-esc');

let _closing = false;

function openSpotlight(entry) {
  // Build content
  const proseHtml = textToHtml(entry.content);

  $content.innerHTML = `
    <span class="void-full__meta">${esc(fmtDate(entry.date))} // VOID-${esc(entry.id)}</span>
    <h1 class="void-full__title">${esc(entry.title)}</h1>
    <div class="void-full__rule" aria-hidden="true"></div>
    <div class="void-full__prose">${proseHtml}</div>
  `;

  // Strip auto-appended sig line if already in content
  if (!entry.content.includes(`- VOID-${entry.id}`)) {
    const sig = document.createElement('span');
    sig.className = 'void-full__sig';
    sig.textContent = `— VOID-${entry.id}`;
    $content.appendChild(sig);
  }

  $spotlight.hidden = false;
  document.body.style.overflow = 'hidden';
  $spotlight.scrollTop = 0;
  const scroll = $spotlight.querySelector('.void-spotlight__scroll');
  if (scroll) scroll.scrollTop = 0;

  requestAnimationFrame(() => {
    $spotlight.classList.add('is-open');
    $esc.focus();
  });
}

function closeSpotlight() {
  if (_closing) return;
  _closing = true;
  $spotlight.classList.remove('is-open');
  $spotlight.classList.add('is-closing');

  setTimeout(() => {
    $spotlight.classList.remove('is-closing');
    $spotlight.hidden = true;
    $content.innerHTML = '';
    document.body.style.overflow = '';
    _closing = false;
  }, 420);
}

$curtain.addEventListener('click', closeSpotlight);
$esc.addEventListener('click', closeSpotlight);

$esc.addEventListener('mouseenter', () => setCursorHover(true));
$esc.addEventListener('mouseleave', () => setCursorHover(false));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$spotlight.hidden) closeSpotlight();
});

// Prevent cursor bleed-through from panel clicks closing overlay
$spotlight.querySelector('.void-spotlight__panel').addEventListener('click', e => {
  e.stopPropagation();
});

// ── Boot ──────────────────────────────────────────────────
(async function boot() {
  try {
    const res = await fetch('/void/assets/content/void.json');
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    renderFeed(data);
  } catch (e) {
    const $list = document.getElementById('void-entries');
    $list.innerHTML = `<p style="font-family:monospace;font-size:.75rem;color:rgba(139,0,51,.4);padding:4rem 0;text-align:center;letter-spacing:.15em;">SIGNAL LOST // ${esc(e.message)}</p>`;
  }
})();
