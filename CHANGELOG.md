# Changelog

All notable changes to `trap.lol` are recorded here.
Format: `[commit] YYYY-MM-DD — scope — description`

---

## [bd8bb1a] 2026-05-12 — Security hardening and pre-production cleanup

### Fixed
- **`guide/index.html` — XSS via unsanitized markdown**
  `marked.parse()` output was injected into `innerHTML` without sanitization.
  Now loads the `dompurify` shard alongside `lucide`/`marked` and wraps output
  with `DOMPurify.sanitize()` before injection.

- **`guide/index.html` — path traversal + raw param in error output**
  The `?md=` query param had no validation, allowing traversal sequences.
  Now gated by `/^[a-zA-Z0-9_-]+\.md$/` regex. Error messages no longer
  echo the raw param value.

- **`art/glass/script/app.js` — IntersectionObserver redundant re-observation**
  `initCardEntrance()` was called on every gacha pull and re-observed all
  `.art-card` elements, including those already visible and unobserved.
  Scoped selector to `.art-card:not(.visible)` — only unentried cards observed.

- **`art/glass/script/app.js` — meaningless aria-label on art cards**
  `"Open artwork N"` (sequential integer) was meaningless to screen readers.
  Replaced with `"View <compositeId>"` (e.g. `"View E4FFEC::9702F0"`).

### Removed
- **`art/glass/data/detention.json.backup`** — stale 71-artifact CDN dataset
  was publicly served at `/art/glass/data/detention.json.backup`. Deleted.

### Updated
- **`.gitignore`** — added `**/*.backup` glob to prevent future backup files
  from being committed or served via GitHub Pages.

---

## [c792aa3] 2026-05-07 — LLM Changes and Status Implementation

- LLM playground changes and uplink status page implementation.

---

## [b16c69c] — changes

## [31c3c35] — changes

## [16e5f8d] — uiux

## [025e973] — reality alter

## [1e9e69d] — changes

## [f11659d] — changes

## [c9cf130] — fixes

## [ac37e64] — char creator dm

## [185b6fb] — personas
