// Neural Uplink — settings persistence & controls
import { esc } from './core.js';

const SETTINGS_KEY = "llm_settings";

// XOR obfuscation — not cryptographic; prevents casual inspection of localStorage
const STORAGE_SALT = "TRAP_SOVEREIGN_2026";

export function _pack(obj) {
  const str = JSON.stringify(obj);
  let out = "";
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode(str.charCodeAt(i) ^ STORAGE_SALT.charCodeAt(i % STORAGE_SALT.length));
  }
  return btoa(unescape(encodeURIComponent(out)));
}

export function _unpack(raw) {
  if (!raw) return null;
  try {
    const str = decodeURIComponent(escape(atob(raw)));
    let out = "";
    for (let i = 0; i < str.length; i++) {
      out += String.fromCharCode(str.charCodeAt(i) ^ STORAGE_SALT.charCodeAt(i % STORAGE_SALT.length));
    }
    return JSON.parse(out);
  } catch (e) {
    try { return JSON.parse(raw); } catch (_) { return null; }
  }
}

export function syncToggle($btn, active) {
  $btn.dataset.active = active ? "true" : "false";
  $btn.setAttribute("aria-checked", active ? "true" : "false");
  $btn.querySelector(".llm-panel__toggle-label").textContent = active ? "On" : "Off";
}

export function persistSettings(cfg) {
  localStorage.setItem(SETTINGS_KEY, _pack({
    tempOverride:  cfg.tempOverride,
    maxCtxTurns:   cfg.maxCtxTurns,
    streaming:     cfg.streaming,
    enterToSend:   cfg.enterToSend,
    systemPrompt:  cfg.systemPrompt,
    selectedAgent: cfg.selectedAgent,
  }));
}

export function restoreSettings() {
  return _unpack(localStorage.getItem(SETTINGS_KEY)) || {};
}

export function initSettingsControls({
  cfg, hasValidKey,
  $settingsBtn, $settingsPanel, $sessionsBtn, $sessionsPanel,
  $syspromptInput, $tempInput, $tempVal, $ctxInput, $ctxVal,
  $toggleStream, $toggleEnter,
  closeAllPanels, getSelectedModel, appendSysLog,
}) {
  function gated() { return !hasValidKey(); }

  $settingsBtn.addEventListener("click", () => {
    if (gated()) return;
    const wasHidden = $settingsPanel.hidden;
    closeAllPanels();
    if (wasHidden) {
      $settingsPanel.hidden = false;
      $settingsBtn.classList.add("llm-shell__action-btn--active");
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
  });

  $syspromptInput.addEventListener("input", () => {
    cfg.systemPrompt = $syspromptInput.value;
    persistSettings(cfg);
  });

  $tempInput.addEventListener("input", () => {
    const v = parseFloat($tempInput.value);
    cfg.tempOverride = v;
    $tempVal.textContent = v.toFixed(2);
    persistSettings(cfg);
  });

  $tempVal.addEventListener("dblclick", () => {
    cfg.tempOverride = null;
    $tempInput.value = getSelectedModel()?.recommended_inference?.temperature ?? 0.7;
    $tempVal.textContent = "auto";
    persistSettings(cfg);
  });

  $ctxInput.addEventListener("input", () => {
    const v = parseInt($ctxInput.value, 10);
    cfg.maxCtxTurns = v;
    $ctxVal.textContent = `${v} turns`;
    persistSettings(cfg);
  });

  $ctxVal.addEventListener("dblclick", () => {
    cfg.maxCtxTurns = null;
    $ctxInput.value = $ctxInput.min;
    $ctxVal.textContent = "unlimited";
    persistSettings(cfg);
  });

  $toggleStream.addEventListener("click", () => {
    cfg.streaming = !cfg.streaming;
    syncToggle($toggleStream, cfg.streaming);
    persistSettings(cfg);
  });

  $toggleEnter.addEventListener("click", () => {
    cfg.enterToSend = !cfg.enterToSend;
    syncToggle($toggleEnter, cfg.enterToSend);
    persistSettings(cfg);
  });
}
