/* ─────────────────────────────────────────────────────────────
   trap.lol — Tunnel Light
   Scroll ignition. bdunk bdunk bdunk.
   GPL-3.0 — trap.lol
   ───────────────────────────────────────────────────────────── */

export function initTunnelLight() {
  if (typeof IntersectionObserver === "undefined") return;

  const SELECTORS = [
    "#echoes-section .echoes-portal",
    ".section-title",
    ".card-primary-wrap",
    ".ext-category",
    ".bot-profile",
    ".app-card",
    ".tool-entry",
    ".site-footer",
  ].join(", ");

  const lamps = Array.from(document.querySelectorAll(SELECTORS));
  if (!lamps.length) return;

  lamps.forEach((el) => el.classList.add("tl-lamp"));

  /* Track per-parent ignition order so siblings stagger —
     each sibling fires 60ms after the previous one */
  const parentCounters = new Map();

  const ignite = (el) => {
    const parent = el.parentElement;
    const idx = parentCounters.get(parent) ?? 0;
    parentCounters.set(parent, idx + 1);

    const delay = idx * 60;
    setTimeout(() => {
      el.classList.add("tl-lamp--lit");
    }, delay);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        ignite(entry.target);
        observer.unobserve(entry.target);
      });
    },
    {
      rootMargin: "0px 0px -8% 0px",
      threshold: 0,
    }
  );

  /* Double rAF — let browser paint the dormant state first */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      lamps.forEach((el) => observer.observe(el));
    });
  });
}
