/* trap.lol — LLM Transport
   Pure HTTP layer for nano-gpt (OpenAI-compatible) chat completions.
   No UI. No prompt logic. No app-specific concerns.
   GPL-3.0 — trap.lol */

import { config } from './core.js';

function apiBase() {
  return config?.llm?.api_base ?? 'https://nano-gpt.com/api/v1';
}

function authHeaders(apiKey, proxyMode = false) {
  if (proxyMode) return { 'Content-Type': 'application/json' };
  return apiKey
    ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
    : { 'Content-Type': 'application/json' };
}

// ── <think>…</think> stripping ────────────────────────────────────────────────
export function extractThoughts(rawText) {
  const thoughts = [];
  const text = rawText.replace(/<think>([\s\S]*?)<\/think>/gi, (_, t) => {
    thoughts.push(t.trim());
    return '';
  }).trim();
  return { text, thoughts };
}

// ── Streaming chat completion ─────────────────────────────────────────────────
// payload: standard OpenAI chat payload (model, messages, temperature, …)
// opts.onChunk(delta)          — called for each text delta
// opts.onDone(text, thoughts)  — called when stream ends cleanly
// opts.onError(err)            — called on any failure
// opts.signal                  — optional AbortSignal
// opts.proxyMode               — skip Bearer header, use credentials:include
// opts.apiKey                  — caller-supplied key; avoids shared-module-instance problems
export async function streamChat(payload, { onChunk, onDone, onError, signal, proxyMode = false, apiKey = '' } = {}) {
  const sendPayload = { ...payload, stream: true };
  // Strip engine-private fields before sending
  delete sendPayload._charName;
  delete sendPayload._flags;

  let fullText = '';

  try {
    const res = await fetch(`${apiBase()}/chat/completions`, {
      method: 'POST',
      signal,
      credentials: proxyMode ? 'include' : 'omit',
      headers: authHeaders(apiKey, proxyMode),
      body: JSON.stringify(sendPayload),
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.text();
        if (res.status === 402) {
          msg = 'Payment required — check your nano-gpt balance or subscription status.';
        } else {
          try { const j = JSON.parse(body); msg = j.error?.message || j.error || msg; } catch (_) {}
        }
      } catch (_) {}
      throw Object.assign(new Error(msg), { status: res.status });
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break outer;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onChunk?.(delta, fullText);
          }
        } catch (_) {}
      }
    }

    const { text, thoughts } = extractThoughts(fullText);
    onDone?.(text, thoughts, fullText);

  } catch (err) {
    onError?.(err);
  }
}

// ── Non-streaming chat completion ─────────────────────────────────────────────
// Returns { text, thoughts, rawText, tokens } or throws.
export async function fetchChat(payload, { proxyMode = false, apiKey = '' } = {}) {
  const sendPayload = { ...payload, stream: false };
  delete sendPayload._charName;
  delete sendPayload._flags;

  const res = await fetch(`${apiBase()}/chat/completions`, {
    method: 'POST',
    credentials: proxyMode ? 'include' : 'omit',
    headers: authHeaders(apiKey, proxyMode),
    body: JSON.stringify(sendPayload),
  });

  if (!res.ok) {
    if (res.status === 402) throw Object.assign(new Error('Payment required — check your nano-gpt balance or subscription status.'), { status: 402 });
    const j = await res.json().catch(() => ({}));
    throw Object.assign(
      new Error(j.error?.message || j.error || `HTTP ${res.status}`),
      { status: res.status }
    );
  }

  const data    = await res.json();
  const rawText = data.choices?.[0]?.message?.content ?? '';
  const { text, thoughts } = extractThoughts(rawText);

  return {
    text,
    thoughts,
    rawText,
    tokens: data.usage?.completion_tokens ?? 0,
  };
}
