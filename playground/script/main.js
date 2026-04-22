import { loadCoreData } from '../../glass/script/modules/core.js';
import { initLLM } from '../../glass/script/modules/llm.js';

// ── Prefill from hub launchpad ?q= / ?agent= ─────────────────────────────
// Consumes the URL params and wipes them so reload doesn't re-trigger.
function applyInboundPrefill() {
  const params = new URLSearchParams(window.location.search);
  const q      = params.get('q');
  const agent  = params.get('agent');
  if (!q && !agent) return;

  // Wait for LLM shell to be mounted before poking at its DOM.
  // initLLM runs synchronously after config load, so elements exist post-init.
  requestAnimationFrame(() => {
    if (agent) {
      const $agentSelect = document.getElementById('llm-agent-select');
      if ($agentSelect) {
        // The agent roster loads async inside initLLM — retry a few frames.
        let tries = 0;
        const poll = () => {
          const match = Array.from($agentSelect.options).find(o => o.value === agent);
          if (match) {
            $agentSelect.value = agent;
            $agentSelect.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (tries++ < 30) {
            setTimeout(poll, 120);
          }
        };
        poll();
      }
    }
    if (q) {
      const $input = document.getElementById('llm-input');
      if ($input) {
        $input.value = q;
        // Trigger autosize + char-count listeners.
        $input.dispatchEvent(new Event('input', { bubbles: true }));
        $input.focus();
        // Move cursor to end for easy review/edit.
        const len = $input.value.length;
        try { $input.setSelectionRange(len, len); } catch (_) {}
      }
    }
    // Strip params so a reload doesn't replay the prefill.
    if (window.history?.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  });
}

async function boot() {
  const success = await loadCoreData('../');
  if (!success) return;

  document.getElementById('playground-section')?.classList.remove('hidden');
  initLLM({ base: '../' });
  if (typeof lucide !== 'undefined') lucide.createIcons();
  applyInboundPrefill();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
