import { loadCoreData } from './modules/core.js';
import { renderUI } from './modules/ui.js';

async function boot() {
  const success = await loadCoreData();
  if (!success) return;

  renderUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
