// Neural Uplink — session save, load, export, import, bulk management
import { esc } from './core.js';
import { _pack, _unpack } from './llm-settings.js';

const SESSIONS_KEY    = "llm_sessions";
export const HISTORY_KEY = "llm_active_history";

export function getSessions()           { return _unpack(localStorage.getItem(SESSIONS_KEY)) || {}; }
export function saveSessions(sessions)  { localStorage.setItem(SESSIONS_KEY, _pack(sessions)); }

export function persistHistory({ history, turnCount, tokenCount, model }) {
  if (history.length) {
    localStorage.setItem(HISTORY_KEY, _pack({ history, turnCount, tokenCount, model, savedAt: Date.now() }));
  } else {
    localStorage.removeItem(HISTORY_KEY);
  }
}

export function sessionSnapshot({ name, modelId, turnCount, tokenCount, history, selectedAgent, systemPrompt }) {
  return {
    name,
    model:         modelId,
    savedAt:       new Date().toISOString(),
    turnCount,
    tokenCount,
    history:       history.slice(),
    selectedAgent,
    systemPrompt,
  };
}

export function initSessions({
  getState, setState,
  hasValidKey, gated,
  $sessionsBtn, $sessionsPanel,
  $sessionSave, $sessionExpJSON, $sessionExpMD, $sessionImport, $sessionList,
  $sessionsBulk, $sessionsSelectAll, $sessionsBulkCount, $sessionsBulkDelete,
  closeAllPanels, appendSysLog, appendMessage,
  getSelectedModel, updateProviderBadge,
  $modelSelect, $agentSelect, $syspromptInput,
  updateStats, persistSettings, cfg,
}) {
  const _selectedKeys = new Set();

  function updateBulkBar(total) {
    const n = _selectedKeys.size;
    $sessionsBulk.hidden = n === 0;
    $sessionsBulkCount.textContent = `${n} selected`;
    $sessionsSelectAll.indeterminate = n > 0 && n < total;
    $sessionsSelectAll.checked = total > 0 && n === total;
  }

  function renderSessionList() {
    const sessions = getSessions();
    const keys     = Object.keys(sessions).sort((a, b) => b.localeCompare(a));
    _selectedKeys.forEach(k => { if (!sessions[k]) _selectedKeys.delete(k); });
    updateBulkBar(keys.length);
    if (!keys.length) {
      $sessionList.innerHTML = `<span class="llm-sessions__empty">No saved sessions.</span>`;
      return;
    }
    $sessionList.innerHTML = "";
    keys.forEach((k) => {
      const s   = sessions[k];
      const d   = new Date(s.savedAt);
      const dateStr = `${d.toLocaleDateString()} ${d.toTimeString().slice(0,5)}`;
      const checked = _selectedKeys.has(k);
      const $item = document.createElement("div");
      $item.className = "llm-session-item" + (checked ? " llm-session-item--selected" : "");
      $item.dataset.key = k;
      $item.innerHTML = `
        <label class="llm-session-item__check" title="Select">
          <input type="checkbox" class="llm-session-item__checkbox" data-key="${esc(k)}" ${checked ? "checked" : ""} />
        </label>
        <div class="llm-session-item__info">
          <span class="llm-session-item__name" data-key="${esc(k)}" title="Click to rename">${esc(s.name)}</span>
          <span class="llm-session-item__meta">${esc(s.model)} · ${s.turnCount} turn${s.turnCount !== 1 ? "s" : ""} · ${dateStr}</span>
        </div>
        <div class="llm-session-item__actions">
          <button class="llm-session-item__btn" data-action="rename" data-key="${esc(k)}" title="Rename"><i data-lucide="pencil"></i></button>
          <button class="llm-session-item__btn" data-action="load" data-key="${esc(k)}" title="Load session"><i data-lucide="play"></i></button>
          <button class="llm-session-item__btn llm-session-item__btn--danger" data-action="delete" data-key="${esc(k)}" title="Delete session"><i data-lucide="trash-2"></i></button>
        </div>`;
      $sessionList.appendChild($item);
    });
    if (typeof lucide !== "undefined") lucide.createIcons({ nodes: [$sessionList] });
  }

  function activateRename(key) {
    const sessions = getSessions();
    const s = sessions[key];
    if (!s) return;
    const $nameSpan = $sessionList.querySelector(`.llm-session-item__name[data-key="${key}"]`);
    if (!$nameSpan) return;
    const $inp = document.createElement("input");
    $inp.type = "text";
    $inp.className = "llm-session-item__rename-input";
    $inp.value = s.name;
    $inp.maxLength = 120;
    $nameSpan.replaceWith($inp);
    $inp.focus();
    $inp.select();
    const commit = () => {
      const val = $inp.value.trim();
      if (val && val !== s.name) { sessions[key].name = val; saveSessions(sessions); }
      renderSessionList();
    };
    $inp.addEventListener("blur", commit);
    $inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter")  { e.preventDefault(); $inp.blur(); }
      if (e.key === "Escape") { $inp.value = s.name; $inp.blur(); }
    });
  }

  function loadSession(key) {
    const sessions = getSessions();
    const s        = sessions[key];
    if (!s) return;
    const state = getState();
    state.history.length = 0;
    state.history.push(...s.history);
    setState({ turnCount: s.turnCount, tokenCount: s.tokenCount });
    if (s.selectedAgent != null) { cfg.selectedAgent = s.selectedAgent; $agentSelect.value = s.selectedAgent; }
    if (s.systemPrompt  != null) { cfg.systemPrompt  = s.systemPrompt;  $syspromptInput.value = s.systemPrompt; }
    if (s.model && $modelSelect) {
      $modelSelect.value = s.model;
      updateProviderBadge();
    }
    const $messages = document.getElementById("llm-messages");
    $messages.innerHTML = "";
    s.history.forEach(({ role, content }) => {
      if (role === "system") return;
      appendMessage(role, content);
    });
    appendSysLog(`Session "${s.name}" loaded (${s.turnCount} turns).`);
    updateStats();
    closeAllPanels();
    persistSettings(cfg);
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Event bindings ────────────────────────────────────────────────────────

  $sessionsBtn.addEventListener("click", () => {
    if (gated()) return;
    const wasHidden = $sessionsPanel.hidden;
    closeAllPanels();
    if (wasHidden) {
      $sessionsPanel.hidden = false;
      $sessionsBtn.classList.add("llm-shell__action-btn--active");
      renderSessionList();
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
  });

  $sessionList.addEventListener("change", (e) => {
    const $cb = e.target.closest(".llm-session-item__checkbox");
    if (!$cb) return;
    const key = $cb.dataset.key;
    $cb.checked ? _selectedKeys.add(key) : _selectedKeys.delete(key);
    $cb.closest(".llm-session-item").classList.toggle("llm-session-item--selected", $cb.checked);
    updateBulkBar(Object.keys(getSessions()).length);
  });

  $sessionList.addEventListener("click", (e) => {
    const $name = e.target.closest(".llm-session-item__name");
    if ($name && !e.target.closest(".llm-session-item__checkbox")) { activateRename($name.dataset.key); return; }
    const $btn = e.target.closest("[data-action]");
    if (!$btn) return;
    const key    = $btn.dataset.key;
    const action = $btn.dataset.action;
    if (action === "load") {
      loadSession(key);
    } else if (action === "rename") {
      activateRename(key);
    } else if (action === "delete") {
      const sessions = getSessions();
      _selectedKeys.delete(key);
      delete sessions[key];
      saveSessions(sessions);
      renderSessionList();
    }
  });

  $sessionsSelectAll.addEventListener("change", () => {
    const sessions = getSessions();
    const keys = Object.keys(sessions);
    if ($sessionsSelectAll.checked) { keys.forEach(k => _selectedKeys.add(k)); }
    else { _selectedKeys.clear(); }
    renderSessionList();
  });

  $sessionsBulkDelete.addEventListener("click", () => {
    if (!_selectedKeys.size) return;
    const count = _selectedKeys.size;
    const sessions = getSessions();
    _selectedKeys.forEach(k => delete sessions[k]);
    _selectedKeys.clear();
    saveSessions(sessions);
    renderSessionList();
    appendSysLog(`${count} session${count !== 1 ? "s" : ""} deleted.`);
  });

  $sessionSave.addEventListener("click", () => {
    const state = getState();
    if (!state.history.length) { appendSysLog("Nothing to save — conversation is empty."); return; }
    const defaultName = `${getSelectedModel()?.label ?? "session"} ${new Date().toLocaleString()}`;
    const name = prompt("Session name:", defaultName);
    if (!name) return;
    const key      = `${Date.now()}`;
    const sessions = getSessions();
    sessions[key]  = sessionSnapshot({
      name,
      modelId:       $modelSelect.value,
      turnCount:     state.turnCount,
      tokenCount:    state.tokenCount,
      history:       state.history,
      selectedAgent: cfg.selectedAgent,
      systemPrompt:  cfg.systemPrompt,
    });
    saveSessions(sessions);
    renderSessionList();
    appendSysLog(`Session "${name}" saved.`);
  });

  $sessionExpJSON.addEventListener("click", () => {
    const state = getState();
    if (!state.history.length) { appendSysLog("Nothing to export."); return; }
    const m    = getSelectedModel();
    const data = sessionSnapshot({
      name:          `${m?.label ?? "export"} ${new Date().toLocaleString()}`,
      modelId:       $modelSelect.value,
      turnCount:     state.turnCount,
      tokenCount:    state.tokenCount,
      history:       state.history,
      selectedAgent: cfg.selectedAgent,
      systemPrompt:  cfg.systemPrompt,
    });
    const name = `llm-${m?.id ?? "session"}-${Date.now()}.json`;
    downloadFile(name, JSON.stringify(data, null, 2), "application/json");
    appendSysLog(`Exported as ${name}`);
  });

  $sessionExpMD.addEventListener("click", () => {
    const state = getState();
    if (!state.history.length) { appendSysLog("Nothing to export."); return; }
    const m   = getSelectedModel();
    const now = new Date().toLocaleString();
    let md    = `# Neural Uplink — ${m?.label ?? "session"}\n_Exported: ${now}_\n\n---\n\n`;
    state.history.forEach(({ role, content }) => {
      if (role === "system") return;
      const label = role === "user" ? `**You**` : `**AI**`;
      md += `${label}\n\n${content}\n\n---\n\n`;
    });
    const name = `llm-${m?.id ?? "session"}-${Date.now()}.md`;
    downloadFile(name, md, "text/markdown");
    appendSysLog(`Exported as ${name}`);
  });

  $sessionImport.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.history || !Array.isArray(data.history)) throw new Error("Invalid session format");
        const key      = `${Date.now()}`;
        const sessions = getSessions();
        sessions[key]  = {
          name:          typeof data.name === "string"       ? data.name       : file.name,
          model:         typeof data.model === "string"      ? data.model      : "",
          savedAt:       typeof data.savedAt === "string"    ? data.savedAt    : new Date().toISOString(),
          turnCount:     typeof data.turnCount === "number"  ? data.turnCount  : 0,
          tokenCount:    typeof data.tokenCount === "number" ? data.tokenCount : 0,
          history:       data.history,
          selectedAgent: typeof data.selectedAgent === "string" ? data.selectedAgent : "",
          systemPrompt:  typeof data.systemPrompt === "string"  ? data.systemPrompt  : "",
        };
        saveSessions(sessions);
        renderSessionList();
        appendSysLog(`Session "${sessions[key].name}" imported.`);
      } catch (err) {
        appendSysLog(`Import failed: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  return { renderSessionList, getSessions, saveSessions, sessionSnapshot };
}

export function restoreHistory({
  gated, getState, setState,
  $modelSelect, $messages,
  appendMessage, appendSysLog,
  getSessions: _getSessions, saveSessions: _saveSessions, updateStats,
}) {
  if (gated()) return;
  const snap = _unpack(localStorage.getItem(HISTORY_KEY));
  if (!snap) return;
  try {
    if (!Array.isArray(snap.history) || !snap.history.length) return;
    const prevTurns     = snap.history.filter(m => m.role === "user").length;
    const prevAssistant = snap.history.filter(m => m.role === "assistant").length;
    if (prevTurns > 0 && prevAssistant > 0) {
      const prevModel = snap.model ?? ($modelSelect?.value ?? "");
      const savedAt   = snap.savedAt ? new Date(snap.savedAt) : new Date();
      const autoName  = `Auto — ${prevModel} — ${savedAt.toLocaleDateString()} ${savedAt.toTimeString().slice(0,5)} (${prevTurns} turn${prevTurns !== 1 ? "s" : ""})`;
      const sessions  = _getSessions();
      sessions[`auto_${snap.savedAt ?? Date.now()}`] = {
        name: autoName, model: prevModel, savedAt: savedAt.toISOString(),
        turnCount: snap.turnCount ?? prevTurns, tokenCount: snap.tokenCount ?? 0,
        history: snap.history,
      };
      _saveSessions(sessions);
    }
    localStorage.removeItem(HISTORY_KEY);
    if (prevTurns > 0 && prevAssistant > 0) {
      appendSysLog(`Previous session auto-saved to Sessions (${prevTurns} turn${prevTurns !== 1 ? "s" : ""}). Starting new chat.`);
    }
  } catch (e) {
    console.warn("[llm] failed to restore history:", e.message);
    localStorage.removeItem(HISTORY_KEY);
  }
}
