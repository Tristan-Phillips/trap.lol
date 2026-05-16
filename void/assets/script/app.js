/**
 * void — trap.lol
 * Feed, submersion overlay, custom cursor, scroll reveal.
 * The wrong thing glitches on its own schedule — don't touch it.
 */

// ── Cursor ────────────────────────────────────────────────
const $cur = document.getElementById('void-cursor');
const $dot = $cur?.querySelector('.void-cursor__dot');

document.addEventListener('mousemove', e => {
  if (!$cur) return;
  $cur.style.left = e.clientX + 'px';
  $cur.style.top  = e.clientY + 'px';
});

document.addEventListener('mouseleave', () => { if ($cur) $cur.style.opacity = '0'; });
document.addEventListener('mouseenter', () => { if ($cur) $cur.style.opacity = '1'; });

function cursorHover(on) {
  $cur?.classList.toggle('is-hover', on);
}

// ── Safety ────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Date formatting ───────────────────────────────────────
function fmt(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

// ── Get first real prose (strip headings, clamp chars) ────
function scar(raw, limit = 200) {
  const stripped = raw
    .replace(/^#{1,6}\s+.*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const first = stripped.split('\n\n')[0].replace(/\n/g, ' ').trim();
  if (first.length <= limit) return first;
  const cut = first.lastIndexOf(' ', limit);
  return first.slice(0, cut > 80 ? cut : limit) + '…';
}

// ── Text → HTML (minimal, preserves linebreaks as paragraphs) ──
function prose(raw) {
  const blocks = raw.split(/\n{2,}/);
  return blocks.map(block => {
    const b = block.trim();
    if (!b) return '';
    const hm = b.match(/^(#{1,4})\s+(.+)/);
    if (hm) {
      const lvl = Math.min(hm[1].length + 1, 6); // h2–h6 so it doesn't compete with title
      return `<h${lvl}>${esc(hm[2])}</h${lvl}>`;
    }
    const lines = b.split('\n').map(l => esc(l.trim())).join('<br>');
    return `<p>${lines}</p>`;
  }).filter(Boolean).join('\n');
}

// ── Build one entry element ───────────────────────────────
function mkEntry(entry) {
  const li = document.createElement('li');
  li.className = 'void-entry';
  li.setAttribute('role', 'listitem');
  li.setAttribute('tabindex', '0');
  li.setAttribute('aria-label', entry.title);

  li.innerHTML = `
    <div class="void-entry__id" aria-hidden="true">void-${esc(entry.id)}</div>
    <h2 class="void-entry__title">${esc(entry.title)}</h2>
    <div class="void-entry__date" aria-hidden="true">${esc(fmt(entry.date))}</div>
    <div class="void-entry__scar">${esc(scar(entry.content))}</div>
    <div class="void-entry__pull" aria-hidden="true">
      open this wound
      <span aria-hidden="true">&#8594;</span>
    </div>
  `;

  li.addEventListener('click', () => submerge(entry));
  li.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); submerge(entry); }
  });
  li.addEventListener('mouseenter', () => cursorHover(true));
  li.addEventListener('mouseleave', () => cursorHover(false));

  return li;
}

// ── Render feed ───────────────────────────────────────────
function renderFeed(data) {
  const $list = document.getElementById('void-list');
  const sorted = [...data].sort((a, b) => {
    if ((a.date ?? '') > (b.date ?? '')) return -1;
    if ((a.date ?? '') < (b.date ?? '')) return 1;
    return (b.index ?? 0) - (a.index ?? 0);
  });

  sorted.forEach(entry => $list.appendChild(mkEntry(entry)));
  initReveal();
}

// ── Scroll reveal ─────────────────────────────────────────
function initReveal() {
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-visible');
      obs.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });

  document.querySelectorAll('.void-entry').forEach(el => io.observe(el));
}

// ── Submersion ────────────────────────────────────────────
const $sub    = document.getElementById('void-sub');
const $water  = document.getElementById('void-sub-water');
const $panel  = document.getElementById('void-sub-panel');
const $body   = document.getElementById('void-sub-body');
const $close  = document.getElementById('void-sub-close');

let _sinking = false;

function submerge(entry) {
  if (_sinking) return;

  $body.innerHTML = `
    <div class="void-full__id" aria-hidden="true">void-${esc(entry.id)} &nbsp;·&nbsp; ${esc(fmt(entry.date))}</div>
    <h1 class="void-full__title">${esc(entry.title)}</h1>
    <div class="void-full__rule" aria-hidden="true"></div>
    <div class="void-full__prose">${prose(entry.content)}</div>
  `;

  $sub.setAttribute('aria-hidden', 'false');
  $sub.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  $body.scrollTop = 0;

  // Focus the close button after panel arrives
  setTimeout(() => $close.focus(), 350);
}

function surface() {
  if (_sinking) return;
  _sinking = true;

  $sub.classList.remove('is-open');
  $sub.classList.add('is-closing');

  setTimeout(() => {
    $sub.classList.remove('is-closing');
    $sub.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    $body.innerHTML = '';
    _sinking = false;
  }, 500);
}

// Close via water click (outside panel)
$water.addEventListener('click', surface);

// Close via surface button
$close.addEventListener('click', surface);
$close.addEventListener('mouseenter', () => cursorHover(true));
$close.addEventListener('mouseleave', () => cursorHover(false));

// Stop panel clicks from closing
$panel.addEventListener('click', e => e.stopPropagation());

// Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $sub.classList.contains('is-open')) surface();
});

// ── The wrong thing — additional random offset so it's never predictable ──
(function seedWrong() {
  const $w = document.getElementById('void-wrong');
  if (!$w) return;
  // Randomise its vertical position slightly so it never appears in the same spot twice
  const topPct = 20 + Math.random() * 40;
  $w.style.top = topPct + 'vh';
  $w.style.right = (6 + Math.random() * 10) + 'vw';
})();

// ── Boot ──────────────────────────────────────────────────
(async function boot() {
  try {
    const res = await fetch('/void/assets/content/void.json');
    if (!res.ok) throw new Error(`${res.status} — signal lost`);
    renderFeed(await res.json());
  } catch (err) {
    const $list = document.getElementById('void-list');
    const li = document.createElement('li');
    li.style.cssText = 'padding:5rem 0;font-family:Courier New,monospace;font-size:.6rem;letter-spacing:.2em;color:rgba(107,0,32,.3);text-transform:uppercase;';
    li.textContent = err.message;
    $list.appendChild(li);
  }
})();
