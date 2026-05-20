/**
 * Wallhaven — standalone portal
 * Adapted from playground/underdark/script/modules/wallhaven.js
 * No underdark DOM dependencies. Data writes to same localStorage keys
 * (underdark_chars_v4) so assignments appear in gallery automatically.
 */

'use strict';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// URL PARAMS — read ?q=name&charId=id on boot
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const _urlParams  = new URLSearchParams(location.search);
const _bootQuery  = _urlParams.get('q')      || '';
const _bootCharId = _urlParams.get('charId') || null;

// Gate: show assign UI only when underdark characters exist
function hasUnderdarkChars(){
  try {
    const raw = localStorage.getItem('underdark_chars_v4');
    if (!raw) return false;
    const data = JSON.parse(raw);
    return Array.isArray(data.characters) && data.characters.length > 0;
  } catch { return false; }
}
const HAS_CHARS = hasUnderdarkChars();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VAULT CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PROXY_BASE = 'https://wallhaven.trap.lol';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(function(){
  try { const fp=JSON.parse(localStorage.getItem('wh_filters')||'{}'); window.__whFilters__=fp; }
  catch { window.__whFilters__={}; }
})();
const _fp = window.__whFilters__ || {};

const WH = {
  apiKey:       localStorage.getItem('wh_apikey') || '',
  vaultId:      localStorage.getItem('wh_vault_id') || '',
  query:        _bootQuery,
  cats:         _fp.cats   || { general:true, anime:true, people:true },
  purity:       _fp.purity || { sfw:true, sketchy:false, nsfw:false },
  sort:         _fp.sort    || 'toplist',
  topRange:     _fp.topRange|| '1M',
  layout:       _fp.layout  || 'grid',
  page:         1,
  totalPages:   1,
  total:        0,
  results:      [],
  liked:        loadSet('wh_liked'),
  saved:        loadSet('wh_saved'),
  likedData:    loadMap('wh_liked_data'),
  savedData:    loadMap('wh_saved_data'),
  assigned:     loadMapArr('wh_assigned'),
  assignedData: loadMap('wh_assigned_data'),
  lbIndex:      0,
  lbSet:        'browse',
  loading:      false,
  charName:     _bootQuery,
  charId:       _bootCharId,
  seed:         null,
  view:         'browse',
  assignedCharFilter: '',
};

function saveFilters(){
  localStorage.setItem('wh_filters', JSON.stringify({
    cats:WH.cats, purity:WH.purity, sort:WH.sort, topRange:WH.topRange, layout:WH.layout
  }));
}

function loadSet(k){ try{return new Set(JSON.parse(localStorage.getItem(k)||'[]'));}catch{return new Set();} }
function saveSet(k,s){ localStorage.setItem(k,JSON.stringify([...s])); }
function loadMap(k){ try{return new Map(Object.entries(JSON.parse(localStorage.getItem(k)||'{}')));}catch{return new Map();} }
function saveMap(k,m){ const o={}; m.forEach((v,kk)=>{o[kk]=v;}); localStorage.setItem(k,JSON.stringify(o)); }
function loadMapArr(k){ try{const r=JSON.parse(localStorage.getItem(k)||'{}');return new Map(Object.entries(r));}catch{return new Map();} }
function saveMapArr(k,m){ const o={}; m.forEach((v,kk)=>{o[kk]=v;}); localStorage.setItem(k,JSON.stringify(o)); }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DOM REFS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const charLabel      = document.getElementById('wh-char-label');
const whSidebar      = document.getElementById('wh-sidebar');
const whSidebarToggle= document.getElementById('wh-sidebar-toggle');
const whSidebarBack  = document.getElementById('wh-sidebar-backdrop');
const searchInput    = document.getElementById('wh-search-input');
const searchClear    = document.getElementById('wh-search-clear');
const searchBtn      = document.getElementById('wh-search-btn');
const apikeyInput    = document.getElementById('wh-apikey-input');
const apikeyToggle   = document.getElementById('wh-apikey-toggle');
const apikeySave     = document.getElementById('wh-apikey-save');
const keyStatus      = document.getElementById('wh-key-status');
const vaultInput     = document.getElementById('wh-vault-input');
const vaultSaveBtn   = document.getElementById('wh-vault-save');
const vaultNewBtn    = document.getElementById('wh-vault-new');
const vaultStatus    = document.getElementById('wh-vault-status');
const statusText     = document.getElementById('wh-status-text');
const resultCount    = document.getElementById('wh-result-count');
const pageControls   = document.getElementById('wh-page-controls');
const pageNum        = document.getElementById('wh-page-num');
const pageTotal      = document.getElementById('wh-page-total');
const grid           = document.getElementById('wh-grid');
const emptyBrowse    = document.getElementById('wh-empty');
const likedEmpty     = document.getElementById('wh-liked-empty');
const savedEmpty     = document.getElementById('wh-saved-empty');
const assignedEmpty  = document.getElementById('wh-assigned-empty');
const spinner        = document.getElementById('wh-spinner');
const errorBox       = document.getElementById('wh-error');
const errorMsg       = document.getElementById('wh-error-msg');
const retryBtn       = document.getElementById('wh-retry-btn');
const likedCount     = document.getElementById('wh-liked-count');
const savedCount     = document.getElementById('wh-saved-count');
const assignedCount  = document.getElementById('wh-assigned-count');
const filtersPanel   = document.getElementById('wh-filters-panel');
const topRangeGrp    = document.getElementById('wh-toprange-group');
const charFilterWrap = document.getElementById('wh-char-filter-wrap');
const charFilterSel  = document.getElementById('wh-char-filter');
const unassignAllBtn = document.getElementById('wh-unassign-all-btn');
const assignedTab    = document.getElementById('wh-assigned-tab');
const assignedTabM   = document.getElementById('wh-assigned-tab-m');

// Lightbox
const lb             = document.getElementById('wh-lightbox');
const lbBackdrop     = document.getElementById('wh-lb-backdrop');
const lbImg          = document.getElementById('wh-lb-img');
const lbRes          = document.getElementById('wh-lb-res');
const lbPurityEl     = document.getElementById('wh-lb-purity');
const lbCat          = document.getElementById('wh-lb-cat');
const lbViews        = document.getElementById('wh-lb-views').querySelector('span');
const lbFaves        = document.getElementById('wh-lb-faves').querySelector('span');
const lbOpen         = document.getElementById('wh-lb-open');
const lbPrev         = document.getElementById('wh-lb-prev');
const lbNext         = document.getElementById('wh-lb-next');
const lbLike         = document.getElementById('wh-lb-like');
const lbSave         = document.getElementById('wh-lb-save');
const lbDownload     = document.getElementById('wh-lb-download');
const lbClose        = document.getElementById('wh-lb-close');
const lbCounter      = document.getElementById('wh-lb-counter');
const lbAssignWrap   = document.getElementById('wh-lb-assign-wrap');
const lbAssignSel    = document.getElementById('wh-lb-assign-select');
const lbAssignBtn    = document.getElementById('wh-lb-assign-btn');
const lbViewport     = document.getElementById('wh-lb-viewport');
const lbZoomPill     = document.getElementById('wh-lb-zoom-pill');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

const tileObserver = new IntersectionObserver((entries, obs) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const img = entry.target.querySelector('.wh-tile__img--pending');
    if (img && img.dataset.src) {
      const preload = new Image();
      preload.onload = () => {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        img.classList.remove('wh-tile__img--pending');
        img.classList.add('wh-tile__img--reveal');
        entry.target.classList.remove('wh-tile--skeleton');
      };
      preload.onerror = () => {
        const fb = img.dataset.fallback;
        if (fb) {
          img.src = fb;
          img.removeAttribute('data-src');
          img.classList.remove('wh-tile__img--pending');
          img.classList.add('wh-tile__img--reveal');
          entry.target.classList.remove('wh-tile--skeleton');
        } else {
          img.classList.add('wh-tile__img--error');
          entry.target.classList.remove('wh-tile--skeleton');
        }
      };
      preload.src = img.dataset.src;
    }
    obs.unobserve(entry.target);
  });
}, { root: null, rootMargin: '150px 0px', threshold: 0 });

function buildCats()   { return `${WH.cats.general?1:0}${WH.cats.anime?1:0}${WH.cats.people?1:0}`; }
function buildPurity() { return `${WH.purity.sfw?1:0}${WH.purity.sketchy?1:0}${WH.purity.nsfw?1:0}`; }
function purityLabel(p){ return {sfw:'SFW',sketchy:'Sketchy',nsfw:'NSFW'}[p]||p; }
function fmtNum(n){ if(n>=1e6)return(n/1e6).toFixed(1)+'M'; if(n>=1e3)return(n/1e3).toFixed(1)+'k'; return String(n); }

function setLoading(on, isAppend=false){
  WH.loading=on; searchBtn.disabled=on;
  if(!isAppend) spinner.hidden=!on;
  if(on){ emptyBrowse.hidden=true;likedEmpty.hidden=true;savedEmpty.hidden=true;assignedEmpty.hidden=true;errorBox.hidden=true; }
  const lmBtn=document.getElementById('wh-load-more-btn');
  if(lmBtn){
    lmBtn.disabled=on;
    lmBtn.innerHTML=on?'<span class="wh-spin-icon">↻</span> Loading…':'+ Load More';
  }
}
function hideAllStates(){
  emptyBrowse.hidden=true;likedEmpty.hidden=true;savedEmpty.hidden=true;assignedEmpty.hidden=true;errorBox.hidden=true;spinner.hidden=true;
  const logEl=document.getElementById('wh-assign-log'); if(logEl)logEl.hidden=true;
}
function showError(msg){ errorBox.hidden=false;errorMsg.textContent=msg;spinner.hidden=true; }

function updateBadges(){
  const ls=WH.liked.size, ss=WH.saved.size, as=WH.assignedData.size;
  likedCount.textContent    = ls;
  savedCount.textContent    = ss;
  assignedCount.textContent = as;
  likedCount.classList.toggle('wh-liked-badge--active',    ls>0);
  savedCount.classList.toggle('wh-saved-badge--active',    ss>0);
  assignedCount.classList.toggle('wh-saved-badge--active', as>0);
  const mlc=document.getElementById('wh-liked-count-m'), msc=document.getElementById('wh-saved-count-m');
  if(mlc) mlc.textContent=ls;
  if(msc) msc.textContent=ss;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CHARACTER DATA — reads underdark_chars_v4 (same store as gallery)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function getAllChars(){
  try {
    const raw=localStorage.getItem('underdark_chars_v4'); if(!raw)return[];
    const data=JSON.parse(raw);
    return Array.isArray(data.characters)?data.characters:[];
  } catch { return []; }
}
function getCharName(id){
  const c=getAllChars().find(c=>String(c.id)===String(id));
  return c?(c.name||'Unknown'):'Unknown';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ASSIGN UI GATING — hide Assigned tab + assign controls unless HAS_CHARS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if (HAS_CHARS) {
  lbAssignWrap.hidden = false;
} else {
  if (assignedTab)  assignedTab.hidden  = true;
  if (assignedTabM) assignedTabM.hidden = true;
  lbAssignWrap.hidden = true;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POPULATE CHARACTER SELECTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function populateCharSelects(){
  if (!HAS_CHARS) return;
  const chars=getAllChars();
  lbAssignSel.innerHTML='<option value="">Assign to character…</option>';
  chars.forEach(c=>{
    const opt=document.createElement('option');
    opt.value=String(c.id); opt.textContent=c.name||'Unnamed';
    lbAssignSel.appendChild(opt);
  });
  if(WH.charId) lbAssignSel.value=String(WH.charId);

  charFilterSel.innerHTML='<option value="">All Characters</option>';
  chars.forEach(c=>{
    const opt=document.createElement('option');
    opt.value=String(c.id); opt.textContent=c.name||'Unnamed';
    charFilterSel.appendChild(opt);
  });
  if(WH.assignedCharFilter) charFilterSel.value=WH.assignedCharFilter;
}

charFilterSel.addEventListener('change',()=>{
  WH.assignedCharFilter=charFilterSel.value;
  if(WH.view==='assigned') renderCurrentView();
});

unassignAllBtn.addEventListener('click',()=>{
  let wallIds;
  if(WH.assignedCharFilter){
    wallIds=[...WH.assignedData.keys()].filter(wid=>(WH.assigned.get(wid)||[]).includes(WH.assignedCharFilter));
  } else {
    wallIds=[...WH.assignedData.keys()];
  }
  if(!wallIds.length){showToast('Nothing to unassign.','info');return;}
  const label=WH.assignedCharFilter?`from ${getCharName(WH.assignedCharFilter)}`:'from all characters';
  if(!confirm(`Unassign ${wallIds.length} image${wallIds.length===1?'':'s'} ${label}?\n\nThis removes them from the Assigned view but does NOT delete them from character galleries.`))return;
  // Clean up wh_char_gallery for these wallpapers
  try {
    const whKey='wh_char_gallery';
    let store; try{store=JSON.parse(localStorage.getItem(whKey)||'{}');}catch{store={};}
    wallIds.forEach(wid=>{
      const wData=WH.assignedData.get(wid); if(!wData)return;
      const affectedChars=WH.assignedCharFilter?[WH.assignedCharFilter]:(WH.assigned.get(wid)||[]);
      affectedChars.forEach(cid=>{
        const k=String(cid);
        if(Array.isArray(store[k])){
          store[k]=store[k].filter(e=>typeof e==='string'?e!==wData.path:e.url!==wData.path);
          if(!store[k].length)delete store[k];
        }
      });
    });
    localStorage.setItem(whKey,JSON.stringify(store));
  } catch(e){console.warn('WH unassign-all gallery error',e);}
  wallIds.forEach(wid=>{
    if(WH.assignedCharFilter){
      const next=(WH.assigned.get(wid)||[]).filter(id=>id!==WH.assignedCharFilter);
      if(next.length===0){WH.assigned.delete(wid);WH.assignedData.delete(wid);}
      else{WH.assigned.set(wid,next);}
    } else {
      WH.assigned.delete(wid); WH.assignedData.delete(wid);
    }
  });
  saveMapArr('wh_assigned',WH.assigned);
  saveMap('wh_assigned_data',WH.assignedData);
  updateBadges(); renderCurrentView();
  showToast(`Unassigned ${wallIds.length} image${wallIds.length===1?'':'s'} ${label}.`,'success');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API KEY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
apikeyInput.value=WH.apiKey;
if(WH.apiKey){ keyStatus.textContent='Connected'; keyStatus.className='wh-key-status wh-key-status--ok'; }

apikeyToggle.addEventListener('click',()=>{
  const show=apikeyInput.type==='password';
  apikeyInput.type=show?'text':'password';
  apikeyToggle.innerHTML=show
    ?'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" x2="23" y1="1" y2="23"/></svg>'
    :'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
});
apikeySave.addEventListener('click',()=>{
  WH.apiKey=apikeyInput.value.trim();
  localStorage.setItem('wh_apikey',WH.apiKey);
  keyStatus.textContent=WH.apiKey?'Connected':'Cleared';
  keyStatus.className='wh-key-status'+(WH.apiKey?' wh-key-status--ok':'');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VAULT ID
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function setVaultStatus(msg, ok){
  vaultStatus.textContent=msg;
  vaultStatus.className='wh-vault-status'+(ok?' wh-vault-status--ok':ok===false?' wh-vault-status--err':'');
}

function applyVaultId(id){
  WH.vaultId=id;
  vaultInput.value=id;
  localStorage.setItem('wh_vault_id',id);
  if(id){ setVaultStatus('Active','ok'); } else { setVaultStatus('',''); }
}

// Restore saved vault ID on load
if(WH.vaultId){ vaultInput.value=WH.vaultId; setVaultStatus('Active',true); }

vaultSaveBtn.addEventListener('click',async()=>{
  const id=vaultInput.value.trim().toUpperCase();
  if(!id){ applyVaultId(''); showToast('Vault ID cleared.','info'); return; }
  // Validate format XXXX-XXXX-XXXX-XXXX
  if(!/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(id)){
    setVaultStatus('Invalid format',false); showToast('Expected format: XXXX-XXXX-XXXX-XXXX','warn'); return;
  }
  setVaultStatus('Verifying…','');
  try{
    const r=await fetch(`${PROXY_BASE}/vault/${id}/data`);
    if(r.status===404){ setVaultStatus('Not found',false); showToast('Vault ID not found — use "New" to create one.','warn'); return; }
    if(!r.ok) throw new Error('HTTP '+r.status);
    applyVaultId(id);
    showToast('Vault connected — syncing…','success');
    await syncFromVault();
    await pushToVault();
    showToast('Local state uploaded to vault.','success');
  }catch(e){ setVaultStatus('Error',false); showToast('Could not reach proxy: '+e.message,'warn'); }
});

vaultNewBtn.addEventListener('click',async()=>{
  vaultNewBtn.disabled=true; setVaultStatus('Creating…','');
  try{
    const r=await fetch(`${PROXY_BASE}/vault/create`,{method:'POST'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const json=await r.json();
    applyVaultId(json.vault_id);
    vaultInput.value=json.vault_id;
    showToast('New vault created! ID saved.','success');
  }catch(e){ setVaultStatus('Error',false); showToast('Could not create vault: '+e.message,'warn'); }
  finally{ vaultNewBtn.disabled=false; }
});

// Format input automatically as user types (XXXX-XXXX-XXXX-XXXX)
vaultInput.addEventListener('input',()=>{
  let v=vaultInput.value.replace(/[^0-9A-Fa-f]/g,'').toUpperCase().slice(0,16);
  const parts=[v.slice(0,4),v.slice(4,8),v.slice(8,12),v.slice(12,16)].filter(Boolean);
  vaultInput.value=parts.join('-');
});

// ── Vault API helpers ─────────────────────────────────────────────────────
async function vaultPost(path, body){
  if(!WH.vaultId)return;
  return fetch(`${PROXY_BASE}/vault/${WH.vaultId}/${path}`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),
  }).catch(()=>{});
}
async function vaultDelete(path){
  if(!WH.vaultId)return;
  return fetch(`${PROXY_BASE}/vault/${WH.vaultId}/${path}`,{method:'DELETE'}).catch(()=>{});
}

// Push existing localStorage state up to vault (runs once when vault ID is first set)
async function pushToVault(){
  if(!WH.vaultId)return;
  const calls=[];
  WH.liked.forEach(wallId=>{
    const w=WH.likedData.get(wallId); if(!w)return;
    calls.push(vaultPost('like',{wallId,wallData:w}));
  });
  WH.saved.forEach(wallId=>{
    const w=WH.savedData.get(wallId); if(!w)return;
    calls.push(vaultPost('save',{wallId,wallData:w}));
  });
  WH.assigned.forEach((charIds,wallId)=>{
    const w=WH.assignedData.get(wallId); if(!w)return;
    charIds.forEach(charId=>{
      calls.push(vaultPost('assign',{
        wallId, charId:String(charId), charName:getCharName(charId),
        thumbUrl:w.thumbs?.large||w.thumbs?.small||'', fullUrl:w.path||'',
      }));
    });
  });
  await Promise.allSettled(calls);
}

// Sync full vault state from backend → hydrate local sets/maps
async function syncFromVault(){
  if(!WH.vaultId)return;
  try{
    const r=await fetch(`${PROXY_BASE}/vault/${WH.vaultId}/data`);
    if(!r.ok)return;
    const data=await r.json();

    // Hydrate liked
    (data.liked||[]).forEach(e=>{
      WH.liked.add(e.wallId);
      try{ WH.likedData.set(e.wallId,JSON.parse(typeof e.wallData==='string'?e.wallData:JSON.stringify(e.wallData))); }catch{}
    });
    saveSet('wh_liked',WH.liked); saveMap('wh_liked_data',WH.likedData);

    // Hydrate saved
    (data.saved||[]).forEach(e=>{
      WH.saved.add(e.wallId);
      try{ WH.savedData.set(e.wallId,JSON.parse(typeof e.wallData==='string'?e.wallData:JSON.stringify(e.wallData))); }catch{}
    });
    saveSet('wh_saved',WH.saved); saveMap('wh_saved_data',WH.savedData);

    // Hydrate assignments
    (data.assignments||[]).forEach(e=>{
      const charIds=WH.assigned.get(e.wallId)||[];
      if(!charIds.includes(e.charId))charIds.push(e.charId);
      WH.assigned.set(e.wallId,charIds);
      // Reconstruct minimal wall data for assigned view
      if(!WH.assignedData.has(e.wallId)){
        WH.assignedData.set(e.wallId,{
          id:e.wallId, path:e.fullUrl, thumbs:{large:e.thumbUrl,small:e.thumbUrl},
          resolution:'', purity:'sfw', category:'', views:0, favorites:0,
          url:`https://wallhaven.cc/w/${e.wallId}`, file_type:'image/jpeg',
        });
      }
      // Also hydrate wh_char_gallery so underdark gallery sees the assignments
      try{
        const store=JSON.parse(localStorage.getItem('wh_char_gallery')||'{}');
        const cid=String(e.charId);
        if(!Array.isArray(store[cid]))store[cid]=[];
        if(!store[cid].some(x=>(typeof x==='string'?x:x.url)===e.fullUrl)){
          store[cid].push({url:e.fullUrl,thumb:e.thumbUrl,wallId:e.wallId});
          localStorage.setItem('wh_char_gallery',JSON.stringify(store));
        }
      }catch{}
    });
    saveMapArr('wh_assigned',WH.assigned); saveMap('wh_assigned_data',WH.assignedData);

    updateBadges();
    showToast('Vault synced.','success');
  }catch{ /* non-critical */ }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILTER CHIPS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(function restoreFilterChips(){
  document.querySelectorAll('#wh-cats .wh-chip').forEach(b=>b.classList.toggle('active',!!WH.cats[b.dataset.cat]));
  document.querySelectorAll('#wh-purities .wh-chip').forEach(b=>b.classList.toggle('active',!!WH.purity[b.dataset.purity]));
  document.querySelectorAll('#wh-sorts .wh-chip').forEach(b=>b.classList.toggle('active',b.dataset.sort===WH.sort));
  document.querySelectorAll('#wh-ranges .wh-chip').forEach(b=>b.classList.toggle('active',b.dataset.range===WH.topRange));
  document.querySelectorAll('#wh-layouts .wh-chip').forEach(b=>b.classList.toggle('active',b.dataset.layout===WH.layout));
  topRangeGrp.style.display=WH.sort==='toplist'?'':'none';
  grid.className=`wh-grid wh-grid--${WH.layout}`;
})();

document.querySelectorAll('#wh-cats .wh-chip').forEach(btn=>{
  btn.addEventListener('click',()=>{
    WH.cats[btn.dataset.cat]=!WH.cats[btn.dataset.cat];
    btn.classList.toggle('active',WH.cats[btn.dataset.cat]); saveFilters();
  });
});
document.querySelectorAll('#wh-purities .wh-chip').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const p=btn.dataset.purity;
    if(p!=='sfw'&&!WH.apiKey){showToast('API key required for '+purityLabel(p)+' content.','warn');return;}
    WH.purity[p]=!WH.purity[p]; btn.classList.toggle('active',WH.purity[p]); saveFilters();
  });
});
document.querySelectorAll('#wh-sorts .wh-chip').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('#wh-sorts .wh-chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); WH.sort=btn.dataset.sort;
    topRangeGrp.style.display=WH.sort==='toplist'?'':'none'; saveFilters();
  });
});
document.querySelectorAll('#wh-ranges .wh-chip').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('#wh-ranges .wh-chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); WH.topRange=btn.dataset.range; saveFilters();
  });
});
document.querySelectorAll('#wh-layouts .wh-chip').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('#wh-layouts .wh-chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); WH.layout=btn.dataset.layout;
    grid.className=`wh-grid wh-grid--${WH.layout}`; saveFilters();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VIEW TABS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function switchWhView(view){
  WH.view=view;
  document.querySelectorAll('.wh-view-tab').forEach(b=>b.classList.toggle('active',b.dataset.wview===view));
  document.querySelectorAll('.wh-mobile-tab').forEach(b=>b.classList.toggle('active',b.dataset.wview===view));
  const isBrowse=view==='browse', isAssigned=view==='assigned';
  filtersPanel.style.display=isBrowse?'':'none';
  charFilterWrap.hidden=!isAssigned;
  pageControls.hidden=!isBrowse;
  if(isAssigned) populateCharSelects();
  renderCurrentView();
}

document.querySelectorAll('.wh-view-tab').forEach(btn=>btn.addEventListener('click',()=>switchWhView(btn.dataset.wview)));
document.querySelectorAll('.wh-mobile-tab').forEach(btn=>btn.addEventListener('click',()=>switchWhView(btn.dataset.wview)));

// Mobile sidebar toggle
function openWhSidebar(){
  whSidebar.classList.add('wh-sidebar--open'); whSidebarBack.hidden=false;
  whSidebarToggle.setAttribute('aria-expanded','true');
  document.addEventListener('keydown',closeWhSidebarOnEsc);
}
function closeWhSidebar(){
  whSidebar.classList.remove('wh-sidebar--open'); whSidebarBack.hidden=true;
  whSidebarToggle.setAttribute('aria-expanded','false');
  document.removeEventListener('keydown',closeWhSidebarOnEsc);
}
function closeWhSidebarOnEsc(e){ if(e.key==='Escape') closeWhSidebar(); }
whSidebarToggle.addEventListener('click',()=>whSidebar.classList.contains('wh-sidebar--open')?closeWhSidebar():openWhSidebar());
whSidebarBack.addEventListener('click',closeWhSidebar);

function renderAssignLog(){
  const LOG_KEY='wh_assign_log';
  let log; try{log=JSON.parse(localStorage.getItem(LOG_KEY)||'[]');}catch{log=[];}
  // Filter by active char filter if set
  const filtered=WH.assignedCharFilter?log.filter(e=>e.charId===WH.assignedCharFilter):log;
  let el=document.getElementById('wh-assign-log');
  if(!el){
    el=document.createElement('div'); el.id='wh-assign-log'; el.className='wh-assign-log';
    grid.parentElement.appendChild(el);
  }
  if(!filtered.length){el.hidden=true;return;}
  el.hidden=false;
  const fmtDate=ts=>{const d=new Date(ts);return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});};
  el.innerHTML=`
    <div class="wh-assign-log__header">
      <span class="wh-assign-log__title">Assignment Log</span>
      <button class="wh-btn wh-btn--ghost wh-btn--sm" id="wh-log-clear-btn">Clear Log</button>
    </div>
    <div class="wh-assign-log__list">
      ${filtered.map(e=>`
        <div class="wh-assign-log__row wh-assign-log__row--${e.action}">
          ${e.thumb?`<img src="${esc(imgProxyUrl(e.thumb))}" class="wh-assign-log__thumb" loading="lazy" onerror="this.style.display='none'" alt="">`:``}
          <div class="wh-assign-log__info">
            <span class="wh-assign-log__action">${e.action==='assign'?'↗ Assigned':'↙ Unassigned'}</span>
            <span class="wh-assign-log__char">${esc(e.charName)}</span>
            <span class="wh-assign-log__ts">${fmtDate(e.ts)}</span>
          </div>
        </div>`).join('')}
    </div>`;
  document.getElementById('wh-log-clear-btn')?.addEventListener('click',()=>{
    if(!confirm('Clear the full assignment log?'))return;
    localStorage.removeItem(LOG_KEY); el.hidden=true;
    showToast('Log cleared.','info');
  });
}

function renderPuritySplit(items, set) {
  const sfw   = items.filter(w => w.purity === 'sfw');
  const adult = items.filter(w => w.purity !== 'sfw');
  const hasBoth = sfw.length && adult.length;

  function insertSectionHead(label, count) {
    const el = document.createElement('div');
    el.className = 'wh-purity-section';
    el.innerHTML = `<span class="wh-purity-section__label">${label}</span><span class="wh-purity-section__count">${count}</span>`;
    grid.appendChild(el);
  }

  let idx = 0;
  if (sfw.length) {
    if (hasBoth) insertSectionHead('SFW', sfw.length);
    sfw.forEach(w => buildTile(w, idx++, set));
  }
  if (adult.length) {
    if (hasBoth) insertSectionHead('Sketchy / NSFW', adult.length);
    adult.forEach(w => buildTile(w, idx++, set));
  }
}

function renderCurrentView(){
  hideAllStates(); grid.innerHTML='';
  if(WH.view==='liked'){
    const items=[...WH.likedData.values()];
    if(!items.length){likedEmpty.hidden=false;return;}
    renderPuritySplit(items,'liked');
    window.lucide?.createIcons({nodes:[grid]});
    statusText.textContent='Liked'; resultCount.textContent=items.length+' images';
  } else if(WH.view==='saved'){
    const items=[...WH.savedData.values()];
    if(!items.length){savedEmpty.hidden=false;return;}
    renderPuritySplit(items,'saved');
    window.lucide?.createIcons({nodes:[grid]});
    statusText.textContent='Saved'; resultCount.textContent=items.length+' images';
  } else if(WH.view==='assigned'){
    let items=[...WH.assignedData.values()];
    if(WH.assignedCharFilter){
      items=items.filter(w=>(WH.assigned.get(w.id)||[]).includes(WH.assignedCharFilter));
    }
    if(!items.length){assignedEmpty.hidden=false; renderAssignLog(); return;}
    items.forEach((w,i)=>buildTile(w,i,'assigned'));
    renderAssignLog();
    window.lucide?.createIcons({nodes:[grid]});
    const label=WH.assignedCharFilter?`Assigned — ${getCharName(WH.assignedCharFilter)}`:'Assigned';
    statusText.textContent=label; resultCount.textContent=items.length+' images';
  } else {
    if(!WH.results.length){emptyBrowse.hidden=false;return;}
    WH.results.forEach((w,i)=>buildTile(w,i,'browse'));
    window.lucide?.createIcons({nodes:[grid]});
    statusText.textContent=WH.query?`"${WH.query}"`:'';
    resultCount.textContent=WH.total>0?WH.total.toLocaleString()+' results':'';
    pageControls.hidden=false;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEARCH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
searchInput.addEventListener('input',()=>{searchClear.hidden=!searchInput.value;});
searchClear.addEventListener('click',()=>{searchInput.value='';searchClear.hidden=true;searchInput.focus();});
searchInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();doSearch();}});
searchBtn.addEventListener('click',doSearch);
retryBtn.addEventListener('click',()=>fetchWallpapers(false));

function doSearch(){
  WH.query=searchInput.value.trim(); WH.page=1; WH.seed=null;
  document.querySelectorAll('.wh-view-tab').forEach(b=>b.classList.toggle('active',b.dataset.wview==='browse'));
  document.querySelectorAll('.wh-mobile-tab').forEach(b=>b.classList.toggle('active',b.dataset.wview==='browse'));
  WH.view='browse'; filtersPanel.style.display=''; charFilterWrap.hidden=true;
  fetchWallpapers(false);
}

function appendLoadMoreBtn(){
  if(WH.view!=='browse'||WH.page>=WH.totalPages)return;
  let wrap=document.getElementById('wh-load-more-wrap');
  if(wrap)wrap.remove();
  wrap=document.createElement('div');
  wrap.id='wh-load-more-wrap';
  wrap.className='wh-load-more-wrap';
  wrap.innerHTML=`<button id="wh-load-more-btn" class="wh-btn wh-btn--ghost wh-btn--lg">+ Load More</button>`;
  wrap.querySelector('button').addEventListener('click',()=>{WH.page++;fetchWallpapers(true);});
  grid.appendChild(wrap);
}

async function fetchWallpapers(append){
  if(WH.loading)return;
  setLoading(true,append); grid.hidden=false;
  if(!append) grid.innerHTML='';
  pageControls.hidden=true;
  const lmWrap=document.getElementById('wh-load-more-wrap');
  if(lmWrap)lmWrap.hidden=true;
  if(!append){statusText.textContent='Scanning…';resultCount.textContent='';}

  const q=WH.query||WH.charName;
  const params=new URLSearchParams({categories:buildCats(),purity:buildPurity(),sorting:WH.sort,order:'desc',page:WH.page});
  if(q)params.set('q',q);
  if(WH.sort==='toplist')params.set('topRange',WH.topRange);
  if(WH.sort==='random'&&WH.seed)params.set('seed',WH.seed);
  const fetchHeaders={};
  if(WH.apiKey)fetchHeaders['X-API-Key']=WH.apiKey;

  try{
    const res=await fetch(`https://wallhaven.trap.lol/api/v1/search?${params.toString()}`,{headers:fetchHeaders});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const json=await res.json();
    if(!json.data)throw new Error(json.error||'Unexpected response');
    const meta=json.meta||{};
    WH.totalPages=meta.last_page||1; WH.total=meta.total||json.data.length;
    if(meta.seed)WH.seed=meta.seed;
    if(append){
      const startIdx=WH.results.length;
      WH.results=WH.results.concat(json.data);
      if(WH.view==='browse'){
        if(lmWrap)lmWrap.remove();
        json.data.forEach((w,i)=>buildTile(w,startIdx+i,'browse'));
      }
    } else {
      WH.results=json.data;
      if(WH.view==='browse'){
        grid.innerHTML='';
        WH.results.forEach((w,i)=>buildTile(w,i,'browse'));
      }
    }
    if(WH.view==='browse'){
      appendLoadMoreBtn();
      window.lucide?.createIcons({nodes:[grid]});
      pageNum.textContent=WH.page; pageTotal.textContent=WH.totalPages;
      statusText.textContent=q?`"${q}"`:'Top results';
      resultCount.textContent=WH.total.toLocaleString()+' results';
      pageControls.hidden=!WH.results.length;
      if(!WH.results.length)emptyBrowse.hidden=false;
    }
    setLoading(false,append);
  } catch(err){
    setLoading(false,append);
    const m=err.message;
    showError(m.includes('429')?'Rate limit — wait a moment.':m.includes('401')?'Unauthorized — check API key.':'Fetch failed: '+m);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TILE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function charBadgesHtml(wallId){
  const charIds=WH.assigned.get(wallId)||[];
  if(!charIds.length)return'';
  const chars=getAllChars();
  return charIds.map(id=>{
    const c=chars.find(c=>String(c.id)===String(id)); if(!c)return'';
    const name=c.name||'?';
    return `<span class="wh-tile__char-badge" title="Assigned to ${esc(name)}">${esc(name.slice(0,1))}</span>`;
  }).join('');
}

function buildTile(w, idx, set){
  const isLiked=WH.liked.has(w.id), isSaved=WH.saved.has(w.id);
  const isAssigned=WH.assigned.has(w.id)&&(WH.assigned.get(w.id)||[]).length>0;
  const tile=document.createElement('div');
  tile.className=`wh-tile wh-tile--${w.purity} wh-tile--skeleton`;
  tile.dataset.idx=idx; tile.dataset.set=set;

  const assignBtn = HAS_CHARS
    ? `<button class="wh-tile-btn${isAssigned?' wh-tile-btn--active-assign':''}" data-action="assign" title="Assign to character">
         <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>
       </button>`
    : '';

  tile.innerHTML=`
    <div class="wh-tile__img-wrap">
      <img class="wh-tile__img wh-tile__img--pending" data-src="${esc(imgProxyUrl(w.thumbs.large))}" data-fallback="${esc(imgProxyUrl(w.thumbs.small||w.thumbs.large))}" draggable="false" alt="">
      ${isAssigned?`<div class="wh-tile__char-badges">${charBadgesHtml(w.id)}</div>`:''}
      <div class="wh-tile__overlay">
        <div class="wh-tile__overlay-top">
          <span class="wh-tile__purity wh-tile__purity--${w.purity}">${purityLabel(w.purity)}</span>
          <span class="wh-tile__res">${esc(w.resolution)}</span>
        </div>
        <div class="wh-tile__overlay-bottom">
          <div class="wh-tile__stats2">
            <span>👁 ${fmtNum(w.views)}</span>
            <span>♥ ${fmtNum(w.favorites)}</span>
          </div>
          <div class="wh-tile__actions">
            <button class="wh-tile-btn${isLiked?' wh-tile-btn--active-heart':''}" data-action="like" title="Like (L)">♥</button>
            <button class="wh-tile-btn${isSaved?' wh-tile-btn--active-save':''}" data-action="save" title="Save (S)">🔖</button>
            ${assignBtn}
            <button class="wh-tile-btn" data-action="dl" title="Download">↓</button>
          </div>
        </div>
      </div>
    </div>`;

  tile.querySelector('.wh-tile__img-wrap').addEventListener('click',e=>{
    if(e.target.closest('[data-action]'))return; openLightbox(idx,set);
  });
  tile.querySelector('[data-action="like"]').addEventListener('click',e=>{e.stopPropagation();toggleLike(w,tile);});
  tile.querySelector('[data-action="save"]').addEventListener('click',e=>{e.stopPropagation();toggleSave(w,tile);});
  if(HAS_CHARS) tile.querySelector('[data-action="assign"]')?.addEventListener('click',e=>{
    e.stopPropagation();
    // If there's an active character (from URL param), assign directly without opening lightbox
    if(WH.charId){
      assignToChar(w, WH.charId);
    } else {
      openLightbox(idx,set);
      requestAnimationFrame(()=>lbAssignSel.focus());
    }
  });
  tile.querySelector('[data-action="dl"]').addEventListener('click',e=>{e.stopPropagation();downloadWallpaper(w);});

  grid.appendChild(tile);
  tileObserver.observe(tile);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIKE / SAVE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function toggleLike(w,tile){
  const btn=tile.querySelector('[data-action="like"]');
  if(WH.liked.has(w.id)){
    WH.liked.delete(w.id);WH.likedData.delete(w.id);btn.classList.remove('wh-tile-btn--active-heart');showToast('Unliked.','info');
    vaultDelete(`like/${w.id}`);
  }else{
    WH.liked.add(w.id);WH.likedData.set(w.id,w);btn.classList.add('wh-tile-btn--active-heart');showToast('Liked!','success');
    vaultPost('like',{wallId:w.id,wallData:w});
  }
  saveSet('wh_liked',WH.liked);saveMap('wh_liked_data',WH.likedData);
  updateBadges();syncLbButtons();
}
function toggleSave(w,tile){
  const btn=tile.querySelector('[data-action="save"]');
  if(WH.saved.has(w.id)){
    WH.saved.delete(w.id);WH.savedData.delete(w.id);btn.classList.remove('wh-tile-btn--active-save');showToast('Removed.','info');
    vaultDelete(`save/${w.id}`);
  }else{
    WH.saved.add(w.id);WH.savedData.set(w.id,w);btn.classList.add('wh-tile-btn--active-save');showToast('Saved!','success');
    vaultPost('save',{wallId:w.id,wallData:w});
  }
  saveSet('wh_saved',WH.saved);saveMap('wh_saved_data',WH.savedData);
  updateBadges();syncLbButtons();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ASSIGN TO CHARACTER
// Writes to wh_char_gallery (wallhaven-owned key) — safe from underdark saveState() overwrites.
// Gallery page reads wh_char_gallery additively alongside underdark_chars_v4.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
lbAssignBtn.addEventListener('click',()=>{
  const charId=lbAssignSel.value; if(!charId)return;
  const w=lbDataset()[WH.lbIndex]; if(!w)return;
  assignToChar(w,charId);
});
lbAssignSel.addEventListener('change',syncLbButtons);

function logAssignAction(action, w, charId){
  try {
    const LOG_KEY='wh_assign_log', MAX=200;
    let log; try{log=JSON.parse(localStorage.getItem(LOG_KEY)||'[]');}catch{log=[];}
    log.unshift({ action, wallId:w.id, charId:String(charId), charName:getCharName(charId), thumb:w.thumbs?.large||w.thumbs?.small||'', ts:Date.now() });
    if(log.length>MAX)log.length=MAX;
    localStorage.setItem(LOG_KEY,JSON.stringify(log));
  } catch { /* non-critical */ }
}

function assignToChar(w, charId){
  const charIds=WH.assigned.get(w.id)||[];
  if(charIds.includes(charId)){
    const next=charIds.filter(id=>id!==charId);
    if(next.length===0){WH.assigned.delete(w.id);WH.assignedData.delete(w.id);}
    else{WH.assigned.set(w.id,next);}
    // Remove from wh_char_gallery (entries may be {url,thumb,wallId} objects or legacy strings)
    try {
      const whKey='wh_char_gallery';
      let store; try{store=JSON.parse(localStorage.getItem(whKey)||'{}');}catch{store={};}
      const cid=String(charId);
      if(Array.isArray(store[cid])){
        store[cid]=store[cid].filter(e=>typeof e==='string'?e!==w.path:e.url!==w.path);
        if(!store[cid].length)delete store[cid];
        localStorage.setItem(whKey,JSON.stringify(store));
      }
    } catch(e){console.warn('WH unassign gallery error',e);}
    vaultDelete(`assign/${w.id}/${charId}`);
    logAssignAction('unassign', w, charId);
    showToast('Unassigned from character.','info');
  } else {
    charIds.push(charId);
    WH.assigned.set(w.id,charIds);
    WH.assignedData.set(w.id,w);
    addToCharacterGalleryInApp(charId, w.path, w.thumbs.large, w.id);
    vaultPost('assign',{
      wallId:w.id, charId:String(charId), charName:getCharName(charId),
      thumbUrl:w.thumbs?.large||w.thumbs?.small||'', fullUrl:w.path||'',
    });
    logAssignAction('assign', w, charId);
    showToast(`Assigned to ${getCharName(charId)} — added to gallery & feed.`,'success');
  }
  saveMapArr('wh_assigned',WH.assigned);
  saveMap('wh_assigned_data',WH.assignedData);
  updateBadges(); syncLbButtons();
  const tileEl=grid.querySelector(`[data-idx="${WH.lbIndex}"][data-set="${WH.lbSet}"]`);
  if(tileEl){
    const isAssigned=WH.assigned.has(w.id)&&(WH.assigned.get(w.id)||[]).length>0;
    tileEl.querySelector('[data-action="assign"]')?.classList.toggle('wh-tile-btn--active-assign',isAssigned);
  }
}

function addToCharacterGalleryInApp(charId, url, thumb, wallId){
  try {
    // Write to wh_char_gallery — a wallhaven-owned key that never gets
    // overwritten by underdark's saveState(). The gallery page reads this
    // additively alongside underdark_chars_v4. No race conditions possible.
    // Schema: { [charId]: [{ url, thumb, wallId }, ...] }
    // url = full-res (may require auth), thumb = large thumbnail (always accessible)
    const whKey = 'wh_char_gallery';
    let store;
    try { store = JSON.parse(localStorage.getItem(whKey) || '{}'); } catch { store = {}; }
    const cid = String(charId);
    if (!Array.isArray(store[cid])) store[cid] = [];
    const alreadyStored = store[cid].some(e => (typeof e === 'string' ? e === url : e.url === url));
    if (!alreadyStored) {
      store[cid].push({ url, thumb: thumb || url, wallId: String(wallId) });
      localStorage.setItem(whKey, JSON.stringify(store));
    }
    addToCharacterFeedInApp(charId, thumb || url, thumb, wallId);
  } catch(e){ console.warn('WH assign gallery error',e); }
}

function addToCharacterFeedInApp(charId, url, thumb, wallId){
  // Writes to underdark_v4 → socialData.localPosts[charId]
  // (same path that underdark's saveLocalPost uses — feeds appear in the social tab)
  try {
    const raw=localStorage.getItem('underdark_v4'); if(!raw)return;
    const data=JSON.parse(raw); if(!data)return;
    if(!data.socialData)              data.socialData={};
    if(!data.socialData.localPosts)   data.socialData.localPosts={};
    if(!data.socialData.localPosts[String(charId)]) data.socialData.localPosts[String(charId)]=[];
    const posts=data.socialData.localPosts[String(charId)];
    if(posts.find(p=>p.id&&p.id.includes(wallId)))return;
    posts.push({
      id:`wh_${wallId}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      charId:String(charId),
      type:'image',
      src:url,
      caption:null,
      timestamp:Date.now(),
      permanent:false,
      source:'wallhaven',
    });
    localStorage.setItem('underdark_v4',JSON.stringify(data));
  } catch(e){ console.warn('WH feed post error',e); }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DOWNLOAD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function downloadWallpaper(w){
  const filename=`wallhaven-${w.id}.${w.file_type==='image/jpeg'?'jpg':'png'}`;
  const dlHeaders={}; if(WH.apiKey)dlHeaders['X-API-Key']=WH.apiKey;
  fetch(`https://wallhaven.trap.lol/api/v1/w/${w.id}`,{headers:dlHeaders})
    .then(r=>r.json())
    .then(json=>{
      const imgUrl=json.data?.path||w.path;
      const a=document.createElement('a');
      a.href=imgUrl; a.download=filename; a.target='_blank'; a.click();
      showToast('Download started.','success');
    })
    .catch(()=>{window.open(w.path,'_blank');showToast('Opened in new tab — save manually.','info');});
}
lbDownload.addEventListener('click',()=>{const w=lbDataset()[WH.lbIndex];if(w)downloadWallpaper(w);});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FULL-RES CACHE + SMART PRELOADER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const LB_CACHE_MAX=40;
const lbCache=new Map();
function lbCacheGet(id){ return lbCache.get(id)||null; }
function lbCacheSet(id,url){
  lbCache.delete(id); lbCache.set(id,url);
  if(lbCache.size>LB_CACHE_MAX) lbCache.delete(lbCache.keys().next().value);
}
let _lbLoadToken=0, _lbPreloadTimer=null;

function imgProxyUrl(raw){
  // Route all wallhaven images through our proxy to avoid hotlink blocks
  if(!raw)return raw;
  return `${PROXY_BASE}/img?url=${encodeURIComponent(raw)}`;
}

function loadFullRes(w, token, onLoad){
  if(!w||!w.path)return;
  if(lbCacheGet(w.id)){onLoad&&onLoad(w.id,lbCacheGet(w.id),token);return;}
  const proxyUrl=imgProxyUrl(w.path);
  const img=new Image();
  img.onload=()=>{ lbCacheSet(w.id,proxyUrl); onLoad&&onLoad(w.id,proxyUrl,token); };
  img.src=proxyUrl;
}
function scheduleNeighbourPreload(ds, centerIdx){
  clearTimeout(_lbPreloadTimer);
  _lbPreloadTimer=setTimeout(()=>{
    [1,-1,2,-2].forEach(offset=>{
      const w=ds[centerIdx+offset];
      if(w&&!lbCacheGet(w.id))loadFullRes(w,-1,null);
    });
  },180);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIGHTBOX
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function lbDataset(){
  if(WH.lbSet==='liked')return[...WH.likedData.values()];
  if(WH.lbSet==='saved')return[...WH.savedData.values()];
  if(WH.lbSet==='assigned'){
    let items=[...WH.assignedData.values()];
    if(WH.assignedCharFilter)items=items.filter(w=>(WH.assigned.get(w.id)||[]).includes(WH.assignedCharFilter));
    return items;
  }
  return WH.results;
}

function openLightbox(idx, set){
  WH.lbIndex=idx; WH.lbSet=set||'browse';
  populateCharSelects();
  lb.hidden=false;
  document.body.classList.add('lb-open');
  renderLightbox();
}

function renderLightbox(){
  resetLbView();
  const ds=lbDataset(), w=ds[WH.lbIndex]; if(!w)return;
  const token=++_lbLoadToken;
  clearTimeout(_lbPreloadTimer);
  lbImg.src=imgProxyUrl(w.thumbs.large)||'';
  lbImg.classList.remove('wh-lb-img--loading');
  const cached=lbCacheGet(w.id);
  if(cached){ lbImg.src=cached; }
  else if(w.path){
    loadFullRes(w,token,(id,url,tok)=>{ if(tok===_lbLoadToken)lbImg.src=url; });
  }
  scheduleNeighbourPreload(ds,WH.lbIndex);
  lbRes.textContent=w.resolution;
  lbPurityEl.textContent=purityLabel(w.purity); lbPurityEl.className=`wh-lb-badge wh-lb-badge--${w.purity}`;
  lbCat.textContent=w.category;
  lbViews.textContent=fmtNum(w.views); lbFaves.textContent=fmtNum(w.favorites);
  lbOpen.href=w.url;
  lbCounter.textContent=(WH.lbIndex+1)+' / '+ds.length;
  lbPrev.disabled=WH.lbIndex===0; lbNext.disabled=WH.lbIndex===ds.length-1;
  syncLbButtons();
}

function syncLbButtons(){
  if(lb.hidden)return;
  const ds=lbDataset(), w=ds[WH.lbIndex]; if(!w)return;
  lbLike.classList.toggle('wh-lb-corner-btn--active-heart',WH.liked.has(w.id));
  lbSave.classList.toggle('wh-lb-corner-btn--active-save', WH.saved.has(w.id));
  if(HAS_CHARS){
    const selectedChar=lbAssignSel.value;
    const assignedToSelected=selectedChar&&(WH.assigned.get(w.id)||[]).includes(selectedChar);
    lbAssignBtn.classList.toggle('wh-lb-action-btn--active-assign',assignedToSelected);
    lbAssignBtn.title=assignedToSelected?`Unassign from ${getCharName(selectedChar)}`:'Assign to selected character';
  }
}

function closeLightbox(){
  lb.hidden=true; document.body.classList.remove('lb-open'); resetLbView();
}

function lbToggleLike(){
  const w=lbDataset()[WH.lbIndex]; if(!w)return;
  const tile=grid.querySelector(`[data-idx="${WH.lbIndex}"][data-set="${WH.lbSet}"]`);
  if(tile){toggleLike(w,tile);}else{
    if(WH.liked.has(w.id)){WH.liked.delete(w.id);WH.likedData.delete(w.id);}else{WH.liked.add(w.id);WH.likedData.set(w.id,w);}
    saveSet('wh_liked',WH.liked);saveMap('wh_liked_data',WH.likedData);updateBadges();syncLbButtons();
  }
}
function lbToggleSave(){
  const w=lbDataset()[WH.lbIndex]; if(!w)return;
  const tile=grid.querySelector(`[data-idx="${WH.lbIndex}"][data-set="${WH.lbSet}"]`);
  if(tile){toggleSave(w,tile);}else{
    if(WH.saved.has(w.id)){WH.saved.delete(w.id);WH.savedData.delete(w.id);}else{WH.saved.add(w.id);WH.savedData.set(w.id,w);}
    saveSet('wh_saved',WH.saved);saveMap('wh_saved_data',WH.savedData);updateBadges();syncLbButtons();
  }
}

lbLike.addEventListener('click',lbToggleLike);
lbSave.addEventListener('click',lbToggleSave);
lbClose.addEventListener('click',closeLightbox);
lbBackdrop.addEventListener('click',closeLightbox);
lbPrev.addEventListener('click',()=>{if(WH.lbIndex>0){WH.lbIndex--;renderLightbox();}});
lbNext.addEventListener('click',()=>{const ds=lbDataset();if(WH.lbIndex<ds.length-1){WH.lbIndex++;renderLightbox();}});

// Touch swipe
(function(){
  let _sx=0,_sy=0;
  lb.addEventListener('touchstart',e=>{if(e.touches.length!==1||LBV.scale>1)return;_sx=e.touches[0].clientX;_sy=e.touches[0].clientY;},{passive:true});
  lb.addEventListener('touchend',e=>{
    if(e.changedTouches.length!==1||LBV.scale>1)return;
    const dx=e.changedTouches[0].clientX-_sx,dy=e.changedTouches[0].clientY-_sy;
    if(Math.abs(dy)>Math.abs(dx)||Math.abs(dx)<40)return;
    if(dx<0){const ds=lbDataset();if(WH.lbIndex<ds.length-1){WH.lbIndex++;renderLightbox();}}
    else if(dx>0&&WH.lbIndex>0){WH.lbIndex--;renderLightbox();}
  },{passive:true});
})();

document.addEventListener('keydown',e=>{
  if(!lb.hidden){
    if(e.key==='Escape'){if(LBV.scale!==1){resetLbView();return;}closeLightbox();return;}
    if((e.key==='+'||e.key==='=')&&!e.ctrlKey){e.preventDefault();zoomLbCentre(+LB_ZOOM_STEP);return;}
    if((e.key==='-'||e.key==='_')&&!e.ctrlKey){e.preventDefault();zoomLbCentre(-LB_ZOOM_STEP);return;}
    if(e.key==='0'&&!e.ctrlKey&&!e.metaKey){resetLbView();return;}
    if(e.key==='ArrowLeft'){
      if(LBV.scale>1){e.preventDefault();LBV.tx-=lbPanStep();clampLbPan();applyLbT(true);}
      else if(WH.lbIndex>0){WH.lbIndex--;renderLightbox();}
      return;
    }
    if(e.key==='ArrowRight'){
      if(LBV.scale>1){e.preventDefault();LBV.tx+=lbPanStep();clampLbPan();applyLbT(true);}
      else{const ds=lbDataset();if(WH.lbIndex<ds.length-1){WH.lbIndex++;renderLightbox();}}
      return;
    }
    if(e.key==='ArrowUp'&&LBV.scale>1){e.preventDefault();LBV.ty-=lbPanStep();clampLbPan();applyLbT(true);return;}
    if(e.key==='ArrowDown'&&LBV.scale>1){e.preventDefault();LBV.ty+=lbPanStep();clampLbPan();applyLbT(true);return;}
    if(e.key==='l'||e.key==='L'){lbToggleLike();return;}
    if(e.key==='s'||e.key==='S'){lbToggleSave();return;}
    if(e.key==='d'||e.key==='D'){const w=lbDataset()[WH.lbIndex];if(w)downloadWallpaper(w);return;}
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIGHTBOX ZOOM / PAN ENGINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const LBV={scale:1,tx:0,ty:0};
const LB_ZOOM_MIN=0.15,LB_ZOOM_MAX=8,LB_WHEEL_SENS=0.12,LB_ZOOM_STEP=0.25;
let _lbZPillTimer=null;

function lbPanStep(){ return Math.max(20,80/LBV.scale); }

function applyLbT(anim){
  if(!lbViewport)return;
  lbViewport.classList.toggle('wh-lb-dragging',!anim);
  lbViewport.style.transform=`translate(${LBV.tx}px,${LBV.ty}px) scale(${LBV.scale})`;
  const $s=document.getElementById('wh-lb-stage');
  if($s)$s.classList.toggle('wh-lb-stage--can-pan',LBV.scale>1);
  if(lbZoomPill){
    lbZoomPill.textContent=Math.round(LBV.scale*100)+'%';
    lbZoomPill.classList.add('wh-lb-zoom-pill--visible');
    clearTimeout(_lbZPillTimer);
    _lbZPillTimer=setTimeout(()=>lbZoomPill.classList.remove('wh-lb-zoom-pill--visible'),1400);
  }
}

function clampLbPan(){
  if(!lbImg||!lbViewport)return;
  const $s=document.getElementById('wh-lb-stage'); if(!$s)return;
  const iW=lbImg.offsetWidth,iH=lbImg.offsetHeight;
  const sW=$s.offsetWidth,sH=$s.offsetHeight;
  const bX=Math.max(0,(iW*LBV.scale-sW)/2);
  const bY=Math.max(0,(iH*LBV.scale-sH)/2);
  LBV.tx=Math.min(bX,Math.max(-bX,LBV.tx));
  LBV.ty=Math.min(bY,Math.max(-bY,LBV.ty));
}

function zoomLbAt(ns,fx,fy){
  ns=Math.min(LB_ZOOM_MAX,Math.max(LB_ZOOM_MIN,ns));
  const $s=document.getElementById('wh-lb-stage'); if(!$s)return;
  const r=$s.getBoundingClientRect();
  const ox=fx-r.left-r.width/2,oy=fy-r.top-r.height/2;
  const ratio=ns/LBV.scale;
  LBV.tx=ox-(ox-LBV.tx)*ratio; LBV.ty=oy-(oy-LBV.ty)*ratio; LBV.scale=ns;
  clampLbPan(); applyLbT(false);
}

function zoomLbCentre(d){
  const $s=document.getElementById('wh-lb-stage'); if(!$s)return;
  const r=$s.getBoundingClientRect();
  zoomLbAt(LBV.scale+d,r.left+r.width/2,r.top+r.height/2);
}

function resetLbView(){
  LBV.scale=1;LBV.tx=0;LBV.ty=0;
  if(lbViewport){lbViewport.style.transform='';lbViewport.classList.remove('wh-lb-dragging');}
  const $s=document.getElementById('wh-lb-stage');
  if($s){$s.classList.remove('wh-lb-stage--can-pan','wh-lb-stage--panning');}
  if(lbZoomPill)lbZoomPill.classList.remove('wh-lb-zoom-pill--visible');
  clearTimeout(_lbZPillTimer);
}

(function initLbZoomPan(){
  if(!lb||!lbViewport)return;
  const $s=document.getElementById('wh-lb-stage'); if(!$s)return;

  $s.addEventListener('wheel',e=>{
    if(lb.hidden)return;
    e.preventDefault();
    let d=e.deltaY;
    if(e.deltaMode===1)d*=32;
    if(e.deltaMode===2)d*=$s.offsetHeight;
    const dir=d>0?-1:1;
    const sens=LB_WHEEL_SENS*(e.ctrlKey?2:1);
    zoomLbAt(LBV.scale*(1+dir*sens),e.clientX,e.clientY);
  },{passive:false});

  let _md=false,_msx=0,_msy=0,_mtx=0,_mty=0;
  $s.addEventListener('mousedown',e=>{
    if(lb.hidden||e.button!==0||LBV.scale<=1)return;
    if(e.target.closest('.wh-lb-corner,.wh-lb-nav,.wh-lightbox__ui,.wh-lb-zoom-pill'))return;
    _md=true;_msx=e.clientX;_msy=e.clientY;_mtx=LBV.tx;_mty=LBV.ty;
    $s.classList.add('wh-lb-stage--panning'); e.preventDefault();
  });
  window.addEventListener('mousemove',e=>{
    if(!_md)return;
    LBV.tx=_mtx+(e.clientX-_msx); LBV.ty=_mty+(e.clientY-_msy);
    clampLbPan(); applyLbT(false);
  });
  window.addEventListener('mouseup',()=>{
    if(!_md)return; _md=false; $s.classList.remove('wh-lb-stage--panning');
  });

  $s.addEventListener('dblclick',e=>{
    if(e.target.closest('.wh-lb-corner,.wh-lb-nav,.wh-lightbox__ui'))return; resetLbView();
  });

  let _td=null,_tmx=null,_tmy=null,_tpx=null,_tpy=null,_totx=0,_toty=0,_pinch=false;
  const tdist=(a,b)=>Math.hypot(b.clientX-a.clientX,b.clientY-a.clientY);
  const tmid =(a,b)=>({x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2});

  lbViewport.addEventListener('touchstart',e=>{
    if(e.target.closest('.wh-lb-corner,.wh-lb-nav,.wh-lightbox__ui'))return;
    if(e.touches.length===2){
      _pinch=true;_td=tdist(e.touches[0],e.touches[1]);
      const m=tmid(e.touches[0],e.touches[1]);_tmx=m.x;_tmy=m.y;
    }else if(e.touches.length===1&&LBV.scale>1){
      _tpx=e.touches[0].clientX;_tpy=e.touches[0].clientY;_totx=LBV.tx;_toty=LBV.ty;
    }
  },{passive:true});

  lbViewport.addEventListener('touchmove',e=>{
    if(e.touches.length===2&&_pinch){
      e.preventDefault();
      const d=tdist(e.touches[0],e.touches[1]);
      const m=tmid(e.touches[0],e.touches[1]);
      if(_td)zoomLbAt(LBV.scale*(d/_td),m.x,m.y);
      if(_tmx!==null){LBV.tx+=m.x-_tmx;LBV.ty+=m.y-_tmy;clampLbPan();applyLbT(false);}
      _td=d;_tmx=m.x;_tmy=m.y;
    }else if(e.touches.length===1&&LBV.scale>1&&_tpx!==null){
      e.preventDefault();
      LBV.tx=_totx+(e.touches[0].clientX-_tpx);LBV.ty=_toty+(e.touches[0].clientY-_tpy);
      clampLbPan();applyLbT(false);
    }
  },{passive:false});

  lbViewport.addEventListener('touchend',e=>{
    if(e.touches.length<2){_td=null;_tmx=null;_tmy=null;_pinch=false;}
    if(e.touches.length===0){_tpx=null;_tpy=null;}
  },{passive:true});
})();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOAST
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function showToast(msg, type){
  const c=document.getElementById('wh-toast-container'); if(!c)return;
  const t=document.createElement('div');
  t.className=`wh-toast wh-toast--${type||'info'}`; t.textContent=msg;
  c.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('wh-toast--in'));
  setTimeout(()=>{t.classList.remove('wh-toast--in');setTimeout(()=>t.remove(),300);},3000);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BOOT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(function boot(){
  // Pre-fill search from URL param
  if(_bootQuery){
    searchInput.value=_bootQuery; searchClear.hidden=false;
    charLabel.textContent=_bootQuery;
  }
  // Pre-select character in assign select
  if(_bootCharId) WH.charId=_bootCharId;

  updateBadges();
  window.lucide?.createIcons();

  // Hydrate from vault if a vault ID is set (fire-and-forget, doesn't block search)
  if(WH.vaultId) syncFromVault();

  if(_bootQuery){
    fetchWallpapers(false);
  } else {
    // Auto-fetch toplist so the page never opens empty
    WH.query=''; WH.page=1; WH.seed=null;
    fetchWallpapers(false);
  }
})();
