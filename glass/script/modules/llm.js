// Neural Uplink — orchestrator
import { config, llmData, fetchJSON, esc } from './core.js';
import { isValidKeyFormat, purgeLegacyKeyStorage, getApiKey, setApiKey, clearApiKey, hasStoredKey, initKeybar } from './llm-auth.js';
import { _pack, _unpack, syncToggle, persistSettings, restoreSettings, initSettingsControls } from './llm-settings.js';
import { getSessions, saveSessions, persistHistory, sessionSnapshot, initSessions, restoreHistory as _restoreHistory, HISTORY_KEY } from './llm-sessions.js';
import { sanitizeHtml, renderMarkdown, appendSysLog as _appendSysLog, appendSysLogHTML as _appendSysLogHTML, appendMessage as _appendMessage, initChatEvents, sendMessage as _sendMessage } from './llm-chat.js';

export function initLLM({ base = "" } = {}) {
  const llm         = config.llm;
  const $llmSection = document.getElementById("playground-section") ?? document.getElementById("llm-section");

  if (!(llm && llm.enabled && $llmSection && llmData)) return;
  $llmSection.classList.remove("hidden");

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const $shell           = document.getElementById("llm-shell");
  const $modelSelect     = document.getElementById("llm-model-select");
  const $providerBadge   = document.getElementById("llm-provider-badge");
  const $messages        = document.getElementById("llm-messages");
  const $form            = document.getElementById("llm-form");
  const $input           = document.getElementById("llm-input");
  const $sendBtn         = document.getElementById("llm-send-btn");
  const $clearBtn        = document.getElementById("llm-clear-btn");
  const $newBtn          = document.getElementById("llm-new-btn");
  const $quicksaveBtn    = document.getElementById("llm-quicksave-btn");
  const $statusDot       = document.getElementById("llm-status-dot");
  const $statusLabel     = document.getElementById("llm-status-label");
  const $statTurns       = document.getElementById("llm-stat-turns")?.querySelector("span");
  const $statTokens      = document.getElementById("llm-stat-tokens")?.querySelector("span");
  const $statChars       = document.getElementById("llm-stat-chars")?.querySelector("span");
  const $charStat        = document.getElementById("llm-stat-chars");
  const $bootTs          = document.getElementById("llm-boot-ts");
  const $keybar          = document.getElementById("llm-keybar");
  const $keybarInputWrap = document.getElementById("llm-keybar-input-wrap");
  const $keybarInput     = document.getElementById("llm-keybar-input");
  const $keybarToggle    = document.getElementById("llm-keybar-toggle");
  const $keybarSave      = document.getElementById("llm-keybar-save");
  const $keybarGetkey    = document.getElementById("llm-keybar-getkey");
  const $keybarLocked    = document.getElementById("llm-keybar-locked");
  const $keybarUnlock    = document.getElementById("llm-keybar-unlock");
  const $settingsBtn     = document.getElementById("llm-settings-btn");
  const $settingsPanel   = document.getElementById("llm-settings-panel");
  const $agentSelect     = document.getElementById("llm-agent-select");
  const $syspromptInput  = document.getElementById("llm-sysprompt-input");
  const $tempInput       = document.getElementById("llm-temp-input");
  const $tempVal         = document.getElementById("llm-temp-val");
  const $ctxInput        = document.getElementById("llm-ctx-input");
  const $ctxVal          = document.getElementById("llm-ctx-val");
  const $toggleStream    = document.getElementById("llm-toggle-stream");
  const $toggleEnter     = document.getElementById("llm-toggle-enter");
  const $sessionsBtn     = document.getElementById("llm-sessions-btn");
  const $sessionsPanel   = document.getElementById("llm-sessions-panel");
  const $sessionSave     = document.getElementById("llm-session-save");
  const $sessionExpJSON  = document.getElementById("llm-session-export-json");
  const $sessionExpMD    = document.getElementById("llm-session-export-md");
  const $sessionImport   = document.getElementById("llm-session-import");
  const $sessionList     = document.getElementById("llm-session-list");
  const $sessionsBulk       = document.getElementById("llm-sessions-bulk");
  const $sessionsSelectAll  = document.getElementById("llm-sessions-select-all");
  const $sessionsBulkCount  = document.getElementById("llm-sessions-bulk-count");
  const $sessionsBulkDelete = document.getElementById("llm-sessions-bulk-delete");

  // ── Runtime state ─────────────────────────────────────────────────────────
  const history  = [];
  let turnCount  = 0;
  let tokenCount = 0;
  let _historyRestored = false;

  const cfg = {
    tempOverride:  null,
    maxCtxTurns:   null,
    streaming:     true,
    enterToSend:   true,
    systemPrompt:  "",
    selectedAgent: "",
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function ts() { return new Date().toTimeString().slice(0, 8); }
  function estimateTokens(t) { return Math.ceil(t.length / 4); }

  function buildCompositeSystemPrompt() {
    return cfg.systemPrompt || (llm.system_prompt ?? "You are a helpful assistant.");
  }

  function updateStats() {
    turnCount  = history.filter(m => m.role === "user").length;
    tokenCount = history.reduce((acc, m) => acc + estimateTokens(m.content), 0);
    if ($statTurns)  $statTurns.textContent  = turnCount;
    if ($statTokens) $statTokens.textContent = tokenCount > 999
      ? `${(tokenCount / 1000).toFixed(1)}k` : tokenCount;
  }

  function setStatus(state, label) {
    $statusDot.dataset.state = state;
    $statusLabel.textContent = label;
    $shell.dataset.state     = state;
  }

  const PROXY_MODE = llm.api_base && !llm.api_base.includes("nano-gpt.com");

  function hasValidKey() {
    if (PROXY_MODE) return true;
    return hasStoredKey();
  }

  function gated() { return !hasValidKey(); }

  function closeAllPanels() {
    $settingsPanel.hidden = true;
    $sessionsPanel.hidden = true;
    $settingsBtn.classList.remove("llm-shell__action-btn--active");
    $sessionsBtn.classList.remove("llm-shell__action-btn--active");
  }

  // ── Bound message helpers (capture $messages) ─────────────────────────────
  function appendSysLog(text)    { _appendSysLog($messages, text); }
  function appendSysLogHTML(html){ _appendSysLogHTML($messages, html); }
  function appendMessage(role, text, streaming) { return _appendMessage($messages, history, role, text, streaming); }

  // ── Purge any stale key storage from prior versions ───────────────────────
  purgeLegacyKeyStorage();

  // ── Keybar state tracker (for shell class) ────────────────────────────────
  let _keybarLocked = false;
  function setKeybarLocked(locked) {
    _keybarLocked = locked;
    $shell.classList.toggle("llm-shell--keygated", !locked);
  }

  // ── Model selector ────────────────────────────────────────────────────────
  const modelMap = new Map();

  llmData._index.forEach(({ family, models: ids }) => {
    const $group = document.createElement("optgroup");
    $group.label = family;
    ids.forEach((id) => {
      const entry = llmData.routing_table[id];
      if (!entry) return;
      modelMap.set(id, { ...entry, id });
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = entry.pay_per_token
        ? `\u25C6 ${entry.label}` : `\u2726 ${entry.label}`;
      opt.dataset.paid = entry.pay_per_token ? "true" : "false";
      if (id === llmData.default_routing) opt.selected = true;
      $group.appendChild(opt);
    });
    if ($group.children.length) $modelSelect.appendChild($group);
  });

  function getSelectedModel() {
    return modelMap.get($modelSelect.value) || modelMap.values().next().value;
  }

  function updateProviderBadge() {
    const m = getSelectedModel();
    if (!m) return;
    $providerBadge.textContent = `${m.provider} // ${m.context_k}k ctx · ${m.pay_per_token ? "pay/tok" : "sub"}`;
    $modelSelect.dataset.paid  = m.pay_per_token ? "true" : "false";
  }

  // ── Loading state (also handles abort via stop button) ────────────────────
  function setLoading(active) {
    const isGated = gated();
    $input.disabled = active || isGated;
    if (active) {
      $sendBtn.disabled = false;
      $sendBtn.classList.add("llm-shell__send--stop");
      $sendBtn.classList.remove("llm-shell__send--loading");
      $sendBtn.innerHTML = `<i data-lucide="square"></i>`;
      if (typeof lucide !== "undefined") lucide.createIcons({ nodes: [$sendBtn] });
    } else {
      $sendBtn.disabled = isGated;
      $sendBtn.classList.remove("llm-shell__send--stop", "llm-shell__send--loading");
      $sendBtn.innerHTML = `<i data-lucide="send"></i>`;
      if (typeof lucide !== "undefined") lucide.createIcons({ nodes: [$sendBtn] });
    }
  }

  // ── Session state accessors (for llm-sessions.js) ─────────────────────────
  function getState() { return { history, turnCount, tokenCount }; }
  function setState({ turnCount: tc, tokenCount: tok }) {
    turnCount  = tc;
    tokenCount = tok;
  }

  // ── Session persistence helpers (pass to sendMessage) ────────────────────
  function _persistHistory() {
    persistHistory({ history, turnCount, tokenCount, model: $modelSelect.value });
  }

  // ── Bound sendMessage ─────────────────────────────────────────────────────
  // In-flight guard: only one send can be active at a time
  let _sending = false;

  async function doSend(userText) {
    if (_sending) return;
    _sending = true;
    try {
      await _sendMessage({
        userText, history, cfg, llm,
        PROXY_MODE, getApiKey, hasValidKey,
        getSelectedModel, buildCompositeSystemPrompt, estimateTokens,
        $messages, $input, $sendBtn, $statChars, $charStat,
        $modelSelect, modelMap,
        setLoading, setStatus, updateStats, updateProviderBadge,
        appendSysLog, appendSysLogHTML,
        persistHistory: _persistHistory,
      });
    } finally {
      _sending = false;
    }
  }

  // ── History restore ───────────────────────────────────────────────────────
  function restoreHistory() {
    if (gated() || _historyRestored) return;
    _historyRestored = true;
    _restoreHistory({
      gated, getState, setState,
      $modelSelect, $messages,
      appendMessage, appendSysLog,
      getSessions, saveSessions, updateStats,
    });
  }

  // ── Keybar init ───────────────────────────────────────────────────────────
  initKeybar({
    llm, PROXY_MODE, hasValidKey,
    $keybar, $keybarInputWrap, $keybarInput, $keybarToggle, $keybarSave,
    $keybarGetkey, $keybarLocked, $keybarUnlock,
    $input, $sendBtn,
    setKeybarLocked, setStatus, restoreHistory, appendSysLog,
    referralConfig: config.referrals?.nano_gpt,
  });

  // ── Settings controls ─────────────────────────────────────────────────────
  initSettingsControls({
    cfg, hasValidKey,
    $settingsBtn, $settingsPanel, $sessionsBtn, $sessionsPanel,
    $syspromptInput, $tempInput, $tempVal, $ctxInput, $ctxVal,
    $toggleStream, $toggleEnter,
    closeAllPanels, getSelectedModel, appendSysLog,
  });

  // ── Restore persisted settings ────────────────────────────────────────────
  (function applyRestoredSettings() {
    const saved = restoreSettings();
    if (saved.tempOverride != null) {
      cfg.tempOverride = saved.tempOverride;
      $tempInput.value = saved.tempOverride;
      $tempVal.textContent = saved.tempOverride;
    }
    if (saved.maxCtxTurns != null) {
      cfg.maxCtxTurns = saved.maxCtxTurns;
      $ctxInput.value = saved.maxCtxTurns;
      $ctxVal.textContent = `${saved.maxCtxTurns} turns`;
    }
    if (saved.streaming === false)   { cfg.streaming = false;   syncToggle($toggleStream, false); }
    if (saved.enterToSend === false) { cfg.enterToSend = false; syncToggle($toggleEnter, false); }
    if (saved.systemPrompt) { cfg.systemPrompt = saved.systemPrompt; $syspromptInput.value = saved.systemPrompt; }
    if (saved.selectedAgent) cfg.selectedAgent = saved.selectedAgent;
    if (!PROXY_MODE) {
      const keybarLabel = $keybarLocked.querySelector(".llm-keybar__locked-label");
      if (keybarLabel) {
        const valid = hasValidKey();
        keybarLabel.dataset.valid = valid ? "true" : "false";
        keybarLabel.textContent   = valid ? "Key Active" : "Invalid Key";
      }
    }
  })();

  // ── Sessions ──────────────────────────────────────────────────────────────
  initSessions({
    getState, setState,
    hasValidKey, gated,
    $sessionsBtn, $sessionsPanel,
    $sessionSave, $sessionExpJSON, $sessionExpMD, $sessionImport, $sessionList,
    $sessionsBulk, $sessionsSelectAll, $sessionsBulkCount, $sessionsBulkDelete,
    closeAllPanels, appendSysLog, appendMessage,
    getSelectedModel, updateProviderBadge,
    $modelSelect, $agentSelect, $syspromptInput,
    updateStats, persistSettings: () => persistSettings(cfg), cfg,
  });

  // ── Agents ────────────────────────────────────────────────────────────────
  const agentMap = new Map();

  function applyAgentCard(d) {
    cfg.systemPrompt  = d.system_prompt ?? ([d.description, d.personality].filter(Boolean)[0] ?? "");
    $syspromptInput.value = cfg.systemPrompt;
  }

  fetchJSON(`${base}glass/data/llm-agents/default.json`)
    .then((card) => {
      const data = card.spec ? card.data : card;
      agentMap.set("default", { id: "default", name: data.name ?? "Default", data, raw: card });
      if (!cfg.selectedAgent) applyAgentCard(data);
    })
    .catch(() => console.log("[llm] default.json not found — using config system_prompt"));

  fetchJSON(`${base}glass/data/llm-agents/index.json`)
    .then((filenames) => {
      if (!Array.isArray(filenames) || !filenames.length) return;
      return Promise.allSettled(
        filenames.filter((f) => f.replace(/\.json$/i, "") !== "default").map((f) =>
          fetchJSON(`${base}glass/data/llm-agents/${f}`).then((card) => ({ f, card }))
        )
      );
    })
    .then((results) => {
      if (!results) return;
      results.forEach((r) => {
        if (r.status !== "fulfilled") return;
        const { f, card } = r.value;
        const data = card.spec ? card.data : card;
        const id   = f.replace(/\.json$/i, "");
        const name = data.name ?? id;
        agentMap.set(id, { id, name, data, raw: card });
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = name;
        if (data.tags?.length) opt.title = data.tags.join(", ");
        $agentSelect.appendChild(opt);
      });
      if (cfg.selectedAgent && cfg.selectedAgent !== "default" && agentMap.has(cfg.selectedAgent)) {
        $agentSelect.value = cfg.selectedAgent;
      }
    })
    .catch(() => console.log("[llm] llm-agents/index.json not found — agent selector inactive"))
    .finally(() => { if (!PROXY_MODE) {
      const keybarLabel = $keybarLocked.querySelector(".llm-keybar__locked-label");
      if (keybarLabel) {
        const valid = hasValidKey();
        keybarLabel.dataset.valid = valid ? "true" : "false";
        keybarLabel.textContent   = valid ? "Key Active" : "Invalid Key";
      }
    }});

  $agentSelect.addEventListener("change", () => {
    const val = $agentSelect.value;
    cfg.selectedAgent = val;
    if (!val) {
      const def = agentMap.get("default");
      const defData = def?.data;
      cfg.systemPrompt      = defData ? ([defData.system_prompt, defData.description].filter(Boolean)[0] ?? "") : (llm.system_prompt ?? "");
      $syspromptInput.value = cfg.systemPrompt;
      if (!gated()) appendSysLog("Agent cleared — default uplink active.");
      persistSettings(cfg);
      return;
    }
    const entry = agentMap.get(val);
    if (!entry) return;
    const d = entry.data;
    applyAgentCard(d);
    if (!gated()) {
      appendSysLog(`Agent: ${d.name}${d.tags?.length ? ` [${d.tags.join(", ")}]` : ""}`);
      if (d.creator_notes) appendSysLog(`Note: ${d.creator_notes}`);
    }
    persistSettings(cfg);
  });

  // ── Boot ──────────────────────────────────────────────────────────────────
  if ($bootTs) $bootTs.textContent = ts();
  document.getElementById("llm-boot-dismiss")?.addEventListener("click", function() {
    this.closest(".llm-msg")?.remove();
  });
  updateProviderBadge();

  if (PROXY_MODE) {
    setStatus("thinking", "CHECKING AUTH...");
    fetch(`${llm.api_base.replace(/\/v1\/?$/, "")}/health`, { credentials: "include" })
      .then(async (res) => {
        const ct = res.headers.get("content-type") || "";
        if (res.ok && ct.includes("application/json")) {
          const data = await res.json();
          if (data.auth_url) llm._proxyAuthUrl = data.auth_url;
          setStatus("ready", "READY");
          appendSysLog("Sovereign proxy active — Cloudflare Access session verified.");
          restoreHistory();
        } else {
          setStatus("error", "AUTH REQUIRED");
          const authUrl = llm._proxyAuthUrl || llm.auth_url;
          appendSysLogHTML(`Authentication required. <a href="${esc(authUrl)}" class="llm-msg__auth-link">Authenticate →</a>`);
          $input.disabled   = true;
          $sendBtn.disabled = true;
        }
      })
      .catch(() => {
        setStatus("error", "PROXY UNREACHABLE");
        appendSysLog("Proxy unreachable — ensure VPS and tunnel are online.");
        $input.disabled   = true;
        $sendBtn.disabled = true;
      });
  } else if (hasValidKey()) {
    setStatus("ready", "READY");
  } else {
    setStatus("error", "KEY REQUIRED");
  }
  console.log(`[llm] Neural Uplink — ${llmData._index.length} families, ${modelMap.size} models`);

  // ── Model change ──────────────────────────────────────────────────────────
  $modelSelect.addEventListener("change", () => {
    if (gated()) return;
    updateProviderBadge();
    const m   = getSelectedModel();
    const inf = m.recommended_inference;
    if (cfg.tempOverride === null) $tempVal.textContent = "auto";
    appendSysLog(`Model → ${m.label} | ${m.provider} | ${m.context_k}k ctx | temp ${cfg.tempOverride ?? inf.temperature} top_p ${inf.top_p} | ${m.pay_per_token ? "pay-per-token" : "subscription"}`);
  });

  // ── Chat events (copy/edit/retry/regen/delete) ────────────────────────────
  initChatEvents({ $messages, history, estimateTokens, sendMessage: doSend, updateStats });

  // ── Input / submit ────────────────────────────────────────────────────────
  $input.addEventListener("input", () => {
    $input.style.height = "auto";
    $input.style.height = Math.min($input.scrollHeight, 200) + "px";
    const len = $input.value.length;
    if ($statChars) $statChars.textContent = len;
    if ($charStat)  $charStat.dataset.warn  = len > 6000 ? "critical" : len > 3000 ? "warn" : "";
  });

  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && cfg.enterToSend) {
      e.preventDefault();
      $form.requestSubmit();
    }
  });

  $form.addEventListener("submit", (e) => {
    e.preventDefault();
    if ($sendBtn.classList.contains("llm-shell__send--stop")) {
      if (_sendMessage._currentAbort) _sendMessage._currentAbort.abort();
      return;
    }
    if (gated() || _sending) return;
    const text = $input.value.trim();
    if (!text || $sendBtn.disabled) return;
    $input.value = "";
    $input.style.height = "auto";
    if ($statChars) $statChars.textContent = "0";
    if ($charStat)  $charStat.dataset.warn  = "";
    closeAllPanels();
    doSend(text);
  });

  // ── Clear ─────────────────────────────────────────────────────────────────
  $clearBtn.addEventListener("click", () => {
    if (gated()) return;
    history.length = 0;
    turnCount  = 0;
    tokenCount = 0;
    updateStats();
    setStatus("ready", "READY");
    $messages.innerHTML = "";
    _persistHistory();
    appendSysLog("Conversation purged. Context buffer zeroed.");
  });

  // ── New conversation ──────────────────────────────────────────────────────
  $newBtn.addEventListener("click", () => {
    if (gated()) return;
    const assistantCount = history.filter(m => m.role === "assistant").length;
    if (turnCount > 0 && assistantCount > 0) {
      const m        = getSelectedModel();
      const name     = `Auto — ${m?.label ?? $modelSelect.value} — ${new Date().toLocaleString()} (${turnCount} turn${turnCount !== 1 ? "s" : ""})`;
      const sessions = getSessions();
      sessions[`auto_${Date.now()}`] = sessionSnapshot({
        name, modelId: $modelSelect.value, turnCount, tokenCount,
        history, selectedAgent: cfg.selectedAgent, systemPrompt: cfg.systemPrompt,
      });
      saveSessions(sessions);
      appendSysLog(`Conversation saved to Sessions. Starting new chat.`);
    }
    history.length = 0;
    turnCount  = 0;
    tokenCount = 0;
    _historyRestored = false;
    updateStats();
    setStatus("ready", "READY");
    $messages.innerHTML = "";
    _persistHistory();
    closeAllPanels();
    $input.focus();
  });

  // ── Quicksave ─────────────────────────────────────────────────────────────
  $quicksaveBtn.addEventListener("click", () => {
    if (gated()) return;
    if (!history.length) { appendSysLog("Nothing to save — conversation is empty."); return; }
    const assistantCount = history.filter(m => m.role === "assistant").length;
    if (!assistantCount) { appendSysLog("Quick-save skipped — no assistant responses yet."); return; }
    const key      = `qs_${Date.now()}`;
    const name     = `[QS] ${getSelectedModel()?.label ?? "session"} — ${new Date().toLocaleString()}`;
    const sessions = getSessions();
    sessions[key]  = sessionSnapshot({ name, modelId: $modelSelect.value, turnCount, tokenCount, history, selectedAgent: cfg.selectedAgent, systemPrompt: cfg.systemPrompt });
    saveSessions(sessions);
    _persistHistory();
    $quicksaveBtn.classList.add("llm-shell__action-btn--saved");
    setTimeout(() => $quicksaveBtn.classList.remove("llm-shell__action-btn--saved"), 1800);
    appendSysLog(`Quick-saved: "${name}" — ${history.length} message${history.length !== 1 ? "s" : ""} committed.`);
  });

  // ── Active history auto-persist on DOM change ─────────────────────────────
  const _historyObserver = new MutationObserver(() => { _persistHistory(); });
  _historyObserver.observe($messages, { childList: true, subtree: false });

  // ── Final gate assertion ──────────────────────────────────────────────────
  setTimeout(() => {
    if (!PROXY_MODE) {
      const keybarLabel = $keybarLocked.querySelector(".llm-keybar__locked-label");
      if (keybarLabel) {
        const valid = hasValidKey();
        keybarLabel.dataset.valid = valid ? "true" : "false";
        keybarLabel.textContent   = valid ? "Key Active" : "Invalid Key";
      }
      if (hasValidKey()) restoreHistory();
    }
  }, 0);
}
