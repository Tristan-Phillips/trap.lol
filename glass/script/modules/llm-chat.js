// Neural Uplink — message rendering & core send logic
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
  console.warn("[security] DOMPurify unavailable — using fallback sanitization");
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

// appendSysLogHTML is only used for auth links whose URL has already been esc()-sanitized
// by the caller. DOMPurify is applied here as an additional defense-in-depth layer.
export function appendSysLogHTML($messages, html) {
  const safeHtml = sanitizeHtml(html);
  const $msg = document.createElement("div");
  $msg.className = "llm-msg llm-msg--system";
  const $body = document.createElement("div");
  $body.className = "llm-msg__body";
  const $text = document.createElement("p");
  $text.className = "llm-msg__text";
  $text.innerHTML = safeHtml;
  const $footer = document.createElement("div");
  $footer.className = "llm-msg__sys-footer";
  const $ts = document.createElement("span");
  $ts.className = "llm-msg__ts";
  $ts.textContent = new Date().toTimeString().slice(0, 8);
  const $del = document.createElement("button");
  $del.className = "llm-msg__sys-delete";
  $del.title = "Dismiss";
  $del.setAttribute("aria-label", "Dismiss system message");
  $del.innerHTML = `<i data-lucide="x"></i>`;
  $footer.appendChild($ts);
  $footer.appendChild($del);
  $body.appendChild($text);
  $body.appendChild($footer);
  $msg.innerHTML = `<span class="llm-msg__role">SYS</span>`;
  $msg.appendChild($body);
  $messages.appendChild($msg);
  $messages.scrollTop = $messages.scrollHeight;
  if (typeof lucide !== "undefined") lucide.createIcons({ nodes: [$del] });
  $del.addEventListener("click", () => $msg.remove());
}

export function appendSysLog($messages, text) {
  const ts = () => new Date().toTimeString().slice(0, 8);
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

export function buildMsgActions(role, historyIndex) {
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

export function appendMessage($messages, history, role, text, isStreaming = false) {
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
  $ts.textContent = new Date().toTimeString().slice(0, 8);
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

export function initChatEvents({ $messages, history, estimateTokens, sendMessage, updateStats }) {
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
        const $input = document.getElementById("llm-input");
        $input.value = current;
        $input.dispatchEvent(new Event("input"));
        $input.focus();
        const historyIdx = history.findIndex(
          (m, i) => m.role === "user" && history.slice(0, i).filter(x => x.role !== "system").length === domIdx
        );
        if (historyIdx >= 0) {
          history.splice(historyIdx);
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
          updateStats();
        }
        $msg.remove();
        break;
      }
    }
  });
}

export async function sendMessage({
  userText, history, cfg, llm,
  PROXY_MODE, getApiKey, hasValidKey,
  getSelectedModel, buildCompositeSystemPrompt, estimateTokens,
  $messages, $input, $sendBtn, $statChars, $charStat,
  $modelSelect, modelMap,
  setLoading, setStatus, updateStats, updateProviderBadge,
  appendSysLog: _appendSysLog, appendSysLogHTML: _appendSysLogHTML,
  persistHistory,
}) {
  if (!hasValidKey()) { console.warn("[llm] sendMessage blocked — no valid key"); return; }
  const token = PROXY_MODE ? "" : getApiKey();
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
  history._tokenCount = (history._tokenCount ?? 0) + estimateTokens(userText);
  appendMessage($messages, history, "user", userText);
  setLoading(true);
  setStatus("thinking", "THINKING...");
  updateStats();

  const $streamTarget = appendMessage($messages, history, "assistant", "", true);
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

  const abortController = new AbortController();
  // Expose abort handle so send button stop action can reach it
  sendMessage._currentAbort = abortController;

  try {
    const headers = { "Content-Type": "application/json" };
    if (!PROXY_MODE && token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${llm.api_base}/chat/completions`, {
      method: "POST",
      signal: abortController.signal,
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
        // authUrl is esc()-sanitized inside appendSysLogHTML's sanitizeHtml call
        const authFragment = authUrl ? ` <a href="${esc(authUrl)}" target="_blank" rel="noopener" class="llm-msg__auth-link">Authenticate →</a>` : "";
        throw Object.assign(new Error(reason), { _authFragment: authFragment });
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

    const ts = () => new Date().toTimeString().slice(0, 8);
    $streamMsg.classList.remove("llm-msg--streaming");

    if (stopped && !fullText) {
      $streamMsg.remove();
      history.pop();
      const $userMsgs = $messages.querySelectorAll(".llm-msg--user");
      $userMsgs[$userMsgs.length - 1]?.remove();
      $input.value = userText;
      $input.style.height = "auto";
      $input.style.height = Math.min($input.scrollHeight, 200) + "px";
      _appendSysLog("Generation stopped — no output received. Message restored to input.");
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
      history.push({ role: "assistant", content: fullText });
      updateStats();
      persistHistory();
      if (stopped) _appendSysLog(`Generation stopped — partial response committed (${chunkCount} chunk${chunkCount !== 1 ? "s" : ""}).`);
    }

    setStatus("ready", "READY");
    if (!stopped) console.log(`[llm] latency ${((performance.now()-t0)/1000).toFixed(2)}s — ${chunkCount} chunks`);

  } catch (e) {
    if (e.name === "AbortError") {
      $streamMsg.remove();
      history.pop();
      const $userMsgs = $messages.querySelectorAll(".llm-msg--user");
      $userMsgs[$userMsgs.length - 1]?.remove();
      $input.value = userText;
      $input.style.height = "auto";
      $input.style.height = Math.min($input.scrollHeight, 200) + "px";
      setStatus("ready", "READY");
      _appendSysLog("Generation stopped — message restored to input.");
      return;
    }

    $streamMsg.remove();
    history.pop();
    const $userMsgs = $messages.querySelectorAll(".llm-msg--user");
    $userMsgs[$userMsgs.length - 1]?.remove();
    setStatus("error", "ERROR");
    updateStats();
    console.error("[llm] request failed:", e.message);

    const fallbackId = m.fallback_id;
    if (PROXY_MODE || !fallbackId || !modelMap.has(fallbackId)) {
      if (e._authFragment) {
        _appendSysLogHTML(`${esc(e.message)}${e._authFragment}`);
      } else {
        _appendSysLog(`Error: ${e.message} — your message has been restored to the input.`);
      }
      $input.value = userText;
      $input.style.height = "auto";
      $input.style.height = Math.min($input.scrollHeight, 200) + "px";
    } else {
      const fb = modelMap.get(fallbackId);
      _appendSysLog(`Request failed — falling back to ${fb.label}. Your message has been restored.`);
      $modelSelect.value = fallbackId;
      updateProviderBadge();
      $input.value = userText;
      $input.style.height = "auto";
      $input.style.height = Math.min($input.scrollHeight, 200) + "px";
      if ($statChars) $statChars.textContent = userText.length;
      if ($charStat)  $charStat.dataset.warn  = userText.length > 6000 ? "critical" : userText.length > 3000 ? "warn" : "";
    }
    setTimeout(() => {
      const $shell = document.getElementById("llm-shell");
      if ($shell?.dataset.state === "error") setStatus("ready", "READY");
    }, 4000);
  } finally {
    sendMessage._currentAbort = null;
    setLoading(false);
    $input.focus();
  }
}
// Abort handle for stop button
sendMessage._currentAbort = null;
