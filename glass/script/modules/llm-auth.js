// Neural Uplink — authentication & key-bar logic
import { esc } from './core.js';

export const KEY_REGEX = /^sk-nano-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidKeyFormat(k) { return KEY_REGEX.test(k.trim()); }

// Purge any legacy key material that may have been persisted in a prior version
export function purgeLegacyKeyStorage() {
  ["llm_api_key"].forEach(k => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
}

// Cookie helpers — 24h, SameSite=Strict, no Secure flag needed (works on localhost too)
const COOKIE_NAME = "llm_ak";

function _saveCookie(val) {
  const expires = new Date(Date.now() + 86400_000).toUTCString();
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(val)}; expires=${expires}; path=/; SameSite=Strict`;
}

function _loadCookie() {
  const match = document.cookie.split("; ").find(c => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return "";
  try { return decodeURIComponent(match.split("=").slice(1).join("=")); } catch { return ""; }
}

function _clearCookie() {
  document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict`;
}

// API key — persisted in a 24h cookie, held in memory at runtime
let _apiKey = "";

export function getApiKey()    { return _apiKey; }
export function setApiKey(k)   { _apiKey = k; _saveCookie(k); }
export function clearApiKey()  { _apiKey = ""; _clearCookie(); }
export function hasStoredKey() { return !!_apiKey && isValidKeyFormat(_apiKey); }

// Attempt to restore key from cookie on module load
export function restoreKeyFromCookie() {
  const stored = _loadCookie();
  if (stored && isValidKeyFormat(stored)) { _apiKey = stored; return true; }
  _clearCookie();
  return false;
}

export function initKeybar({
  llm, PROXY_MODE, hasValidKey,
  $keybar, $keybarInputWrap, $keybarInput, $keybarToggle, $keybarSave,
  $keybarGetkey, $keybarLocked, $keybarUnlock,
  $input, $sendBtn,
  setKeybarLocked, setStatus, restoreHistory, appendSysLog,
  referralConfig,
}) {
  const $keybarLabel = $keybarLocked.querySelector(".llm-keybar__locked-label");

  function _setKeybarLocked(locked) {
    $keybarInputWrap.hidden = locked;
    $keybarLocked.hidden    = !locked;
    $keybar.dataset.locked  = locked ? "true" : "false";
    $input.disabled   = !locked;
    $sendBtn.disabled = !locked;
    if ($keybarLabel) {
      const valid = hasValidKey();
      $keybarLabel.dataset.valid = valid ? "true" : "false";
      $keybarLabel.textContent   = valid ? "Key Active" : "Invalid Key";
    }
    if (locked && typeof lucide !== "undefined") lucide.createIcons({ nodes: [$keybarLocked] });
    setKeybarLocked(locked);
  }

  $keybarInput.addEventListener("input", () => {
    const val = $keybarInput.value.trim();
    if (!val) { $keybarInput.dataset.valid = ""; return; }
    $keybarInput.dataset.valid = isValidKeyFormat(val) ? "true" : "false";
  });

  if (PROXY_MODE) {
    $keybar.hidden    = true;
    $input.disabled   = false;
    $sendBtn.disabled = false;
  } else {
    _setKeybarLocked(hasValidKey());
  }

  $keybarToggle.addEventListener("click", () => {
    const isPass = $keybarInput.type === "password";
    $keybarInput.type = isPass ? "text" : "password";
    $keybarToggle.innerHTML = `<i data-lucide="${isPass ? "eye-off" : "eye"}"></i>`;
    if (typeof lucide !== "undefined") lucide.createIcons({ nodes: [$keybarToggle] });
  });

  $keybarSave.addEventListener("click", () => {
    const val = $keybarInput.value.trim();
    if (!val || !isValidKeyFormat(val)) {
      $keybarInput.classList.add("llm-keybar__input--shake");
      $keybarInput.dataset.valid = "false";
      setTimeout(() => $keybarInput.classList.remove("llm-keybar__input--shake"), 500);
      return;
    }
    setApiKey(val);
    $keybarInput.value = "";
    $keybarInput.dataset.valid = "";
    _setKeybarLocked(true);
    setStatus("ready", "READY");
    restoreHistory();
    appendSysLog("API key validated and locked. Uplink authenticated — ready to transmit.");
  });

  $keybarUnlock.addEventListener("click", () => {
    clearApiKey();
    _setKeybarLocked(false);
    setStatus("error", "KEY REQUIRED");
    appendSysLog("API key removed. Enter a new key to re-authenticate.");
  });

  const REFERRAL_URL = referralConfig?.referral_url ?? "https://nano-gpt.com/subscription/ACDtKPdM";
  const DIRECT_URL   = referralConfig?.direct_url   ?? "https://nano-gpt.com";
  const SVC_DESC     = referralConfig?.description  ?? "nano-gpt provides subscription-based access to 20+ models including DeepSeek R1, Claude, GPT, and Llama — at flat monthly cost, no per-token billing for included models.";

  $keybarGetkey.addEventListener("click", () => {
    const $modal = document.createElement("div");
    $modal.className = "llm-keymodal";
    $modal.innerHTML = `
      <div class="llm-keymodal__box">
        <div class="llm-keymodal__header">
          <i data-lucide="key-round" class="llm-keymodal__icon"></i>
          <span class="llm-keymodal__title">Get a nano-gpt API Key</span>
        </div>
        <p class="llm-keymodal__body">
          ${esc(SVC_DESC)}
        </p>
        <p class="llm-keymodal__body llm-keymodal__body--muted">
          Would you like to use the site owner's referral link? It costs you nothing and supports this infrastructure.
        </p>
        <div class="llm-keymodal__actions">
          <button class="llm-keymodal__btn llm-keymodal__btn--primary" data-action="referral">
            <i data-lucide="heart"></i> Use Referral Link
          </button>
          <button class="llm-keymodal__btn llm-keymodal__btn--secondary" data-action="direct">
            <i data-lucide="external-link"></i> Go Direct
          </button>
          <button class="llm-keymodal__btn llm-keymodal__btn--ghost" data-action="close">
            Cancel
          </button>
        </div>
      </div>`;
    document.body.appendChild($modal);
    if (typeof lucide !== "undefined") lucide.createIcons({ nodes: [$modal] });
    $modal.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      if (action === "referral") window.open(REFERRAL_URL, "_blank", "noopener");
      if (action === "direct")   window.open(DIRECT_URL,   "_blank", "noopener");
      $modal.remove();
    });
  });

  return { setKeybarLocked: _setKeybarLocked };
}
