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

// API key is session-scoped only — never written to localStorage
let _apiKey = "";

export function getApiKey()       { return _apiKey; }
export function setApiKey(k)      { _apiKey = k; }
export function clearApiKey()     { _apiKey = ""; }
export function hasStoredKey()    { return !!_apiKey && isValidKeyFormat(_apiKey); }

export function initKeybar({
  llm, PROXY_MODE, hasValidKey,
  $keybar, $keybarInputWrap, $keybarInput, $keybarToggle, $keybarSave,
  $keybarGetkey, $keybarLocked, $keybarUnlock,
  $input, $sendBtn,
  setKeybarLocked, setStatus, restoreHistory, appendSysLog,
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
    if (typeof lucide !== "undefined") lucide.createIcons();
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
    if (typeof lucide !== "undefined") lucide.createIcons();
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

  const REFERRAL_URL = "https://nano-gpt.com/subscription/ACDtKPdM";
  const DIRECT_URL   = "https://nano-gpt.com";

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
          nano-gpt provides subscription-based access to 20+ models including DeepSeek R1, Claude, GPT, and Llama — at flat monthly cost, no per-token billing for included models.
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
