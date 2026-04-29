// Neural Uplink — Messaging & Core Logic
import { esc } from './core.js';

export function sanitizeHtml(html) {
  if (typeof DOMPurify !== "undefined") {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["p","br","strong","em","code","pre","ul","ol","li","blockquote","h1","h2","h3","h4","h5","h6","a","span","div","table","thead","tbody","tr","th","td","hr"],
      ALLOWED_ATTR: ["href","target","rel","class","title"],
      ALLOW_DATA_ATTR: false,
      FORCE_BODY: true,
    });
  }
  
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

export function renderMarkdown(text) {
  if (typeof marked === "undefined") {
    return `<p>${esc(text).replace(/\n/g, "<br>")}</p>`;
  }

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
      wrap.innerHTML = `
        <div class="md-codeblock__header">
          <span class="md-codeblock__lang">${esc(lang)}</span>
          <button class="md-codeblock__copy" title="Copy code" data-copy>copy</button>
        </div>`;
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
    });
    return tmp.innerHTML;
  } catch {
    return `<p>${esc(text).replace(/\n/g, "<br>")}</p>`;
  }
}

export function appendSysLog($messages, content, isHtml = false) {
  const ts = new Date().toTimeString().slice(0, 8);
  const safeContent = isHtml ? sanitizeHtml(content) : esc(content);
  
  const $msg = document.createElement("div");
  $msg.className = "llm-msg llm-msg--system";
  $msg.innerHTML = `
    <span class="llm-msg__role">SYS</span>
    <div class="llm-msg__body">
      <p class="llm-msg__text">${safeContent}</p>
      <div class="llm-msg__sys-footer">
        <span class="llm-msg__ts">${ts}</span>
        <button class="llm-msg__sys-delete" title="Dismiss" aria-label="Dismiss system message">
          <i data-lucide="x"></i>
        </button>
      </div>
    </div>`;

  $messages.appendChild($msg);
  $messages.scrollTop = $messages.scrollHeight;

  const $del = $msg.querySelector(".llm-msg__sys-delete");
  if (window.lucide) window.lucide.createIcons({ nodes: [$del] });
  $del.addEventListener("click", () => $msg.remove());
}

// Compatibility aliases
export const appendSysLogHTML = ($m, html) => appendSysLog($m, html, true);

export function buildMsgActions(role, historyIndex) {
  const bar = document.createElement("div");
  bar.className = "llm-msg__actions";
  
  const actions = [
    { icon: "copy", label: "Copy", action: "copy" },
    ...(role === "user" ? [
      { icon: "pencil", label: "Edit", action: "edit" },
      { icon: "rotate-ccw", label: "Retry", action: "retry" },
    ] : [
      { icon: "refresh-cw", label: "Regenerate", action: "regenerate" },
    ]),
    { icon: "trash-2", label: "Delete", action: "delete" },
  ];

  actions.forEach(({ icon, label, action }) => {
    const btn = document.createElement("button");
    btn.className = "llm-msg__action-btn";
    btn.title = label;
    btn.dataset.action = action;
    btn.dataset.idx = historyIndex;
    btn.innerHTML = `<i data-lucide="${icon}"></i>`;
    bar.appendChild(btn);
  });
  
  return bar;
}

export function appendMessage($messages, history, role, text, isStreaming = false) {
  const histIdx = history.filter(m => m.role !== "system").length - 1;
  const $msg = document.createElement("div");
  $msg.className = `llm-msg llm-msg--${role}${isStreaming ? " llm-msg--streaming" : ""}`;
  $msg.dataset.histIdx = histIdx;

  const labels = {
    user: { name: "You", badge: "YOU" },
    assistant: { name: "AI", badge: "AI" },
    system: { name: "SYS", badge: "ERR" }
  };
  const { name, badge } = labels[role] || labels.system;

  $msg.innerHTML = `
    <span class="llm-msg__role">${badge}</span>
    <div class="llm-msg__body">
      <span class="llm-msg__name">${name}</span>
      <div class="llm-msg__bubble">
        <div class="llm-msg__text">${text ? renderMarkdown(text) : ""}</div>
        <span class="llm-msg__ts">${new Date().toTimeString().slice(0, 8)}</span>
      </div>
    </div>`;

  const $body = $msg.querySelector(".llm-msg__body");
  const $actions = buildMsgActions(role, histIdx);
  $body.appendChild($actions);
  
  $messages.appendChild($msg);
  $messages.scrollTop = $messages.scrollHeight;
  
  if (window.lucide) window.lucide.createIcons({ nodes: [$actions] });
  return $msg.querySelector(".llm-msg__text");
}

export function initChatEvents({ $messages, history, sendMessage, updateStats }) {
  // Handle code block copying
  $messages.addEventListener("click", (e) => {
    const $btn = e.target.closest("[data-copy]");
    if (!$btn) return;
    const code = $btn.closest(".md-codeblock")?.querySelector("code");
    if (!code) return;
    
    navigator.clipboard.writeText(code.textContent).then(() => {
      const original = $btn.textContent;
      $btn.textContent = "copied!";
      $btn.classList.add("md-codeblock__copy--done");
      setTimeout(() => {
        $btn.textContent = original;
        $btn.classList.remove("md-codeblock__copy--done");
      }, 1800);
    });
  });

  // Handle message actions
  $messages.addEventListener("click", (e) => {
    const $btn = e.target.closest(".llm-msg__action-btn");
    if (!$btn) return;

    const action = $btn.dataset.action;
    const $msg = $btn.closest(".llm-msg");
    const role = $msg.classList.contains("llm-msg--user") ? "user" : "assistant";
    const allMsgs = [...$messages.querySelectorAll(".llm-msg--user, .llm-msg--assistant")];
    const domIdx = allMsgs.indexOf($msg);
    const chatHistory = history.filter(m => m.role !== "system");

    switch (action) {
      case "copy":
        const text = chatHistory[domIdx]?.content ?? $msg.querySelector(".llm-msg__text").textContent;
        navigator.clipboard.writeText(text);
        break;

      case "edit":
        const current = chatHistory[domIdx]?.content ?? "";
        const $input = document.getElementById("llm-input");
        $input.value = current;
        $input.dispatchEvent(new Event("input"));
        $input.focus();
        // Fallthrough to delete subsequent history
      case "retry":
      case "regenerate":
        const truncateIdx = action === "regenerate" ? domIdx : (action === "retry" ? domIdx : domIdx);
        // Find real history index
        let sysCount = 0;
        let foundIdx = -1;
        for (let i = 0; i < history.length; i++) {
          if (history[i].role === "system") { sysCount++; continue; }
          if (i - sysCount === (action === "regenerate" ? domIdx : domIdx)) {
            foundIdx = i;
            break;
          }
        }

        if (foundIdx >= 0) {
          const retryText = action === "regenerate" ? history[foundIdx-1]?.content : (action === "retry" ? history[foundIdx]?.content : null);
          history.splice(foundIdx);
          updateStats();
          allMsgs.slice(domIdx).forEach(el => el.remove());
          if (retryText && (action === "retry" || action === "regenerate")) sendMessage(retryText);
        }
        break;

      case "delete":
        let sCount = 0;
        let dIdx = -1;
        for (let i = 0; i < history.length; i++) {
          if (history[i].role === "system") { sCount++; continue; }
          if (i - sCount === domIdx) { dIdx = i; break; }
        }
        if (dIdx >= 0) {
          history.splice(dIdx, 1);
          updateStats();
        }
        $msg.remove();
        break;
    }
  });
}

/**
 * Core sender logic
 * @param {Object} ctx - The execution context containing DOM refs, state, and config.
 */
export async function sendMessage(ctx) {
  const { 
    userText, history, cfg, llm, 
    auth, ui, model, 
    callbacks 
  } = ctx;

  if (!auth.hasValidKey()) return;
  const token = auth.PROXY_MODE ? "" : auth.getApiKey();

  const m = model.getSelected();
  const inf = m.recommended_inference;
  const temperature = cfg.tempOverride ?? inf.temperature;

  let contextHistory = [...history];
  if (cfg.maxCtxTurns !== null) {
    const maxMsgs = cfg.maxCtxTurns * 2;
    if (contextHistory.length > maxMsgs) {
      contextHistory = contextHistory.slice(-maxMsgs);
    }
  }

  history.push({ role: "user", content: userText });
  appendMessage(ui.messages, history, "user", userText);
  
  ui.setLoading(true);
  ui.setStatus("thinking", "THINKING...");
  callbacks.updateStats();

  const $streamTarget = appendMessage(ui.messages, history, "assistant", "", true);
  const $streamMsg = $streamTarget.closest(".llm-msg");
  
  const $thinking = document.createElement("div");
  $thinking.className = "llm-msg__thinking";
  $thinking.innerHTML = "<span></span><span></span><span></span>";
  $streamTarget.appendChild($thinking);

  const messages = [
    { role: "system", content: callbacks.buildSystemPrompt() },
    ...contextHistory,
    { role: "user", content: userText },
  ];

  const abortController = new AbortController();
  sendMessage._currentAbort = abortController;

  try {
    const res = await fetch(`${llm.api_base}/chat/completions`, {
      method: "POST",
      signal: abortController.signal,
      credentials: auth.PROXY_MODE ? "include" : "omit",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "Authorization": `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ 
        model: m.id, 
        messages, 
        stream: cfg.streaming, 
        temperature, 
        top_p: inf.top_p 
      }),
    });

    if (!res.ok) {
      if (auth.PROXY_MODE && (res.status === 401 || res.status === 403)) {
        let reason = res.status === 401 ? "Session expired." : "Access denied.";
        try {
          const err = await res.json();
          if (err.error) reason = err.error;
          if (err.auth_url) llm._proxyAuthUrl = err.auth_url;
        } catch {}
        const authUrl = llm._proxyAuthUrl || llm.auth_url;
        const authLink = authUrl ? ` <a href="${esc(authUrl)}" target="_blank" rel="noopener" class="llm-msg__auth-link">Authenticate →</a>` : "";
        throw Object.assign(new Error(reason), { _authFragment: authLink });
      }
      throw new Error(`HTTP ${res.status} — ${await res.text()}`);
    }

    let fullText = "";
    let chunkCount = 0;
    let stopped = false;

    if (cfg.streaming) {
      ui.setStatus("streaming", "STREAMING...");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let rafPending = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const lines = decoder.decode(value, { stream: true }).split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") break;
            try {
              const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
              if (delta) {
                if (!chunkCount) $thinking.remove();
                fullText += delta;
                chunkCount++;
                if (!rafPending) {
                  rafPending = true;
                  requestAnimationFrame(() => {
                    $streamTarget.innerHTML = renderMarkdown(fullText);
                    ui.messages.scrollTop = ui.messages.scrollHeight;
                    rafPending = false;
                  });
                }
              }
            } catch {}
          }
        }
      } catch (e) {
        if (e.name === "AbortError") stopped = true;
        else throw e;
      }
    } else {
      const data = await res.json();
      fullText = data.choices?.[0]?.message?.content ?? "";
      $thinking.remove();
    }

    $streamMsg.classList.remove("llm-msg--streaming");

    if (stopped && !fullText) {
      $streamMsg.remove();
      history.pop();
      // Remove last user message from DOM
      ui.messages.querySelectorAll(".llm-msg--user")?.item(-1)?.remove();
      ui.input.value = userText;
      ui.input.style.height = "auto";
      appendSysLog(ui.messages, "Generation stopped. Message restored to input.");
    } else {
      $streamTarget.innerHTML = renderMarkdown(fullText);
      if (stopped) {
        const badge = document.createElement("span");
        badge.className = "llm-msg__stopped-badge";
        badge.textContent = "⬛ stopped";
        $streamMsg.querySelector(".llm-msg__body")?.appendChild(badge);
      }
      history.push({ role: "assistant", content: fullText });
      callbacks.updateStats();
      callbacks.persistHistory();
      if (stopped) appendSysLog(ui.messages, `Generation stopped (partial response committed).`);
    }

    ui.setStatus("ready", "READY");

  } catch (e) {
    $streamMsg.remove();
    history.pop();
    ui.messages.querySelectorAll(".llm-msg--user")?.item(-1)?.remove();
    ui.setStatus("error", "ERROR");
    
    if (e.name === "AbortError") {
      appendSysLog(ui.messages, "Generation stopped.");
    } else {
      console.error("[llm] failure:", e);
      if (e._authFragment) appendSysLog(ui.messages, `${e.message}${e._authFragment}`, true);
      else appendSysLog(ui.messages, `Error: ${e.message}`);
    }
    
    ui.input.value = userText;
    ui.input.style.height = "auto";
    setTimeout(() => { if (ui.getShellState() === "error") ui.setStatus("ready", "READY"); }, 4000);
  } finally {
    sendMessage._currentAbort = null;
    ui.setLoading(false);
    ui.input.focus();
  }
}
sendMessage._currentAbort = null;
