// Neural Uplink — Settings & Persistence
const SETTINGS_KEY = "llm_settings";
const STORAGE_SALT = "TRAP_SOVEREIGN_2026";

/**
 * Basic obfuscation to prevent casual inspection of localStorage.
 */
function _transform(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode(str.charCodeAt(i) ^ STORAGE_SALT.charCodeAt(i % STORAGE_SALT.length));
  }
  return out;
}

export function _pack(obj) {
  const str = _transform(JSON.stringify(obj));
  return btoa(unescape(encodeURIComponent(str)));
}

export function _unpack(raw) {
  if (!raw) return null;
  try {
    const str = _transform(decodeURIComponent(escape(atob(raw))));
    return JSON.parse(str);
  } catch (e) {
    try { return JSON.parse(raw); } catch { return null; }
  }
}

export function syncToggle($btn, active) {
  $btn.dataset.active = active;
  $btn.setAttribute("aria-checked", active);
  $btn.querySelector(".llm-panel__toggle-label").textContent = active ? "On" : "Off";
}

export function persistSettings(cfg) {
  localStorage.setItem(SETTINGS_KEY, _pack({
    tempOverride: cfg.tempOverride,
    maxCtxTurns: cfg.maxCtxTurns,
    streaming: cfg.streaming,
    enterToSend: cfg.enterToSend,
    systemPrompt: cfg.systemPrompt,
    selectedAgent: cfg.selectedAgent,
  }));
}

export const restoreSettings = () => _unpack(localStorage.getItem(SETTINGS_KEY)) || {};

export function initSettingsControls(ctx) {
  const { ui, cfg, auth, model, callbacks } = ctx;

  ui.settingsBtn.addEventListener("click", () => {
    if (auth.gated()) return;
    const isVisible = !ui.settingsPanel.hidden;
    callbacks.closeAllPanels();
    if (!isVisible) {
      ui.settingsPanel.hidden = false;
      ui.settingsBtn.classList.add("llm-shell__action-btn--active");
      if (window.lucide) window.lucide.createIcons();
    }
  });

  ui.syspromptInput.addEventListener("input", () => {
    cfg.systemPrompt = ui.syspromptInput.value;
    persistSettings(cfg);
  });

  ui.tempInput.addEventListener("input", () => {
    cfg.tempOverride = parseFloat(ui.tempInput.value);
    ui.tempVal.textContent = cfg.tempOverride.toFixed(2);
    persistSettings(cfg);
  });

  ui.tempVal.addEventListener("dblclick", () => {
    cfg.tempOverride = null;
    ui.tempInput.value = model.getSelected()?.recommended_inference?.temperature ?? 0.7;
    ui.tempVal.textContent = "auto";
    persistSettings(cfg);
  });

  ui.ctxInput.addEventListener("input", () => {
    cfg.maxCtxTurns = parseInt(ui.ctxInput.value, 10);
    ui.ctxVal.textContent = `${cfg.maxCtxTurns} turns`;
    persistSettings(cfg);
  });

  ui.ctxVal.addEventListener("dblclick", () => {
    cfg.maxCtxTurns = null;
    ui.ctxInput.value = ui.ctxInput.min;
    ui.ctxVal.textContent = "unlimited";
    persistSettings(cfg);
  });

  ui.toggleStream.addEventListener("click", () => {
    cfg.streaming = !cfg.streaming;
    syncToggle(ui.toggleStream, cfg.streaming);
    persistSettings(cfg);
  });

  ui.toggleEnter.addEventListener("click", () => {
    cfg.enterToSend = !cfg.enterToSend;
    syncToggle(ui.toggleEnter, cfg.enterToSend);
    persistSettings(cfg);
  });
}
