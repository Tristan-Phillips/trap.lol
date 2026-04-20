import { config, llmData, fetchJSON, esc, IS_TOUCH } from './core.js';

export function initLLM() {
// ── Neural Uplink (Dev/Research Assistant) ────────────────────────────────
  const llm         = config.llm;
  const $llmSection = document.getElementById("llm-section");

  if (llm && llm.enabled && $llmSection && llmData) {
    $llmSection.classList.remove("hidden");

    // ── DOM refs ───────────────────────────────────────────────────────────
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
    // Key bar
    const $keybar          = document.getElementById("llm-keybar");
    const $keybarInputWrap = document.getElementById("llm-keybar-input-wrap");
    const $keybarInput     = document.getElementById("llm-keybar-input");
    const $keybarToggle    = document.getElementById("llm-keybar-toggle");
    const $keybarSave      = document.getElementById("llm-keybar-save");
    const $keybarGetkey    = document.getElementById("llm-keybar-getkey");
    const $keybarLocked    = document.getElementById("llm-keybar-locked");
    const $keybarUnlock    = document.getElementById("llm-keybar-unlock");
    // Settings
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
    // Sessions
    const $sessionsBtn     = document.getElementById("llm-sessions-btn");
    const $sessionsPanel   = document.getElementById("llm-sessions-panel");
    const $sessionSave     = document.getElementById("llm-session-save");
    const $sessionExpJSON  = document.getElementById("llm-session-export-json");
    const $sessionExpMD    = document.getElementById("llm-session-export-md");
    const $sessionImport   = document.getElementById("llm-session-import");
    const $sessionList     = document.getElementById("llm-session-list");

    // ── Runtime state ──────────────────────────────────────────────────────
    const history  = [];
    let turnCount  = 0;
    let tokenCount = 0;

    const cfg = {
      tempOverride:  null,
      maxCtxTurns:   null,
      streaming:     true,
      enterToSend:   true,
      systemPrompt:  "",
      selectedAgent: "",
    };

    // ── Utilities ──────────────────────────────────────────────────────────
    function ts() { return new Date().toTimeString().slice(0, 8); }
    function estimateTokens(t) { return Math.ceil(t.length / 4); }

    function buildCompositeSystemPrompt() {
      return cfg.systemPrompt || (llm.system_prompt ?? "You are a helpful assistant.");
    }

    function updateStats() {
      if ($statTurns)  $statTurns.textContent  = turnCount;
      if ($statTokens) $statTokens.textContent = tokenCount > 999
        ? `${(tokenCount / 1000).toFixed(1)}k` : tokenCount;
    }

    function setStatus(state, label) {
      $statusDot.dataset.state = state;
      $statusLabel.textContent = label;
      $shell.dataset.state     = state;
    }

    // ── Proxy mode detection ───────────────────────────────────────────────
    const PROXY_MODE = llm.api_base && !llm.api_base.includes("nano-gpt.com");
    let _apiKey = "";

    function activeToken() {
      return PROXY_MODE ? "" : _apiKey;
    }

    // Sanitize HTML using DOMPurify if available
    function sanitizeHtml(html) {
      if (typeof DOMPurify !== "undefined") {
        return DOMPurify.sanitize(html);
      }
      console.warn("[security] DOMPurify not loaded, falling back to basic manual sanitization (unsafe)");
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      tmp.querySelectorAll("script,style,iframe,object,embed,form,input,button,textarea,select").forEach(el => el.remove());
      tmp.querySelectorAll("*").forEach(el => {
        for (const attr of [...el.attributes]) {
          const name = attr.name.toLowerCase();
          if (name.startsWith("on") || (["href","src","action","formaction","xlink:href"].includes(name) && /^\s*(javascript:|data:|vbscript:)/i.test(attr.value))) {
            el.removeAttribute(attr.name);
          }
        }
      });
      return tmp.innerHTML;
    }

    if (typeof marked !== "undefined") {
      marked.use({ gfm: true, breaks: true });
    } else {
      console.error("[llm] marked NOT loaded — markdown will render as plain text.");
    }

    function renderMarkdown(text) {
      if (typeof marked !== "undefined") {
        try {
          const raw = sanitizeHtml(marked.parse(text));
          const tmp = document.createElement("div");
          tmp.innerHTML = raw;
          tmp.querySelectorAll("pre").forEach((pre) => {
            const code = pre.querySelector("code");
            if (!code) return;
            const lang = (code.className.match(/language-(\S+)/) || [])[1] || "code";
            const wrap = document.createElement("div");
            wrap.className = "md-codeblock";
            const header = document.createElement("div");
            header.className = "md-codeblock__header";
            header.innerHTML = `<span class="md-codeblock__lang">${esc(lang)}</span><button class="md-codeblock__copy" title="Copy code" data-copy>copy</button>`;
            wrap.appendChild(header);
            pre.parentNode.insertBefore(wrap, pre);
            wrap.appendChild(pre);
          });
          return tmp.innerHTML;
        } catch(_) {}
      }
      return `<p>${esc(text).replace(/\n/g, "<br>")}</p>`;
    }

    // ── Model selector ─────────────────────────────────────────────────────
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

    // ── Storage Hardening ──────────────────────────────────────────────────
    const STORAGE_SALT = "TRAP_SOVEREIGN_2026";

    function _pack(obj) {
      const str = JSON.stringify(obj);
      let out = "";
      for (let i = 0; i < str.length; i++) {
        out += String.fromCharCode(str.charCodeAt(i) ^ STORAGE_SALT.charCodeAt(i % STORAGE_SALT.length));
      }
      return btoa(unescape(encodeURIComponent(out)));
    }

    function _unpack(raw) {
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

    function updateProviderBadge() {
      const m = getSelectedModel();
      if (!m) return;
      $providerBadge.textContent = `${m.provider} // ${m.context_k}k ctx · ${m.pay_per_token ? "pay/tok" : "sub"}`;
      $modelSelect.dataset.paid  = m.pay_per_token ? "true" : "false";
    }

    // ── Key bar ────────────────────────────────────────────────────────────
    const KEY_REGEX = /^sk-nano-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    function isValidKeyFormat(k) { return KEY_REGEX.test(k.trim()); }

    ["llm_api_key"].forEach(k => {
      if (localStorage.getItem(k))  localStorage.removeItem(k);
      if (sessionStorage.getItem(k)) sessionStorage.removeItem(k);
    });

    function hasValidKey() {
      if (PROXY_MODE) return true;
      return !!_apiKey && isValidKeyFormat(_apiKey);
    }

    const $keybarLabel = $keybarLocked.querySelector(".llm-keybar__locked-label");

    function setKeybarLocked(locked) {
      $keybarInputWrap.hidden = locked;
      $keybarLocked.hidden    = !locked;
      $keybar.dataset.locked  = locked ? "true" : "false";
      $shell.classList.toggle("llm-shell--keygated", !locked);
      $input.disabled   = !locked;
      $sendBtn.disabled = !locked;
      if ($keybarLabel) {
        const valid = hasValidKey();
        $keybarLabel.dataset.valid = valid ? "true" : "false";
        $keybarLabel.textContent   = valid ? "Key Active" : "Invalid Key";
      }
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
      setKeybarLocked(hasValidKey());
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
      _apiKey = val;
      $keybarInput.value = "";
      $keybarInput.dataset.valid = "";
      setKeybarLocked(true);
      if (typeof lucide !== "undefined") lucide.createIcons();
      setStatus("ready", "READY");
      restoreHistory();
      appendSysLog("API key validated and locked. Uplink authenticated — ready to transmit.");
    });

    $keybarUnlock.addEventListener("click", () => {
      _apiKey = "";
      _historyRestored = false;
      setKeybarLocked(false);
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

    // ── Agents ─────────────────────────────────────────────────────────────
    const agentMap = new Map();

    fetchJSON("glass/data/llm-agents/default.json")
      .then((card) => {
        const data = card.spec ? card.data : card;
        agentMap.set("default", { id: "default", name: data.name ?? "Default", data, raw: card });
        if (!cfg.selectedAgent) applyAgentCard(data);
      })
      .catch(() => console.log("[llm] default.json not found — using config system_prompt"));

    fetchJSON("glass/data/llm-agents/index.json")
      .then((filenames) => {
        if (!Array.isArray(filenames) || !filenames.length) return;
        return Promise.allSettled(
          filenames.filter((f) => f.replace(/\.json$/i, "") !== "default").map((f) =>
            fetchJSON(`glass/data/llm-agents/${f}`).then((card) => ({ f, card }))
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
      .finally(() => { if (!PROXY_MODE) setKeybarLocked(hasValidKey()); });

    function applyAgentCard(d) {
      cfg.systemPrompt  = d.system_prompt ?? ([d.description, d.personality].filter(Boolean)[0] ?? "");
      $syspromptInput.value = cfg.systemPrompt;
    }

    $agentSelect.addEventListener("change", () => {
      const val = $agentSelect.value;
      cfg.selectedAgent = val;

      if (!val) {
        const def = agentMap.get("default");
        const defData = def?.data;
        cfg.systemPrompt      = defData ? ([defData.system_prompt, defData.description].filter(Boolean)[0] ?? "") : (llm.system_prompt ?? "");
        $syspromptInput.value = cfg.systemPrompt;
        if (!gated()) appendSysLog("Agent cleared — default uplink active.");
        persistSettings();
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
      persistSettings();
    });

    // ── Boot ───────────────────────────────────────────────────────────────
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

    // ── Settings persistence ───────────────────────────────────────────────
    function syncToggle($btn, active) {
      $btn.dataset.active = active ? "true" : "false";
      $btn.setAttribute("aria-checked", active ? "true" : "false");
      $btn.querySelector(".llm-panel__toggle-label").textContent = active ? "On" : "Off";
    }

    function persistSettings() {
      localStorage.setItem("llm_settings", _pack({
        tempOverride:  cfg.tempOverride,
        maxCtxTurns:   cfg.maxCtxTurns,
        streaming:     cfg.streaming,
        enterToSend:   cfg.enterToSend,
        systemPrompt:  cfg.systemPrompt,
        selectedAgent: cfg.selectedAgent,
      }));
    }

    (function restoreSettings() {
      const saved = _unpack(localStorage.getItem("llm_settings")) || {};
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
      if (saved.streaming === false)   { cfg.streaming = false;    syncToggle($toggleStream, false); }
      if (saved.enterToSend === false) { cfg.enterToSend = false;  syncToggle($toggleEnter, false); }
      if (saved.systemPrompt) { cfg.systemPrompt = saved.systemPrompt; $syspromptInput.value = saved.systemPrompt; }
      if (saved.selectedAgent) cfg.selectedAgent = saved.selectedAgent;
      if (!PROXY_MODE) setKeybarLocked(hasValidKey());
    })();

    // ── Model change ───────────────────────────────────────────────────────
    $modelSelect.addEventListener("change", () => {
      if (gated()) return;
      updateProviderBadge();
      const m   = getSelectedModel();
      const inf = m.recommended_inference;
      if (cfg.tempOverride === null) $tempVal.textContent = "auto";
      appendSysLog(`Model → ${m.label} | ${m.provider} | ${m.context_k}k ctx | temp ${cfg.tempOverride ?? inf.temperature} top_p ${inf.top_p} | ${m.pay_per_token ? "pay-per-token" : "subscription"}`);
    });

    // ── Panel toggles ──────────────────────────────────────────────────────
    function closeAllPanels() {
      $settingsPanel.hidden = true;
      $sessionsPanel.hidden = true;
      $settingsBtn.classList.remove("llm-shell__action-btn--active");
      $sessionsBtn.classList.remove("llm-shell__action-btn--active");
    }

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

    // ── Settings controls ──────────────────────────────────────────────────
    $syspromptInput.addEventListener("input", () => { cfg.systemPrompt = $syspromptInput.value; persistSettings(); });

    $tempInput.addEventListener("input", () => {
      const v = parseFloat($tempInput.value);
      cfg.tempOverride = v;
      $tempVal.textContent = v.toFixed(2);
      persistSettings();
    });
    $tempVal.addEventListener("dblclick", () => {
      cfg.tempOverride = null;
      $tempInput.value = getSelectedModel()?.recommended_inference?.temperature ?? 0.7;
      $tempVal.textContent = "auto";
      persistSettings();
    });

    $ctxInput.addEventListener("input", () => {
      const v = parseInt($ctxInput.value, 10);
      cfg.maxCtxTurns = v;
      $ctxVal.textContent = `${v} turns`;
      persistSettings();
    });
    $ctxVal.addEventListener("dblclick", () => {
      cfg.maxCtxTurns = null;
      $ctxInput.value = $ctxInput.min;
      $ctxVal.textContent = "unlimited";
      persistSettings();
    });

    $toggleStream.addEventListener("click", () => { cfg.streaming = !cfg.streaming; syncToggle($toggleStream, cfg.streaming); persistSettings(); });
    $toggleEnter.addEventListener("click",  () => { cfg.enterToSend = !cfg.enterToSend; syncToggle($toggleEnter, cfg.enterToSend); persistSettings(); });

    // ── Sessions ───────────────────────────────────────────────────────────
    const SESSIONS_KEY = "llm_sessions";

    function getSessions() { return _unpack(localStorage.getItem(SESSIONS_KEY)) || {}; }
    function saveSessions(sessions) { localStorage.setItem(SESSIONS_KEY, _pack(sessions)); }

    function sessionSnapshot(name) {
      return {
        name,
        model:         $modelSelect.value,
        savedAt:       new Date().toISOString(),
        turnCount,
        tokenCount,
        history:       history.slice(),
        selectedAgent: cfg.selectedAgent,
        systemPrompt:  cfg.systemPrompt,
      };
    }

    const $sessionsBulk       = document.getElementById("llm-sessions-bulk");
    const $sessionsSelectAll  = document.getElementById("llm-sessions-select-all");
    const $sessionsBulkCount  = document.getElementById("llm-sessions-bulk-count");
    const $sessionsBulkDelete = document.getElementById("llm-sessions-bulk-delete");
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
      const $input2 = document.createElement("input");
      $input2.type = "text";
      $input2.className = "llm-session-item__rename-input";
      $input2.value = s.name;
      $input2.maxLength = 120;
      $nameSpan.replaceWith($input2);
      $input2.focus();
      $input2.select();
      const commit = () => {
        const val = $input2.value.trim();
        if (val && val !== s.name) { sessions[key].name = val; saveSessions(sessions); }
        renderSessionList();
      };
      $input2.addEventListener("blur", commit);
      $input2.addEventListener("keydown", (e) => {
        if (e.key === "Enter")  { e.preventDefault(); $input2.blur(); }
        if (e.key === "Escape") { $input2.value = s.name; $input2.blur(); }
      });
    }

    function loadSession(key) {
      const sessions = getSessions();
      const s        = sessions[key];
      if (!s) return;
      history.length = 0;
      history.push(...s.history);
      turnCount  = s.turnCount;
      tokenCount = s.tokenCount;
      if (s.selectedAgent != null) { cfg.selectedAgent = s.selectedAgent; $agentSelect.value = s.selectedAgent; }
      if (s.systemPrompt  != null) { cfg.systemPrompt  = s.systemPrompt;  $syspromptInput.value = s.systemPrompt; }
      if (modelMap.has(s.model)) { $modelSelect.value = s.model; updateProviderBadge(); }
      $messages.innerHTML = "";
      s.history.forEach(({ role, content }) => {
        if (role === "system") return;
        appendMessage(role, content);
      });
      appendSysLog(`Session "${s.name}" loaded (${s.turnCount} turns).`);
      updateStats();
      closeAllPanels();
      persistSettings();
    }

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
      if (!history.length) { appendSysLog("Nothing to save — conversation is empty."); return; }
      const defaultName = `${getSelectedModel()?.label ?? "session"} ${new Date().toLocaleString()}`;
      const name = prompt("Session name:", defaultName);
      if (!name) return;
      const key      = `${Date.now()}`;
      const sessions = getSessions();
      sessions[key]  = sessionSnapshot(name);
      saveSessions(sessions);
      renderSessionList();
      appendSysLog(`Session "${name}" saved.`);
    });

    $quicksaveBtn.addEventListener("click", () => {
      if (gated()) return;
      if (!history.length) { appendSysLog("Nothing to save — conversation is empty."); return; }
      const assistantCount = history.filter(m => m.role === "assistant").length;
      if (!assistantCount) { appendSysLog("Quick-save skipped — no assistant responses yet."); return; }
      const key      = `qs_${Date.now()}`;
      const name     = `[QS] ${getSelectedModel()?.label ?? "session"} — ${new Date().toLocaleString()}`;
      const sessions = getSessions();
      sessions[key]  = sessionSnapshot(name);
      saveSessions(sessions);
      persistHistory();
      renderSessionList();
      $quicksaveBtn.classList.add("llm-shell__action-btn--saved");
      setTimeout(() => $quicksaveBtn.classList.remove("llm-shell__action-btn--saved"), 1800);
      appendSysLog(`Quick-saved: "${name}" — ${history.length} message${history.length !== 1 ? "s" : ""} committed.`);
    });

    function downloadFile(filename, content, mime) {
      const blob = new Blob([content], { type: mime });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    $sessionExpJSON.addEventListener("click", () => {
      if (!history.length) { appendSysLog("Nothing to export."); return; }
      const m    = getSelectedModel();
      const data = sessionSnapshot(`${m?.label ?? "export"} ${new Date().toLocaleString()}`);
      const name = `llm-${m?.id ?? "session"}-${Date.now()}.json`;
      downloadFile(name, JSON.stringify(data, null, 2), "application/json");
      appendSysLog(`Exported as ${name}`);
    });

    $sessionExpMD.addEventListener("click", () => {
      if (!history.length) { appendSysLog("Nothing to export."); return; }
      const m   = getSelectedModel();
      const now = new Date().toLocaleString();
      let md    = `# Neural Uplink — ${m?.label ?? "session"}\n_Exported: ${now}_\n\n---\n\n`;
      history.forEach(({ role, content }) => {
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

    // ── Message rendering ──────────────────────────────────────────────────
    function appendSysLog(text) {
      const $msg = document.createElement("div");
      $msg.className = "llm-msg llm-msg--system";
      $msg.innerHTML = `
        <span class="llm-msg__role">SYS</span>
        <div class="llm-msg__body">
          <p class="llm-msg__text">${esc(text)}</p>
          <div class="llm-msg__sys-footer">
            <span class="llm-msg__ts">${ts()}</span>
            <button class="llm-msg__sys-delete" title="Dismiss" aria-label="Dismiss system message">
              <i data-lucide="x"></i>
            </button>
          </div>
        </div>`;
      $messages.appendChild($msg);
      $messages.scrollTop = $messages.scrollHeight;
      const $del = $msg.querySelector(".llm-msg__sys-delete");
      if (typeof lucide !== "undefined") lucide.createIcons({ nodes: [$del] });
      $del.addEventListener("click", () => $msg.remove());
    }

    function appendSysLogHTML(html) {
      const $msg = document.createElement("div");
      $msg.className = "llm-msg llm-msg--system";
      const $body = document.createElement("div");
      $body.className = "llm-msg__body";
      const $text = document.createElement("p");
      $text.className = "llm-msg__text";
      $text.innerHTML = html;
      const $footer = document.createElement("div");
      $footer.className = "llm-msg__sys-footer";
      $footer.innerHTML = `<span class="llm-msg__ts">${ts()}</span><button class="llm-msg__sys-delete" title="Dismiss" aria-label="Dismiss system message"><i data-lucide="x"></i></button>`;
      $body.appendChild($text);
      $body.appendChild($footer);
      $msg.innerHTML = `<span class="llm-msg__role">SYS</span>`;
      $msg.appendChild($body);
      $messages.appendChild($msg);
      $messages.scrollTop = $messages.scrollHeight;
      const $del = $msg.querySelector(".llm-msg__sys-delete");
      if (typeof lucide !== "undefined") lucide.createIcons({ nodes: [$del] });
      $del.addEventListener("click", () => $msg.remove());
    }

    function buildMsgActions(role, historyIndex) {
      const bar = document.createElement("div");
      bar.className = "llm-msg__actions";
      const actions = [
        { icon: "copy",          label: "Copy",       action: "copy" },
        ...(role === "user" ? [
          { icon: "pencil",      label: "Edit",       action: "edit" },
          { icon: "rotate-ccw", label: "Retry",      action: "retry" },
        ] : [
          { icon: "refresh-cw", label: "Regenerate", action: "regenerate" },
        ]),
        { icon: "trash-2",       label: "Delete",     action: "delete" },
      ];
      actions.forEach(({ icon, label, action }) => {
        const btn = document.createElement("button");
        btn.className = "llm-msg__action-btn";
        btn.title = label;
        btn.dataset.action = action;
        btn.dataset.idx    = historyIndex;
        btn.innerHTML = `<i data-lucide="${icon}"></i>`;
        bar.appendChild(btn);
      });
      return bar;
    }

    function appendMessage(role, text, isStreaming = false) {
      const histIdx = history.filter(m => m.role !== "system").length - 1;
      const $msg    = document.createElement("div");
      $msg.className = `llm-msg llm-msg--${role}`;
      $msg.dataset.histIdx = histIdx;
      const nameLabel  = role === "user" ? "You" : (role === "assistant" ? "AI" : "SYS");
      const badgeLabel = role === "user" ? "YOU" : role === "assistant" ? "AI" : "ERR";
      const $body    = document.createElement("div");
      $body.className = "llm-msg__body";
      const $nameTag = document.createElement("span");
      $nameTag.className = "llm-msg__name";
      $nameTag.textContent = nameLabel;
      const $bubble  = document.createElement("div");
      $bubble.className = "llm-msg__bubble";
      const $content = document.createElement("div");
      $content.className = "llm-msg__text";
      if (text) $content.innerHTML = renderMarkdown(text);
      const $ts = document.createElement("span");
      $ts.className = "llm-msg__ts";
      $ts.textContent = ts();
      $bubble.appendChild($content);
      $bubble.appendChild($ts);
      const $role = document.createElement("span");
      $role.className = "llm-msg__role";
      $role.textContent = badgeLabel;
      $body.appendChild($nameTag);
      $body.appendChild($bubble);
      const $actions = buildMsgActions(role, histIdx);
      $body.appendChild($actions);
      $msg.appendChild($role);
      $msg.appendChild($body);
      if (isStreaming) $msg.classList.add("llm-msg--streaming");
      $messages.appendChild($msg);
      $messages.scrollTop = $messages.scrollHeight;
      if (typeof lucide !== "undefined") lucide.createIcons({ nodes: [$actions] });
      return $content;
    }

    $messages.addEventListener("click", (e) => {
      const $btn = e.target.closest("[data-copy]");
      if (!$btn) return;
      const code = $btn.closest(".md-codeblock")?.querySelector("code");
      if (!code) return;
      navigator.clipboard.writeText(code.textContent).then(() => {
        $btn.textContent = "copied!";
        $btn.classList.add("md-codeblock__copy--done");
        setTimeout(() => { $btn.textContent = "copy"; $btn.classList.remove("md-codeblock__copy--done"); }, 1800);
      }).catch(() => {});
    });

    $messages.addEventListener("click", (e) => {
      const $btn = e.target.closest(".llm-msg__action-btn");
      if (!$btn) return;
      const action = $btn.dataset.action;
      const $msg   = $btn.closest(".llm-msg");
      const role   = $msg.classList.contains("llm-msg--user") ? "user" : "assistant";
      const $text  = $msg.querySelector(".llm-msg__text");
      const allMsgs = [...$messages.querySelectorAll(".llm-msg--user, .llm-msg--assistant")];
      const domIdx  = allMsgs.indexOf($msg);
      const chatHistory = history.filter(m => m.role !== "system");

      switch (action) {
        case "copy": {
          const text = chatHistory[domIdx]?.content ?? $text.textContent;
          navigator.clipboard.writeText(text).catch(() => {});
          $btn.title = "Copied!";
          setTimeout(() => { $btn.title = "Copy"; }, 1500);
          break;
        }
        case "edit": {
          const current = chatHistory[domIdx]?.content ?? "";
          $input.value = current;
          $input.dispatchEvent(new Event("input"));
          $input.focus();
          const historyIdx = history.findIndex(
            (m, i) => m.role === "user" && history.slice(0, i).filter(x => x.role !== "system").length === domIdx
          );
          if (historyIdx >= 0) {
            history.splice(historyIdx);
            turnCount = Math.floor(history.filter(m => m.role === "user").length);
            tokenCount = history.reduce((acc, m) => acc + estimateTokens(m.content), 0);
            updateStats();
          }
          allMsgs.slice(domIdx).forEach(el => el.remove());
          break;
        }
        case "retry":
        case "regenerate": {
          const userDomIdx = action === "retry" ? domIdx : domIdx - 1;
          const userMsg    = chatHistory[userDomIdx]?.content;
          if (!userMsg) break;
          const historyIdx = history.findIndex(
            (m, i) => m.role === "user" && history.slice(0, i).filter(x => x.role !== "system").length === userDomIdx
          );
          if (historyIdx >= 0) {
            history.splice(historyIdx);
            turnCount = Math.floor(history.filter(m => m.role === "user").length);
            tokenCount = history.reduce((acc, m) => acc + estimateTokens(m.content), 0);
            updateStats();
          }
          (action === "retry" ? allMsgs.slice(userDomIdx) : allMsgs.slice(userDomIdx + 1)).forEach(el => el.remove());
          sendMessage(userMsg);
          break;
        }
        case "delete": {
          const historyIdx = history.findIndex(
            (m, i) => m.role === role && history.slice(0, i).filter(x => x.role !== "system").length === domIdx
          );
          if (historyIdx >= 0) {
            history.splice(historyIdx, 1);
            turnCount = Math.floor(history.filter(m => m.role === "user").length);
            tokenCount = history.reduce((acc, m) => acc + estimateTokens(m.content), 0);
            updateStats();
          }
          $msg.remove();
          break;
        }
      }
    });

    let _abortController = null;

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

    // ── Core send ──────────────────────────────────────────────────────────
    async function sendMessage(userText) {
      if (gated()) { console.warn("[llm] sendMessage blocked — no valid key"); return; }
      const token = activeToken();
      if (!PROXY_MODE && !token) { console.warn("[llm] sendMessage blocked — empty token"); return; }

      const m   = getSelectedModel();
      const inf = m.recommended_inference;
      const temperature = cfg.tempOverride ?? inf.temperature;

      let contextHistory = history.slice();
      if (cfg.maxCtxTurns !== null) {
        const maxMsgs = cfg.maxCtxTurns * 2;
        if (contextHistory.length > maxMsgs) contextHistory = contextHistory.slice(contextHistory.length - maxMsgs);
      }

      history.push({ role: "user", content: userText });
      tokenCount += estimateTokens(userText);
      appendMessage("user", userText);
      setLoading(true);
      setStatus("thinking", "THINKING...");
      updateStats();

      const $streamTarget = appendMessage("assistant", "", true);
      const $streamMsg    = $streamTarget.closest(".llm-msg");
      const $thinking = document.createElement("div");
      $thinking.className = "llm-msg__thinking";
      $thinking.innerHTML = "<span></span><span></span><span></span>";
      $streamTarget.appendChild($thinking);

      const t0 = performance.now();
      const messages = [
        { role: "system", content: buildCompositeSystemPrompt() },
        ...contextHistory,
        { role: "user",   content: userText },
      ];

      _abortController = new AbortController();

      try {
        const headers = { "Content-Type": "application/json" };
        if (!PROXY_MODE && activeToken()) headers["Authorization"] = `Bearer ${activeToken()}`;

        const res = await fetch(`${llm.api_base}/chat/completions`, {
          method: "POST",
          signal: _abortController.signal,
          credentials: PROXY_MODE ? "include" : "omit",
          headers,
          body: JSON.stringify({ model: m.id, messages, stream: cfg.streaming, temperature, top_p: inf.top_p }),
        });

        if (!res.ok) {
          if (PROXY_MODE && (res.status === 401 || res.status === 403)) {
            let reason = res.status === 401 ? "Session expired or not authenticated." : "Access denied — your account is not provisioned.";
            try {
              const errJson = await res.json();
              if (errJson.error) reason = errJson.error;
              if (errJson.auth_url) llm._proxyAuthUrl = errJson.auth_url;
            } catch (_) {}
            const authUrl = llm._proxyAuthUrl || llm.auth_url;
            throw new Error(`${reason}${authUrl ? ` <a href="${esc(authUrl)}" target="_blank" rel="noopener" class="llm-msg__auth-link">Authenticate →</a>` : ""}`);
          }
          if (PROXY_MODE && res.status === 429) {
            let reason = "Rate limit exceeded — try again later.";
            try { const errJson = await res.json(); if (errJson.error) reason = errJson.error; } catch (_) {}
            throw new Error(reason);
          }
          const errBody = await res.text();
          throw new Error(`HTTP ${res.status} — ${errBody}`);
        }

        let fullText   = "";
        let chunkCount = 0;
        let stopped    = false;

        if (cfg.streaming) {
          setStatus("streaming", "STREAMING...");
          const reader  = res.body.getReader();
          const decoder = new TextDecoder();
          let rafPending = false;
          const liveRender = () => {
            $streamTarget.innerHTML = renderMarkdown(fullText);
            $messages.scrollTop = $messages.scrollHeight;
            rafPending = false;
          };
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              for (const line of decoder.decode(value, { stream: true }).split("\n")) {
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6).trim();
                if (payload === "[DONE]") break;
                try {
                  const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
                  if (delta) {
                    if (!chunkCount) $thinking.remove();
                    fullText += delta;
                    chunkCount++;
                    if (!rafPending) { rafPending = true; requestAnimationFrame(liveRender); }
                  }
                } catch (_) {}
              }
            }
          } catch (streamErr) {
            if (streamErr.name === "AbortError") stopped = true;
            else throw streamErr;
          }
          rafPending = false;
        } else {
          const data = await res.json();
          fullText   = data.choices?.[0]?.message?.content ?? "";
          $thinking.remove();
        }

        const durationMs = performance.now() - t0;
        $streamMsg.classList.remove("llm-msg--streaming");

        if (stopped && !fullText) {
          $streamMsg.remove();
          history.pop();
          tokenCount -= estimateTokens(userText);
          const $userMsgs = $messages.querySelectorAll(".llm-msg--user");
          $userMsgs[$userMsgs.length - 1]?.remove();
          $input.value = userText;
          $input.style.height = "auto";
          $input.style.height = Math.min($input.scrollHeight, 200) + "px";
          appendSysLog("Generation stopped — no output received. Message restored to input.");
        } else {
          $streamTarget.innerHTML = renderMarkdown(fullText);
          const $msgTs = $streamMsg.querySelector(".llm-msg__ts");
          if ($msgTs) $msgTs.textContent = ts();
          if (stopped) {
            const $stopBadge = document.createElement("span");
            $stopBadge.className = "llm-msg__stopped-badge";
            $stopBadge.textContent = "⬛ stopped";
            $streamMsg.querySelector(".llm-msg__body")?.appendChild($stopBadge);
          }
          turnCount++;
          tokenCount += estimateTokens(fullText);
          history.push({ role: "assistant", content: fullText });
          updateStats();
          if (stopped) appendSysLog(`Generation stopped — partial response committed (${chunkCount} chunk${chunkCount !== 1 ? "s" : ""}).`);
        }

        setStatus("ready", "READY");
        if (!stopped) console.log(`[llm] latency ${((performance.now()-t0)/1000).toFixed(2)}s — ${chunkCount} chunks`);

      } catch (e) {
        if (e.name === "AbortError") {
          $streamMsg.remove();
          history.pop();
          tokenCount -= estimateTokens(userText);
          const $userMsgs = $messages.querySelectorAll(".llm-msg--user");
          $userMsgs[$userMsgs.length - 1]?.remove();
          $input.value = userText;
          $input.style.height = "auto";
          $input.style.height = Math.min($input.scrollHeight, 200) + "px";
          setStatus("ready", "READY");
          appendSysLog("Generation stopped — message restored to input.");
          return;
        }
        $streamMsg.remove();
        history.pop();
        tokenCount -= estimateTokens(userText);
        const $userMsgs = $messages.querySelectorAll(".llm-msg--user");
        $userMsgs[$userMsgs.length - 1]?.remove();
        setStatus("error", "ERROR");
        updateStats();
        console.error("[llm] request failed:", e.message);

        const fallbackId = m.fallback_id;
        if (PROXY_MODE || !fallbackId || !modelMap.has(fallbackId)) {
          if (PROXY_MODE && e.message.includes("llm-msg__auth-link")) {
            appendSysLogHTML(`${e.message}`);
          } else {
            appendSysLog(`Error: ${e.message} — your message has been restored to the input.`);
          }
          $input.value = userText;
          $input.style.height = "auto";
          $input.style.height = Math.min($input.scrollHeight, 200) + "px";
        } else {
          const fb = modelMap.get(fallbackId);
          appendSysLog(`Request failed — falling back to ${fb.label}. Your message has been restored.`);
          $modelSelect.value = fallbackId;
          updateProviderBadge();
          $input.value = userText;
          $input.style.height = "auto";
          $input.style.height = Math.min($input.scrollHeight, 200) + "px";
          if ($statChars) $statChars.textContent = userText.length;
          if ($charStat)  $charStat.dataset.warn  = userText.length > 6000 ? "critical" : userText.length > 3000 ? "warn" : "";
        }
        setTimeout(() => { if ($shell.dataset.state === "error") setStatus("ready", "READY"); }, 4000);
      } finally {
        _abortController = null;
        setLoading(false);
        $input.focus();
      }
    }

    // ── Input ──────────────────────────────────────────────────────────────
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
        if (_abortController) _abortController.abort();
        return;
      }
      if (gated()) return;
      const text = $input.value.trim();
      if (!text || $sendBtn.disabled) return;
      $input.value = "";
      $input.style.height = "auto";
      if ($statChars) $statChars.textContent = "0";
      if ($charStat)  $charStat.dataset.warn  = "";
      closeAllPanels();
      sendMessage(text);
    });

    // ── Clear ──────────────────────────────────────────────────────────────
    $clearBtn.addEventListener("click", () => {
      if (gated()) return;
      history.length = 0;
      turnCount  = 0;
      tokenCount = 0;
      updateStats();
      setStatus("ready", "READY");
      $messages.innerHTML = "";
      persistHistory();
      appendSysLog("Conversation purged. Context buffer zeroed.");
    });

    // ── New conversation ────────────────────────────────────────────────────
    $newBtn.addEventListener("click", () => {
      if (gated()) return;
      const assistantCount = history.filter(m => m.role === "assistant").length;
      if (turnCount > 0 && assistantCount > 0) {
        const m        = getSelectedModel();
        const name     = `Auto — ${m?.label ?? $modelSelect.value} — ${new Date().toLocaleString()} (${turnCount} turn${turnCount !== 1 ? "s" : ""})`;
        const sessions = getSessions();
        sessions[`auto_${Date.now()}`] = sessionSnapshot(name);
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
      persistHistory();
      closeAllPanels();
      $input.focus();
    });

    // ── Active conversation persistence ────────────────────────────────────
    const HISTORY_KEY = "llm_active_history";

    function persistHistory() {
      if (history.length) {
        localStorage.setItem(HISTORY_KEY, _pack({ history, turnCount, tokenCount, model: $modelSelect.value, savedAt: Date.now() }));
      } else {
        localStorage.removeItem(HISTORY_KEY);
      }
    }

    let _historyRestored = false;

    const _historyObserver = new MutationObserver(() => { persistHistory(); });
    _historyObserver.observe($messages, { childList: true, subtree: false });

    function restoreHistory() {
      if (gated()) return;
      if (_historyRestored) return;
      _historyRestored = true;
      const snap = _unpack(localStorage.getItem(HISTORY_KEY));
      if (!snap) return;
      try {
        if (!Array.isArray(snap.history) || !snap.history.length) return;
        const prevTurns     = snap.history.filter(m => m.role === "user").length;
        const prevAssistant = snap.history.filter(m => m.role === "assistant").length;
        if (prevTurns > 0 && prevAssistant > 0) {
          const prevModel = snap.model ?? $modelSelect.value;
          const savedAt   = snap.savedAt ? new Date(snap.savedAt) : new Date();
          const autoName  = `Auto — ${prevModel} — ${savedAt.toLocaleDateString()} ${savedAt.toTimeString().slice(0,5)} (${prevTurns} turn${prevTurns !== 1 ? "s" : ""})`;
          const sessions  = getSessions();
          sessions[`auto_${snap.savedAt ?? Date.now()}`] = {
            name: autoName, model: prevModel, savedAt: savedAt.toISOString(),
            turnCount: snap.turnCount ?? prevTurns, tokenCount: snap.tokenCount ?? 0,
            history: snap.history,
          };
          saveSessions(sessions);
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

    // ── Final gate assertion ───────────────────────────────────────────────
    setTimeout(() => {
      if (!PROXY_MODE) {
        setKeybarLocked(hasValidKey());
        if (hasValidKey()) restoreHistory();
      }
    }, 0);
  }
}
