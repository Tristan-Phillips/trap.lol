/**
 * void
 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${y} · ${['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][+m - 1]} ${+d}`;
}

// Cut text mid-sentence — not at a clean paragraph break.
// The fragment feels like the rest of it is just gone.
function fragment(raw, chars = 160) {
  const clean = raw
    .replace(/^#{1,6}\s+.*/gm, '')
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
  if (clean.length <= chars) return clean;
  // Find a word boundary after chars, not before — so it cuts INTO a thought
  const after = clean.indexOf(' ', chars);
  return after === -1 ? clean : clean.slice(0, after);
}

// Plain text → paragraphs, minimal
function toProse(raw) {
  return raw
    .split(/\n{2,}/)
    .map(block => {
      const b = block.trim();
      if (!b) return '';
      const hm = b.match(/^(#{1,4})\s+(.+)/);
      if (hm) return `<h${Math.min(+hm[1].length + 1, 4)}>${esc(hm[2])}</h${Math.min(+hm[1].length + 1, 4)}>`;
      // Preserve single line breaks within a paragraph
      const inner = b.split('\n').map(l => esc(l)).join('<br>');
      return `<p>${inner}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

// Entries are not all equally indented.
// Some sit slightly right. Some flush. One or two further right still.
// Not random — seeded by ID so it's stable, but varied enough to feel organic.
function indent(id) {
  const seed = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const steps = [0, 0, 0, 0.6, 0, 1.2, 0, 0, 0.3, 0];
  return steps[seed % steps.length];
}

// ── Feed ─────────────────────────────────────────────────

function buildEntry(entry) {
  const el = document.createElement('div');
  el.className = 'e';
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'article');
  el.setAttribute('aria-label', entry.title);
  el.style.paddingLeft = indent(entry.id) + 'em';

  const frag = fragment(entry.content);
  // The fragment ends without … sometimes — the thought just stops
  const hasEllipsis = frag.length < entry.content.replace(/^#{1,6}\s+.*/gm, '').trim().length;

  el.innerHTML = `
    <div class="e-title">${esc(entry.title)}</div>
    <div class="e-fragment">${esc(frag)}${hasEllipsis ? '' : ''}</div>
    <div class="e-id">${esc(entry.id)}</div>
  `;

  el.addEventListener('click', () => openWell(entry));
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWell(entry); }
  });

  return el;
}

function renderFeed(data) {
  const $feed = document.getElementById('feed');
  const sorted = [...data].sort((a, b) => {
    const da = a.date ?? '', db = b.date ?? '';
    if (da > db) return -1;
    if (da < db) return 1;
    return (b.index ?? 0) - (a.index ?? 0);
  });

  sorted.forEach(entry => $feed.appendChild(buildEntry(entry)));
  revealEntries();
}

// Reveal — entries don't announce themselves.
// They just weren't there, and now they are.
function revealEntries() {
  const entries = document.querySelectorAll('.e');
  const io = new IntersectionObserver((records, obs) => {
    records.forEach(r => {
      if (!r.isIntersecting) return;
      // Delay is minimal — they don't march in one by one dramatically
      setTimeout(() => r.target.classList.add('in'), Math.random() * 80);
      obs.unobserve(r.target);
    });
  }, { threshold: 0.04, rootMargin: '0px 0px -4% 0px' });

  entries.forEach(el => io.observe(el));
}

// ── Well ─────────────────────────────────────────────────

const $well      = document.getElementById('well');
const $wellBg    = document.getElementById('well-bg');
const $wellBody  = document.getElementById('well-body');
const $wellClose = document.getElementById('well-close');
const $content   = document.getElementById('well-content');

let _busy = false;

function openWell(entry) {
  if (_busy) return;

  $content.innerHTML = `
    <div class="w-title">${esc(entry.title)}</div>
    <div class="w-date">${esc(fmtDate(entry.date))}</div>
    ${toProse(entry.content)}
  `;

  $well.hidden = false;
  $well.removeAttribute('aria-hidden');
  $well.scrollTop = 0;
  document.body.style.overflow = 'hidden';

  requestAnimationFrame(() => {
    $well.classList.add('open');
    setTimeout(() => $wellClose.focus(), 500);
  });
}

function closeWell() {
  if (_busy) return;
  _busy = true;
  $well.classList.remove('open');
  $well.classList.add('closing');

  setTimeout(() => {
    $well.classList.remove('closing');
    $well.hidden = true;
    $well.setAttribute('aria-hidden', 'true');
    $content.innerHTML = '';
    document.body.style.overflow = '';
    _busy = false;
  }, 600);
}

$wellBg.addEventListener('click', closeWell);
$wellClose.addEventListener('click', closeWell);
$wellBody.addEventListener('click', e => e.stopPropagation());

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$well.hidden) closeWell();
});

// The out link — fire and navigate
document.getElementById('out').addEventListener('click', function(e) {
  e.preventDefault();
  const href = this.getAttribute('href');
  this.style.opacity = '0';
  setTimeout(() => { window.location.href = href; }, 250);
});

// ── Boot ─────────────────────────────────────────────────

(async function boot() {
  try {
    const res = await fetch('/void/assets/content/void.json');
    if (!res.ok) throw new Error(res.status);
    renderFeed(await res.json());
  } catch (err) {
    const $feed = document.getElementById('feed');
    const div = document.createElement('div');
    div.style.cssText = 'color:rgba(90,0,24,.3);font-family:Courier New,monospace;font-size:.65em;letter-spacing:.15em;padding-top:4rem;';
    div.textContent = String(err.message);
    $feed.appendChild(div);
  }
})();
