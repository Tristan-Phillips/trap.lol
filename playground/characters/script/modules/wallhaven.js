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
const prevBtn        = document.getElementById('wh-prev-btn');
const nextBtn        = document.getElementById('wh-next-btn');
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

// Header button (new, in arena header)
const whOpenBtn      = document.getElementById('wh-open-btn');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Intersection Observer — swap data-src → src when tile enters the viewport
const tileObserver = new IntersectionObserver((entries, obs) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const img = entry.target.querySelector('.wh-tile__img--pending');
    if (img && img.dataset.src) {
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
      img.classList.remove('wh-tile__img--pending');
      img.classList.add('wh-tile__img--reveal');
    }
    obs.unobserve(entry.target);
  });
}, { root: grid, rootMargin: '100px', threshold: 0 });

function buildCats()   { return `${WH.cats.general?1:0}${WH.cats.anime?1:0}${WH.cats.people?1:0}`; }
function buildPurity() { return `${WH.purity.sfw?1:0}${WH.purity.sketchy?1:0}${WH.purity.nsfw?1:0}`; }
function purityLabel(p){ return {sfw:'SFW',sketchy:'Sketchy',nsfw:'NSFW'}[p]||p; }
function fmtNum(n){ if(n>=1e6)return(n/1e6).toFixed(1)+'M'; if(n>=1e3)return(n/1e3).toFixed(1)+'k'; return String(n); }

function setLoading(on){
  WH.loading=on; spinner.hidden=!on; searchBtn.disabled=on;
  if(on){ emptyBrowse.hidden=true;likedEmpty.hidden=true;savedEmpty.hidden=true;assignedEmpty.hidden=true;errorBox.hidden=true; }
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

// Returns all characters from main app (reads localStorage key used by the RP app)
function getAllChars(){
  try {
    // The main app stores characters under 'characters' as an array of objects with .id and .name
    const raw = localStorage.getItem('characters');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
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
  lucide.createIcons({nodes:[apikeyToggle]});
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
    lucide.createIcons({nodes:[grid]});
    statusText.textContent='Liked'; resultCount.textContent=items.length+' images';
  } else if(WH.view==='saved'){
    const items=[...WH.savedData.values()];
    if(!items.length){savedEmpty.hidden=false;return;}
    items.forEach((w,i)=>buildTile(w,i,'saved'));
    lucide.createIcons({nodes:[grid]});
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
    lucide.createIcons({nodes:[grid]});
    const label=WH.assignedCharFilter?`Assigned — ${getCharName(WH.assignedCharFilter)}`:'Assigned';
    statusText.textContent=label; resultCount.textContent=items.length+' images';
  } else {
    if(!WH.results.length){emptyBrowse.hidden=false;return;}
    WH.results.forEach((w,i)=>buildTile(w,i,'browse'));
    lucide.createIcons({nodes:[grid]});
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
prevBtn.addEventListener('click',()=>{if(WH.page>1){WH.page--;fetchWallpapers(false);}});
nextBtn.addEventListener('click',()=>{if(WH.page<WH.totalPages){WH.page++;fetchWallpapers(false);}});
retryBtn.addEventListener('click',()=>fetchWallpapers(false));

function doSearch(){
  WH.query=searchInput.value.trim(); WH.page=1; WH.seed=null;
  document.querySelectorAll('.wh-view-tab').forEach(b=>b.classList.toggle('active',b.dataset.wview==='browse'));
  WH.view='browse'; filtersPanel.style.display=''; charFilterWrap.hidden=true;
  fetchWallpapers(false);
}

async function fetchWallpapers(append){
  if(WH.loading)return;
  setLoading(true); grid.hidden=false; grid.innerHTML='';
  pageControls.hidden=true; statusText.textContent='Scanning…'; resultCount.textContent='';

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
    const pageData=json.data.slice(0,10);
    WH.results=append?WH.results.concat(pageData):pageData;
    grid.innerHTML='';
    WH.results.forEach((w,i)=>buildTile(w,i,'browse'));
    lucide.createIcons({nodes:[grid]});
    pageNum.textContent=WH.page; pageTotal.textContent=WH.totalPages;
    statusText.textContent=q?`"${q}"`:'Top results';
    resultCount.textContent=WH.total.toLocaleString()+' results';
    pageControls.hidden=!WH.results.length;
    prevBtn.disabled=WH.page<=1; nextBtn.disabled=WH.page>=WH.totalPages;
    if(!WH.results.length)emptyBrowse.hidden=false;
    setLoading(false);
  }catch(err){
    setLoading(false);
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
    return c?`<span class="wh-tile__char-badge" title="Assigned to ${c.name||'?'}">${(c.name||'?').slice(0,1)}</span>`:'';
  }).join('');
}

function buildTile(w,idx,set){
  const isLiked=WH.liked.has(w.id);
  const isSaved=WH.saved.has(w.id);
  const isAssigned=WH.assigned.has(w.id)&&(WH.assigned.get(w.id)||[]).length>0;

  const tile=document.createElement('div');
  tile.className=`wh-tile wh-tile--${w.purity}`;
  tile.dataset.idx=idx; tile.dataset.set=set;

  tile.innerHTML=`
    <div class="wh-tile__img-wrap">
      <img class="wh-tile__img wh-tile__img--pending" data-src="${w.thumbs.large}" draggable="false" alt="">
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
function addToCharacterGalleryInApp(charId, url, thumb, wallId){
  try {
    const raw=localStorage.getItem('characters'); if(!raw)return;
    const chars=JSON.parse(raw); if(!Array.isArray(chars))return;
    const idx=chars.findIndex(c=>String(c.id)===String(charId)); if(idx===-1)return;
    const char=chars[idx];
    if(!char.gallery)char.gallery=[];
    // Avoid duplicates
    if(!char.gallery.find(g=>g.url===url)){
      char.gallery.push({url,thumb:thumb||url,wh:wallId,addedAt:Date.now()});
      chars[idx]=char;
      localStorage.setItem('characters',JSON.stringify(chars));
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
  const ds=lbDataset(), w=ds[WH.lbIndex]; if(!w)return;
  lbImg.classList.add('wh-lb-img--loading'); lbImg.src='';
  const t=new Image();
  t.onload=()=>{lbImg.src=w.path;lbImg.classList.remove('wh-lb-img--loading');};
  t.onerror=()=>{lbImg.src=w.thumbs.large;lbImg.classList.remove('wh-lb-img--loading');};
  t.src=w.path;
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
lbClose.addEventListener('click',()=>{lb.hidden=true;});
lbBackdrop.addEventListener('click',()=>{lb.hidden=true;});
lbPrev.addEventListener('click',()=>{if(WH.lbIndex>0){WH.lbIndex--;renderLightbox();}});
lbNext.addEventListener('click',()=>{const ds=lbDataset();if(WH.lbIndex<ds.length-1){WH.lbIndex++;renderLightbox();}});

// Touch swipe for lightbox
(function(){
  let _sx=0,_sy=0;
  lb.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;_sx=e.touches[0].clientX;_sy=e.touches[0].clientY;},{passive:true});
  lb.addEventListener('touchend',e=>{
    if(e.changedTouches.length!==1)return;
    const dx=e.changedTouches[0].clientX-_sx;
    const dy=e.changedTouches[0].clientY-_sy;
    if(Math.abs(dy)>Math.abs(dx)||Math.abs(dx)<40)return;
    if(dx<0){const ds=lbDataset();if(WH.lbIndex<ds.length-1){WH.lbIndex++;renderLightbox();}}
    else if(dx>0&&WH.lbIndex>0){WH.lbIndex--;renderLightbox();}
  },{passive:true});
})();

document.addEventListener('keydown',e=>{
  if(!lb.hidden){
    if(e.key==='ArrowLeft'&&WH.lbIndex>0){WH.lbIndex--;renderLightbox();}
    else if(e.key==='ArrowRight'){const ds=lbDataset();if(WH.lbIndex<ds.length-1){WH.lbIndex++;renderLightbox();}}
    else if(e.key==='Escape'){lb.hidden=true;}
    else if(e.key==='l'||e.key==='L') lbToggleLike();
    else if(e.key==='s'||e.key==='S') lbToggleSave();
    else if(e.key==='d'||e.key==='D'){const w=lbDataset()[WH.lbIndex];if(w)downloadWallpaper(w);}
    return;
  }
  if(!arena.hidden&&e.key==='Escape')closeArena();
});

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
  WH.charName=charName||''; WH.charId=charId||null;
  charLabel.textContent=charName||'Visual Archive';
  searchInput.value=charName||''; searchClear.hidden=!charName;
  apikeyInput.value=WH.apiKey;
  arena.hidden=false;
  updateBadges(); populateCharSelects(); lucide.createIcons();
  document.querySelectorAll('.wh-view-tab').forEach(b=>b.classList.toggle('active',b.dataset.wview==='browse'));
  WH.view='browse'; filtersPanel.style.display=''; charFilterWrap.hidden=true;
  if(charName&&WH.results.length===0){
    WH.query=charName; WH.page=1; WH.seed=null; fetchWallpapers(false);
  } else { renderCurrentView(); }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
document.addEventListener('DOMContentLoaded',()=>{
  updateBadges();
  lucide.createIcons({nodes:[document.getElementById('wh-open-btn')]});
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