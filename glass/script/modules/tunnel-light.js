/* trap.lol — Tunnel Light
   Staggered scroll ignition.
   GPL-3.0 — trap.lol */

export function initTunnelLight() {
  if (typeof IntersectionObserver === "undefined") return;

  const selectors = [
    "#echoes-section .echoes-portal",
    ".section-title",
    ".card-primary-wrap",
    ".ext-category",
    ".bots-grid",
    ".app-card",
    ".tool-entry",
    ".site-footer",
  ].join(", ");

  const lamps = document.querySelectorAll(selectors);
  if (!lamps.length) return;

  lamps.forEach(el => el.classList.add("tl-lamp"));

  const parentCounters = new Map();
  const ignite = (el) => {
    const parent = el.parentElement;
    const idx = parentCounters.get(parent) ?? 0;
    parentCounters.set(parent, idx + 1);

    setTimeout(() => el.classList.add("tl-lamp--lit"), idx * 60);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        ignite(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px" }
  );

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      lamps.forEach(el => observer.observe(el));
    });
  });
}
