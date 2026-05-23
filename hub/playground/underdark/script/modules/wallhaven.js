/**
 * wallhaven.js — Wallhaven Gallery Arena
 * Self-contained module; initialises on DOMContentLoaded.
 */
(function () {
'use strict';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Load persisted filter prefs, fall back to defaults
(function(){
  try {
    const fp=JSON.parse(localStorage.getItem('wh_filters')||'{}');
    window.__whFilters__=fp;
  } catch { window.__whFilters__={}; }
})();
const _fp=window.__whFilters__||{};

const WH = {
  apiKey:       localStorage.getItem('wh_apikey') || '',
  query:        '',
  cats:         _fp.cats  || { general:true, anime:true, people:true },
  purity:       _fp.purity|| { sfw:true, sketchy:false, nsfw:false },
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
  // assigned: { [wallId]: [charId, charId, …] }
  assigned:     loadMapArr('wh_assigned'),
  // assignedData: { [wallId]: wallpaper object }
  assignedData: loadMap('wh_assigned_data'),
  lbIndex:      0,
  lbSet:        'browse',
  loading:      false,
  charName:     '',
  charId:       null,   // id of char that opened the gallery (for default assign)
  seed:         null,
  view:         'browse',
  assignedCharFilter: '',  // charId or ''
};
function saveFilters(){
  localStorage.setItem('wh_filters',JSON.stringify({
    cats:WH.cats, purity:WH.purity, sort:WH.sort, topRange:WH.topRange, layout:WH.layout
  }));
}

function loadSet(k){ try{return new Set(JSON.parse(localStorage.getItem(k)||'[]'));}catch{return new Set();} }
function saveSet(k,s){ localStorage.setItem(k,JSON.stringify([...s])); }
function loadMap(k){ try{return new Map(Object.entries(JSON.parse(localStorage.getItem(k)||'{}')));}catch{return new Map();} }
function saveMap(k,m){ const o={}; m.forEach((v,kk)=>{o[kk]=v;}); localStorage.setItem(k,JSON.stringify(o)); }
function loadMapArr(k){ try{ const raw=JSON.parse(localStorage.getItem(k)||'{}'); return new Map(Object.entries(raw)); }catch{return new Map();} }
function saveMapArr(k,m){ const o={}; m.forEach((v,kk)=>{o[kk]=v;}); localStorage.setItem(k,JSON.stringify(o)); }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DOM REFS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const arena          = document.getElementById('wh-arena');
const backBtn        = document.getElementById('wh-back-btn');
const charLabel      = document.getElementById('wh-char-label');
const whSidebar      = document.getElementById('wh-sidebar');
const whSidebarToggle= document.getElementById('wh-sidebar-toggle');
const whSidebarBack  = document.getElementById('wh-sidebar-backdrop');
const whMobileTabs   = document.getElementById('wh-mobile-tabs');
const searchInput    = document.getElementById('wh-search-input');
const searchClear    = document.getElementById('wh-search-clear');
const searchBtn      = document.getElementById('wh-search-btn');
const apikeyInput    = document.getElementById('wh-apikey-input');
const apikeyToggle   = document.getElementById('wh-apikey-toggle');
const apikeySave     = document.getElementById('wh-apikey-save');
const keyStatus      = document.getElementById('wh-key-status');
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
const charFilterWrap    = document.getElementById('wh-char-filter-wrap');
const charFilterSel     = document.getElementById('wh-char-filter');
const unassignAllBtn    = document.getElementById('wh-unassign-all-btn');

// Lightbox
const lb             = document.getElementById('wh-lightbox');
const lbBackdrop     = document.getElementById('wh-lb-backdrop');
const lbImg          = document.getElementById('wh-lb-img');
const lbRes          = document.getElementById('wh-lb-res');
const lbPurityEl     = document.getElementById('wh-lb-purity');
const lbCat          = document.getElementById('wh-lb-cat');
const lbViews        = document.getElementById('wh-lb-views').querySelector('span');
const lbFaves        = document.getElementById('wh-lb-faves').querySelector('span');
const lbSetBg        = document.getElementById('wh-lb-set-bg');
const lbOpen         = document.getElementById('wh-lb-open');
const lbPrev         = document.getElementById('wh-lb-prev');
const lbNext         = document.getElementById('wh-lb-next');
const lbLike         = document.getElementById('wh-lb-like');
const lbSave         = document.getElementById('wh-lb-save');
const lbDownload     = document.getElementById('wh-lb-download');
const lbClose        = document.getElementById('wh-lb-close');
const lbCounter      = document.getElementById('wh-lb-counter');
const lbAssignSel    = document.getElementById('wh-lb-assign-select');
const lbAssignBtn    = document.getElementById('wh-lb-assign-btn');
const lbViewport     = document.getElementById('wh-lb-viewport');
const lbZoomPill     = document.getElementById('wh-lb-zoom-pill');

// Header button (new, in arena header)
const whOpenBtn      = document.getElementById('wh-open-btn');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

// Intersection Observer — swap data-src → src when tile enters the viewport
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
  
  const lmBtn = document.getElementById('wh-load-more-btn');
  if(lmBtn) {
    lmBtn.disabled = on;
    lmBtn.innerHTML = on ? '<i data-lucide="loader" class="wh-spin-icon"></i> Loading...' : '<i data-lucide="plus"></i> Load More';
    if(on && window.lucide) window.lucide.createIcons({nodes:[lmBtn]});
  }
}
function hideAllStates(){ emptyBrowse.hidden=true;likedEmpty.hidden=true;savedEmpty.hidden=true;assignedEmpty.hidden=true;errorBox.hidden=true;spinner.hidden=true; }
function showError(msg){ errorBox.hidden=false;errorMsg.textContent=msg;spinner.hidden=true; }

function updateBadges(){
  const ls=WH.liked.size, ss=WH.saved.size, as=WH.assignedData.size;
  likedCount.textContent    = ls;
  savedCount.textContent    = ss;
  assignedCount.textContent = as;
  likedCount.classList.toggle('wh-liked-badge--active',    ls>0);
  savedCount.classList.toggle('wh-saved-badge--active',    ss>0);
  assignedCount.classList.toggle('wh-saved-badge--active', as>0);
  // Mirror badges in mobile tabs
  const mlc=document.getElementById('wh-liked-count-m'), msc=document.getElementById('wh-saved-count-m');
  if(mlc) mlc.textContent=ls;
  if(msc) msc.textContent=ss;
}

// Returns all characters from main app (reads underdark_chars_v4 — the actual storage key)
function getAllChars(){
  try {
    const raw = localStorage.getItem('underdark_chars_v4');
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data.characters) ? data.characters : [];
  } catch { return []; }
}

function getCharName(id){
  const chars = getAllChars();
  const c = chars.find(c=>String(c.id)===String(id));
  return c ? (c.name||'Unknown') : 'Unknown';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POPULATE CHARACTER SELECTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function populateCharSelects(){
  const chars = getAllChars();

  // Lightbox assign select
  lbAssignSel.innerHTML = '<option value="">Assign to character…</option>';
  chars.forEach(c=>{
    const opt=document.createElement('option');
    opt.value=String(c.id);
    opt.textContent=c.name||'Unnamed';
    lbAssignSel.appendChild(opt);
  });
  // Pre-select current char if set
  if(WH.charId) lbAssignSel.value=String(WH.charId);

  // Sidebar char filter (assigned view)
  charFilterSel.innerHTML='<option value="">All Characters</option>';
  chars.forEach(c=>{
    const opt=document.createElement('option');
    opt.value=String(c.id);
    opt.textContent=c.name||'Unnamed';
    charFilterSel.appendChild(opt);
  });
  if(WH.assignedCharFilter) charFilterSel.value=WH.assignedCharFilter;
}

charFilterSel.addEventListener('change',()=>{
  WH.assignedCharFilter=charFilterSel.value;
  if(WH.view==='assigned') renderCurrentView();
});

unassignAllBtn.addEventListener('click',()=>{
  // Collect wall IDs to unassign — filtered by current char filter if set
  let wallIds;
  if(WH.assignedCharFilter){
    wallIds=[...WH.assignedData.keys()].filter(wid=>(WH.assigned.get(wid)||[]).includes(WH.assignedCharFilter));
  } else {
    wallIds=[...WH.assignedData.keys()];
  }
  if(!wallIds.length){showToast('Nothing to unassign.','info');return;}
  const label=WH.assignedCharFilter?`from ${getCharName(WH.assignedCharFilter)}`:'from all characters';
  if(!confirm(`Unassign ${wallIds.length} image${wallIds.length===1?'':'s'} ${label}?\n\nThis removes them from the Assigned view but does NOT delete them from character galleries.`))return;
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
apikeyInput.value = WH.apiKey;
if(WH.apiKey){ keyStatus.textContent='Connected'; keyStatus.className='wh-key-status wh-key-status--ok'; }

apikeyToggle.addEventListener('click',()=>{
  const show=apikeyInput.type==='password';
  apikeyInput.type=show?'text':'password';
  apikeyToggle.innerHTML=show?'<i data-lucide="eye-off"></i>':'<i data-lucide="eye"></i>';
  window.lucide?.createIcons({nodes:[apikeyToggle]});
});
apikeySave.addEventListener('click',()=>{
  WH.apiKey=apikeyInput.value.trim();
  localStorage.setItem('wh_apikey',WH.apiKey);
  keyStatus.textContent=WH.apiKey?'Connected':'Cleared';
  keyStatus.className='wh-key-status'+(WH.apiKey?' wh-key-status--ok':'');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILTER CHIPS — wire + restore persisted state
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Restore chip active states from persisted WH values
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
    btn.classList.toggle('active',WH.cats[btn.dataset.cat]);
    saveFilters();
  });
});
document.querySelectorAll('#wh-purities .wh-chip').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const p=btn.dataset.purity;
    if(p!=='sfw'&&!WH.apiKey){showToast('API key required for '+purityLabel(p)+' content.','warn');return;}
    WH.purity[p]=!WH.purity[p];
    btn.classList.toggle('active',WH.purity[p]);
    saveFilters();
  });
});
document.querySelectorAll('#wh-sorts .wh-chip').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('#wh-sorts .wh-chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); WH.sort=btn.dataset.sort;
    topRangeGrp.style.display=WH.sort==='toplist'?'':'none';
    saveFilters();
  });
});
document.querySelectorAll('#wh-ranges .wh-chip').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('#wh-ranges .wh-chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); WH.topRange=btn.dataset.range;
    saveFilters();
  });
});
document.querySelectorAll('#wh-layouts .wh-chip').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('#wh-layouts .wh-chip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); WH.layout=btn.dataset.layout;
    grid.className=`wh-grid wh-grid--${WH.layout}`;
    saveFilters();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// VIEW TABS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function switchWhView(view){
  WH.view=view;
  // Sync both desktop sidebar tabs and mobile bottom nav
  document.querySelectorAll('.wh-view-tab').forEach(b=>b.classList.toggle('active',b.dataset.wview===view));
  document.querySelectorAll('.wh-mobile-tab').forEach(b=>b.classList.toggle('active',b.dataset.wview===view));
  const isBrowse=view==='browse';
  const isAssigned=view==='assigned';
  filtersPanel.style.display=isBrowse?'':'none';
  charFilterWrap.hidden=!isAssigned;
  pageControls.hidden=!isBrowse;
  if(isAssigned) populateCharSelects();
  renderCurrentView();
}

document.querySelectorAll('.wh-view-tab').forEach(btn=>{
  btn.addEventListener('click',()=>switchWhView(btn.dataset.wview));
});

// Mobile bottom nav tabs
document.querySelectorAll('.wh-mobile-tab').forEach(btn=>{
  btn.addEventListener('click',()=>switchWhView(btn.dataset.wview));
});

// Mobile sidebar toggle
function openWhSidebar(){
  whSidebar.classList.add('wh-sidebar--open');
  whSidebarBack.hidden=false;
  whSidebarToggle.setAttribute('aria-expanded','true');
  document.addEventListener('keydown',closeWhSidebarOnEsc);
}
function closeWhSidebar(){
  whSidebar.classList.remove('wh-sidebar--open');
  whSidebarBack.hidden=true;
  whSidebarToggle.setAttribute('aria-expanded','false');
  document.removeEventListener('keydown',closeWhSidebarOnEsc);
}
function closeWhSidebarOnEsc(e){ if(e.key==='Escape') closeWhSidebar(); }

whSidebarToggle.addEventListener('click',()=>{
  whSidebar.classList.contains('wh-sidebar--open')?closeWhSidebar():openWhSidebar();
});
whSidebarBack.addEventListener('click',closeWhSidebar);

function renderCurrentView(){
  hideAllStates(); grid.innerHTML='';
  if(WH.view==='liked'){
    const items=[...WH.likedData.values()];
    if(!items.length){likedEmpty.hidden=false;return;}
    items.forEach((w,i)=>buildTile(w,i,'liked'));
    window.lucide?.createIcons({nodes:[grid]});
    statusText.textContent='Liked'; resultCount.textContent=items.length+' images';
  } else if(WH.view==='saved'){
    const items=[...WH.savedData.values()];
    if(!items.length){savedEmpty.hidden=false;return;}
    items.forEach((w,i)=>buildTile(w,i,'saved'));
    window.lucide?.createIcons({nodes:[grid]});
    statusText.textContent='Saved'; resultCount.textContent=items.length+' images';
  } else if(WH.view==='assigned'){
    let items=[...WH.assignedData.values()];
    if(WH.assignedCharFilter){
      items=items.filter(w=>{
        const charIds=WH.assigned.get(w.id)||[];
        return charIds.includes(WH.assignedCharFilter);
      });
    }
    if(!items.length){assignedEmpty.hidden=false;return;}
    items.forEach((w,i)=>buildTile(w,i,'assigned'));
    window.lucide?.createIcons({nodes:[grid]});
    const label=WH.assignedCharFilter?`Assigned — ${getCharName(WH.assignedCharFilter)}`:'Assigned';
    statusText.textContent=label; resultCount.textContent=items.length+' images';
  } else {
    if(!WH.results.length){emptyBrowse.hidden=false;return;}
    WH.results.forEach((w,i)=>buildTile(w,i,'browse'));
    window.lucide?.createIcons({nodes:[grid]});
    statusText.textContent=WH.query?`"${WH.query}"`:'';;
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
  WH.view='browse'; filtersPanel.style.display=''; charFilterWrap.hidden=true;
  fetchWallpapers(false);
}

function appendLoadMoreBtn() {
  if (WH.view !== 'browse' || WH.page >= WH.totalPages) return;
  let wrap = document.getElementById('wh-load-more-wrap');
  if (wrap) wrap.remove();
  wrap = document.createElement('div');
  wrap.id = 'wh-load-more-wrap';
  wrap.className = 'wh-load-more-wrap';
  wrap.innerHTML = `<button id="wh-load-more-btn" class="wh-btn wh-btn--ghost wh-btn--lg"><i data-lucide="plus"></i> Load More</button>`;
  wrap.querySelector('button').addEventListener('click', () => {
    WH.page++;
    fetchWallpapers(true);
  });
  grid.appendChild(wrap);
}

async function fetchWallpapers(append){
  if(WH.loading)return;
  setLoading(true, append); grid.hidden=false; 
  if(!append) grid.innerHTML='';
  pageControls.hidden=true; 
  const lmWrap = document.getElementById('wh-load-more-wrap');
  if(lmWrap) lmWrap.hidden = true;
  if(!append) { statusText.textContent='Scanning…'; resultCount.textContent=''; }

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
    
    if(append) {
      const startIdx = WH.results.length;
      WH.results=WH.results.concat(json.data);
      if(lmWrap) lmWrap.remove();
      json.data.forEach((w,i)=>buildTile(w,startIdx+i,'browse'));
    } else {
      WH.results=json.data;
      grid.innerHTML='';
      WH.results.forEach((w,i)=>buildTile(w,i,'browse'));
    }
    
    appendLoadMoreBtn();
    window.lucide?.createIcons({nodes:[grid]});
    
    pageNum.textContent=WH.page; pageTotal.textContent=WH.totalPages;
    statusText.textContent=q?`"${q}"`:'Top results';
    resultCount.textContent=WH.total.toLocaleString()+' results';
    pageControls.hidden=!WH.results.length;
    
    if(!WH.results.length)emptyBrowse.hidden=false;
    setLoading(false, append);
  }catch(err){
    setLoading(false, append);
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
    const c=chars.find(c=>String(c.id)===String(id));
    if(!c)return'';
    const name=c.name||'?';
    const safeName=name.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    return `<span class="wh-tile__char-badge" title="Assigned to ${safeName}">${esc(name.slice(0,1))}</span>`;
  }).join('');
}

function buildTile(w,idx,set){
  const isLiked=WH.liked.has(w.id);
  const isSaved=WH.saved.has(w.id);
  const isAssigned=WH.assigned.has(w.id)&&(WH.assigned.get(w.id)||[]).length>0;

  const tile=document.createElement('div');
  tile.className=`wh-tile wh-tile--${w.purity} wh-tile--skeleton`;
  tile.dataset.idx=idx; tile.dataset.set=set;

  tile.innerHTML=`
    <div class="wh-tile__img-wrap">
      <img class="wh-tile__img wh-tile__img--pending" data-src="${esc(w.thumbs.large)}" data-fallback="${esc(w.thumbs.small||w.thumbs.large)}" draggable="false" alt="">
      ${isAssigned?`<div class="wh-tile__char-badges">${charBadgesHtml(w.id)}</div>`:''}
      <div class="wh-tile__overlay">
        <div class="wh-tile__overlay-top">
          <span class="wh-tile__purity wh-tile__purity--${w.purity}">${purityLabel(w.purity)}</span>
          <span class="wh-tile__res">${w.resolution}</span>
        </div>
        <div class="wh-tile__overlay-bottom">
          <div class="wh-tile__stats2">
            <span><i data-lucide="eye"></i>${fmtNum(w.views)}</span>
            <span><i data-lucide="heart"></i>${fmtNum(w.favorites)}</span>
          </div>
          <div class="wh-tile__actions">
            <button class="wh-tile-btn${isLiked?' wh-tile-btn--active-heart':''}" data-action="like" title="Like (L)"><i data-lucide="heart"></i></button>
            <button class="wh-tile-btn${isSaved?' wh-tile-btn--active-save':''}" data-action="save" title="Save (S)"><i data-lucide="bookmark"></i></button>
            <button class="wh-tile-btn${isAssigned?' wh-tile-btn--active-assign':''}" data-action="assign" title="Assign to character"><i data-lucide="user-check"></i></button>
            <button class="wh-tile-btn" data-action="dl" title="Download"><i data-lucide="download"></i></button>
            <button class="wh-tile-btn wh-tile-btn--bg" data-action="bg" title="Set as background"><i data-lucide="image"></i></button>
          </div>
        </div>
      </div>
    </div>`;

  tile.querySelector('.wh-tile__img-wrap').addEventListener('click',e=>{
    if(e.target.closest('[data-action]'))return;
    openLightbox(idx,set);
  });
  tile.querySelector('[data-action="like"]').addEventListener('click',e=>{e.stopPropagation();toggleLike(w,tile);});
  tile.querySelector('[data-action="save"]').addEventListener('click',e=>{e.stopPropagation();toggleSave(w,tile);});
  tile.querySelector('[data-action="assign"]').addEventListener('click',e=>{e.stopPropagation();openLightbox(idx,set);requestAnimationFrame(()=>{lbAssignSel.focus();});});
  tile.querySelector('[data-action="dl"]').addEventListener('click',e=>{e.stopPropagation();downloadWallpaper(w);});
  tile.querySelector('[data-action="bg"]').addEventListener('click',e=>{e.stopPropagation();setAsBackground(w.path);});

  grid.appendChild(tile);
  tileObserver.observe(tile);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIKE / SAVE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function toggleLike(w,tile){
  const btn=tile.querySelector('[data-action="like"]');
  if(WH.liked.has(w.id)){WH.liked.delete(w.id);WH.likedData.delete(w.id);btn.classList.remove('wh-tile-btn--active-heart');showToast('Unliked.','info');}
  else{WH.liked.add(w.id);WH.likedData.set(w.id,w);btn.classList.add('wh-tile-btn--active-heart');showToast('Liked!','success');}
  saveSet('wh_liked',WH.liked);saveMap('wh_liked_data',WH.likedData);
  updateBadges();syncLbButtons();
}
function toggleSave(w,tile){
  const btn=tile.querySelector('[data-action="save"]');
  if(WH.saved.has(w.id)){WH.saved.delete(w.id);WH.savedData.delete(w.id);btn.classList.remove('wh-tile-btn--active-save');showToast('Removed.','info');}
  else{WH.saved.add(w.id);WH.savedData.set(w.id,w);btn.classList.add('wh-tile-btn--active-save');showToast('Saved!','success');}
  saveSet('wh_saved',WH.saved);saveMap('wh_saved_data',WH.savedData);
  updateBadges();syncLbButtons();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ASSIGN TO CHARACTER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
lbAssignBtn.addEventListener('click',()=>{
  const charId=lbAssignSel.value; if(!charId)return;
  const w=lbDataset()[WH.lbIndex]; if(!w)return;
  assignToChar(w,charId);
});

function assignToChar(w, charId){
  const charIds=WH.assigned.get(w.id)||[];
  if(charIds.includes(charId)){
    // unassign
    const next=charIds.filter(id=>id!==charId);
    if(next.length===0){ WH.assigned.delete(w.id); WH.assignedData.delete(w.id); }
    else{ WH.assigned.set(w.id,next); }
    showToast('Unassigned from character.','info');
  } else {
    charIds.push(charId);
    WH.assigned.set(w.id,charIds);
    WH.assignedData.set(w.id,w);
    // Push into the character's actual gallery in the main app
    addToCharacterGalleryInApp(charId, w.path, w.thumbs.large, w.id);
    const cName=getCharName(charId);
    showToast(`Assigned to ${cName} — added to their gallery & feed.`,'success');
  }
  saveMapArr('wh_assigned',WH.assigned);
  saveMap('wh_assigned_data',WH.assignedData);
  updateBadges(); syncLbButtons();
  // Refresh tile assign button state
  const tileEl=grid.querySelector(`[data-idx="${WH.lbIndex}"][data-set="${WH.lbSet}"]`);
  if(tileEl){
    const isAssigned=WH.assigned.has(w.id)&&(WH.assigned.get(w.id)||[]).length>0;
    tileEl.querySelector('[data-action="assign"]').classList.toggle('wh-tile-btn--active-assign',isAssigned);
  }
}

// Push image into the main app's character gallery
// Gallery entries are URL strings stored at loadedCharacters[id].extensions.underdark.gallery
function addToCharacterGalleryInApp(charId, url, thumb, wallId){
  try {
    const raw=localStorage.getItem('underdark_chars_v4'); if(!raw)return;
    const data=JSON.parse(raw); if(!data||!data.loadedCharacters)return;
    const char=data.loadedCharacters[String(charId)]; if(!char)return;
    if(!char.extensions)               char.extensions={};
    if(!char.extensions.underdark)     char.extensions.underdark={};
    if(!char.extensions.underdark.gallery) char.extensions.underdark.gallery=[];
    // Avoid duplicates — gallery stores plain URL strings
    if(!char.extensions.underdark.gallery.includes(url)){
      char.extensions.underdark.gallery.push(url);
      data.loadedCharacters[String(charId)]=char;
      localStorage.setItem('underdark_chars_v4',JSON.stringify(data));
    }
    // Also push a social post to the character's feed
    addToCharacterFeedInApp(charId, url, thumb, wallId);
  } catch(e){ console.warn('WH assign gallery error',e); }
}

function addToCharacterFeedInApp(charId, url, thumb, wallId){
  try {
    const key=`feed_${charId}`;
    const raw=localStorage.getItem(key);
    const feed=raw?JSON.parse(raw):[];
    if(!Array.isArray(feed))return;
    // Avoid duplicate posts for same wallpaper
    if(feed.find(p=>p.whId===wallId))return;
    feed.unshift({
      id:`wh_${wallId}_${Date.now()}`,
      whId:wallId,
      type:'image',
      imageUrl:url,
      thumb:thumb||url,
      caption:'',
      likes:0,
      ts:Date.now(),
      source:'wallhaven',
    });
    localStorage.setItem(key,JSON.stringify(feed));
    // Notify the main app so the feed re-renders if it's visible
    document.dispatchEvent(new CustomEvent('wh:feed-updated',{detail:{charId,url,thumb}}));
  } catch(e){ console.warn('WH feed post error',e); }
}

// Legacy event kept for compatibility — maps to the assign flow using the current char
document.addEventListener('wh:add-to-gallery',e=>{
  const {url,thumb}=e.detail;
  if(WH.charId) addToCharacterGalleryInApp(WH.charId,url,thumb,'');
});

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
      a.href=imgUrl; a.download=filename; a.target='_blank';
      a.click();
      showToast('Download started.','success');
    })
    .catch(()=>{
      window.open(w.path,'_blank');
      showToast('Opened in new tab — save manually.','info');
    });
}

lbDownload.addEventListener('click',()=>{
  const w=lbDataset()[WH.lbIndex]; if(w)downloadWallpaper(w);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INTEGRATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function setAsBackground(url){
  const i=document.getElementById('bg-url-input'),a=document.getElementById('bg-url-apply');
  if(i&&a){i.value=url;a.click();showToast('Arena background updated.','success');}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FULL-RES IMAGE CACHE + SMART PRELOADER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LRU cache keyed by wallpaper id → resolved full-res URL
const LB_CACHE_MAX = 40;
const lbCache = new Map(); // id → url (insertion order = LRU)

function lbCacheGet(id){ return lbCache.get(id) || null; }
function lbCacheSet(id, url){
  lbCache.delete(id); // bump to end (most-recent)
  lbCache.set(id, url);
  if(lbCache.size > LB_CACHE_MAX){
    lbCache.delete(lbCache.keys().next().value); // evict oldest
  }
}

// Token prevents stale loads from writing to the active lightbox image
let _lbLoadToken = 0;
// Timeout handle for deferred neighbour preloading
let _lbPreloadTimer = null;

// Load full-res for a wallpaper, writing into cache.
// Returns a Promise<url|null>. Cancellable via token comparison.
function loadFullRes(w, token, onLoad){
  if(!w || !w.path) return;
  if(lbCacheGet(w.id)){ onLoad && onLoad(w.id, lbCacheGet(w.id), token); return; }
  const img = new Image();
  img.onload = () => {
    lbCacheSet(w.id, w.path);
    onLoad && onLoad(w.id, w.path, token);
  };
  // on error: cache nothing, thumbnail stays visible
  img.src = w.path;
}

// Silently preload neighbours into cache (no DOM writes)
function scheduleNeighbourPreload(ds, centerIdx){
  clearTimeout(_lbPreloadTimer);
  _lbPreloadTimer = setTimeout(() => {
    // Preload pattern: +1, -1, +2, -2 (by priority)
    [1, -1, 2, -2].forEach(offset => {
      const w = ds[centerIdx + offset];
      if(w && !lbCacheGet(w.id)) loadFullRes(w, -1, null);
    });
  }, 180); // wait until user pauses navigating
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIGHTBOX
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function lbDataset(){
  if(WH.lbSet==='liked')return[...WH.likedData.values()];
  if(WH.lbSet==='saved')return[...WH.savedData.values()];
  if(WH.lbSet==='assigned'){
    let items=[...WH.assignedData.values()];
    if(WH.assignedCharFilter) items=items.filter(w=>(WH.assigned.get(w.id)||[]).includes(WH.assignedCharFilter));
    return items;
  }
  return WH.results;
}
function openLightbox(idx,set){
  WH.lbIndex=idx; WH.lbSet=set||'browse';
  populateCharSelects();
  lb.hidden=false; renderLightbox();
}
function renderLightbox(){
  resetLbView();
  const ds=lbDataset(), w=ds[WH.lbIndex]; if(!w)return;

  // Invalidate any previous in-flight full-res load
  const token = ++_lbLoadToken;
  clearTimeout(_lbPreloadTimer);

  // Show thumbnail immediately (fills viewport via CSS width/height)
  lbImg.src = w.thumbs.large || '';
  lbImg.classList.remove('wh-lb-img--loading');

  const cached = lbCacheGet(w.id);
  if(cached){
    // Instant swap — already in cache
    lbImg.src = cached;
  } else if(w.path){
    loadFullRes(w, token, (id, url, tok) => {
      // Only write to DOM if this is still the active load
      if(tok === _lbLoadToken) lbImg.src = url;
    });
  }

  // Kick off neighbour preloading after user settles
  scheduleNeighbourPreload(ds, WH.lbIndex);

  lbRes.textContent=w.resolution;
  lbPurityEl.textContent=purityLabel(w.purity); lbPurityEl.className=`wh-lb-badge wh-lb-badge--${w.purity}`;
  lbCat.textContent=w.category;
  lbViews.textContent=fmtNum(w.views); lbFaves.textContent=fmtNum(w.favorites);
  lbOpen.href=w.url;
  lbCounter.textContent=(WH.lbIndex+1)+' / '+ds.length;
  lbPrev.disabled=WH.lbIndex===0; lbNext.disabled=WH.lbIndex===ds.length-1;
  lbSetBg.onclick=()=>setAsBackground(w.path);
  syncLbButtons();
}
function syncLbButtons(){
  if(lb.hidden)return;
  const ds=lbDataset(), w=ds[WH.lbIndex]; if(!w)return;
  lbLike.classList.toggle('wh-lb-corner-btn--active-heart',WH.liked.has(w.id));
  lbSave.classList.toggle('wh-lb-corner-btn--active-save', WH.saved.has(w.id));
  const isAssigned=WH.assigned.has(w.id)&&(WH.assigned.get(w.id)||[]).length>0;
  lbAssignBtn.classList.toggle('wh-lb-action-btn--active-assign',isAssigned);
  lbAssignBtn.title=isAssigned?'Click to unassign':'Assign to selected character';
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
lbClose.addEventListener('click',()=>{lb.hidden=true;resetLbView();});
lbBackdrop.addEventListener('click',()=>{lb.hidden=true;resetLbView();});
lbPrev.addEventListener('click',()=>{if(WH.lbIndex>0){WH.lbIndex--;renderLightbox();}});
lbNext.addEventListener('click',()=>{const ds=lbDataset();if(WH.lbIndex<ds.length-1){WH.lbIndex++;renderLightbox();}});

// Touch swipe for lightbox — disabled when zoomed (pinch/pan takes over)
(function(){
  let _sx=0,_sy=0;
  lb.addEventListener('touchstart',e=>{
    if(e.touches.length!==1||LBV.scale>1)return;
    _sx=e.touches[0].clientX;_sy=e.touches[0].clientY;
  },{passive:true});
  lb.addEventListener('touchend',e=>{
    if(e.changedTouches.length!==1||LBV.scale>1)return;
    const dx=e.changedTouches[0].clientX-_sx;
    const dy=e.changedTouches[0].clientY-_sy;
    if(Math.abs(dy)>Math.abs(dx)||Math.abs(dx)<40)return;
    if(dx<0){const ds=lbDataset();if(WH.lbIndex<ds.length-1){WH.lbIndex++;renderLightbox();}}
    else if(dx>0&&WH.lbIndex>0){WH.lbIndex--;renderLightbox();}
  },{passive:true});
})();

document.addEventListener('keydown',e=>{
  if(!lb.hidden){
    // Escape — first reset zoom if zoomed, then close
    if(e.key==='Escape'){
      if(LBV.scale!==1){resetLbView();return;}
      lb.hidden=true;return;
    }
    // Zoom controls
    if((e.key==='+'||e.key==='=')&&!e.ctrlKey){e.preventDefault();zoomLbCentre(+LB_ZOOM_STEP);return;}
    if((e.key==='-'||e.key==='_')&&!e.ctrlKey){e.preventDefault();zoomLbCentre(-LB_ZOOM_STEP);return;}
    if(e.key==='0'&&!e.ctrlKey&&!e.metaKey){resetLbView();return;}
    // Arrow keys: pan image when zoomed, navigate slides when at 1:1
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
    // Action shortcuts
    if(e.key==='l'||e.key==='L'){lbToggleLike();return;}
    if(e.key==='s'||e.key==='S'){lbToggleSave();return;}
    if(e.key==='d'||e.key==='D'){const w=lbDataset()[WH.lbIndex];if(w)downloadWallpaper(w);return;}
    return;
  }
  if(!arena.hidden&&e.key==='Escape')closeArena();
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
  const $s=lb.querySelector('.wh-lightbox__stage');
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
  const $s=lb.querySelector('.wh-lightbox__stage'); if(!$s)return;
  const iW=lbImg.offsetWidth,iH=lbImg.offsetHeight;
  const sW=$s.offsetWidth,sH=$s.offsetHeight;
  const bX=Math.max(0,(iW*LBV.scale-sW)/2);
  const bY=Math.max(0,(iH*LBV.scale-sH)/2);
  LBV.tx=Math.min(bX,Math.max(-bX,LBV.tx));
  LBV.ty=Math.min(bY,Math.max(-bY,LBV.ty));
}

function zoomLbAt(ns,fx,fy){
  ns=Math.min(LB_ZOOM_MAX,Math.max(LB_ZOOM_MIN,ns));
  const $s=lb.querySelector('.wh-lightbox__stage'); if(!$s)return;
  const r=$s.getBoundingClientRect();
  const ox=fx-r.left-r.width/2, oy=fy-r.top-r.height/2;
  const ratio=ns/LBV.scale;
  LBV.tx=ox-(ox-LBV.tx)*ratio;
  LBV.ty=oy-(oy-LBV.ty)*ratio;
  LBV.scale=ns;
  clampLbPan();
  applyLbT(false);
}

function zoomLbCentre(d){
  const $s=lb.querySelector('.wh-lightbox__stage'); if(!$s)return;
  const r=$s.getBoundingClientRect();
  zoomLbAt(LBV.scale+d,r.left+r.width/2,r.top+r.height/2);
}

function resetLbView(){
  LBV.scale=1;LBV.tx=0;LBV.ty=0;
  if(lbViewport){lbViewport.style.transform='';lbViewport.classList.remove('wh-lb-dragging');}
  if(lbImg){lbImg.style.filter='';}
  const $s=lb.querySelector('.wh-lightbox__stage');
  if($s){$s.classList.remove('wh-lb-stage--can-pan','wh-lb-stage--panning');}
  if(lbZoomPill)lbZoomPill.classList.remove('wh-lb-zoom-pill--visible');
  clearTimeout(_lbZPillTimer);
}

(function initLbZoomPan(){
  if(!lb||!lbViewport)return;
  const $s=lb.querySelector('.wh-lightbox__stage'); if(!$s)return;

  // ── Wheel zoom (focal point at cursor) ─────────────────────────────────
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

  // ── Mouse drag pan (only when zoomed in) ───────────────────────────────
  let _md=false,_msx=0,_msy=0,_mtx=0,_mty=0,_mDragged=false;
  $s.addEventListener('mousedown',e=>{
    if(lb.hidden||e.button!==0||LBV.scale<=1)return;
    if(e.target.closest('.wh-lb-corner,.wh-lb-nav,.wh-lightbox__ui,.wh-lb-zoom-pill'))return;
    _md=true;_mDragged=false;
    _msx=e.clientX;_msy=e.clientY;_mtx=LBV.tx;_mty=LBV.ty;
    $s.classList.add('wh-lb-stage--panning');
    e.preventDefault();
  });
  window.addEventListener('mousemove',e=>{
    if(!_md)return;
    const dx=e.clientX-_msx,dy=e.clientY-_msy;
    if(Math.abs(dx)>3||Math.abs(dy)>3)_mDragged=true;
    LBV.tx=_mtx+dx;LBV.ty=_mty+dy;
    clampLbPan();applyLbT(false);
  });
  window.addEventListener('mouseup',()=>{
    if(!_md)return;
    _md=false;
    $s.classList.remove('wh-lb-stage--panning');
  });

  // ── Double-click to reset ───────────────────────────────────────────────
  $s.addEventListener('dblclick',e=>{
    if(e.target.closest('.wh-lb-corner,.wh-lb-nav,.wh-lightbox__ui'))return;
    resetLbView();
  });

  // ── Touch pinch-to-zoom + single-finger pan when zoomed ────────────────
  let _td=null,_tmx=null,_tmy=null,_tpx=null,_tpy=null,_totx=0,_toty=0,_pinch=false;
  const tdist=(a,b)=>Math.hypot(b.clientX-a.clientX,b.clientY-a.clientY);
  const tmid =(a,b)=>({x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2});

  lbViewport.addEventListener('touchstart',e=>{
    if(e.target.closest('.wh-lb-corner,.wh-lb-nav,.wh-lightbox__ui'))return;
    if(e.touches.length===2){
      _pinch=true;
      _td=tdist(e.touches[0],e.touches[1]);
      const m=tmid(e.touches[0],e.touches[1]);
      _tmx=m.x;_tmy=m.y;
    } else if(e.touches.length===1&&LBV.scale>1){
      _tpx=e.touches[0].clientX;_tpy=e.touches[0].clientY;
      _totx=LBV.tx;_toty=LBV.ty;
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
    } else if(e.touches.length===1&&LBV.scale>1&&_tpx!==null){
      e.preventDefault();
      LBV.tx=_totx+(e.touches[0].clientX-_tpx);
      LBV.ty=_toty+(e.touches[0].clientY-_tpy);
      clampLbPan();applyLbT(false);
    }
  },{passive:false});

  lbViewport.addEventListener('touchend',e=>{
    if(e.touches.length<2){_td=null;_tmx=null;_tmy=null;_pinch=false;}
    if(e.touches.length===0){_tpx=null;_tpy=null;}
  },{passive:true});
})();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ARENA OPEN / CLOSE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
backBtn.addEventListener('click',closeArena);
function closeArena(){arena.hidden=true;lb.hidden=true;}

// Header button in chat arena
if(whOpenBtn){
  whOpenBtn.addEventListener('click',()=>{
    // Try to read the active character's name from the thread header
    const activeBot=document.querySelector('#active-bots .active-bot--selected, #active-bots .active-bot');
    const name=activeBot?(activeBot.title||'').trim():'';
    const charId=activeBot?activeBot.dataset.id:null;
    openWallhavenGallery(name, charId);
  });
}

window.openWallhavenGallery = function(charName, charId){
  const prevName = WH.charName;
  // Strip parenthetical aliases (e.g. "Blonde Blazer (Mandy)" → "Blonde Blazer")
  // so the search query has a better chance of returning results on Wallhaven.
  const searchName = charName ? charName.replace(/\s*\([^)]*\)\s*/g, '').trim() : '';
  WH.charName=charName||''; WH.charId=charId||null;
  charLabel.textContent=charName||'Visual Archive';
  searchInput.value=searchName||''; searchClear.hidden=!searchName;
  apikeyInput.value=WH.apiKey;
  arena.hidden=false;
  updateBadges(); populateCharSelects(); window.lucide?.createIcons();
  document.querySelectorAll('.wh-view-tab').forEach(b=>b.classList.toggle('active',b.dataset.wview==='browse'));
  WH.view='browse'; filtersPanel.style.display=''; charFilterWrap.hidden=true;
  const nameChanged=charName&&charName!==prevName;
  if(charName&&(WH.results.length===0||nameChanged)){
    WH.results=[]; WH.query=searchName; WH.page=1; WH.seed=null; fetchWallpapers(false);
  } else if(!charName&&WH.results.length===0){
    // No char, no prior results — auto-fetch top results so it never opens empty
    WH.query=''; WH.page=1; WH.seed=null; fetchWallpapers(false);
  } else { renderCurrentView(); }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
document.addEventListener('DOMContentLoaded',()=>{
  updateBadges();
  window.lucide?.createIcons({nodes:[document.getElementById('wh-open-btn')]});
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOAST
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function showToast(msg,type){
  const c=document.getElementById('toast-container'); if(!c)return;
  const t=document.createElement('div');
  t.className=`toast toast--${type||'info'}`; t.textContent=msg;
  c.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('toast--in'));
  setTimeout(()=>{t.classList.remove('toast--in');setTimeout(()=>t.remove(),300);},3000);
}

})();