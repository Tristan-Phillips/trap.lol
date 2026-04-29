// Neural Uplink — Authentication & Security
import { esc } from './core.js';

export const KEY_REGEX = /^sk-nano-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE_NAME = "llm_ak";

export function isValidKeyFormat(k) { 
  return typeof k === 'string' && KEY_REGEX.test(k.trim()); 
}

export function purgeLegacyKeyStorage() {
  ["llm_api_key"].forEach(k => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
}

const Cookie = {
  set(val, days = 1) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(val)}; expires=${expires}; path=/; SameSite=Strict`;
  },
  get() {
    const match = document.cookie.match(new RegExp('(^| )' + COOKIE_NAME + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : "";
  },
  clear() {
    document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict`;
  }
};

let _apiKey = "";

export const getApiKey = () => _apiKey;
export const setApiKey = (k) => { _apiKey = k; Cookie.set(k); };
export const clearApiKey = () => { _apiKey = ""; Cookie.clear(); };
export const hasStoredKey = () => !!_apiKey && isValidKeyFormat(_apiKey);

export function restoreKeyFromCookie() {
  const stored = Cookie.get();
  if (isValidKeyFormat(stored)) {
    _apiKey = stored;
    return true;
  }
  Cookie.clear();
  return false;
}

export function initKeybar(ctx) {
  const { 
    ui, auth, callbacks, config 
  } = ctx;

  const $input = ui.keybar.querySelector("#llm-keybar-input");
  const $toggle = ui.keybar.querySelector("#llm-keybar-toggle");
  const $save = ui.keybar.querySelector("#llm-keybar-save");
  const $unlock = ui.keybar.querySelector("#llm-keybar-unlock");
  const $getkey = ui.keybar.querySelector("#llm-keybar-getkey");
  const $label = ui.keybar.querySelector(".llm-keybar__locked-label");

  function setLocked(locked) {
    ui.keybar.dataset.locked = locked;
    ui.keybar.querySelector("#llm-keybar-input-wrap").hidden = locked;
    ui.keybar.querySelector("#llm-keybar-locked").hidden = !locked;
    
    if ($label) {
      const valid = auth.hasValidKey();
      $label.dataset.valid = valid;
      $label.textContent = valid ? "Key Active" : "Invalid Key";
    }

    callbacks.onLockChange(locked);
    if (locked && window.lucide) window.lucide.createIcons({ nodes: [ui.keybar] });
  }

  $input.addEventListener("input", () => {
    const val = $input.value.trim();
    $input.dataset.valid = val ? isValidKeyFormat(val) : "";
  });

  if (auth.PROXY_MODE) {
    ui.keybar.hidden = true;
  } else {
    setLocked(auth.hasValidKey());
  }

  $toggle.addEventListener("click", () => {
    const isPass = $input.type === "password";
    $input.type = isPass ? "text" : "password";
    $toggle.innerHTML = `<i data-lucide="${isPass ? "eye-off" : "eye"}"></i>`;
    if (window.lucide) window.lucide.createIcons({ nodes: [$toggle] });
  });

  $save.addEventListener("click", () => {
    const val = $input.value.trim();
    if (!isValidKeyFormat(val)) {
      $input.classList.add("llm-keybar__input--shake");
      setTimeout(() => $input.classList.remove("llm-keybar__input--shake"), 500);
      return;
    }
    setApiKey(val);
    $input.value = "";
    setLocked(true);
    callbacks.onAuthSuccess();
  });

  $unlock.addEventListener("click", () => {
    clearApiKey();
    setLocked(false);
    callbacks.onAuthRevoke();
  });

  $getkey.addEventListener("click", () => {
    const referral = config?.referrals?.nano_gpt || {};
    const modal = document.createElement("div");
    modal.className = "llm-keymodal";
    modal.innerHTML = `
      <div class="llm-keymodal__box">
        <div class="llm-keymodal__header">
          <i data-lucide="key-round" class="llm-keymodal__icon"></i>
          <span class="llm-keymodal__title">Uplink Authorization</span>
        </div>
        <p class="llm-keymodal__body">${esc(referral.description || "Access 20+ premium models via nano-gpt.")}</p>
        <div class="llm-keymodal__actions">
          <button class="llm-keymodal__btn llm-keymodal__btn--primary" data-action="referral">Use Referral</button>
          <button class="llm-keymodal__btn llm-keymodal__btn--secondary" data-action="direct">Go Direct</button>
          <button class="llm-keymodal__btn llm-keymodal__btn--ghost" data-action="close">Cancel</button>
        </div>
      </div>`;
    
    document.body.appendChild(modal);
    if (window.lucide) window.lucide.createIcons({ nodes: [modal] });
    
    modal.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      if (action === "referral") window.open(referral.referral_url || "https://nano-gpt.com", "_blank");
      if (action === "direct") window.open(referral.direct_url || "https://nano-gpt.com", "_blank");
      modal.remove();
    });
  });
}
