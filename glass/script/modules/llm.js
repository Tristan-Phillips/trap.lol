// Neural Uplink — Orchestrator
import { config, llmData, fetchJSON, esc } from './core.js';
import * as Auth from './llm-auth.js';
import * as Settings from './llm-settings.js';
import * as Sessions from './llm-sessions.js';
import * as Chat from './llm-chat.js';

export function initLLM() {
  const llm = config.llm;
  const $section = document.getElementById("playground-section") ?? document.getElementById("llm-section");

  if (!(llm?.enabled && $section && llmData)) return;
  $section.classList.remove("hidden");

  // --- UI References ---
  const ui = {
    shell:           document.getElementById("llm-shell"),
    messages:        document.getElementById("llm-messages"),
    form:            document.getElementById("llm-form"),
    input:           document.getElementById("llm-input"),
    sendBtn:         document.getElementById("llm-send-btn"),
    clearBtn:        document.getElementById("llm-clear-btn"),
    newBtn:          document.getElementById("llm-new-btn"),
    quicksaveBtn:    document.getElementById("llm-quicksave-btn"),
    statusDot:       document.getElementById("llm-status-dot"),
    statusLabel:     document.getElementById("llm-status-label"),
    statTurns:       document.getElementById("llm-stat-turns")?.querySelector("span"),
    statTokens:      document.getElementById("llm-stat-tokens")?.querySelector("span"),
    statChars:       document.getElementById("llm-stat-chars")?.querySelector("span"),
    charStat:        document.getElementById("llm-stat-chars"),
    modelSelect:     document.getElementById("llm-model-select"),
    providerBadge:   document.getElementById("llm-provider-badge"),
    keybar:          document.getElementById("llm-keybar"),
    settingsBtn:     document.getElementById("llm-settings-btn"),
    settingsPanel:   document.getElementById("llm-settings-panel"),
    sessionsBtn:     document.getElementById("llm-sessions-btn"),
    sessionsPanel:   document.getElementById("llm-sessions-panel"),
    agentSelect:     document.getElementById("llm-agent-select"),
    syspromptInput:  document.getElementById("llm-sysprompt-input"),
    tempInput:       document.getElementById("llm-temp-input"),
    tempVal:         document.getElementById("llm-temp-val"),
    ctxInput:        document.getElementById("llm-ctx-input"),
    ctxVal:          document.getElementById("llm-ctx-val"),
    toggleStream:    document.getElementById("llm-toggle-stream"),
    toggleEnter:     document.getElementById("llm-toggle-enter"),
    sessionSave:     document.getElementById("llm-session-save"),
    sessionExpJSON:  document.getElementById("llm-session-export-json"),
    sessionExpMD:    document.getElementById("llm-session-export-md"),
    sessionImport:   document.getElementById("llm-session-import"),
    sessionList:     document.getElementById("llm-session-list"),
    sessionsBulk:    document.getElementById("llm-sessions-bulk"),
    sessionsSelectAll:  document.getElementById("llm-sessions-select-all"),
    sessionsBulkCount:  document.getElementById("llm-sessions-bulk-count"),
    sessionsBulkDelete: document.getElementById("llm-sessions-bulk-delete"),

    setStatus(state, label) {
      this.statusDot.dataset.state = state;
      this.statusLabel.textContent = label;
      this.shell.dataset.state = state;
    },
    setLoading(active) {
      const isGated = !Auth.hasStoredKey() && !llm.api_base?.includes("nano-gpt.com");
      this.input.disabled = active || isGated;
      this.sendBtn.classList.toggle("llm-shell__send--stop", active);
      this.sendBtn.innerHTML = `<i data-lucide="${active ? "square" : "send"}"></i>`;
      if (window.lucide) window.lucide.createIcons({ nodes: [this.sendBtn] });
    },
    getShellState() { return this.shell.dataset.state; }
  };

  // --- Runtime State ---
  const state = {
    history: [],
    turnCount: 0,
    tokenCount: 0,
    _restored: false
  };

  const cfg = {
    tempOverride:  null,
    maxCtxTurns:   null,
    streaming:     true,
    enterToSend:   true,
    systemPrompt:  "",
    selectedAgent: ""
  };

  const PROXY_MODE = llm.api_base && !llm.api_base.includes("nano-gpt.com");

  // --- Helpers ---
  const modelMap = new Map();
  const agentMap = new Map();

  function buildSystemPrompt() {
    return cfg.systemPrompt || (llm.system_prompt ?? "You are a helpful assistant.");
  }

  function updateStats() {
    state.turnCount = state.history.filter(m => m.role === "user").length;
    state.tokenCount = state.history.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
    if (ui.statTurns) ui.statTurns.textContent = state.turnCount;
    if (ui.statTokens) {
      ui.statTokens.textContent = state.tokenCount > 999 
        ? `${(state.tokenCount / 1000).toFixed(1)}k` : state.tokenCount;
    }
  }

  function updateProviderBadge() {
    const m = modelMap.get(ui.modelSelect.value);
    if (!m) return;
    ui.providerBadge.textContent = `${m.provider} // ${m.context_k}k ctx · ${m.pay_per_token ? "pay/tok" : "sub"}`;
    ui.modelSelect.dataset.paid = m.pay_per_token;
  }

  function closeAllPanels() {
    ui.settingsPanel.hidden = ui.sessionsPanel.hidden = true;
    ui.settingsBtn.classList.remove("llm-shell__action-btn--active");
    ui.sessionsBtn.classList.remove("llm-shell__action-btn--active");
  }

  // --- Initialization ---
  Auth.purgeLegacyKeyStorage();
  if (!PROXY_MODE) Auth.restoreKeyFromCookie();

  // Populate Models
  llmData._index.forEach(({ family, models: ids }) => {
    const group = document.createElement("optgroup");
    group.label = family;
    ids.forEach(id => {
      const entry = llmData.routing_table[id];
      if (!entry) return;
      modelMap.set(id, { ...entry, id });
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = `${entry.pay_per_token ? "\u25C6" : "\u2726"} ${entry.label}`;
      if (id === llmData.default_routing) opt.selected = true;
      group.appendChild(opt);
    });
    if (group.children.length) ui.modelSelect.appendChild(group);
  });

  const ctx = {
    ui, state, cfg, llm,
    auth: {
      PROXY_MODE,
      getApiKey: Auth.getApiKey,
      hasValidKey: () => PROXY_MODE || Auth.hasStoredKey(),
      gated: () => !PROXY_MODE && !Auth.hasStoredKey()
    },
    model: {
      getSelected: () => modelMap.get(ui.modelSelect.value) || modelMap.values().next().value
    },
    callbacks: {
      updateStats,
      onModelChange: updateProviderBadge,
      closeAllPanels,
      buildSystemPrompt,
      appendMessage: (role, text) => Chat.appendMessage(ui.messages, state.history, role, text),
      onLoadSuccess: (msg) => Chat.appendSysLog(ui.messages, msg),
      persistHistory: () => Sessions.persistHistory({ 
        history: state.history, 
        turnCount: state.turnCount, 
        tokenCount: state.tokenCount, 
        model: ui.modelSelect.value 
      })
    }
  };

  // Sub-module Inits
  Auth.initKeybar({
    ...ctx,
    config,
    callbacks: {
      ...ctx.callbacks,
      onLockChange: (locked) => {
        ui.shell.classList.toggle("llm-shell--keygated", !locked);
        ui.input.disabled = !locked;
        ui.sendBtn.disabled = !locked;
      },
      onAuthSuccess: () => {
        ui.setStatus("ready", "READY");
        if (!state._restored) {
          state._restored = true;
          Sessions.restoreHistory(ctx);
        }
        Chat.appendSysLog(ui.messages, "Uplink authenticated.");
      },
      onAuthRevoke: () => {
        ui.setStatus("error", "KEY REQUIRED");
        Chat.appendSysLog(ui.messages, "API key removed.");
      }
    }
  });

  Settings.initSettingsControls(ctx);
  Sessions.initSessions(ctx);
  Chat.initChatEvents({ 
    $messages: ui.messages, 
    history: state.history, 
    updateStats,
    sendMessage: (text) => Chat.sendMessage({ ...ctx, userText: text })
  });

  // Apply Settings
  (function applyRestored() {
    const saved = Settings.restoreSettings();
    Object.assign(cfg, saved);
    if (saved.tempOverride != null) {
      ui.tempInput.value = saved.tempOverride;
      ui.tempVal.textContent = saved.tempOverride.toFixed(2);
    }
    if (saved.maxCtxTurns != null) {
      ui.ctxInput.value = saved.maxCtxTurns;
      ui.ctxVal.textContent = `${saved.maxCtxTurns} turns`;
    }
    Settings.syncToggle(ui.toggleStream, cfg.streaming);
    Settings.syncToggle(ui.toggleEnter, cfg.enterToSend);
    if (saved.systemPrompt) ui.syspromptInput.value = saved.systemPrompt;
  })();

  // Agents Logic
  const applyAgent = (d) => {
    cfg.systemPrompt = d.system_prompt || d.description || "";
    ui.syspromptInput.value = cfg.systemPrompt;
  };

  fetchJSON(`/glass/data/llm-agents/default.json`).then(card => {
    const data = card.spec ? card.data : card;
    agentMap.set("default", { id: "default", name: data.name || "Default", data });
    if (!cfg.selectedAgent) applyAgent(data);
  }).catch(() => {});

  fetchJSON(`/glass/data/llm-agents/index.json`).then(files => {
    if (!Array.isArray(files)) return;
    files.filter(f => !f.includes("default")).forEach(f => {
      fetchJSON(`/glass/data/llm-agents/${f}`).then(card => {
        const data = card.spec ? card.data : card;
        const id = f.replace(".json", "");
        agentMap.set(id, { id, name: data.name || id, data });
        const opt = document.createElement("option");
        opt.value = id; opt.textContent = data.name || id;
        ui.agentSelect.appendChild(opt);
        if (cfg.selectedAgent === id) ui.agentSelect.value = id;
      });
    });
  }).catch(() => {});

  ui.agentSelect.addEventListener("change", () => {
    const id = ui.agentSelect.value;
    cfg.selectedAgent = id;
    const entry = agentMap.get(id || "default");
    if (entry) {
      applyAgent(entry.data);
      if (!ctx.auth.gated()) Chat.appendSysLog(ui.messages, `Agent: ${entry.name}`);
    }
    Settings.persistSettings(cfg);
  });

  // --- Event Listeners ---
  ui.modelSelect.addEventListener("change", () => {
    if (ctx.auth.gated()) return;
    updateProviderBadge();
    const m = ctx.model.getSelected();
    Chat.appendSysLog(ui.messages, `Model → ${m.label} (${m.provider})`);
  });

  ui.input.addEventListener("input", () => {
    ui.input.style.height = "auto";
    ui.input.style.height = Math.min(ui.input.scrollHeight, 200) + "px";
    const len = ui.input.value.length;
    if (ui.statChars) ui.statChars.textContent = len;
    if (ui.charStat) ui.charStat.dataset.warn = len > 6000 ? "critical" : len > 3000 ? "warn" : "";
  });

  ui.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && cfg.enterToSend) {
      e.preventDefault(); ui.form.requestSubmit();
    }
  });

  ui.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (ui.sendBtn.classList.contains("llm-shell__send--stop")) {
      Chat.sendMessage._currentAbort?.abort();
      return;
    }
    const text = ui.input.value.trim();
    if (!text || ctx.auth.gated()) return;

    ui.input.value = ""; ui.input.style.height = "auto";
    if (ui.statChars) ui.statChars.textContent = "0";
    closeAllPanels();
    Chat.sendMessage({ ...ctx, userText: text });
  });

  ui.clearBtn.addEventListener("click", () => {
    if (ctx.auth.gated()) return;
    state.history.length = 0;
    updateStats();
    ui.messages.innerHTML = "";
    ctx.callbacks.persistHistory();
    Chat.appendSysLog(ui.messages, "Context purged.");
  });

  ui.newBtn.addEventListener("click", () => {
    if (ctx.auth.gated()) return;
    if (state.turnCount > 0) {
      const sessions = Sessions.getSessions();
      sessions[Date.now()] = Sessions.createSnapshot({ 
        name: `Auto ${new Date().toLocaleString()}`, 
        modelId: ui.modelSelect.value, 
        state, cfg 
      });
      Sessions.saveSessions(sessions);
    }
    state.history.length = 0;
    updateStats();
    ui.messages.innerHTML = "";
    ctx.callbacks.persistHistory();
    closeAllPanels();
    ui.input.focus();
  });

  ui.quicksaveBtn.addEventListener("click", () => {
    if (ctx.auth.gated() || !state.history.length) return;
    const sessions = Sessions.getSessions();
    const name = `[QS] ${ctx.model.getSelected()?.label} — ${new Date().toLocaleTimeString()}`;
    sessions[Date.now()] = Sessions.createSnapshot({ name, modelId: ui.modelSelect.value, state, cfg });
    Sessions.saveSessions(sessions);
    ui.quicksaveBtn.classList.add("llm-shell__action-btn--saved");
    setTimeout(() => ui.quicksaveBtn.classList.remove("llm-shell__action-btn--saved"), 1500);
    Chat.appendSysLog(ui.messages, `Quick-saved: ${name}`);
  });

  // Auto-persist history on change
  new MutationObserver(() => ctx.callbacks.persistHistory()).observe(ui.messages, { childList: true });

  // Boot logic
  const bootTs = document.getElementById("llm-boot-ts");
  if (bootTs) bootTs.textContent = new Date().toTimeString().slice(0, 8);
  document.getElementById("llm-boot-dismiss")?.addEventListener("click", function() {
    this.closest(".llm-msg")?.remove();
  });

  if (PROXY_MODE) {
    ui.setStatus("thinking", "CHECKING AUTH...");
    fetch(`${llm.api_base.replace(/\/v1\/?$/, "")}/health`, { credentials: "include" })
      .then(async res => {
        if (res.ok && res.headers.get("content-type")?.includes("json")) {
          const data = await res.json();
          if (data.auth_url) llm._proxyAuthUrl = data.auth_url;
          ui.setStatus("ready", "READY");
          Sessions.restoreHistory(ctx);
        } else {
          ui.setStatus("error", "AUTH REQUIRED");
          const url = llm._proxyAuthUrl || llm.auth_url;
          Chat.appendSysLog(ui.messages, `Authentication required. <a href="${esc(url)}" class="llm-msg__auth-link">Authenticate →</a>`, true);
        }
      })
      .catch(() => ui.setStatus("error", "PROXY UNREACHABLE"));
  } else if (Auth.hasStoredKey()) {
    ui.setStatus("ready", "READY");
    Sessions.restoreHistory(ctx);
  } else {
    ui.setStatus("error", "KEY REQUIRED");
  }

  updateProviderBadge();
}

