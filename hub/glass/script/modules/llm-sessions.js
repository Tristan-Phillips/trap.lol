// Neural Uplink — Session Management
import { esc } from './core.js';
import { _pack, _unpack } from './llm-settings.js';

const SESSIONS_KEY = "llm_sessions";
export const HISTORY_KEY = "llm_active_history";

export const getSessions = () => _unpack(localStorage.getItem(SESSIONS_KEY)) || {};
export const saveSessions = (s) => localStorage.setItem(SESSIONS_KEY, _pack(s));

export function persistHistory({ history, turnCount, tokenCount, model }) {
  if (history.length) {
    localStorage.setItem(HISTORY_KEY, _pack({ history, turnCount, tokenCount, model, savedAt: Date.now() }));
  } else {
    localStorage.removeItem(HISTORY_KEY);
  }
}

export function createSnapshot({ name, modelId, state, cfg }) {
  return {
    name,
    model: modelId,
    savedAt: new Date().toISOString(),
    turnCount: state.turnCount,
    tokenCount: state.tokenCount,
    history: [...state.history],
    selectedAgent: cfg.selectedAgent,
    systemPrompt: cfg.systemPrompt,
  };
}

export function initSessions(ctx) {
  const { ui, state, cfg, auth, model, callbacks } = ctx;
  const _selectedKeys = new Set();

  function updateBulkBar() {
    const total = Object.keys(getSessions()).length;
    const n = _selectedKeys.size;
    ui.sessionsBulk.hidden = n === 0;
    ui.sessionsBulkCount.textContent = `${n} selected`;
    ui.sessionsSelectAll.indeterminate = n > 0 && n < total;
    ui.sessionsSelectAll.checked = total > 0 && n === total;
  }

  function renderList() {
    const sessions = getSessions();
    const keys = Object.keys(sessions).sort((a, b) => b.localeCompare(a));
    
    // Cleanup selection
    _selectedKeys.forEach(k => { if (!sessions[k]) _selectedKeys.delete(k); });
    updateBulkBar();

    if (!keys.length) {
      ui.sessionList.innerHTML = `<span class="llm-sessions__empty">No saved sessions.</span>`;
      return;
    }

    ui.sessionList.innerHTML = keys.map(k => {
      const s = sessions[k];
      const d = new Date(s.savedAt);
      const dateStr = `${d.toLocaleDateString()} ${d.toTimeString().slice(0,5)}`;
      const isSelected = _selectedKeys.has(k);
      
      return `
        <div class="llm-session-item${isSelected ? " llm-session-item--selected" : ""}" data-key="${esc(k)}">
          <label class="llm-session-item__check">
            <input type="checkbox" class="llm-session-item__checkbox" ${isSelected ? "checked" : ""} />
          </label>
          <div class="llm-session-item__info">
            <span class="llm-session-item__name" title="Click to rename">${esc(s.name)}</span>
            <span class="llm-session-item__meta">${esc(s.model)} · ${s.turnCount} turns · ${dateStr}</span>
          </div>
          <div class="llm-session-item__actions">
            <button class="llm-session-item__btn" data-action="rename" title="Rename"><i data-lucide="pencil"></i></button>
            <button class="llm-session-item__btn" data-action="load" title="Load"><i data-lucide="play"></i></button>
            <button class="llm-session-item__btn llm-session-item__btn--danger" data-action="delete" title="Delete"><i data-lucide="trash-2"></i></button>
          </div>
        </div>`;
    }).join("");

    if (window.lucide) window.lucide.createIcons({ nodes: [ui.sessionList] });
  }

  // --- Events ---

  ui.sessionsBtn.addEventListener("click", () => {
    if (auth.gated()) return;
    const isVisible = !ui.sessionsPanel.hidden;
    callbacks.closeAllPanels();
    if (!isVisible) {
      ui.sessionsPanel.hidden = false;
      ui.sessionsBtn.classList.add("llm-shell__action-btn--active");
      renderList();
    }
  });

  ui.sessionList.addEventListener("change", (e) => {
    const cb = e.target.closest(".llm-session-item__checkbox");
    if (!cb) return;
    const key = cb.closest(".llm-session-item").dataset.key;
    cb.checked ? _selectedKeys.add(key) : _selectedKeys.delete(key);
    cb.closest(".llm-session-item").classList.toggle("llm-session-item--selected", cb.checked);
    updateBulkBar();
  });

  ui.sessionList.addEventListener("click", (e) => {
    const item = e.target.closest(".llm-session-item");
    if (!item) return;
    const key = item.dataset.key;
    const sessions = getSessions();
    const s = sessions[key];

    const action = e.target.closest("[data-action]")?.dataset.action;
    const isName = e.target.closest(".llm-session-item__name");

    if (action === "load") {
      state.history.length = 0;
      state.history.push(...s.history);
      state.turnCount = s.turnCount;
      state.tokenCount = s.tokenCount;
      
      if (s.selectedAgent) { cfg.selectedAgent = s.selectedAgent; ui.agentSelect.value = s.selectedAgent; }
      if (s.systemPrompt) { cfg.systemPrompt = s.systemPrompt; ui.syspromptInput.value = s.systemPrompt; }
      if (s.model && ui.modelSelect) {
        ui.modelSelect.value = s.model;
        callbacks.onModelChange();
      }
      
      ui.messages.innerHTML = "";
      s.history.filter(m => m.role !== "system").forEach(m => callbacks.appendMessage(m.role, m.content));
      
      callbacks.onLoadSuccess(`Session "${s.name}" loaded.`);
      callbacks.closeAllPanels();
    } 
    else if (action === "delete") {
      _selectedKeys.delete(key);
      delete sessions[key];
      saveSessions(sessions);
      renderList();
    }
    else if (action === "rename" || isName) {
      const nameSpan = item.querySelector(".llm-session-item__name");
      const input = document.createElement("input");
      input.className = "llm-session-item__rename-input";
      input.value = s.name;
      nameSpan.replaceWith(input);
      input.focus();
      input.select();
      
      const commit = () => {
        const val = input.value.trim();
        if (val && val !== s.name) { sessions[key].name = val; saveSessions(sessions); }
        renderList();
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") input.blur();
        if (ev.key === "Escape") { input.value = s.name; input.blur(); }
      });
    }
  });

  ui.sessionsSelectAll.addEventListener("change", () => {
    const keys = Object.keys(getSessions());
    if (ui.sessionsSelectAll.checked) keys.forEach(k => _selectedKeys.add(k));
    else _selectedKeys.clear();
    renderList();
  });

  ui.sessionsBulkDelete.addEventListener("click", () => {
    if (!_selectedKeys.size) return;
    const sessions = getSessions();
    _selectedKeys.forEach(k => delete sessions[k]);
    const count = _selectedKeys.size;
    _selectedKeys.clear();
    saveSessions(sessions);
    renderList();
    callbacks.onLoadSuccess(`${count} sessions deleted.`);
  });

  ui.sessionSave.addEventListener("click", () => {
    if (!state.history.length) return callbacks.onLoadSuccess("History empty — nothing to save.");
    const defName = `${model.getSelected()?.label || "session"} ${new Date().toLocaleString()}`;
    const name = prompt("Session name:", defName);
    if (!name) return;
    
    const sessions = getSessions();
    sessions[Date.now()] = createSnapshot({ name, modelId: ui.modelSelect.value, state, cfg });
    saveSessions(sessions);
    renderList();
    callbacks.onLoadSuccess(`Session "${name}" saved.`);
  });

  // Export/Import
  const download = (name, content, mime) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  ui.sessionExpJSON.addEventListener("click", () => {
    if (!state.history.length) return;
    const snap = createSnapshot({ name: `Export ${Date.now()}`, modelId: ui.modelSelect.value, state, cfg });
    download(`session-${Date.now()}.json`, JSON.stringify(snap, null, 2), "application/json");
  });

  ui.sessionExpMD.addEventListener("click", () => {
    if (!state.history.length) return;
    let md = `# Session Export — ${new Date().toLocaleString()}\n\n`;
    state.history.forEach(m => {
      if (m.role === "system") return;
      md += `### ${m.role === "user" ? "You" : "AI"}\n${m.content}\n\n---\n\n`;
    });
    download(`session-${Date.now()}.md`, md, "text/markdown");
  });

  ui.sessionImport.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.history) throw new Error("Invalid format");
        const sessions = getSessions();
        const key = Date.now();
        sessions[key] = {
          name: data.name || file.name,
          model: data.model || "",
          savedAt: data.savedAt || new Date().toISOString(),
          turnCount: data.turnCount || 0,
          tokenCount: data.tokenCount || 0,
          history: data.history,
          selectedAgent: data.selectedAgent || "",
          systemPrompt: data.systemPrompt || "",
        };
        saveSessions(sessions);
        renderList();
        callbacks.onLoadSuccess("Session imported.");
      } catch (err) { callbacks.onLoadSuccess(`Import failed: ${err.message}`); }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  return { renderList };
}

export function restoreHistory(ctx) {
  const { auth, state, ui, callbacks } = ctx;
  if (auth.gated()) return;
  
  const snap = _unpack(localStorage.getItem(HISTORY_KEY));
  if (!snap || !snap.history?.length) return;
  
  try {
    const turns = snap.history.filter(m => m.role === "user").length;
    const assistant = snap.history.filter(m => m.role === "assistant").length;
    
    if (turns > 0 && assistant > 0) {
      const sessions = getSessions();
      const modelName = snap.model || "Unknown";
      const date = snap.savedAt ? new Date(snap.savedAt) : new Date();
      
      sessions[`auto_${Date.now()}`] = {
        name: `Auto — ${modelName} — ${date.toLocaleString()}`,
        model: modelName,
        savedAt: date.toISOString(),
        turnCount: snap.turnCount || turns,
        tokenCount: snap.tokenCount || 0,
        history: snap.history,
      };
      saveSessions(sessions);
      callbacks.onLoadSuccess(`Previous session auto-saved (${turns} turns).`);
    }
    localStorage.removeItem(HISTORY_KEY);
  } catch (e) {
    console.warn("[llm] restore failed:", e);
    localStorage.removeItem(HISTORY_KEY);
  }
}
