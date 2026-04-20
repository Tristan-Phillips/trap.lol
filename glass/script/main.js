import { loadCoreData } from './modules/core.js';
import { renderUI } from './modules/ui.js';
import { initLLM } from './modules/llm.js';

async function boot() {
  const success = await loadCoreData();
  if (!success) return;

  renderUI();
  initLLM();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
