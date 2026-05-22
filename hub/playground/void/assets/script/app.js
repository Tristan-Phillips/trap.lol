/**
 * void // trap.lol
 *
 * The same person who built a sovereign infrastructure terminal
 * also wrote "I am scared, but also excited :D"
 *
 * The particle field uses the site's own colour vocabulary.
 * Everything else is stripped back so the words can breathe.
 */

// ── Helpers ───────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const mo = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  return `${mo[+m-1]} ${+d} ${y}`;
}

// Get the single most striking line from the content —
// not the first line, but the line that earns its place.
function pickLine(raw) {
  const lines = raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('-'));

  if (!lines.length) return '';

  // Prefer lines that feel unguarded — not too short, not too long,
  // and contain lowercase natural language (not metadata)
  const candidates = lines.filter(l => l.length > 30 && l.length < 160);
  if (!candidates.length) return lines[0].slice(0, 120);

  // Pick the line with the highest ratio of lowercase + commas + emotional markers
  // (this is a heuristic — longer natural sentences score higher)
  const scored = candidates.map(l => ({
    l,
    score: (l.match(/[,—…\.]/g) || []).length + (l.match(/[a-z]/g) || []).length / l.length * 5
  }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].l;
  return best.length > 110 ? best.slice(0, best.lastIndexOf(' ', 110)) + '…' : best;
}

// Configure marked — breaks=true preserves the writer's intentional single-line breaks
marked.use({
  breaks: true,
  gfm: true,
  extensions: [{
    name: 'voidSig',
    level: 'block',
    start(src) { return src.indexOf('- VOID-'); },
    tokenizer(src) {
      const m = src.match(/^- (VOID-[A-Z0-9]{6})\n?/);
      if (m) return { type: 'voidSig', raw: m[0], id: m[1] };
    },
    renderer(token) {
      return `<p class="w-void-sig">${esc(token.id)}</p>\n`;
    },
  }],
});

function toProse(raw) {
  const dirty = marked.parse(raw);
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['p','br','h1','h2','h3','h4','h5','strong','em','blockquote','ul','ol','li','code','pre','hr','span'],
    ALLOWED_ATTR: ['class'],
  });
}

// ── Particle field ────────────────────────────────────────
// Uses the site's own violet/gold vocabulary.
// Drifts slowly. Not reactive to mouse — it exists on its own.
// The hub is controlled. This isn't controlled.

function initField() {
  const canvas = document.getElementById('field');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let W, H, particles;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    if (!particles) initParticles();
  }

  function initParticles() {
    // Sparse. Like stars you're not sure you can see.
    const count = Math.floor((W * H) / 28000);
    particles = Array.from({ length: Math.max(count, 18) }, () => mkParticle());
  }

  function mkParticle() {
    // Each particle is one of three types:
    // violet (dominant — the site's accent)
    // gold (rare — the warm accent)
    // ghost (very dim — depth)
    const r = Math.random();
    const type = r < 0.55 ? 'violet' : r < 0.7 ? 'gold' : 'ghost';
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: type === 'ghost' ? Math.random() * 0.8 + 0.2 : Math.random() * 1.2 + 0.4,
      vx: (Math.random() - 0.5) * 0.12,
      vy: (Math.random() - 0.5) * 0.08 - 0.04, // slight upward drift
      alpha: type === 'ghost'
        ? Math.random() * 0.06 + 0.02
        : type === 'gold'
          ? Math.random() * 0.12 + 0.04
          : Math.random() * 0.18 + 0.05,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.004 + Math.random() * 0.008,
      type,
    };
  }

  const colours = {
    violet: '190, 41, 236',
    gold:   '244, 168, 48',
    ghost:  '180, 160, 210',
  };

  function draw(ts) {
    ctx.clearRect(0, 0, W, H);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.pulse += p.pulseSpeed;

      // Wrap
      if (p.x < -2)  p.x = W + 2;
      if (p.x > W+2) p.x = -2;
      if (p.y < -2)  p.y = H + 2;
      if (p.y > H+2) p.y = -2;

      const a = p.alpha * (0.7 + 0.3 * Math.sin(p.pulse));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colours[p.type]}, ${a})`;
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
}

// ── Feed ─────────────────────────────────────────────────

function buildEntry(entry) {
  const el = document.createElement('div');
  el.className = 'v-entry';
  el.setAttribute('role', 'listitem');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', `${entry.title}${entry.date ? ' — ' + fmtDate(entry.date) : ''}`);

  const line = pickLine(entry.content);

  el.innerHTML = `
    ${entry.date ? `<div class="v-entry__date">${esc(fmtDate(entry.date))}</div>` : ''}
    <div class="v-entry__title">${esc(entry.title)}</div>
    ${line ? `<div class="v-entry__line">${esc(line)}</div>` : ''}
    <div class="v-entry__id" aria-hidden="true">${esc(entry.id)}</div>
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
    const da = a.date ?? '0000-00-00';
    const db = b.date ?? '0000-00-00';
    return da > db ? -1 : da < db ? 1 : (b.index ?? 0) - (a.index ?? 0);
  });

  sorted.forEach(e => $feed.appendChild(buildEntry(e)));

  // Reveal — entries appear quietly, not dramatically
  const io = new IntersectionObserver((records, obs) => {
    records.forEach(r => {
      if (!r.isIntersecting) return;
      // tiny stagger so multiple entries appearing at once don't all land simultaneously
      const idx = [...document.querySelectorAll('.v-entry')].indexOf(r.target);
      setTimeout(() => r.target.classList.add('in'), Math.min(idx * 40, 200));
      obs.unobserve(r.target);
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -3% 0px' });

  document.querySelectorAll('.v-entry').forEach(el => io.observe(el));
}

// ── Well ─────────────────────────────────────────────────

const $well   = document.getElementById('well');
const $veil   = document.getElementById('well-veil');
const $doc    = document.getElementById('well-doc');
const $inner  = document.getElementById('well-inner');
const $close  = document.getElementById('well-close');

let busy = false;

function openWell(entry) {
  if (busy) return;

  $inner.innerHTML = `
    <span class="w-id">${esc(entry.id)}</span>
    ${entry.date ? `<span class="w-date">${esc(fmtDate(entry.date))}</span>` : ''}
    <h1 class="w-title">${esc(entry.title)}</h1>
    <div class="w-rule" aria-hidden="true"></div>
    <div class="w-prose">${toProse(entry.content)}</div>
  `;

  $well.hidden = false;
  document.body.style.overflow = 'hidden';
  $doc.scrollTop = 0;

  requestAnimationFrame(() => {
    $well.classList.add('open');
    setTimeout(() => $close.focus(), 400);
  });
}

function closeWell() {
  if (busy) return;
  busy = true;

  $well.classList.remove('open');
  $well.classList.add('closing');

  setTimeout(() => {
    $well.classList.remove('closing');
    $well.hidden = true;
    $inner.innerHTML = '';
    document.body.style.overflow = '';
    busy = false;
  }, 550);
}

$veil.addEventListener('click', closeWell);
$close.addEventListener('click', closeWell);
$doc.addEventListener('click', e => e.stopPropagation());

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$well.hidden) closeWell();
});

// ── Boot ─────────────────────────────────────────────────

initField();

(async function boot() {
  try {
    const res = await fetch('/hub/playground/void/assets/data/void.json');
    if (!res.ok) throw new Error(res.status);
    renderFeed(await res.json());
  } catch (err) {
    const el = document.createElement('div');
    el.style.cssText = 'padding:4rem 0;font-size:.65rem;letter-spacing:.15em;color:rgba(190,41,236,.25);';
    el.textContent = `// signal lost — ${err.message}`;
    document.getElementById('feed').appendChild(el);
  }
})();
