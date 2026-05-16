/**
 * DM MATRIX // trap.lol
 * All logic wrapped in DOMContentLoaded. No module scope issues.
 * Surgical JSON loading — one source at a time, loaded/unloaded on demand.
 */

document.addEventListener('DOMContentLoaded', function () {

  // ── Helpers ────────────────────────────────────────────────

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  // Strip 5etools {@tag text} inline notation to plain text
  function tag(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/\{@atk [^}]+\}/g, '')
      .replace(/\{@hit (-?\d+)\}/g, (_, n) => (parseInt(n) >= 0 ? '+' : '') + n + ' to hit')
      .replace(/\{@h\}/g, 'Hit: ')
      .replace(/\{@damage ([^}]+)\}/g, '$1')
      .replace(/\{@dice ([^}]+)\}/g, '$1')
      .replace(/\{@dc (\d+)\}/g, 'DC $1')
      .replace(/\{@recharge(?: (\d+))?\}/g, (_, n) => n ? '(Recharge ' + n + '–6)' : '(Recharge 6)')
      .replace(/\{@\w+ ([^|}]+)[^}]*\}/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // Render a 5etools entry node to HTML string
  function renderEntry(e) {
    if (!e) return '';
    if (typeof e === 'string') return '<p>' + esc(tag(e)) + '</p>';
    if (e.type === 'list') {
      return '<ul class="srd-list">' + (e.items || []).map(function(i) {
        return '<li>' + esc(tag(typeof i === 'string' ? i : (i.name || ''))) + '</li>';
      }).join('') + '</ul>';
    }
    if (e.type === 'entries' || e.type === 'section') {
      var inner = (e.entries || []).map(renderEntry).join('');
      return e.name
        ? '<div class="srd-sub"><p class="srd-sub__name">' + esc(e.name) + '</p>' + inner + '</div>'
        : inner;
    }
    if (e.type === 'table') {
      var head = (e.colLabels || []).map(function(l) { return '<th>' + esc(tag(l)) + '</th>'; }).join('');
      var rows = (e.rows || []).map(function(row) {
        return '<tr>' + row.map(function(c) {
          var txt = typeof c === 'string' ? c : (c.roll ? c.roll.min + '–' + c.roll.max : '');
          return '<td>' + esc(tag(txt)) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      return '<table class="srd-table"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table>';
    }
    if (e.type === 'inset' || e.type === 'insetReadaloud') {
      return '<blockquote class="srd-inset">' + (e.entries || []).map(renderEntry).join('') + '</blockquote>';
    }
    if (e.entries) return (e.entries || []).map(renderEntry).join('');
    if (e.text)    return '<p>' + esc(tag(e.text)) + '</p>';
    return '';
  }

  function fmtCR(cr) {
    if (!cr) return '—';
    if (typeof cr === 'object') cr = cr.cr || '—';
    return String(cr);
  }

  function fmtType(type) {
    if (!type) return '';
    if (typeof type === 'string') return type;
    var t = type.type || '';
    if (type.tags && type.tags.length) t += ' (' + type.tags.join(', ') + ')';
    return t;
  }

  function mod(score) {
    var m = Math.floor((score - 10) / 2);
    return (m >= 0 ? '+' : '') + m;
  }

  var SCHOOLS = {
    A:'Abjuration', C:'Conjuration', D:'Divination',
    E:'Enchantment', V:'Evocation',  I:'Illusion',
    N:'Necromancy',  T:'Transmutation', P:'Psionic'
  };

  function showToast(msg) {
    var $t = document.getElementById('roll-toast');
    if (!$t) {
      $t = document.createElement('div');
      $t.id = 'roll-toast';
      $t.className = 'roll-toast';
      document.body.appendChild($t);
    }
    $t.textContent = msg;
    $t.classList.add('roll-toast--show');
    clearTimeout($t._timer);
    $t._timer = setTimeout(function() { $t.classList.remove('roll-toast--show'); }, 3500);
  }

  // ── State ──────────────────────────────────────────────────

  var state = {
    activeModule: 'campaign',
    sessionActive: false,
    bestiary: { monsters: [], loaded: false, activeSource: 'MM', page: 0, filtered: [] },
    spells:   { spells: [],   loaded: false, activeSource: 'PHB', filtered: [] },
    conditionsLoaded: false,
    diceHistory: []
  };

  // Source catalogue — load only what's needed
  var BESTIARY_SOURCES = {
    'MM':   { label: 'Monster Manual',           file: 'bestiary-mm.json',   count: '~450' },
    'VGM':  { label: "Volo's Guide",             file: 'bestiary-vgm.json',  count: '~120' },
    'MTF':  { label: "Mordenkainen's Tome",      file: 'bestiary-mtf.json',  count: '~130' },
    'MPMM': { label: 'Monsters of Multiverse',   file: 'bestiary-mpmm.json', count: '~250' },
    'BGD':  { label: "Baldur's Gate: DiA",       file: 'bestiary-bgdia.json',count: '~70'  },
    'CoS':  { label: 'Curse of Strahd',          file: 'bestiary-cos.json',  count: '~40'  },
    'TOA':  { label: 'Tomb of Annihilation',     file: 'bestiary-toa.json',  count: '~50'  },
  };

  var SPELL_SOURCES = {
    'PHB':  { label: "Player's Handbook",   file: 'spells-phb.json',  count: '~300' },
    'XGE':  { label: "Xanathar's Guide",    file: 'spells-xge.json',  count: '~95'  },
    'TCE':  { label: "Tasha's Cauldron",    file: 'spells-tce.json',  count: '~30'  },
    'XPHB': { label: 'PHB 2024',            file: 'spells-xphb.json', count: '~300' },
    'BMT':  { label: 'Book of Many Things', file: 'spells-bmt.json',  count: '~10'  },
  };

  // ── DOM refs ───────────────────────────────────────────────

  var $welcome      = document.getElementById('welcome');
  var $app          = document.getElementById('app');
  var $btnNew       = document.getElementById('welcome-new');
  var $btnLoad      = document.getElementById('welcome-load');
  var $sidebar      = document.getElementById('sidebar');
  var $modeLabel    = document.getElementById('mode-label');
  var $toggleLabel  = document.getElementById('session-toggle-label');
  var $sessionModal = document.getElementById('session-modal');
  var $settingsModal= document.getElementById('settings-modal');

  // ── Welcome ────────────────────────────────────────────────

  function dismissWelcome() {
    $welcome.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    $welcome.style.opacity    = '0';
    $welcome.style.transform  = 'scale(1.04)';
    setTimeout(function() {
      $welcome.hidden    = true;
      $app.hidden        = false;
      $app.style.opacity = '0';
      // Double rAF so display:flex is computed before transition
      requestAnimationFrame(function() {
        requestAnimationFrame(function() { $app.style.opacity = '1'; });
      });
    }, 480);
  }

  $btnNew.addEventListener('click',  dismissWelcome);
  $btnLoad.addEventListener('click', dismissWelcome);

  // ── Navigation ─────────────────────────────────────────────

  var $sidebarItems = document.querySelectorAll('.sidebar__item[data-module]');
  var $modules      = document.querySelectorAll('.module[data-module]');

  function activateModule(name) {
    state.activeModule = name;

    $sidebarItems.forEach(function(btn) {
      btn.classList.toggle('sidebar__item--active', btn.dataset.module === name);
    });
    $modules.forEach(function(sec) {
      sec.classList.toggle('module--hidden', sec.dataset.module !== name);
    });

    // Lazy load on first open
    if (name === 'bestiary'   && !state.bestiary.loaded) initBestiary();
    if (name === 'spellbook'  && !state.spells.loaded)   initSpellbook();
    if (name === 'cheatsheet' && !state.conditionsLoaded) initCheatsheet();
  }

  $sidebarItems.forEach(function(btn) {
    btn.addEventListener('click', function() { activateModule(btn.dataset.module); });
    btn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateModule(btn.dataset.module); }
    });
  });

  // ── Session mode ───────────────────────────────────────────

  document.getElementById('session-toggle').addEventListener('click', function() {
    if (!state.sessionActive) openModal($sessionModal);
    else endSession();
  });

  document.getElementById('session-modal-cancel').addEventListener('click',  function() { closeModal($sessionModal); });
  document.getElementById('session-modal-confirm').addEventListener('click', function() {
    var title = document.getElementById('session-title-input').value.trim();
    closeModal($sessionModal);
    beginSession(title);
    document.getElementById('session-title-input').value = '';
  });

  var _currentSessionId = null;

  function beginSession(title) {
    state.sessionActive = true;
    renderPartyBar();
    $sidebar.classList.add('sidebar--session');
    $toggleLabel.textContent = 'END SESSION';
    $modeLabel.textContent   = 'SESSION';
    var svg = document.querySelector('#session-toggle svg');
    if (svg) svg.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';

    // Create session log entry (campaign object available after campaignLoad below)
    _currentSessionId = typeof campaignUID === 'function' ? campaignUID() : 'c_' + Date.now();
    if (typeof campaign !== 'undefined') {
      campaign.sessions.push({
        id:      _currentSessionId,
        date:    new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }),
        title:   title || ('Session ' + (campaign.sessions.length + 1)),
        summary: '',
        xp:      0
      });
      campaignSave();
      if (typeof renderSessions     === 'function') renderSessions();
      if (typeof renderCampaignStats === 'function') renderCampaignStats();
      var $sub = document.getElementById('session-modal-sub');
      if ($sub) $sub.textContent = 'Session ' + campaign.sessions.length + ' commences.';
    }
  }

  function endSession() {
    if (_currentSessionId && typeof campaign !== 'undefined') {
      var s = campaign.sessions.find(function(x) { return x.id === _currentSessionId; });
      if (s) {
        var summary = prompt('Session summary (optional):', s.summary || '') || '';
        var xpStr   = prompt('XP awarded this session:', String(s.xp || 0));
        var xp      = parseInt(xpStr) || 0;
        var oldXP   = s.xp || 0;
        s.summary   = summary.trim();
        s.xp        = xp;
        campaign.totalXP = Math.max(0, campaign.totalXP - oldXP + xp);
        campaignSave();
        if (typeof renderSessions      === 'function') renderSessions();
        if (typeof renderCampaignStats === 'function') renderCampaignStats();
      }
      _currentSessionId = null;
    }

    state.sessionActive = false;
    renderPartyBar();
    $sidebar.classList.remove('sidebar--session');
    $toggleLabel.textContent = 'BEGIN SESSION';
    $modeLabel.textContent   = 'PREP';
    var svg = document.querySelector('#session-toggle svg');
    if (svg) svg.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';

    if (typeof campaign !== 'undefined') {
      var $sub = document.getElementById('session-modal-sub');
      if ($sub) $sub.textContent = 'Session ' + (campaign.sessions.length + 1) + ' commences.';
    }
  }

  // ── Modals ─────────────────────────────────────────────────

  function openModal($m) {
    $m.hidden = false;
    document.body.style.overflow = 'hidden';
    var f = $m.querySelector('button, input');
    if (f) setTimeout(function() { f.focus(); }, 60);
  }

  function closeModal($m) {
    $m.hidden = true;
    document.body.style.overflow = '';
  }

  document.getElementById('settings-btn').addEventListener('click',   function() { openModal($settingsModal); });
  document.getElementById('settings-modal-close').addEventListener('click', function() { closeModal($settingsModal); });

  var ALL_MODALS = [$sessionModal, $settingsModal,
    document.getElementById('char-modal'),
    document.getElementById('combatant-modal')
  ];

  document.addEventListener('keydown', function(e) {
    // Escape — close modals and pickers
    if (e.key === 'Escape') {
      document.querySelectorAll('.condition-picker').forEach(function(p) { p.remove(); });
      ALL_MODALS.forEach(function($m) { if ($m && !$m.hidden) closeModal($m); });
      return;
    }

    // Session-mode keyboard shortcuts — skip when typing in an input/textarea
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    // Module navigation
    if (e.ctrlKey && e.key === 'b') { e.preventDefault(); activateModule('bestiary');  return; }
    if (e.ctrlKey && e.key === 'p') { e.preventDefault(); activateModule('party');     return; }
    if (e.ctrlKey && e.key === 'd') { e.preventDefault(); activateModule('dice');      return; }
    if (e.ctrlKey && e.key === 'o') { e.preventDefault(); activateModule('oracle');    return; }

    // Combat shortcuts (session mode only — still usable in prep for testing)
    if (e.key === 'n' || e.key === 'N') { advanceTurn(); return; }
  });

  ALL_MODALS.forEach(function($m) {
    if (!$m) return;
    $m.addEventListener('click', function(e) { if (e.target === $m) closeModal($m); });
  });

  // Sidebar labels toggle
  var $labelsToggle = document.getElementById('sidebar-labels-toggle');
  if ($labelsToggle) {
    $labelsToggle.addEventListener('change', function() {
      $sidebar.classList.toggle('sidebar--collapsed', !$labelsToggle.checked);
    });
  }

  // Oracle chips
  document.querySelectorAll('.oracle-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      var $f = document.getElementById('oracle-field');
      if ($f) { $f.value = chip.textContent.trim(); $f.focus(); }
    });
  });

  // ══════════════════════════════════════════════════════════
  // CAMPAIGN — persistent data layer (localStorage)
  // ══════════════════════════════════════════════════════════

  var campaign = {
    name:     'Unnamed Campaign',
    setting:  '',
    banner:   null,  // base64 data URL
    scratch:  '',
    npcs:     [],    // { id, name, role, notes }
    lore:     {      // keyed by tab
      locations: [],   // { id, title, body }
      factions:  [],
      timeline:  []
    },
    sessions: [],    // { id, date, title, summary, xp }
    totalXP:  0,
    partyLevel: 1
  };

  function campaignLoad() {
    try {
      var raw = localStorage.getItem('dndm_campaign');
      if (!raw) return;
      var saved = JSON.parse(raw);
      Object.assign(campaign, saved);
      // Ensure lore sub-keys are always arrays
      if (!campaign.lore || typeof campaign.lore !== 'object') campaign.lore = {};
      ['locations','factions','timeline'].forEach(function(k) {
        if (!Array.isArray(campaign.lore[k])) campaign.lore[k] = [];
      });
      if (!Array.isArray(campaign.npcs))    campaign.npcs    = [];
      if (!Array.isArray(campaign.sessions)) campaign.sessions = [];
      if (typeof campaign.totalXP    !== 'number') campaign.totalXP    = 0;
      if (typeof campaign.partyLevel !== 'number') campaign.partyLevel = 1;
    } catch(e) {}
  }

  function campaignSave() {
    try { localStorage.setItem('dndm_campaign', JSON.stringify(campaign)); } catch(e) {}
  }

  function campaignUID() {
    return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  }

  campaignLoad();

  // ── Banner ────────────────────────────────────────────────

  function renderBanner() {
    var $name    = document.getElementById('campaign-name');
    var $setting = document.getElementById('campaign-setting');
    var $banner  = document.getElementById('campaign-banner');
    if ($name)    $name.textContent    = campaign.name    || 'Unnamed Campaign';
    if ($setting) $setting.textContent = campaign.setting || 'No setting defined.';
    if ($banner && campaign.banner) {
      $banner.style.backgroundImage  = 'url(' + campaign.banner + ')';
      $banner.style.backgroundSize   = 'cover';
      $banner.style.backgroundPosition = 'center';
    }
  }

  renderBanner();

  // Click campaign name / setting to edit inline
  var $campName = document.getElementById('campaign-name');
  if ($campName) {
    $campName.title = 'Click to rename';
    $campName.style.cursor = 'pointer';
    $campName.addEventListener('click', function() {
      var val = prompt('Campaign name:', campaign.name);
      if (val !== null) {
        campaign.name = val.trim() || 'Unnamed Campaign';
        campaignSave();
        renderBanner();
      }
    });
  }

  var $campSetting = document.getElementById('campaign-setting');
  if ($campSetting) {
    $campSetting.title = 'Click to edit setting';
    $campSetting.style.cursor = 'pointer';
    $campSetting.addEventListener('click', function() {
      var val = prompt('Campaign setting:', campaign.setting);
      if (val !== null) {
        campaign.setting = val.trim();
        campaignSave();
        renderBanner();
      }
    });
  }

  // Banner image upload
  var $bannerUpload = document.querySelector('.module__banner-upload');
  if ($bannerUpload) {
    var $bannerInput = document.createElement('input');
    $bannerInput.type   = 'file';
    $bannerInput.accept = 'image/*';
    $bannerInput.hidden = true;
    document.body.appendChild($bannerInput);
    $bannerUpload.addEventListener('click', function() { $bannerInput.click(); });
    $bannerInput.addEventListener('change', function() {
      var file = $bannerInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(e) {
        campaign.banner = e.target.result;
        campaignSave();
        renderBanner();
      };
      reader.readAsDataURL(file);
      $bannerInput.value = '';
    });
  }

  // ── Campaign Stats ─────────────────────────────────────────

  function renderCampaignStats() {
    var $sessions = document.getElementById('stat-sessions');
    var $xp       = document.getElementById('stat-xp');
    var $level    = document.getElementById('stat-level');
    var $npcs     = document.getElementById('stat-npcs');
    if ($sessions) $sessions.textContent = campaign.sessions.length;
    if ($xp)       $xp.textContent       = campaign.totalXP.toLocaleString();
    if ($level)    $level.textContent    = campaign.partyLevel;
    if ($npcs)     $npcs.textContent     = campaign.npcs.length;
  }

  renderCampaignStats();

  // Click party level to edit
  var $statLevel = document.getElementById('stat-level');
  if ($statLevel) {
    $statLevel.title = 'Click to edit';
    $statLevel.style.cursor = 'pointer';
    $statLevel.addEventListener('click', function() {
      var val = prompt('Party level (1–20):', campaign.partyLevel);
      var n   = parseInt(val);
      if (!isNaN(n) && n >= 1 && n <= 20) {
        campaign.partyLevel = n;
        campaignSave();
        renderCampaignStats();
      }
    });
  }

  // ── Scratch Pad ───────────────────────────────────────────

  var $scratch = document.getElementById('scratch-pad');
  if ($scratch) {
    $scratch.value = campaign.scratch || '';
    var _scratchTimer;
    $scratch.addEventListener('input', function() {
      clearTimeout(_scratchTimer);
      _scratchTimer = setTimeout(function() {
        campaign.scratch = $scratch.value;
        campaignSave();
      }, 600);
    });
  }

  // ── NPCs ──────────────────────────────────────────────────

  function renderNPCs() {
    var $grid = document.getElementById('npc-grid');
    if (!$grid) return;
    if (!campaign.npcs.length) {
      $grid.innerHTML = '<div class="npc-card npc-card--empty"><span class="npc-card__empty-text">No NPCs yet. Add your first character.</span></div>';
      return;
    }
    $grid.innerHTML = campaign.npcs.map(function(npc) {
      return '<div class="npc-card" data-npc-id="' + esc(npc.id) + '">'
        + '<div class="npc-card__head">'
          + '<span class="npc-card__name">' + esc(npc.name) + '</span>'
          + '<span class="npc-card__role">' + esc(npc.role || '') + '</span>'
        + '</div>'
        + (npc.notes ? '<p class="npc-card__notes">' + esc(npc.notes) + '</p>' : '')
        + '<div class="npc-card__actions">'
          + '<button class="npc-card__btn npc-edit" data-npc-id="' + esc(npc.id) + '">Edit</button>'
          + '<button class="npc-card__btn npc-card__btn--remove npc-remove" data-npc-id="' + esc(npc.id) + '">Remove</button>'
        + '</div>'
        + '</div>';
    }).join('');

    $grid.querySelectorAll('.npc-edit').forEach(function(btn) {
      btn.addEventListener('click', function() { openNPCModal(btn.dataset.npcId); });
    });
    $grid.querySelectorAll('.npc-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        campaign.npcs = campaign.npcs.filter(function(n) { return n.id !== btn.dataset.npcId; });
        campaignSave();
        renderNPCs();
        renderCampaignStats();
      });
    });
  }

  function openNPCModal(editId) {
    var existing = editId ? campaign.npcs.find(function(n) { return n.id === editId; }) : null;
    var name  = prompt('NPC name:', existing ? existing.name : '');
    if (name === null) return;
    name = name.trim();
    if (!name) return;
    var role  = prompt('Role / title (optional):', existing ? existing.role  : '') || '';
    var notes = prompt('Notes (optional):', existing ? existing.notes : '') || '';

    if (existing) {
      existing.name  = name;
      existing.role  = role.trim();
      existing.notes = notes.trim();
    } else {
      campaign.npcs.push({ id: campaignUID(), name: name, role: role.trim(), notes: notes.trim() });
    }
    campaignSave();
    renderNPCs();
    renderCampaignStats();
  }

  renderNPCs();

  var $npcAddBtn = document.querySelector('#module-campaign .panel__head .panel__add');
  if ($npcAddBtn) $npcAddBtn.addEventListener('click', function() { openNPCModal(null); });

  // ── Lore Wiki ─────────────────────────────────────────────

  var _activeTab = 'locations';

  function renderLore() {
    var $list = document.getElementById('lore-list');
    if (!$list) return;
    var entries = campaign.lore[_activeTab] || [];
    if (!entries.length) {
      $list.innerHTML = '<div class="lore-empty">No entries. The world is yet unwritten.</div>';
      return;
    }
    $list.innerHTML = entries.map(function(e) {
      return '<div class="lore-entry" data-lore-id="' + esc(e.id) + '">'
        + '<div class="lore-entry__head">'
          + '<span class="lore-entry__title">' + esc(e.title) + '</span>'
          + '<div class="lore-entry__actions">'
            + '<button class="lore-edit" data-lore-id="' + esc(e.id) + '">Edit</button>'
            + '<button class="lore-remove" data-lore-id="' + esc(e.id) + '">✕</button>'
          + '</div>'
        + '</div>'
        + (e.body ? '<p class="lore-entry__body">' + esc(e.body) + '</p>' : '')
        + '</div>';
    }).join('');

    $list.querySelectorAll('.lore-edit').forEach(function(btn) {
      btn.addEventListener('click', function() { openLoreModal(btn.dataset.loreId); });
    });
    $list.querySelectorAll('.lore-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        campaign.lore[_activeTab] = campaign.lore[_activeTab].filter(function(e) { return e.id !== btn.dataset.loreId; });
        campaignSave();
        renderLore();
      });
    });
  }

  function openLoreModal(editId) {
    var entries  = campaign.lore[_activeTab] || [];
    var existing = editId ? entries.find(function(e) { return e.id === editId; }) : null;
    var title = prompt('Entry title:', existing ? existing.title : '');
    if (title === null) return;
    title = title.trim();
    if (!title) return;
    var body = prompt('Description (optional):', existing ? existing.body : '') || '';

    if (existing) {
      existing.title = title;
      existing.body  = body.trim();
    } else {
      if (!campaign.lore[_activeTab]) campaign.lore[_activeTab] = [];
      campaign.lore[_activeTab].push({ id: campaignUID(), title: title, body: body.trim() });
    }
    campaignSave();
    renderLore();
  }

  renderLore();

  // Tab switching — also update _activeTab
  document.querySelectorAll('.panel__tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      var panel = tab.closest('.panel');
      panel.querySelectorAll('.panel__tab').forEach(function(t) { t.classList.remove('panel__tab--active'); });
      tab.classList.add('panel__tab--active');
      _activeTab = tab.dataset.tab;
      renderLore();
    });
  });

  // Find lore Add Entry button (second panel__add button in campaign module)
  var $loreAddBtn = document.querySelector('#module-campaign .lore-list ~ * .panel__add, #module-campaign .panel__add:last-of-type');
  // Safer: find by panel title
  document.querySelectorAll('#module-campaign .panel__head').forEach(function(head) {
    var titleEl = head.querySelector('.panel__title');
    if (titleEl && titleEl.textContent.trim() === 'LORE WIKI') {
      var btn = head.querySelector('.panel__add');
      if (btn) btn.addEventListener('click', function() { openLoreModal(null); });
    }
  });

  // ══════════════════════════════════════════════════════════
  // SESSIONS LOG
  // ══════════════════════════════════════════════════════════

  function renderSessions() {
    var $list = document.getElementById('session-list');
    if (!$list) return;
    if (!campaign.sessions.length) {
      $list.innerHTML = '<div class="session-empty">No sessions recorded. Begin your first session to start logging.</div>';
      return;
    }
    $list.innerHTML = campaign.sessions.slice().reverse().map(function(s, revIdx) {
      var idx = campaign.sessions.length - revIdx;
      return '<div class="session-entry" data-session-id="' + esc(s.id) + '">'
        + '<div class="session-entry__head">'
          + '<span class="session-entry__num">Session ' + idx + '</span>'
          + '<span class="session-entry__title">' + esc(s.title || '—') + '</span>'
          + '<span class="session-entry__date">' + esc(s.date || '') + '</span>'
          + '<div class="session-entry__actions">'
            + '<button class="session-edit" data-session-id="' + esc(s.id) + '">Edit</button>'
            + '<button class="session-remove" data-session-id="' + esc(s.id) + '">✕</button>'
          + '</div>'
        + '</div>'
        + (s.summary ? '<p class="session-entry__summary">' + esc(s.summary) + '</p>' : '')
        + (s.xp ? '<span class="session-entry__xp">+' + esc(String(s.xp)) + ' XP</span>' : '')
        + '</div>';
    }).join('');

    $list.querySelectorAll('.session-edit').forEach(function(btn) {
      btn.addEventListener('click', function() { openSessionEditModal(btn.dataset.sessionId); });
    });
    $list.querySelectorAll('.session-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var s = campaign.sessions.find(function(x) { return x.id === btn.dataset.sessionId; });
        if (s && s.xp) campaign.totalXP = Math.max(0, campaign.totalXP - s.xp);
        campaign.sessions = campaign.sessions.filter(function(x) { return x.id !== btn.dataset.sessionId; });
        campaignSave();
        renderSessions();
        renderCampaignStats();
      });
    });
  }

  function openSessionEditModal(editId) {
    var existing = editId ? campaign.sessions.find(function(s) { return s.id === editId; }) : null;
    var title   = prompt('Session title:', existing ? existing.title : '');
    if (title === null) return;
    var summary = prompt('Session summary:', existing ? existing.summary : '') || '';
    var xpStr   = prompt('XP awarded:', existing ? String(existing.xp || 0) : '0');
    var xp      = parseInt(xpStr) || 0;

    if (existing) {
      var oldXP = existing.xp || 0;
      existing.title   = title.trim();
      existing.summary = summary.trim();
      existing.xp      = xp;
      campaign.totalXP = Math.max(0, campaign.totalXP - oldXP + xp);
    } else {
      campaign.sessions.push({
        id:      campaignUID(),
        date:    new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }),
        title:   title.trim(),
        summary: summary.trim(),
        xp:      xp
      });
      campaign.totalXP += xp;
    }
    campaignSave();
    renderSessions();
    renderCampaignStats();
  }

  renderSessions();

  // Wire up "New Session" button in sessions module header
  var $newSessionBtn = document.querySelector('#module-sessions .module__action');
  if ($newSessionBtn) $newSessionBtn.addEventListener('click', function() { openSessionEditModal(null); });

  // ══════════════════════════════════════════════════════════
  // EXPORT / IMPORT campaign JSON
  // ══════════════════════════════════════════════════════════

  var $exportBtn = document.getElementById('export-btn');
  var $importBtn = document.getElementById('import-btn');
  var $importFile= document.getElementById('import-file');

  if ($exportBtn) {
    $exportBtn.addEventListener('click', function() {
      var blob = new Blob([JSON.stringify({ campaign: campaign, party: party }, null, 2)], { type: 'application/json' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href     = url;
      a.download = (campaign.name || 'campaign').replace(/\s+/g, '_') + '_grimoire.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if ($importBtn && $importFile) {
    $importBtn.addEventListener('click', function() { $importFile.click(); });
    $importFile.addEventListener('change', function() {
      var file = $importFile.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var data = JSON.parse(e.target.result);
          if (!data.campaign) { showToast('Invalid file — no campaign data found'); return; }
          if (!confirm('This will overwrite your current campaign. Continue?')) return;
          campaign = Object.assign(campaign, data.campaign);
          if (data.party) party = data.party;
          campaignSave();
          partySave();
          renderBanner();
          renderCampaignStats();
          renderNPCs();
          renderLore();
          renderSessions();
          renderParty();
          showToast('Campaign imported successfully');
          closeModal($settingsModal);
        } catch(err) {
          showToast('Import failed: ' + err.message);
        }
      };
      reader.readAsText(file);
      $importFile.value = '';
    });
  }

  // Wire "Add to Encounter" from stat block
  document.addEventListener('click', function(e) {
    if (!e.target.matches('.stat-block__add-btn')) return;
    var name = e.target.dataset.monster;
    if (!name) return;
    var roll = Math.floor(Math.random() * 20) + 1;
    var hp   = 10;
    combatants.push({
      id:    'comb_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
      name:  name,
      init:  roll,
      hp:    hp,
      hpMax: hp,
      ac:    '—',
      type:  'enemy',
      conditions: [],
      dead:  false
    });
    combatants.sort(function(a,b) { return b.init - a.init; });
    combatActive = true;
    if ($roundNum)   $roundNum.textContent   = combatRound;
    if ($combatNext) $combatNext.disabled    = false;
    if ($endCombat)  $endCombat.disabled     = false;
    renderCombat();
    showToast(name + ' added to encounter (roll initiative: ' + roll + ')');
  });

  // ══════════════════════════════════════════════════════════
  // BESTIARY — load one source at a time
  // ══════════════════════════════════════════════════════════

  function initBestiary() {
    var $mod = document.getElementById('module-bestiary');
    if (!$mod) return;

    // Build source switcher buttons inside the filters row
    var $filters = document.getElementById('bestiary-filters');
    if ($filters) {
      // Source pills
      var sourcePills = Object.keys(BESTIARY_SOURCES).map(function(key) {
        var src = BESTIARY_SOURCES[key];
        return '<button class="filter-pill source-pill' + (key === 'MM' ? ' filter-pill--active' : '') + '" data-source="' + key + '" title="' + esc(src.label) + '">'
          + esc(key) + ' <span class="pill-count">' + src.count + '</span></button>';
      }).join('');
      $filters.innerHTML = sourcePills;

      $filters.querySelectorAll('.source-pill').forEach(function(pill) {
        pill.addEventListener('click', function() {
          $filters.querySelectorAll('.source-pill').forEach(function(p) { p.classList.remove('filter-pill--active'); });
          pill.classList.add('filter-pill--active');
          loadBestiarySource(pill.dataset.source);
        });
      });
    }

    loadBestiarySource('MM');
    initBestiarySearch();
  }

  function loadBestiarySource(sourceKey) {
    state.bestiary.activeSource = sourceKey;
    var src   = BESTIARY_SOURCES[sourceKey];
    var $list = document.getElementById('bestiary-list');
    var $panel= document.getElementById('stat-block-panel');
    if (!$list || !src) return;

    $list.innerHTML  = '<div class="bestiary-loading"><span class="loading-dot"></span> Loading ' + esc(src.label) + '…</div>';
    $panel.innerHTML = '<div class="stat-block-empty">Select a creature to view its stat block.</div>';

    fetch('/dndm/assets/data/5etools/bestiary/' + src.file)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function(d) {
        var monsters = (d.monster || []).slice().sort(function(a, b) {
          return a.name.localeCompare(b.name);
        });
        state.bestiary.monsters = monsters;
        state.bestiary.loaded   = true;
        state.bestiary.filtered = monsters;
        renderMonsterList(monsters);
      })
      .catch(function(err) {
        $list.innerHTML = '<div class="bestiary-loading" style="color:var(--crimson-hi)">Failed to load — ' + esc(String(err)) + '</div>';
      });
  }

  function renderMonsterList(monsters) {
    var $list = document.getElementById('bestiary-list');
    if (!monsters.length) { $list.innerHTML = '<div class="bestiary-loading">No monsters found.</div>'; return; }

    var PAGE = 80;
    var visible = monsters.slice(0, PAGE);
    var html = visible.map(function(m) {
      return '<div class="monster-row" data-name="' + esc(m.name) + '" tabindex="0" role="button" aria-label="' + esc(m.name) + '">'
        + '<span class="monster-row__name">' + esc(m.name) + '</span>'
        + '<span class="monster-row__type">' + esc(fmtType(m.type)) + '</span>'
        + '<span class="monster-row__cr">CR ' + esc(fmtCR(m.cr)) + '</span>'
        + '</div>';
    }).join('');

    if (monsters.length > PAGE) {
      html += '<button class="load-more-btn" data-offset="' + PAGE + '">Load more (' + (monsters.length - PAGE) + ' remaining)</button>';
    }

    $list.innerHTML = html;
    bindMonsterRows($list, monsters, 0);

    var $lm = $list.querySelector('.load-more-btn');
    if ($lm) {
      $lm.addEventListener('click', function() {
        var offset = parseInt($lm.dataset.offset);
        var next   = monsters.slice(offset, offset + PAGE);
        var newHtml = next.map(function(m) {
          return '<div class="monster-row" data-name="' + esc(m.name) + '" tabindex="0" role="button">'
            + '<span class="monster-row__name">' + esc(m.name) + '</span>'
            + '<span class="monster-row__type">' + esc(fmtType(m.type)) + '</span>'
            + '<span class="monster-row__cr">CR ' + esc(fmtCR(m.cr)) + '</span>'
            + '</div>';
        }).join('');
        var newOffset = offset + PAGE;
        if (newOffset < monsters.length) {
          newHtml += '<button class="load-more-btn" data-offset="' + newOffset + '">Load more (' + (monsters.length - newOffset) + ' remaining)</button>';
        }
        $lm.insertAdjacentHTML('beforebegin', newHtml);
        bindMonsterRows($list, monsters, offset);
        $lm.remove();
        var newBtn = $list.querySelector('.load-more-btn');
        if (newBtn) newBtn.addEventListener('click', arguments.callee);
      });
    }
  }

  function bindMonsterRows($list, monsters, offset) {
    var rows = $list.querySelectorAll('.monster-row:not([data-bound])');
    rows.forEach(function(row) {
      row.dataset.bound = '1';
      row.addEventListener('click', function() {
        var name = row.dataset.name;
        var m = monsters.find(function(x) { return x.name === name; });
        if (m) showStatBlock(m);
      });
      row.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          var name = row.dataset.name;
          var m = monsters.find(function(x) { return x.name === name; });
          if (m) showStatBlock(m);
        }
      });
    });
  }

  // Bestiary filter state
  var _bfCRMin  = 0;
  var _bfCRMax  = 30;
  var _bfTypes  = []; // empty = all
  var _bfSizes  = []; // empty = all

  var CREATURE_TYPES = ['aberration','beast','celestial','construct','dragon','elemental',
                        'fey','fiend','giant','humanoid','monstrosity','ooze','plant','undead'];
  var CREATURE_SIZES = ['Tiny','Small','Medium','Large','Huge','Gargantuan'];

  function crToNum(cr) {
    if (!cr) return 0;
    if (typeof cr === 'object') cr = cr.cr || '0';
    if (cr === '1/8') return 0.125;
    if (cr === '1/4') return 0.25;
    if (cr === '1/2') return 0.5;
    return parseFloat(cr) || 0;
  }

  function applyBestiaryFilters() {
    var q = (document.getElementById('bestiary-search') || {}).value || '';
    q = q.toLowerCase().trim();
    var filtered = state.bestiary.monsters.filter(function(m) {
      if (q && !m.name.toLowerCase().includes(q)) return false;
      var cr = crToNum(m.cr);
      if (cr < _bfCRMin || cr > _bfCRMax) return false;
      if (_bfTypes.length) {
        var t = typeof m.type === 'string' ? m.type : (m.type && m.type.type) || '';
        if (!_bfTypes.includes(t.toLowerCase())) return false;
      }
      if (_bfSizes.length) {
        var sz = Array.isArray(m.size) ? m.size[0] : (m.size || '');
        var sizeMap = { T:'Tiny', S:'Small', M:'Medium', L:'Large', H:'Huge', G:'Gargantuan' };
        sz = sizeMap[sz] || sz;
        if (!_bfSizes.includes(sz)) return false;
      }
      return true;
    });
    state.bestiary.filtered = filtered;
    renderMonsterList(filtered);
  }

  function initBestiarySearch() {
    var $search = document.getElementById('bestiary-search');
    if ($search) {
      $search.addEventListener('input', applyBestiaryFilters);
    }

    // Advanced filter panel — injected below source pills
    var $advCont = document.getElementById('bestiary-adv-filters');
    if (!$advCont) return;

    // CR range
    var crHTML = '<div class="bfilt-row">'
      + '<label class="bfilt-label">CR</label>'
      + '<input class="bfilt-range" type="number" id="bf-cr-min" min="0" max="30" value="0" placeholder="0" title="Min CR" />'
      + '<span class="bfilt-sep">–</span>'
      + '<input class="bfilt-range" type="number" id="bf-cr-max" min="0" max="30" value="30" placeholder="30" title="Max CR" />'
      + '</div>';

    // Type pills
    var typeHTML = '<div class="bfilt-row bfilt-row--wrap">'
      + '<label class="bfilt-label">Type</label>'
      + CREATURE_TYPES.map(function(t) {
          return '<button class="bfilt-pill" data-btype="' + t + '">' + t.charAt(0).toUpperCase() + t.slice(0,4) + '</button>';
        }).join('')
      + '</div>';

    // Size pills
    var sizeHTML = '<div class="bfilt-row bfilt-row--wrap">'
      + '<label class="bfilt-label">Size</label>'
      + CREATURE_SIZES.map(function(s) {
          return '<button class="bfilt-pill" data-bsize="' + s + '">' + s.slice(0,3) + '</button>';
        }).join('')
      + '<button class="bfilt-clear">✕ Clear</button>'
      + '</div>';

    $advCont.innerHTML = crHTML + typeHTML + sizeHTML;

    // CR range inputs
    var $crMin = document.getElementById('bf-cr-min');
    var $crMax = document.getElementById('bf-cr-max');
    if ($crMin) $crMin.addEventListener('input', function() { _bfCRMin = parseFloat($crMin.value) || 0; applyBestiaryFilters(); });
    if ($crMax) $crMax.addEventListener('input', function() { _bfCRMax = parseFloat($crMax.value) || 30; applyBestiaryFilters(); });

    // Type toggle pills
    $advCont.querySelectorAll('[data-btype]').forEach(function(pill) {
      pill.addEventListener('click', function() {
        var t = pill.dataset.btype;
        var i = _bfTypes.indexOf(t);
        if (i === -1) { _bfTypes.push(t); pill.classList.add('bfilt-pill--active'); }
        else          { _bfTypes.splice(i,1); pill.classList.remove('bfilt-pill--active'); }
        applyBestiaryFilters();
      });
    });

    // Size toggle pills
    $advCont.querySelectorAll('[data-bsize]').forEach(function(pill) {
      pill.addEventListener('click', function() {
        var s = pill.dataset.bsize;
        var i = _bfSizes.indexOf(s);
        if (i === -1) { _bfSizes.push(s); pill.classList.add('bfilt-pill--active'); }
        else          { _bfSizes.splice(i,1); pill.classList.remove('bfilt-pill--active'); }
        applyBestiaryFilters();
      });
    });

    // Clear button
    var $clr = $advCont.querySelector('.bfilt-clear');
    if ($clr) $clr.addEventListener('click', function() {
      _bfCRMin = 0; _bfCRMax = 30; _bfTypes = []; _bfSizes = [];
      if ($crMin) $crMin.value = '0';
      if ($crMax) $crMax.value = '30';
      $advCont.querySelectorAll('.bfilt-pill--active').forEach(function(p) { p.classList.remove('bfilt-pill--active'); });
      if ($search) $search.value = '';
      applyBestiaryFilters();
    });
  }

  function showStatBlock(m) {
    document.querySelectorAll('.monster-row').forEach(function(r) {
      r.classList.toggle('monster-row--active', r.dataset.name === m.name);
    });

    var $panel = document.getElementById('stat-block-panel');
    if (!$panel) return;

    var abs = ['str','dex','con','int','wis','cha'];
    var abilityHTML = abs.map(function(a) {
      return '<div class="stat-block__ability">'
        + '<span class="stat-block__ability-name">' + a.toUpperCase() + '</span>'
        + '<span class="stat-block__ability-score">' + (m[a] ?? '—') + '</span>'
        + '<span class="stat-block__ability-mod">' + (m[a] != null ? mod(m[a]) : '') + '</span>'
        + '</div>';
    }).join('');

    var hp = m.hp ? (m.hp.average + ' (' + m.hp.formula + ')') : '—';

    var ac = Array.isArray(m.ac)
      ? m.ac.map(function(a) {
          if (typeof a === 'number') return String(a);
          var s = String(a.ac || '');
          if (a.from) s += ' (' + a.from.map(tag).join(', ') + ')';
          return s;
        }).join(', ')
      : String(m.ac || '—');

    var speed = m.speed
      ? Object.entries(m.speed).map(function(e) {
          return (e[0] === 'walk' ? '' : e[0] + ' ') + e[1] + ' ft.';
        }).join(', ')
      : '—';

    function listProp(obj) {
      return obj ? Object.entries(obj).map(function(e) { return e[0].toUpperCase() + ' ' + e[1]; }).join(', ') : null;
    }

    function fmtDmgArr(arr) {
      if (!arr || !arr.length) return null;
      return arr.map(function(d) {
        if (typeof d === 'string') return d;
        if (d.special) return d.special;
        if (Array.isArray(d)) return d.join(', ');
        return '';
      }).filter(Boolean).join('; ');
    }

    var saves   = listProp(m.save);
    var skills  = listProp(m.skill);
    var immune  = fmtDmgArr(m.immune);
    var resist  = fmtDmgArr(m.resist);
    var vuln    = fmtDmgArr(m.vulnerable);
    var condImm = m.conditionImmune
      ? m.conditionImmune.map(function(c) { return typeof c === 'string' ? c : (c.conditionImmune || ''); }).join(', ')
      : null;

    var senses = [
      m.senses ? (Array.isArray(m.senses) ? m.senses.join(', ') : m.senses) : null,
      'passive Perception ' + (m.passive || '?')
    ].filter(Boolean).join(', ');

    var langs = Array.isArray(m.languages) ? m.languages.join(', ') : (m.languages || '—');

    var ALIGN = { L:'Lawful', N:'Neutral', C:'Chaotic', G:'Good', E:'Evil', U:'Unaligned', A:'Any' };
    var align = Array.isArray(m.alignment)
      ? m.alignment.map(function(a) { return ALIGN[a] || a; }).join(' ')
      : (m.alignment || '');

    function renderActions(list) {
      return (list || []).map(function(a) {
        var text = (a.entries || []).map(function(e) {
          return typeof e === 'string' ? esc(tag(e)) : esc(tag(JSON.stringify(e)));
        }).join(' ');
        var hasHit  = (a.entries || []).join(' ').includes('{@hit');
        var hasDmg  = (a.entries || []).join(' ').includes('{@damage');
        var rollBtn = (hasHit || hasDmg)
          ? '<button class="stat-block__roll-btn" data-action="' + esc(a.name) + '">&#9858; Roll</button>'
          : '';
        return '<p class="stat-block__action"><span class="stat-block__action-name">' + esc(a.name) + '.</span> ' + text + rollBtn + '</p>';
      }).join('');
    }

    function propLine(label, val) {
      return val ? '<p class="stat-block__stat-line"><strong>' + label + '</strong> ' + esc(val) + '</p>' : '';
    }

    $panel.innerHTML =
      '<div class="stat-block">'
      + '<div class="stat-block__name">' + esc(m.name) + '</div>'
      + '<div class="stat-block__meta">' + esc((m.size || '') + ' ' + fmtType(m.type) + ', ' + align) + '</div>'
      + '<hr class="stat-block__divider">'
      + propLine('Armor Class', ac)
      + propLine('Hit Points', hp)
      + propLine('Speed', speed)
      + '<hr class="stat-block__divider">'
      + '<div class="stat-block__ability-row">' + abilityHTML + '</div>'
      + '<hr class="stat-block__divider">'
      + propLine('Saving Throws', saves)
      + propLine('Skills', skills)
      + propLine('Damage Immunities', immune)
      + propLine('Damage Resistances', resist)
      + propLine('Damage Vulnerabilities', vuln)
      + propLine('Condition Immunities', condImm)
      + propLine('Senses', senses)
      + propLine('Languages', langs)
      + propLine('Challenge', fmtCR(m.cr))
      + (m.trait ? '<hr class="stat-block__divider">' + renderActions(m.trait) : '')
      + (m.action ? '<hr class="stat-block__divider"><h4 class="stat-block__action-head">Actions</h4>' + renderActions(m.action) : '')
      + (m.bonus  ? '<h4 class="stat-block__action-head">Bonus Actions</h4>' + renderActions(m.bonus)  : '')
      + (m.reaction ? '<h4 class="stat-block__action-head">Reactions</h4>' + renderActions(m.reaction) : '')
      + (m.legendary ? '<h4 class="stat-block__action-head">Legendary Actions</h4>' + renderActions(m.legendary) : '')
      + '<div class="stat-block__actions">'
      + '<button class="stat-block__add-btn" data-monster="' + esc(m.name) + '">+ Add to Encounter</button>'
      + '<button class="stat-block__fav-btn">☆ Favourite</button>'
      + '<button class="stat-block__ask-btn" data-monster="' + esc(m.name) + '" data-cr="' + esc(fmtCR(m.cr)) + '">◈ Ask Oracle</button>'
      + '</div></div>';

    $panel.querySelectorAll('.stat-block__roll-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { rollFromAction(btn.dataset.action, m); });
    });

    var $askBtn = $panel.querySelector('.stat-block__ask-btn');
    if ($askBtn) $askBtn.addEventListener('click', function() {
      var name = $askBtn.dataset.monster;
      var cr   = $askBtn.dataset.cr;
      var prompt = 'What tactics should I use as a DM for ' + name + ' (CR ' + cr + ')? Include key abilities, action economy, and encounter tips.';
      activateModule('oracle');
      var $field = document.getElementById('oracle-field');
      if ($field) { $field.value = prompt; $field.focus(); }
    });
  }

  function rollFromAction(actionName, monster) {
    var action = (monster.action || monster.trait || []).find(function(a) { return a.name === actionName; });
    if (!action) return;
    var text  = (action.entries || []).join(' ');
    var hitM  = text.match(/\{@hit (-?\d+)\}/);
    var dmgM  = text.match(/\{@damage ([^}]+)\}/);

    function parseDice(formula) {
      var total = 0, sign = 1;
      formula.replace(/\s/g,'').split(/([+-])/).forEach(function(p) {
        if (p === '+') { sign =  1; return; }
        if (p === '-') { sign = -1; return; }
        var m = p.match(/^(\d+)d(\d+)$/);
        if (m) {
          for (var i = 0; i < parseInt(m[1]); i++)
            total += sign * (Math.floor(Math.random() * parseInt(m[2])) + 1);
        } else { total += sign * (parseInt(p) || 0); }
      });
      return total;
    }

    if (hitM) {
      var d20    = Math.floor(Math.random() * 20) + 1;
      var bonus  = parseInt(hitM[1]);
      var total  = d20 + bonus;
      var flag   = d20 === 20 ? ' — CRIT!' : d20 === 1 ? ' — FUMBLE' : '';
      var dmgStr = dmgM ? ' | Dmg: ' + parseDice(dmgM[1]) : '';
      showToast(actionName + ': ' + total + ' to hit (d20:' + d20 + ' ' + (bonus >= 0 ? '+' : '') + bonus + ')' + dmgStr + flag);
    } else if (dmgM) {
      showToast(actionName + ': ' + parseDice(dmgM[1]) + ' damage');
    }
  }

  // ══════════════════════════════════════════════════════════
  // SPELLBOOK — surgical single-source loading
  // ══════════════════════════════════════════════════════════

  function initSpellbook() {
    var $filters = document.getElementById('spell-filters');
    if ($filters) {
      var pills = Object.keys(SPELL_SOURCES).map(function(key) {
        var src = SPELL_SOURCES[key];
        return '<button class="filter-pill source-pill' + (key === 'PHB' ? ' filter-pill--active' : '') + '" data-source="' + key + '" title="' + esc(src.label) + '">'
          + esc(key) + ' <span class="pill-count">' + src.count + '</span></button>';
      }).join('');
      $filters.innerHTML = pills;

      $filters.querySelectorAll('.source-pill').forEach(function(pill) {
        pill.addEventListener('click', function() {
          $filters.querySelectorAll('.source-pill').forEach(function(p) { p.classList.remove('filter-pill--active'); });
          pill.classList.add('filter-pill--active');
          loadSpellSource(pill.dataset.source);
        });
      });
    }

    loadSpellSource('PHB');
    initSpellSearch();
  }

  function loadSpellSource(sourceKey) {
    state.spells.activeSource = sourceKey;
    var src   = SPELL_SOURCES[sourceKey];
    var $list = document.getElementById('spell-list');
    var $panel= document.getElementById('spell-detail-panel');
    if (!$list || !src) return;

    $list.innerHTML  = '<div class="bestiary-loading"><span class="loading-dot"></span> Loading ' + esc(src.label) + '…</div>';
    $panel.innerHTML = '<div class="stat-block-empty">Select a spell to view its description.</div>';

    fetch('/dndm/assets/data/5etools/spells/' + src.file)
      .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function(d) {
        var spells = (d.spell || []).slice().sort(function(a, b) {
          if (a.level !== b.level) return a.level - b.level;
          return a.name.localeCompare(b.name);
        });
        state.spells.spells   = spells;
        state.spells.loaded   = true;
        state.spells.filtered = spells;
        renderSpellList(spells);
      })
      .catch(function(err) {
        $list.innerHTML = '<div class="bestiary-loading" style="color:var(--crimson-hi)">Failed to load — ' + esc(String(err)) + '</div>';
      });
  }

  function renderSpellList(spells) {
    var $list = document.getElementById('spell-list');
    if (!spells.length) { $list.innerHTML = '<div class="bestiary-loading">No spells found.</div>'; return; }

    $list.innerHTML = spells.map(function(s) {
      var lvl    = s.level === 0 ? 'Cantrip' : 'Lvl ' + s.level;
      var school = SCHOOLS[s.school] || s.school || '';
      return '<div class="monster-row" data-name="' + esc(s.name) + '" tabindex="0" role="button" aria-label="' + esc(s.name) + '">'
        + '<span class="monster-row__name">' + esc(s.name) + '</span>'
        + '<span class="monster-row__type">' + esc(school) + '</span>'
        + '<span class="monster-row__cr">' + esc(lvl) + '</span>'
        + '</div>';
    }).join('');

    $list.querySelectorAll('.monster-row').forEach(function(row) {
      row.addEventListener('click', function() {
        var name = row.dataset.name;
        var s = spells.find(function(x) { return x.name === name; });
        if (s) showSpellDetail(s);
      });
      row.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          var name = row.dataset.name;
          var s = spells.find(function(x) { return x.name === name; });
          if (s) showSpellDetail(s);
        }
      });
    });
  }

  var SPELL_SCHOOLS_LIST  = ['Abjuration','Conjuration','Divination','Enchantment','Evocation','Illusion','Necromancy','Transmutation'];
  var SPELL_CLASSES_LIST  = ['Bard','Cleric','Druid','Paladin','Ranger','Sorcerer','Warlock','Wizard'];
  var _sfLevels = []; // empty = all; 0=cantrip, 1-9
  var _sfSchools= []; // empty = all (full name)
  var _sfConc   = false;
  var _sfRitual = false;
  var _sfClasses= []; // empty = all

  function applySpellFilters() {
    var q = (document.getElementById('spell-search') || {}).value || '';
    q = q.toLowerCase().trim();
    var filtered = state.spells.spells.filter(function(s) {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      if (_sfLevels.length && !_sfLevels.includes(s.level)) return false;
      if (_sfSchools.length) {
        var sn = SCHOOLS[s.school] || s.school || '';
        if (!_sfSchools.includes(sn)) return false;
      }
      if (_sfConc) {
        var isConc = (s.duration || []).some(function(d) { return d.concentration; });
        if (!isConc) return false;
      }
      if (_sfRitual) {
        if (!s.meta || !s.meta.ritual) return false;
      }
      if (_sfClasses.length) {
        var classes = (s.classes && s.classes.fromClassList)
          ? s.classes.fromClassList.map(function(c) { return c.name; })
          : [];
        if (!_sfClasses.some(function(cl) { return classes.includes(cl); })) return false;
      }
      return true;
    });
    state.spells.filtered = filtered;
    renderSpellList(filtered);
  }

  function initSpellSearch() {
    var $search = document.getElementById('spell-search');
    if ($search) $search.addEventListener('input', applySpellFilters);

    var $advCont = document.getElementById('spell-adv-filters');
    if (!$advCont) return;

    // Level pills: C 1 2 3 4 5 6 7 8 9
    var levelPills = '<div class="bfilt-row bfilt-row--wrap">'
      + '<label class="bfilt-label">Level</label>'
      + '<button class="bfilt-pill" data-slevel="0">Cantrip</button>'
      + [1,2,3,4,5,6,7,8,9].map(function(l) {
          return '<button class="bfilt-pill" data-slevel="' + l + '">' + l + '</button>';
        }).join('')
      + '</div>';

    // School pills
    var schoolPills = '<div class="bfilt-row bfilt-row--wrap">'
      + '<label class="bfilt-label">School</label>'
      + SPELL_SCHOOLS_LIST.map(function(sc) {
          return '<button class="bfilt-pill" data-sschool="' + sc + '">' + sc.slice(0,4) + '</button>';
        }).join('')
      + '</div>';

    // Toggle rows
    var toggleRow = '<div class="bfilt-row">'
      + '<label class="bfilt-label">Filter</label>'
      + '<button class="bfilt-pill" id="sf-conc">Conc.</button>'
      + '<button class="bfilt-pill" id="sf-ritual">Ritual</button>'
      + '</div>';

    // Class pills
    var classPills = '<div class="bfilt-row bfilt-row--wrap">'
      + '<label class="bfilt-label">Class</label>'
      + SPELL_CLASSES_LIST.map(function(cl) {
          return '<button class="bfilt-pill" data-sclass="' + cl + '">' + cl.slice(0,3) + '</button>';
        }).join('')
      + '<button class="bfilt-clear">✕ Clear</button>'
      + '</div>';

    $advCont.innerHTML = levelPills + schoolPills + toggleRow + classPills;

    // Level pills
    $advCont.querySelectorAll('[data-slevel]').forEach(function(pill) {
      pill.addEventListener('click', function() {
        var lv = parseInt(pill.dataset.slevel);
        var i  = _sfLevels.indexOf(lv);
        if (i === -1) { _sfLevels.push(lv); pill.classList.add('bfilt-pill--active'); }
        else          { _sfLevels.splice(i,1); pill.classList.remove('bfilt-pill--active'); }
        applySpellFilters();
      });
    });

    // School pills
    $advCont.querySelectorAll('[data-sschool]').forEach(function(pill) {
      pill.addEventListener('click', function() {
        var sc = pill.dataset.sschool;
        var i  = _sfSchools.indexOf(sc);
        if (i === -1) { _sfSchools.push(sc); pill.classList.add('bfilt-pill--active'); }
        else          { _sfSchools.splice(i,1); pill.classList.remove('bfilt-pill--active'); }
        applySpellFilters();
      });
    });

    // Conc / Ritual toggles
    var $sfConc = document.getElementById('sf-conc');
    var $sfRit  = document.getElementById('sf-ritual');
    if ($sfConc) $sfConc.addEventListener('click', function() {
      _sfConc = !_sfConc;
      $sfConc.classList.toggle('bfilt-pill--active', _sfConc);
      applySpellFilters();
    });
    if ($sfRit) $sfRit.addEventListener('click', function() {
      _sfRitual = !_sfRitual;
      $sfRit.classList.toggle('bfilt-pill--active', _sfRitual);
      applySpellFilters();
    });

    // Class pills
    $advCont.querySelectorAll('[data-sclass]').forEach(function(pill) {
      pill.addEventListener('click', function() {
        var cl = pill.dataset.sclass;
        var i  = _sfClasses.indexOf(cl);
        if (i === -1) { _sfClasses.push(cl); pill.classList.add('bfilt-pill--active'); }
        else          { _sfClasses.splice(i,1); pill.classList.remove('bfilt-pill--active'); }
        applySpellFilters();
      });
    });

    // Clear
    var $clr = $advCont.querySelector('.bfilt-clear');
    if ($clr) $clr.addEventListener('click', function() {
      _sfLevels = []; _sfSchools = []; _sfConc = false; _sfRitual = false; _sfClasses = [];
      $advCont.querySelectorAll('.bfilt-pill--active').forEach(function(p) { p.classList.remove('bfilt-pill--active'); });
      if ($search) $search.value = '';
      applySpellFilters();
    });
  }

  function showSpellDetail(s) {
    document.querySelectorAll('#spell-list .monster-row').forEach(function(r) {
      r.classList.toggle('monster-row--active', r.dataset.name === s.name);
    });

    var $panel = document.getElementById('spell-detail-panel');
    if (!$panel) return;

    function fmtTime(time) {
      return (time || []).map(function(t) {
        return t.number + ' ' + t.unit + (t.condition ? ' (' + t.condition + ')' : '');
      }).join(', ') || '—';
    }

    function fmtRange(r) {
      if (!r) return '—';
      if (r.type === 'special') return 'Special';
      if (r.type === 'point') {
        var d = r.distance || {};
        if (d.type === 'self')      return 'Self';
        if (d.type === 'touch')     return 'Touch';
        if (d.type === 'sight')     return 'Sight';
        if (d.type === 'unlimited') return 'Unlimited';
        return (d.amount || '') + ' ' + (d.type || '');
      }
      var d2 = r.distance || {};
      if (d2.amount) return 'Self (' + d2.amount + '-' + d2.type + ' ' + r.type + ')';
      return r.type;
    }

    function fmtComp(c) {
      if (!c) return '—';
      var p = [];
      if (c.v) p.push('V');
      if (c.s) p.push('S');
      if (c.m) p.push('M (' + (typeof c.m === 'string' ? c.m : (c.m.text || 'material')) + ')');
      return p.join(', ');
    }

    function fmtDur(dur) {
      return (dur || []).map(function(d) {
        if (d.type === 'instant')   return 'Instantaneous';
        if (d.type === 'permanent') return 'Until dispelled';
        if (d.type === 'special')   return 'Special';
        if (d.duration) {
          var amt = d.duration.amount, unit = d.duration.type;
          return (d.concentration ? 'Concentration, up to ' : '') + amt + ' ' + unit + (amt !== 1 ? 's' : '');
        }
        return d.type || '';
      }).join(', ') || '—';
    }

    var level  = s.level === 0 ? 'Cantrip' : s.level + ordinal(s.level) + '-level';
    var school = SCHOOLS[s.school] || s.school || '';
    var isConc = (s.duration || []).some(function(d) { return d.concentration; });
    var isRit  = s.meta && s.meta.ritual;

    var tags = (isConc ? '<span class="spell-tag spell-tag--conc">Concentration</span>' : '')
             + (isRit  ? '<span class="spell-tag spell-tag--ritual">Ritual</span>' : '');

    var entries = (s.entries || []).map(renderEntry).join('');
    var higher  = s.entriesHigherLevel
      ? '<div class="spell-higher"><p class="spell-higher__label">At Higher Levels.</p>' + (s.entriesHigherLevel || []).map(renderEntry).join('') + '</div>'
      : '';

    $panel.innerHTML =
      '<div class="stat-block spell-block">'
      + '<div class="stat-block__name">' + esc(s.name) + '</div>'
      + '<div class="stat-block__meta">' + esc(level) + ' ' + esc(school) + tags + '</div>'
      + '<hr class="stat-block__divider">'
      + '<p class="stat-block__stat-line"><strong>Casting Time</strong> ' + esc(fmtTime(s.time)) + '</p>'
      + '<p class="stat-block__stat-line"><strong>Range</strong> '        + esc(fmtRange(s.range)) + '</p>'
      + '<p class="stat-block__stat-line"><strong>Components</strong> '   + esc(fmtComp(s.components)) + '</p>'
      + '<p class="stat-block__stat-line"><strong>Duration</strong> '     + esc(fmtDur(s.duration)) + '</p>'
      + '<hr class="stat-block__divider">'
      + '<div class="spell-entries">' + entries + '</div>'
      + higher
      + '<div class="stat-block__actions">'
      + '<button class="stat-block__ask-btn" data-spell="' + esc(s.name) + '" data-level="' + s.level + '">◈ Ask Oracle</button>'
      + '</div>'
      + '</div>';

    var $askSpell = $panel.querySelector('.stat-block__ask-btn');
    if ($askSpell) $askSpell.addEventListener('click', function() {
      var name  = $askSpell.dataset.spell;
      var lvl   = parseInt($askSpell.dataset.level) === 0 ? 'cantrip' : $askSpell.dataset.level + ordinal(parseInt($askSpell.dataset.level)) + '-level spell';
      var prompt = 'Explain ' + name + ' (' + lvl + ') — how it works, common rulings, creative uses, and things a DM should know.';
      activateModule('oracle');
      var $field = document.getElementById('oracle-field');
      if ($field) { $field.value = prompt; $field.focus(); }
    });
  }

  function ordinal(n) {
    var s = ['th','st','nd','rd'];
    var v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }

  // ══════════════════════════════════════════════════════════
  // CHEATSHEET — conditions + actions (single fetch each)
  // ══════════════════════════════════════════════════════════

  function initCheatsheet() {
    var $cs = document.getElementById('cheatsheet-content');
    if (!$cs) return;
    $cs.innerHTML = '<div class="bestiary-loading"><span class="loading-dot"></span> Loading reference data…</div>';

    Promise.all([
      fetch('/dndm/assets/data/5etools/conditionsdiseases.json').then(function(r) { return r.json(); }),
      fetch('/dndm/assets/data/5etools/actions.json').then(function(r) { return r.json(); })
    ]).then(function(results) {
      var conds   = results[0].condition || [];
      var actions = results[1].action    || [];
      state.conditionsLoaded = true;

      var condsHTML = conds.filter(function(c) { return c.entries; }).map(function(c) {
        var items = [];
        (c.entries || []).forEach(function(e) {
          if (typeof e === 'string') items.push(e);
          else if (e.type === 'list') items = items.concat(e.items || []);
          else if (e.entries) items = items.concat(e.entries.filter(function(x) { return typeof x === 'string'; }));
        });
        return '<div class="cs-entry">'
          + '<div class="cs-entry__name">' + esc(c.name) + '</div>'
          + '<ul class="cs-entry__list">' + items.map(function(i) {
              return '<li>' + esc(tag(typeof i === 'string' ? i : '')) + '</li>';
            }).join('') + '</ul>'
          + '</div>';
      }).join('');

      var actsHTML = actions.filter(function(a) { return a.entries; }).map(function(a) {
        return '<div class="cs-entry">'
          + '<div class="cs-entry__name">' + esc(a.name) + '</div>'
          + '<div class="cs-entry__body">' + (a.entries || []).map(renderEntry).join('') + '</div>'
          + '</div>';
      }).join('');

      $cs.innerHTML =
        '<div class="cs-cols">'
        + '<div class="cs-col"><h3 class="cs-section-title">CONDITIONS</h3>' + condsHTML + '</div>'
        + '<div class="cs-col"><h3 class="cs-section-title">COMBAT ACTIONS</h3>' + actsHTML + '</div>'
        + '</div>';
    }).catch(function(err) {
      $cs.innerHTML = '<div class="bestiary-loading" style="color:var(--crimson-hi)">Failed to load: ' + esc(String(err)) + '</div>';
    });
  }

  // ══════════════════════════════════════════════════════════
  // DICE VAULT
  // ══════════════════════════════════════════════════════════

  function parseDice(formula) {
    var total = 0, sign = 1;
    String(formula).replace(/\s/g,'').split(/([+-])/).forEach(function(p) {
      if (p === '+') { sign =  1; return; }
      if (p === '-') { sign = -1; return; }
      var m = p.match(/^(\d+)d(\d+)$/);
      if (m) {
        for (var i = 0; i < parseInt(m[1]); i++)
          total += sign * (Math.floor(Math.random() * parseInt(m[2])) + 1);
      } else { total += sign * (parseInt(p) || 0); }
    });
    return total;
  }

  function drawDie(canvas, sides, value) {
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var cx = W / 2, cy = H / 2 - 10;
    var r = 85;
    ctx.clearRect(0, 0, W, H);

    var bg = ctx.createRadialGradient(cx, cy, 10, cx, cy, 180);
    bg.addColorStop(0, 'rgba(139,26,26,0.1)');
    bg.addColorStop(1, 'rgba(10,7,5,0)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Polygon shape
    var pts = sides === 4 ? 3 : sides === 6 ? 4 : 6;
    var rot = sides === 4 ? -Math.PI/2 : sides === 6 ? Math.PI/4 : -Math.PI/2;
    ctx.shadowColor = 'rgba(196,146,42,0.25)'; ctx.shadowBlur = 20;
    ctx.beginPath();
    for (var i = 0; i < pts; i++) {
      var a = (i / pts) * Math.PI * 2 + rot;
      i === 0 ? ctx.moveTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r)
              : ctx.lineTo(cx + Math.cos(a)*r, cy + Math.sin(a)*r);
    }
    ctx.closePath();

    var fill = ctx.createRadialGradient(cx-15, cy-15, 4, cx, cy, r);
    fill.addColorStop(0, '#1C0A0A'); fill.addColorStop(1, '#0A0705');
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = value === sides ? 'rgba(232,184,75,0.7)' : value === 1 ? 'rgba(196,43,43,0.7)' : 'rgba(196,146,42,0.4)';
    ctx.lineWidth = 1.5; ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.font = 'bold ' + (sides <= 6 ? 56 : 52) + 'px Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = value === sides ? 'rgba(232,184,75,0.95)'
                  : value === 1     ? 'rgba(196,43,43,0.9)'
                  : 'rgba(232,223,207,0.85)';
    ctx.fillText(String(value), cx, cy);

    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(154,142,122,0.35)';
    ctx.textAlign = 'right';
    ctx.fillText('d' + sides, W - 10, H - 10);
  }

  function showDiceResult(sides, rolls, mod, label) {
    var sum = rolls.reduce(function(a,b){return a+b;},0) + mod;
    var $num   = document.getElementById('dice-result-num');
    var $lbl   = document.getElementById('dice-result-label');
    var canvas = document.getElementById('dice-canvas');

    if ($num) {
      $num.style.transition = 'none';
      $num.style.opacity    = '0';
      $num.style.transform  = 'scale(1.5)';
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          $num.style.transition = 'opacity 0.2s ease, transform 0.25s ease';
          $num.style.opacity    = '1';
          $num.style.transform  = 'scale(1)';
          $num.textContent      = sum;
          $num.style.color      = rolls.includes(sides) ? 'var(--gold-hi)'
                                : rolls.includes(1)     ? 'var(--crimson-hi)'
                                : 'var(--bone)';
        });
      });
    }

    if ($lbl) $lbl.textContent = label || (rolls.length + 'd' + sides + (mod ? (mod>0?'+':'')+mod : '') + (rolls.length > 1 ? ' ('+rolls.join('+')+')' : ''));
    drawDie(canvas, sides, rolls[0]);

    // History
    state.diceHistory.unshift({ sides: sides, rolls: rolls, mod: mod, sum: sum });
    if (state.diceHistory.length > 10) state.diceHistory.pop();

    var $hist = document.getElementById('dice-history');
    if ($hist) {
      $hist.innerHTML = state.diceHistory.map(function(h) {
        var isCrit = h.rolls.includes(h.sides);
        var isFail = h.rolls.includes(1);
        var cls    = isCrit ? 'roll-crit' : isFail ? 'roll-fail' : 'roll-val';
        var mods   = h.mod ? (h.mod > 0 ? '+' : '') + h.mod : '';
        return '<li class="dice-history__entry">'
          + '<span>' + h.rolls.length + 'd' + h.sides + mods + '</span>'
          + '<span class="' + cls + '">' + h.sum + '</span>'
          + '</li>';
      }).join('');
    }
  }

  document.querySelectorAll('.die-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var sides = parseInt(btn.dataset.die);
      var m     = parseInt(document.getElementById('dice-mod').value) || 0;
      var roll  = Math.floor(Math.random() * sides) + 1;
      showDiceResult(sides, [roll], m, null);
    });
  });

  var $advBtn = document.getElementById('adv-btn');
  var $disBtn = document.getElementById('dis-btn');

  if ($advBtn) $advBtn.addEventListener('click', function() {
    var r1 = Math.floor(Math.random()*20)+1, r2 = Math.floor(Math.random()*20)+1;
    var m  = parseInt(document.getElementById('dice-mod').value) || 0;
    var hi = Math.max(r1, r2);
    showDiceResult(20, [hi, Math.min(r1,r2)], m, 'Advantage ['+r1+','+r2+'] → '+hi+(m?(m>0?'+':'')+m:''));
  });

  if ($disBtn) $disBtn.addEventListener('click', function() {
    var r1 = Math.floor(Math.random()*20)+1, r2 = Math.floor(Math.random()*20)+1;
    var m  = parseInt(document.getElementById('dice-mod').value) || 0;
    var lo = Math.min(r1, r2);
    showDiceResult(20, [lo, Math.max(r1,r2)], m, 'Disadvantage ['+r1+','+r2+'] → '+lo+(m?(m>0?'+':'')+m:''));
  });

  // Initial canvas placeholder
  (function() {
    var canvas = document.getElementById('dice-canvas');
    if (!canvas) return;
    drawDie(canvas, 20, 20);
  })();

  // ══════════════════════════════════════════════════════════
  // PARTY TRACKER
  // ══════════════════════════════════════════════════════════

  var CONDITIONS = [
    'Blinded','Charmed','Deafened','Exhaustion','Frightened',
    'Grappled','Incapacitated','Invisible','Paralyzed','Petrified',
    'Poisoned','Prone','Restrained','Stunned','Unconscious','Concentrating'
  ];

  // Party state — localStorage (persistent; full sheets need to survive tab close)
  var party = [];

  function partyLoad() {
    try {
      var raw = localStorage.getItem('dndm_party');
      if (!raw) raw = sessionStorage.getItem('dndm_party'); // migrate old data
      if (raw) party = JSON.parse(raw);
      // Ensure every PC has the full sheet fields
      party.forEach(function(pc) {
        if (!pc.str)         pc.str         = 10;
        if (!pc.dex)         pc.dex         = 10;
        if (!pc.con)         pc.con         = 10;
        if (!pc.int)         pc.int         = 10;
        if (!pc.wis)         pc.wis         = 10;
        if (!pc.cha)         pc.cha         = 10;
        if (!pc.profBonus)   pc.profBonus   = 2;
        if (!pc.speed)       pc.speed       = 30;
        if (!pc.alignment)   pc.alignment   = '';
        if (!pc.languages)   pc.languages   = '';
        if (!pc.saveProfMap) pc.saveProfMap = {};   // { str: true, dex: false, ... }
        if (!pc.skillProfMap)pc.skillProfMap= {};   // { acrobatics: 1, ... }  1=prof 2=expert
        if (!pc.slotsByLevel)pc.slotsByLevel= {};   // { 1: {max:4,used:1}, ... }
        if (!pc.features)    pc.features    = '';
        if (!pc.equipment)   pc.equipment   = '';
        if (!pc.personality) pc.personality = '';
        if (!pc.bonds)       pc.bonds       = '';
        if (!pc.flaws)       pc.flaws       = '';
        if (!pc.backstory)   pc.backstory   = '';
        if (!pc.level)       pc.level       = 1;
        if (typeof pc.deaths !== 'number') pc.deaths = 0;
      });
    } catch(e) { party = []; }
  }

  function partySave() {
    try { localStorage.setItem('dndm_party', JSON.stringify(party)); } catch(e) {}
  }

  function partyUid() {
    return 'pc_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  }

  partyLoad();
  renderParty();

  function renderParty() {
    var $grid = document.getElementById('party-grid');
    if (!$grid) return;
    var $empty = document.getElementById('party-empty');

    if (!party.length) {
      $grid.innerHTML = '<div class="party-empty" id="party-empty">'
        + '<p class="party-empty__text">No characters yet.</p>'
        + '<button class="party-empty__btn" id="add-character-empty">+ Add First Character</button>'
        + '</div>';
      document.getElementById('add-character-empty').addEventListener('click', openCharModal);
      return;
    }

    $grid.innerHTML = party.map(function(pc) {
      return renderPCCard(pc);
    }).join('');

    party.forEach(function(pc) {
      bindPCCard(pc.id);
    });
  }

  function renderPCCard(pc) {
    var pct     = pc.hpMax > 0 ? Math.max(0, Math.round((pc.hp / pc.hpMax) * 100)) : 0;
    var barCls  = pct === 100 ? 'pc-card__hp-bar--full' : pct <= 25 ? 'pc-card__hp-bar--crit' : pct <= 50 ? 'pc-card__hp-bar--low' : '';
    var isKO    = pc.hp <= 0;
    var isDead  = pc.deaths >= 3;

    var condHTML = pc.conditions.map(function(c) {
      return '<span class="condition-badge" data-cond="' + esc(c) + '" title="Click to remove" data-pcid="' + esc(pc.id) + '">' + esc(c) + '</span>';
    }).join('');
    condHTML += '<button class="condition-badge condition-badge--add" data-pcid="' + esc(pc.id) + '" title="Add condition">+</button>';

    var dsSuccHTML = [0,1,2].map(function(i) {
      return '<span class="death-save' + (i < pc.dsSucc ? ' death-save--success' : '') + '" data-pcid="' + esc(pc.id) + '" data-ds="succ" data-i="' + i + '"></span>';
    }).join('');
    var dsFailHTML = [0,1,2].map(function(i) {
      return '<span class="death-save' + (i < pc.dsFail ? ' death-save--fail' : '') + '" data-pcid="' + esc(pc.id) + '" data-ds="fail" data-i="' + i + '"></span>';
    }).join('');

    return '<div class="pc-card' + (isKO ? ' pc-card--ko' : '') + '" id="pc-card-' + esc(pc.id) + '">'
      + '<button class="pc-card__sheet-btn" data-pcid="' + esc(pc.id) + '" title="Open character sheet" aria-label="Character sheet">◈ SHEET</button>'
      + '<button class="pc-card__remove" data-pcid="' + esc(pc.id) + '" title="Remove character" aria-label="Remove ' + esc(pc.name) + '">×</button>'
      + '<div class="pc-card__header">'
        + '<div class="pc-card__avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div>'
        + '<div class="pc-card__info">'
          + '<div class="pc-card__name">' + esc(pc.name) + '</div>'
          + '<div class="pc-card__meta">' + esc([pc.race, pc.cls].filter(Boolean).join(' · ')) + '</div>'
          + (pc.player ? '<div class="pc-card__player">Player: ' + esc(pc.player) + '</div>' : '')
        + '</div>'
      + '</div>'

      + '<div class="pc-card__hp-section">'
        + '<div class="pc-card__hp-row">'
          + '<span class="pc-card__hp-label">HP</span>'
          + '<span class="pc-card__hp-display" id="hp-display-' + esc(pc.id) + '">' + pc.hp + ' / ' + pc.hpMax + '</span>'
        + '</div>'
        + '<div class="pc-card__hp-bar-bg"><div class="pc-card__hp-bar ' + barCls + '" id="hp-bar-' + esc(pc.id) + '" style="width:' + pct + '%"></div></div>'
        + '<div class="pc-card__hp-input-row">'
          + '<input class="pc-card__hp-input" type="number" placeholder="Amount…" id="hp-input-' + esc(pc.id) + '" min="0" />'
          + '<button class="pc-card__hp-quick pc-card__hp-quick--heal" data-pcid="' + esc(pc.id) + '" data-hpop="heal">Heal</button>'
          + '<button class="pc-card__hp-quick pc-card__hp-quick--dmg"  data-pcid="' + esc(pc.id) + '" data-hpop="dmg">Damage</button>'
        + '</div>'
      + '</div>'

      + (isKO
        ? '<div class="pc-card__death-saves">'
            + '<span class="pc-card__death-label">' + (isDead ? '☠ Dead' : 'Death Saves') + '</span>'
            + '<div class="death-saves__track" title="Successes">' + dsSuccHTML + '</div>'
            + '<div class="death-saves__track" title="Failures">'  + dsFailHTML + '</div>'
          + '</div>'
        : '')

      + '<div class="pc-card__conditions" id="conditions-' + esc(pc.id) + '">' + condHTML + '</div>'

      + '<div class="pc-card__ac-row">'
        + '<span class="pc-card__ac-shield">AC</span>'
        + '<span class="pc-card__ac-val">' + (pc.ac || '—') + '</span>'
        + (pc.initBonus != null ? '<span class="pc-card__ac-shield" style="margin-left:auto">INIT</span><span class="pc-card__ac-val">' + (pc.initBonus >= 0 ? '+' : '') + pc.initBonus + '</span>' : '')
      + '</div>'
      + '</div>';
  }

  function bindPCCard(id) {
    var $card = document.getElementById('pc-card-' + id);
    if (!$card) return;
    var pc = party.find(function(p) { return p.id === id; });
    if (!pc) return;

    // Sheet button
    var $sheetBtn = $card.querySelector('.pc-card__sheet-btn');
    if ($sheetBtn) $sheetBtn.addEventListener('click', function() { openCharSheet(pc.id); });

    // Remove button
    var $rm = $card.querySelector('.pc-card__remove');
    if ($rm) $rm.addEventListener('click', function() {
      if (confirm('Remove ' + pc.name + ' from the party?')) {
        party = party.filter(function(p) { return p.id !== id; });
        partySave();
        renderParty();
      }
    });

    // Heal / Damage buttons
    $card.querySelectorAll('[data-hpop]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var $inp = document.getElementById('hp-input-' + id);
        var amt  = parseInt($inp ? $inp.value : 0) || 0;
        if (amt <= 0) { showToast('Enter an amount first'); return; }
        if (btn.dataset.hpop === 'heal') {
          pc.hp = Math.min(pc.hpMax, pc.hp + amt);
          if (pc.hp > 0) { pc.dsSucc = 0; pc.dsFail = 0; }
          showToast(pc.name + ' healed ' + amt + ' HP → ' + pc.hp);
        } else {
          pc.hp = Math.max(0, pc.hp - amt);
          showToast(pc.name + ' took ' + amt + ' damage → ' + pc.hp + (pc.hp === 0 ? ' (KO!)' : ''));
        }
        if ($inp) $inp.value = '';
        partySave();
        refreshPCCard(pc);
      });
    });

    // Death saves
    $card.querySelectorAll('[data-ds]').forEach(function(dot) {
      dot.addEventListener('click', function() {
        var i    = parseInt(dot.dataset.i);
        var type = dot.dataset.ds;
        if (type === 'succ') pc.dsSucc = pc.dsSucc > i ? pc.dsSucc - 1 : i + 1;
        else                  pc.dsFail = pc.dsFail > i ? pc.dsFail - 1 : i + 1;
        if (pc.dsFail >= 3) showToast(pc.name + ' has died. (' + pc.dsFail + ' failures)');
        if (pc.dsSucc >= 3) { showToast(pc.name + ' is stable!'); pc.hp = 1; pc.dsSucc = 0; pc.dsFail = 0; }
        partySave();
        refreshPCCard(pc);
      });
    });

    // Condition add button
    $card.querySelectorAll('.condition-badge--add').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        showConditionPicker(pc.id, btn);
      });
    });

    // Condition remove
    $card.querySelectorAll('.condition-badge[data-cond]').forEach(function(badge) {
      badge.addEventListener('click', function(e) {
        e.stopPropagation();
        var cond = badge.dataset.cond;
        pc.conditions = pc.conditions.filter(function(c) { return c !== cond; });
        partySave();
        refreshPCCard(pc);
      });
    });
  }

  function refreshPCCard(pc) {
    var $card = document.getElementById('pc-card-' + pc.id);
    if (!$card) return;
    var pct    = pc.hpMax > 0 ? Math.max(0, Math.round((pc.hp / pc.hpMax) * 100)) : 0;
    var barCls = pct === 100 ? 'pc-card__hp-bar--full' : pct <= 25 ? 'pc-card__hp-bar--crit' : pct <= 50 ? 'pc-card__hp-bar--low' : '';
    var isKO   = pc.hp <= 0;

    // Toggle ko class
    $card.classList.toggle('pc-card--ko', isKO);

    // HP display
    var $disp = document.getElementById('hp-display-' + pc.id);
    if ($disp) $disp.textContent = pc.hp + ' / ' + pc.hpMax;

    // HP bar
    var $bar = document.getElementById('hp-bar-' + pc.id);
    if ($bar) { $bar.style.width = pct + '%'; $bar.className = 'pc-card__hp-bar ' + barCls; }

    // Full re-render for conditions + death saves (these involve structural changes)
    var $newCard = document.createElement('div');
    $newCard.innerHTML = renderPCCard(pc);
    var newNode = $newCard.firstElementChild;
    $card.replaceWith(newNode);
    bindPCCard(pc.id);
    renderPartyBar();
  }

  function showConditionPicker(pcId, anchor) {
    // Remove any existing picker
    document.querySelectorAll('.condition-picker').forEach(function(p) { p.remove(); });

    var pc = party.find(function(p) { return p.id === pcId; });
    if (!pc) return;

    var $picker = document.createElement('div');
    $picker.className = 'condition-picker';

    CONDITIONS.forEach(function(cond) {
      if (pc.conditions.includes(cond)) return; // already has it
      var btn = document.createElement('button');
      btn.className = 'condition-picker__option';
      btn.textContent = cond;
      btn.addEventListener('click', function() {
        pc.conditions.push(cond);
        partySave();
        $picker.remove();
        refreshPCCard(pc);
      });
      $picker.appendChild(btn);
    });

    if (!$picker.children.length) {
      $picker.innerHTML = '<span style="font-size:0.65rem;color:var(--bone-muted)">All conditions applied.</span>';
    }

    // Position near anchor
    var rect = anchor.getBoundingClientRect();
    $picker.style.position = 'fixed';
    $picker.style.top  = (rect.bottom + 6) + 'px';
    $picker.style.left = Math.max(8, rect.left - 100) + 'px';
    document.body.appendChild($picker);

    var close = function(e) {
      if (!$picker.contains(e.target) && e.target !== anchor) {
        $picker.remove();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(function() { document.addEventListener('click', close); }, 50);
  }

  // ── Character Sheet ──────────────────────────────────────

  var SKILLS = [
    { key:'acrobatics',     label:'Acrobatics',      ab:'dex' },
    { key:'animal',         label:'Animal Handling', ab:'wis' },
    { key:'arcana',         label:'Arcana',           ab:'int' },
    { key:'athletics',      label:'Athletics',        ab:'str' },
    { key:'deception',      label:'Deception',        ab:'cha' },
    { key:'history',        label:'History',          ab:'int' },
    { key:'insight',        label:'Insight',          ab:'wis' },
    { key:'intimidation',   label:'Intimidation',     ab:'cha' },
    { key:'investigation',  label:'Investigation',    ab:'int' },
    { key:'medicine',       label:'Medicine',         ab:'wis' },
    { key:'nature',         label:'Nature',           ab:'int' },
    { key:'perception',     label:'Perception',       ab:'wis' },
    { key:'performance',    label:'Performance',      ab:'cha' },
    { key:'persuasion',     label:'Persuasion',       ab:'cha' },
    { key:'religion',       label:'Religion',         ab:'int' },
    { key:'sleight',        label:'Sleight of Hand',  ab:'dex' },
    { key:'stealth',        label:'Stealth',          ab:'dex' },
    { key:'survival',       label:'Survival',         ab:'wis' }
  ];

  var SAVE_KEYS = ['str','dex','con','int','wis','cha'];
  var AB_LABELS = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' };

  function abMod(score) {
    var m = Math.floor(((score || 10) - 10) / 2);
    return (m >= 0 ? '+' : '') + m;
  }

  function openCharSheet(pcId) {
    var pc = party.find(function(p) { return p.id === pcId; });
    if (!pc) return;

    var existing = document.getElementById('char-sheet-overlay');
    if (existing) existing.remove();

    var $overlay = document.createElement('div');
    $overlay.id = 'char-sheet-overlay';
    $overlay.className = 'sheet-overlay';
    $overlay.innerHTML = buildSheetHTML(pc);
    document.body.appendChild($overlay);

    bindSheet(pc);
    requestAnimationFrame(function() { $overlay.classList.add('sheet-overlay--visible'); });
  }

  function buildSheetHTML(pc) {
    var prof = pc.profBonus || 2;

    // Ability scores block
    var absHTML = ['str','dex','con','int','wis','cha'].map(function(ab) {
      var score = pc[ab] || 10;
      return '<div class="sheet-ab">'
        + '<label class="sheet-ab__label" for="sheet-' + ab + '">' + AB_LABELS[ab] + '</label>'
        + '<input class="sheet-ab__score" id="sheet-' + ab + '" type="number" min="1" max="30" value="' + score + '" data-field="' + ab + '" />'
        + '<div class="sheet-ab__mod" id="sheet-mod-' + ab + '">' + abMod(score) + '</div>'
        + '</div>';
    }).join('');

    // Saving throws
    var savesHTML = SAVE_KEYS.map(function(ab) {
      var score   = pc[ab] || 10;
      var profOn  = pc.saveProfMap && pc.saveProfMap[ab];
      var bonus   = Math.floor(((score) - 10) / 2) + (profOn ? prof : 0);
      var bonusStr = (bonus >= 0 ? '+' : '') + bonus;
      return '<label class="sheet-check-row" title="Toggle proficiency">'
        + '<input type="checkbox" class="sheet-save-check" data-ab="' + ab + '"' + (profOn ? ' checked' : '') + ' />'
        + '<span class="sheet-check-val" id="sheet-save-val-' + ab + '">' + bonusStr + '</span>'
        + '<span class="sheet-check-label">' + AB_LABELS[ab] + '</span>'
        + '</label>';
    }).join('');

    // Skills
    var skillsHTML = SKILLS.map(function(sk) {
      var score  = pc[sk.ab] || 10;
      var level  = pc.skillProfMap && pc.skillProfMap[sk.key] || 0;
      var bonus  = Math.floor((score - 10) / 2) + (level === 2 ? prof * 2 : level === 1 ? prof : 0);
      var bonusStr = (bonus >= 0 ? '+' : '') + bonus;
      var dotCls = level === 2 ? 'sheet-dot sheet-dot--expert' : level === 1 ? 'sheet-dot sheet-dot--prof' : 'sheet-dot';
      return '<label class="sheet-check-row" title="Click to cycle: none → proficient → expert">'
        + '<span class="' + dotCls + '" data-skill="' + sk.key + '" data-ab="' + sk.ab + '"></span>'
        + '<span class="sheet-check-val" id="sheet-skill-val-' + sk.key + '">' + bonusStr + '</span>'
        + '<span class="sheet-check-label">' + sk.label + ' <span class="sheet-check-ab">(' + AB_LABELS[sk.ab] + ')</span></span>'
        + '</label>';
    }).join('');

    // Spell slots per level
    var slotsHTML = [1,2,3,4,5,6,7,8,9].map(function(lvl) {
      var sl  = (pc.slotsByLevel && pc.slotsByLevel[lvl]) || { max: 0, used: 0 };
      return '<div class="sheet-slots-row">'
        + '<span class="sheet-slots-lv">Lv ' + lvl + '</span>'
        + '<input class="sheet-slots-inp" type="number" min="0" max="9" value="' + (sl.used||0) + '" data-slot-lvl="' + lvl + '" data-slot-type="used" title="Used" />'
        + '<span class="sheet-slots-sep">/</span>'
        + '<input class="sheet-slots-inp" type="number" min="0" max="9" value="' + (sl.max||0) + '" data-slot-lvl="' + lvl + '" data-slot-type="max" title="Max" />'
        + '</div>';
    }).join('');

    // Computed values
    var passivePerc = 10 + Math.floor(((pc.wis || 10) - 10) / 2) + (pc.skillProfMap && pc.skillProfMap['perception'] ? prof : 0);

    return '<div class="sheet-panel">'
      + '<div class="sheet-header">'
        + '<div class="sheet-header__left">'
          + '<input class="sheet-name-input" id="sheet-name" value="' + esc(pc.name) + '" placeholder="Character name" data-field="name" />'
          + '<div class="sheet-meta-row">'
            + '<input class="sheet-meta-inp" id="sheet-cls"   value="' + esc(pc.cls    || '') + '" placeholder="Class" data-field="cls" />'
            + '<input class="sheet-meta-inp sheet-meta-inp--short" id="sheet-level" type="number" min="1" max="20" value="' + (pc.level||1) + '" data-field="level" />'
            + '<input class="sheet-meta-inp" id="sheet-race"  value="' + esc(pc.race   || '') + '" placeholder="Race" data-field="race" />'
            + '<input class="sheet-meta-inp" id="sheet-align" value="' + esc(pc.alignment || '') + '" placeholder="Alignment" data-field="alignment" />'
          + '</div>'
          + '<div class="sheet-meta-row">'
            + '<label class="sheet-meta-label">Player</label>'
            + '<input class="sheet-meta-inp" id="sheet-player" value="' + esc(pc.player || '') + '" placeholder="Player name" data-field="player" />'
            + '<label class="sheet-meta-label">Languages</label>'
            + '<input class="sheet-meta-inp sheet-meta-inp--wide" id="sheet-langs" value="' + esc(pc.languages || '') + '" placeholder="Common, Elvish…" data-field="languages" />'
          + '</div>'
        + '</div>'
        + '<div class="sheet-header__right">'
          + '<div class="sheet-stat-row">'
            + '<div class="sheet-stat"><span class="sheet-stat__label">HP</span><input class="sheet-stat__val sheet-stat__val--hp" id="sheet-hp" type="number" min="0" value="' + (pc.hp||0) + '" data-field="hp" /><span class="sheet-stat__sep">/</span><input class="sheet-stat__val" id="sheet-hpmax" type="number" min="1" value="' + (pc.hpMax||10) + '" data-field="hpMax" /></div>'
            + '<div class="sheet-stat"><span class="sheet-stat__label">AC</span><input class="sheet-stat__val" id="sheet-ac" type="number" min="1" max="99" value="' + (pc.ac||10) + '" data-field="ac" /></div>'
            + '<div class="sheet-stat"><span class="sheet-stat__label">INIT</span><input class="sheet-stat__val" id="sheet-init" type="number" min="-5" max="20" value="' + (pc.initBonus||0) + '" data-field="initBonus" /></div>'
            + '<div class="sheet-stat"><span class="sheet-stat__label">SPEED</span><input class="sheet-stat__val" id="sheet-speed" type="number" min="0" value="' + (pc.speed||30) + '" data-field="speed" /></div>'
            + '<div class="sheet-stat"><span class="sheet-stat__label">PROF</span><input class="sheet-stat__val" id="sheet-prof" type="number" min="2" max="6" value="' + (pc.profBonus||2) + '" data-field="profBonus" /></div>'
          + '</div>'
          + '<div class="sheet-passive">Passive Perception: <strong id="sheet-passive-perc">' + passivePerc + '</strong></div>'
        + '</div>'
        + '<button class="sheet-close" id="sheet-close" aria-label="Close sheet">✕</button>'
      + '</div>'

      + '<div class="sheet-body">'

        + '<div class="sheet-col sheet-col--narrow">'
          + '<div class="sheet-section">'
            + '<h3 class="sheet-section__title">ABILITY SCORES</h3>'
            + '<div class="sheet-abs">' + absHTML + '</div>'
          + '</div>'
          + '<div class="sheet-section">'
            + '<h3 class="sheet-section__title">SAVING THROWS</h3>'
            + '<div class="sheet-checklist">' + savesHTML + '</div>'
          + '</div>'
          + '<div class="sheet-section">'
            + '<h3 class="sheet-section__title">SPELL SLOTS</h3>'
            + '<div class="sheet-slots">' + slotsHTML + '</div>'
          + '</div>'
        + '</div>'

        + '<div class="sheet-col sheet-col--mid">'
          + '<div class="sheet-section sheet-section--skills">'
            + '<h3 class="sheet-section__title">SKILLS</h3>'
            + '<div class="sheet-checklist sheet-checklist--skills">' + skillsHTML + '</div>'
          + '</div>'
        + '</div>'

        + '<div class="sheet-col sheet-col--wide">'
          + '<div class="sheet-section">'
            + '<h3 class="sheet-section__title">FEATURES &amp; TRAITS</h3>'
            + '<textarea class="sheet-textarea" id="sheet-features" placeholder="Class features, racial traits, feats…" data-field="features">' + esc(pc.features || '') + '</textarea>'
          + '</div>'
          + '<div class="sheet-section">'
            + '<h3 class="sheet-section__title">EQUIPMENT</h3>'
            + '<textarea class="sheet-textarea" id="sheet-equipment" placeholder="Weapons, armour, adventuring gear, currency…" data-field="equipment">' + esc(pc.equipment || '') + '</textarea>'
          + '</div>'
          + '<div class="sheet-section">'
            + '<h3 class="sheet-section__title">PERSONALITY</h3>'
            + '<textarea class="sheet-textarea sheet-textarea--short" id="sheet-personality" placeholder="Personality traits…" data-field="personality">' + esc(pc.personality || '') + '</textarea>'
            + '<textarea class="sheet-textarea sheet-textarea--short" id="sheet-bonds" placeholder="Bonds…" data-field="bonds">' + esc(pc.bonds || '') + '</textarea>'
            + '<textarea class="sheet-textarea sheet-textarea--short" id="sheet-flaws" placeholder="Flaws…" data-field="flaws">' + esc(pc.flaws || '') + '</textarea>'
          + '</div>'
          + '<div class="sheet-section">'
            + '<h3 class="sheet-section__title">BACKSTORY</h3>'
            + '<textarea class="sheet-textarea" id="sheet-backstory" placeholder="Background, history, motivation…" data-field="backstory">' + esc(pc.backstory || '') + '</textarea>'
          + '</div>'
        + '</div>'

      + '</div>'
    + '</div>';
  }

  function bindSheet(pc) {
    var $overlay = document.getElementById('char-sheet-overlay');
    if (!$overlay) return;

    // Close
    document.getElementById('sheet-close').addEventListener('click', closeCharSheet);
    $overlay.addEventListener('click', function(e) { if (e.target === $overlay) closeCharSheet(); });

    // Escape key
    var escHandler = function(e) { if (e.key === 'Escape') { closeCharSheet(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);

    // Text/number inputs — live save
    $overlay.querySelectorAll('input[data-field], textarea[data-field]').forEach(function(inp) {
      inp.addEventListener('input', function() {
        var field = inp.dataset.field;
        var val   = inp.type === 'number' ? (parseInt(inp.value) || 0) : inp.value;
        pc[field] = val;
        // Update modifier display for ability scores
        if (['str','dex','con','int','wis','cha'].includes(field)) {
          var $modEl = document.getElementById('sheet-mod-' + field);
          if ($modEl) $modEl.textContent = abMod(val);
          recomputeSheetBonuses(pc);
        }
        if (field === 'profBonus') recomputeSheetBonuses(pc);
        if (field === 'wis') updatePassivePerc(pc);
        partySave();
        renderPartyBar();
      });
    });

    // Ability score inputs — also recompute modifiers on change
    ['str','dex','con','int','wis','cha'].forEach(function(ab) {
      var $inp = document.getElementById('sheet-' + ab);
      if ($inp) $inp.addEventListener('change', function() {
        pc[ab] = parseInt($inp.value) || 10;
        var $mod = document.getElementById('sheet-mod-' + ab);
        if ($mod) $mod.textContent = abMod(pc[ab]);
        recomputeSheetBonuses(pc);
        updatePassivePerc(pc);
        partySave();
      });
    });

    // Saving throw checkboxes
    $overlay.querySelectorAll('.sheet-save-check').forEach(function(chk) {
      chk.addEventListener('change', function() {
        var ab = chk.dataset.ab;
        if (!pc.saveProfMap) pc.saveProfMap = {};
        pc.saveProfMap[ab] = chk.checked;
        recomputeSheetBonuses(pc);
        partySave();
      });
    });

    // Skill dots — cycle none → prof → expert → none
    $overlay.querySelectorAll('.sheet-dot').forEach(function(dot) {
      dot.addEventListener('click', function() {
        var sk  = dot.dataset.skill;
        if (!pc.skillProfMap) pc.skillProfMap = {};
        var cur = pc.skillProfMap[sk] || 0;
        var next = (cur + 1) % 3;
        pc.skillProfMap[sk] = next;
        dot.className = next === 2 ? 'sheet-dot sheet-dot--expert' : next === 1 ? 'sheet-dot sheet-dot--prof' : 'sheet-dot';
        recomputeSheetBonuses(pc);
        if (sk === 'perception') updatePassivePerc(pc);
        partySave();
      });
    });

    // Spell slot inputs
    $overlay.querySelectorAll('.sheet-slots-inp').forEach(function(inp) {
      inp.addEventListener('change', function() {
        var lvl  = parseInt(inp.dataset.slotLvl);
        var type = inp.dataset.slotType;
        if (!pc.slotsByLevel) pc.slotsByLevel = {};
        if (!pc.slotsByLevel[lvl]) pc.slotsByLevel[lvl] = { max: 0, used: 0 };
        pc.slotsByLevel[lvl][type] = parseInt(inp.value) || 0;
        partySave();
      });
    });
  }

  function recomputeSheetBonuses(pc) {
    var prof = pc.profBonus || 2;
    // Saving throws
    SAVE_KEYS.forEach(function(ab) {
      var score  = pc[ab] || 10;
      var profOn = pc.saveProfMap && pc.saveProfMap[ab];
      var bonus  = Math.floor((score - 10) / 2) + (profOn ? prof : 0);
      var $el    = document.getElementById('sheet-save-val-' + ab);
      if ($el) $el.textContent = (bonus >= 0 ? '+' : '') + bonus;
    });
    // Skills
    SKILLS.forEach(function(sk) {
      var score  = pc[sk.ab] || 10;
      var level  = pc.skillProfMap && pc.skillProfMap[sk.key] || 0;
      var bonus  = Math.floor((score - 10) / 2) + (level === 2 ? prof * 2 : level === 1 ? prof : 0);
      var $el    = document.getElementById('sheet-skill-val-' + sk.key);
      if ($el) $el.textContent = (bonus >= 0 ? '+' : '') + bonus;
    });
  }

  function updatePassivePerc(pc) {
    var prof = pc.profBonus || 2;
    var pp   = 10 + Math.floor(((pc.wis || 10) - 10) / 2) + (pc.skillProfMap && pc.skillProfMap['perception'] ? prof : 0);
    var $el  = document.getElementById('sheet-passive-perc');
    if ($el) $el.textContent = pp;
  }

  function closeCharSheet() {
    var $o = document.getElementById('char-sheet-overlay');
    if (!$o) return;
    $o.classList.remove('sheet-overlay--visible');
    setTimeout(function() { if ($o.parentNode) $o.remove(); }, 280);
    renderParty(); // refresh card with any changed name etc.
    renderPartyBar();
  }

  // ── Party Status Bar ─────────────────────────────────────

  function renderPartyBar() {
    var $bar = document.getElementById('party-bar');
    if (!$bar) return;

    // Only show when a session is active and we have party members
    var sessionActive = !!(state && state.sessionActive);
    if (!sessionActive || !party.length) {
      $bar.classList.remove('party-bar--visible');
      return;
    }
    $bar.classList.add('party-bar--visible');

    $bar.innerHTML = '<span class="party-bar__label">PARTY</span>'
      + party.map(function(pc) {
          var pct    = pc.hpMax > 0 ? Math.max(0, Math.min(100, Math.round((pc.hp / pc.hpMax) * 100))) : 0;
          var isKO   = pc.hp <= 0;
          var isDead = pc.deaths >= 3;
          var fillCls = isDead || isKO ? 'party-bar__hp-fill--ko'
                      : pct <= 25     ? 'party-bar__hp-fill--crit'
                      : pct <= 50     ? 'party-bar__hp-fill--low'
                      : '';
          var nameCls = isKO ? 'party-bar__name party-bar__name--ko' : 'party-bar__name';

          var condHTML = (pc.conditions || []).length
            ? '<div class="party-bar__conds">'
                + pc.conditions.map(function(c) { return '<span class="party-bar__cond">' + esc(c.slice(0,4)) + '</span>'; }).join('')
              + '</div>'
            : '';

          var hpLine = isDead
            ? '<span class="party-bar__skull">☠</span>'
            : '<div class="party-bar__hp-track"><div class="party-bar__hp-fill ' + fillCls + '" style="width:' + pct + '%"></div></div>'
              + '<span class="party-bar__hp-text">' + (pc.hp||0) + '/' + (pc.hpMax||0) + '</span>';

          return '<div class="party-bar__card" data-pcid="' + esc(pc.id) + '">'
            + '<span class="' + nameCls + '">' + esc(pc.name) + '</span>'
            + hpLine
            + condHTML
          + '</div>';
        }).join('');

    // Click card → jump to Party module and scroll to card
    $bar.querySelectorAll('.party-bar__card').forEach(function(card) {
      card.addEventListener('click', function() {
        activateModule('party');
        var pcId = card.dataset.pcid;
        var $card = document.getElementById('pc-card-' + pcId);
        if ($card) $card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  }

  // ── Add Character Modal ──────────────────────────────────

  var $charModal = document.getElementById('char-modal');

  function openCharModal() { openModal($charModal); }

  document.getElementById('add-character').addEventListener('click', openCharModal);
  document.getElementById('char-modal-cancel').addEventListener('click', function() { closeModal($charModal); });
  document.getElementById('char-modal-confirm').addEventListener('click', function() {
    var name = document.getElementById('char-name').value.trim();
    if (!name) { document.getElementById('char-name').focus(); return; }
    var hpMax = parseInt(document.getElementById('char-hp-max').value) || 10;

    var pc = {
      id:          partyUid(),
      name:        name,
      cls:         document.getElementById('char-class').value.trim(),
      race:        document.getElementById('char-race').value.trim(),
      player:      document.getElementById('char-player').value.trim(),
      level:       parseInt(document.getElementById('char-level').value) || 1,
      hp:          hpMax,
      hpMax:       hpMax,
      ac:          parseInt(document.getElementById('char-ac').value) || null,
      initBonus:   parseInt(document.getElementById('char-init-bonus').value) || 0,
      profBonus:   parseInt(document.getElementById('char-prof-bonus').value) || 2,
      speed:       parseInt(document.getElementById('char-speed').value) || 30,
      str: parseInt(document.getElementById('char-str').value) || 10,
      dex: parseInt(document.getElementById('char-dex').value) || 10,
      con: parseInt(document.getElementById('char-con').value) || 10,
      int: parseInt(document.getElementById('char-int').value) || 10,
      wis: parseInt(document.getElementById('char-wis').value) || 10,
      cha: parseInt(document.getElementById('char-cha').value) || 10,
      alignment:    '',
      languages:    '',
      saveProfMap:  {},
      skillProfMap: {},
      slotsByLevel: {},
      features:     '',
      equipment:    '',
      personality:  '',
      bonds:        '',
      flaws:        '',
      backstory:    '',
      conditions:   [],
      dsSucc:       0,
      dsFail:       0,
      deaths:       0
    };

    party.push(pc);
    partySave();
    closeModal($charModal);

    // Clear text fields; reset number fields to defaults
    ['char-name','char-class','char-race','char-player']
      .forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
    ['char-hp-max','char-ac','char-init-bonus']
      .forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
    var _dflt = { 'char-level':1, 'char-prof-bonus':2, 'char-speed':30, 'char-str':10, 'char-dex':10, 'char-con':10, 'char-int':10, 'char-wis':10, 'char-cha':10 };
    Object.keys(_dflt).forEach(function(id) { var el = document.getElementById(id); if (el) el.value = _dflt[id]; });

    renderParty();
  });

  // Allow Enter to confirm
  $charModal.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      document.getElementById('char-modal-confirm').click();
    }
  });

  // ── Send party to combat ─────────────────────────────────
  document.getElementById('send-all-to-combat').addEventListener('click', function() {
    if (!party.length) { showToast('No characters in party yet'); return; }
    party.forEach(function(pc) {
      var already = combatants.find(function(c) { return c.id === pc.id; });
      if (already) return;
      var roll = Math.floor(Math.random() * 20) + 1 + (pc.initBonus || 0);
      combatants.push({
        id:    pc.id,
        name:  pc.name,
        init:  roll,
        hp:    pc.hp,
        hpMax: pc.hpMax,
        ac:    pc.ac || '—',
        type:  'pc',
        conditions: pc.conditions.slice(),
        dead: false
      });
    });
    combatants.sort(function(a,b) { return b.init - a.init; });
    activateModule('combat');
    renderCombat();
    showToast('Party added to initiative');
  });

  // ══════════════════════════════════════════════════════════
  // COMBAT TRACKER
  // ══════════════════════════════════════════════════════════

  var combatants = [];
  var combatActive = false;
  var combatRound  = 1;
  var combatTurn   = 0; // index into sorted combatants

  var $combatantModal = document.getElementById('combatant-modal');
  var $combatNext     = document.getElementById('combat-next');
  var $endCombat      = document.getElementById('end-combat');
  var $roundNum       = document.getElementById('round-num');

  document.getElementById('add-combatant').addEventListener('click', function() { openModal($combatantModal); });
  document.getElementById('combatant-modal-cancel').addEventListener('click',  function() { closeModal($combatantModal); });
  document.getElementById('combatant-modal-confirm').addEventListener('click', function() {
    var name = document.getElementById('comb-name').value.trim();
    if (!name) { document.getElementById('comb-name').focus(); return; }
    var hp   = parseInt(document.getElementById('comb-hp').value)   || 10;
    var init = parseInt(document.getElementById('comb-init').value) || 0;

    combatants.push({
      id:    'comb_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
      name:  name,
      init:  init,
      hp:    hp,
      hpMax: hp,
      ac:    parseInt(document.getElementById('comb-ac').value) || '—',
      type:  document.getElementById('comb-type').value,
      conditions: [],
      dead: false
    });
    combatants.sort(function(a,b) { return b.init - a.init; });

    // Adjust active turn index if needed
    if (combatActive && combatTurn >= combatants.length) combatTurn = 0;

    // Enable end combat / next
    combatActive = true;
    if ($roundNum) $roundNum.textContent = combatRound;
    if ($combatNext) $combatNext.disabled = false;
    if ($endCombat)  $endCombat.disabled  = false;

    closeModal($combatantModal);
    ['comb-name','comb-hp','comb-init','comb-ac'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    var sel = document.getElementById('comb-type'); if (sel) sel.value = 'enemy';

    renderCombat();
    showToast(name + ' added (Initiative ' + init + ')');
  });

  $combatantModal.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      document.getElementById('combatant-modal-confirm').click();
    }
  });

  if ($combatNext) $combatNext.addEventListener('click', advanceTurn);
  if ($endCombat)  $endCombat.addEventListener('click',  endCombat);

  function advanceTurn() {
    if (!combatants.length) return;
    combatTurn++;
    if (combatTurn >= combatants.length) {
      combatTurn = 0;
      combatRound++;
      if ($roundNum) $roundNum.textContent = combatRound;
    }
    renderCombat();
  }

  function endCombat() {
    if (!confirm('End combat and clear the tracker?')) return;
    combatants  = [];
    combatActive = false;
    combatRound  = 1;
    combatTurn   = 0;
    if ($roundNum) $roundNum.textContent = '—';
    if ($combatNext) $combatNext.disabled = true;
    if ($endCombat)  $endCombat.disabled  = true;
    renderCombat();
  }

  function renderCombat() {
    var $track = document.getElementById('combat-track');
    if (!$track) return;

    if (!combatants.length) {
      $track.innerHTML = '<div class="combat-empty">'
        + '<p>No active encounter.</p>'
        + '<p class="combat-empty__sub">Add combatants to begin initiative tracking.</p>'
        + '</div>';
      return;
    }

    $track.innerHTML = combatants.map(function(c, i) {
      var isActive = combatActive && i === combatTurn;
      var pct = c.hpMax > 0 ? Math.max(0, Math.round((c.hp / c.hpMax) * 100)) : 0;

      var condHTML = c.conditions.map(function(cond) {
        return '<span class="condition-badge" style="font-size:0.5rem;padding:0.1rem 0.4rem">' + esc(cond) + '</span>';
      }).join('');

      return '<div class="combatant combatant--' + c.type + (isActive ? ' combatant--active' : '') + (c.dead ? ' combatant--dead' : '') + '" id="comb-row-' + esc(c.id) + '" data-comb-id="' + esc(c.id) + '">'
        + '<div class="combatant__init">' + c.init + '</div>'
        + '<div class="combatant__body">'
          + '<div class="combatant__name">' + esc(c.name) + '</div>'
          + '<div class="combatant__sub">AC ' + c.ac + (c.type === 'pc' ? ' · Player' : '') + '</div>'
          + (c.conditions.length ? '<div class="combatant__conditions">' + condHTML + '</div>' : '')
        + '</div>'
        + '<div class="combatant__hp">'
          + '<div class="combatant__hp-display">' + c.hp + '<span style="color:var(--bone-dim);font-size:0.65rem">/' + c.hpMax + '</span></div>'
          + '<div class="combatant__hp-bar-bg"><div class="combatant__hp-bar" style="width:' + pct + '%;background:' + (pct > 50 ? 'var(--crimson-hi)' : pct > 25 ? '#a05000' : '#6B1111') + '"></div></div>'
        + '</div>'
        + '<div class="combatant__controls">'
          + '<button class="combatant__btn combatant__btn--heal" data-combid="' + esc(c.id) + '" title="Heal" aria-label="Heal">+</button>'
          + '<button class="combatant__btn combatant__btn--dmg"  data-combid="' + esc(c.id) + '" title="Damage" aria-label="Damage">−</button>'
          + '<button class="combatant__btn combatant__btn--remove" data-combid="' + esc(c.id) + '" title="Remove from encounter" aria-label="Remove">×</button>'
        + '</div>'
        + '</div>';
    }).join('');

    // Scroll active into view
    var $active = $track.querySelector('.combatant--active');
    if ($active) $active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Bind buttons
    $track.querySelectorAll('[data-combid]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var cid = btn.dataset.combid;
        var c   = combatants.find(function(x) { return x.id === cid; });
        if (!c) return;

        if (btn.classList.contains('combatant__btn--remove')) {
          combatants = combatants.filter(function(x) { return x.id !== cid; });
          if (combatTurn >= combatants.length) combatTurn = Math.max(0, combatants.length - 1);
          renderCombat();
          return;
        }

        if (btn.classList.contains('combatant__btn--heal') || btn.classList.contains('combatant__btn--dmg')) {
          var isHeal = btn.classList.contains('combatant__btn--heal');
          showCombatHPEdit(c.id, btn, isHeal);
          return;
        }
      });
    });
  }

  function showCombatHPEdit(cid, anchor, isHeal) {
    // Remove any existing
    document.querySelectorAll('.combatant__hp-edit').forEach(function(el) { el.remove(); });

    var c = combatants.find(function(x) { return x.id === cid; });
    if (!c) return;

    var $edit = document.createElement('div');
    $edit.className = 'combatant__hp-edit';
    $edit.innerHTML =
      '<input type="number" min="0" placeholder="Amt" autofocus />'
      + '<button class="combatant__hp-edit-btn combatant__hp-edit-btn--' + (isHeal ? 'heal' : 'dmg') + '">'
        + (isHeal ? 'Heal' : 'Dmg') + '</button>'
      + '<button class="combatant__hp-edit-btn combatant__hp-edit-btn--close">✕</button>';

    var $row = document.getElementById('comb-row-' + cid);
    if ($row) $row.appendChild($edit);

    var $inp = $edit.querySelector('input');
    setTimeout(function() { if ($inp) $inp.focus(); }, 40);

    var apply = function() {
      var amt = parseInt($inp.value) || 0;
      if (amt > 0) {
        if (isHeal) c.hp = Math.min(c.hpMax, c.hp + amt);
        else {
          c.hp = Math.max(0, c.hp - amt);
          if (c.hp === 0) { c.dead = true; showToast(c.name + ' is down!'); }
        }
        renderCombat();
      }
      $edit.remove();
    };

    $edit.querySelector('.combatant__hp-edit-btn--' + (isHeal ? 'heal' : 'dmg'))
      .addEventListener('click', apply);
    $edit.querySelector('.combatant__hp-edit-btn--close')
      .addEventListener('click', function() { $edit.remove(); });
    $inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') apply();
      if (e.key === 'Escape') $edit.remove();
    });
  }

  // ══════════════════════════════════════════════════════════
  // ATLAS — map upload, pan/zoom, fog of war, markers
  // ══════════════════════════════════════════════════════════

  var atlasState = {
    maps:       [],          // [{ id, name, dataUrl, fog, markers }]
    activeId:   null,
    gridSize:   40,          // px per fog cell at 1× zoom
    paintMode:  false,
    markerMode: null,        // null | 'secret' | 'trap' | 'npc'
    zoom:       1,
    panX:       0,
    panY:       0,
    isPanning:  false,
    panStart:   null,
    isPainting: false
  };

  function atlasLoad() {
    try {
      var raw = localStorage.getItem('dndm_atlas');
      if (raw) {
        var saved = JSON.parse(raw);
        // Don't store full dataUrls in state — they live in a separate key per map
        atlasState.maps = (saved.maps || []).map(function(m) {
          return { id: m.id, name: m.name, fog: m.fog || [], markers: m.markers || [] };
        });
        atlasState.activeId = saved.activeId || null;
      }
    } catch(e) {}
  }

  function atlasSave() {
    try {
      var slim = {
        maps: atlasState.maps.map(function(m) {
          return { id: m.id, name: m.name, fog: m.fog, markers: m.markers };
        }),
        activeId: atlasState.activeId
      };
      localStorage.setItem('dndm_atlas', JSON.stringify(slim));
    } catch(e) {}
  }

  function atlasMapDataUrl(id) {
    try { return localStorage.getItem('dndm_atlas_img_' + id); } catch(e) { return null; }
  }

  function atlasMapSaveImg(id, dataUrl) {
    try { localStorage.setItem('dndm_atlas_img_' + id, dataUrl); } catch(e) {
      showToast('Map image too large for local storage — try a smaller file');
    }
  }

  function atlasMapRemoveImg(id) {
    try { localStorage.removeItem('dndm_atlas_img_' + id); } catch(e) {}
  }

  function atlasUID() {
    return 'map_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  }

  atlasLoad();

  // ── Map list sidebar ──────────────────────────────────────
  function renderAtlasMapList() {
    var $list = document.getElementById('atlas-map-list');
    if (!$list) return;
    if (!atlasState.maps.length) {
      $list.innerHTML = '<div class="atlas-empty">No maps uploaded.</div>';
      return;
    }
    $list.innerHTML = atlasState.maps.map(function(m) {
      var active = m.id === atlasState.activeId;
      return '<div class="atlas-map-thumb' + (active ? ' atlas-map-thumb--active' : '') + '" data-mapid="' + esc(m.id) + '">'
        + '<span class="atlas-map-thumb__name">' + esc(m.name) + '</span>'
        + '<button class="atlas-map-thumb__del" data-mapid="' + esc(m.id) + '" title="Delete map" aria-label="Delete map">×</button>'
        + '</div>';
    }).join('');

    $list.querySelectorAll('.atlas-map-thumb').forEach(function(el) {
      el.addEventListener('click', function(e) {
        if (e.target.classList.contains('atlas-map-thumb__del')) return;
        atlasOpenMap(el.dataset.mapid);
      });
    });
    $list.querySelectorAll('.atlas-map-thumb__del').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var id = btn.dataset.mapid;
        if (!confirm('Delete this map?')) return;
        atlasMapRemoveImg(id);
        atlasState.maps = atlasState.maps.filter(function(m) { return m.id !== id; });
        if (atlasState.activeId === id) {
          atlasState.activeId = atlasState.maps.length ? atlasState.maps[0].id : null;
        }
        atlasSave();
        renderAtlasMapList();
        if (atlasState.activeId) atlasOpenMap(atlasState.activeId);
        else atlasShowPlaceholder();
      });
    });
  }

  function atlasShowPlaceholder() {
    var $area = document.getElementById('atlas-canvas-area');
    if (!$area) return;
    $area.innerHTML = '<div class="atlas-placeholder">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.2" width="64" height="64"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>'
      + '<p>Upload a map to begin.</p>'
      + '</div>';
  }

  // ── Open a map ────────────────────────────────────────────
  function atlasOpenMap(id) {
    var map = atlasState.maps.find(function(m) { return m.id === id; });
    if (!map) return;
    atlasState.activeId = id;
    atlasState.zoom     = 1;
    atlasState.panX     = 0;
    atlasState.panY     = 0;
    atlasSave();
    renderAtlasMapList();

    var dataUrl = atlasMapDataUrl(id);
    var $area   = document.getElementById('atlas-canvas-area');
    if (!$area) return;

    $area.innerHTML =
      '<div class="atlas-viewport" id="atlas-viewport">'
      + '<div class="atlas-stage" id="atlas-stage" style="transform-origin:0 0">'
        + '<img class="atlas-img" id="atlas-img" src="' + esc(dataUrl || '') + '" draggable="false" />'
        + '<canvas class="atlas-fog" id="atlas-fog"></canvas>'
        + '<div class="atlas-markers" id="atlas-markers"></div>'
      + '</div>'
      + '</div>'
      + '<div class="atlas-toolbar" id="atlas-toolbar">'
        + '<button class="atlas-tool" id="atl-pan"    title="Pan"     aria-label="Pan mode">✥</button>'
        + '<button class="atlas-tool" id="atl-fog"    title="Fog"     aria-label="Toggle fog cells">◼</button>'
        + '<button class="atlas-tool" id="atl-reveal" title="Reveal all" aria-label="Reveal all fog">☀</button>'
        + '<button class="atlas-tool" id="atl-cover"  title="Cover all"  aria-label="Cover all fog">◼◼</button>'
        + '<span class="atlas-tool-sep"></span>'
        + '<button class="atlas-tool" id="atl-m-secret" title="Secret door marker" aria-label="Secret door">🔐</button>'
        + '<button class="atlas-tool" id="atl-m-trap"   title="Trap marker"        aria-label="Trap">⚠</button>'
        + '<button class="atlas-tool" id="atl-m-npc"    title="NPC marker"         aria-label="NPC">👤</button>'
        + '<span class="atlas-tool-sep"></span>'
        + '<button class="atlas-tool" id="atl-zoom-in"  title="Zoom in"  aria-label="Zoom in">+</button>'
        + '<button class="atlas-tool" id="atl-zoom-out" title="Zoom out" aria-label="Zoom out">−</button>'
        + '<button class="atlas-tool" id="atl-player"   title="Send to Player Screen" aria-label="Player screen">▶ PLAYER</button>'
      + '</div>';

    var $img = document.getElementById('atlas-img');
    $img.onload = function() { atlasInitCanvas(map); };
    if ($img.complete && $img.naturalWidth) atlasInitCanvas(map);
  }

  function atlasInitCanvas(map) {
    var $img    = document.getElementById('atlas-img');
    var $fog    = document.getElementById('atlas-fog');
    var $stage  = document.getElementById('atlas-stage');
    var $vp     = document.getElementById('atlas-viewport');
    if (!$img || !$fog || !$stage || !$vp) return;

    var W = $img.naturalWidth;
    var H = $img.naturalHeight;
    var cols = Math.ceil(W / atlasState.gridSize);
    var rows = Math.ceil(H / atlasState.gridSize);

    // Ensure fog array is right size — fill new cells as covered
    var existing = map.fog || [];
    map.fog = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var i = r * cols + c;
        map.fog[i] = (existing[i] !== undefined) ? existing[i] : true; // true = fogged
      }
    }

    $fog.width  = W;
    $fog.height = H;
    $stage.style.width  = W + 'px';
    $stage.style.height = H + 'px';

    atlasDrawFog(map, cols, rows, W, H);
    atlasRenderMarkers(map);
    atlasBindToolbar(map, cols, rows, W, H);
    atlasBindViewport($vp, $stage);
    atlasApplyTransform($stage);
  }

  function atlasDrawFog(map, cols, rows, W, H) {
    var $fog = document.getElementById('atlas-fog');
    if (!$fog) return;
    var ctx = $fog.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    var gs = atlasState.gridSize;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var i = r * cols + c;
        if (map.fog[i]) {
          ctx.fillStyle = 'rgba(10,7,5,0.88)';
          ctx.fillRect(c * gs, r * gs, gs, gs);
          ctx.strokeStyle = 'rgba(139,26,26,0.15)';
          ctx.lineWidth   = 0.5;
          ctx.strokeRect(c * gs + 0.25, r * gs + 0.25, gs - 0.5, gs - 0.5);
        } else {
          // Faint grid line on revealed cells
          ctx.strokeStyle = 'rgba(196,146,42,0.07)';
          ctx.lineWidth   = 0.5;
          ctx.strokeRect(c * gs + 0.25, r * gs + 0.25, gs - 0.5, gs - 0.5);
        }
      }
    }
  }

  function atlasRenderMarkers(map) {
    var $markers = document.getElementById('atlas-markers');
    if (!$markers) return;
    var gs = atlasState.gridSize;
    $markers.innerHTML = (map.markers || []).map(function(mk, idx) {
      var icon = mk.type === 'secret' ? '🔐' : mk.type === 'trap' ? '⚠' : '👤';
      return '<div class="atlas-marker" style="left:' + (mk.x * gs + gs/2) + 'px;top:' + (mk.y * gs + gs/2) + 'px" data-idx="' + idx + '" title="' + esc(mk.label || mk.type) + '">'
        + icon
        + '<button class="atlas-marker__del" data-idx="' + idx + '">×</button>'
        + '</div>';
    }).join('');

    $markers.querySelectorAll('.atlas-marker__del').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        map.markers.splice(parseInt(btn.dataset.idx), 1);
        atlasSave();
        atlasRenderMarkers(map);
      });
    });
  }

  function atlasBindToolbar(map, cols, rows, W, H) {
    var activeToolBtn = null;

    function setTool(mode, btn) {
      atlasState.paintMode  = (mode === 'fog');
      atlasState.markerMode = (mode === 'secret' || mode === 'trap' || mode === 'npc') ? mode : null;
      if (activeToolBtn) activeToolBtn.classList.remove('atlas-tool--active');
      activeToolBtn = btn;
      if (btn) btn.classList.add('atlas-tool--active');
      var $vp = document.getElementById('atlas-viewport');
      if ($vp) $vp.style.cursor = mode === 'fog' ? 'crosshair' : (mode ? 'copy' : 'grab');
    }

    var $panBtn    = document.getElementById('atl-pan');
    var $fogBtn    = document.getElementById('atl-fog');
    var $revealBtn = document.getElementById('atl-reveal');
    var $coverBtn  = document.getElementById('atl-cover');
    var $mSecret   = document.getElementById('atl-m-secret');
    var $mTrap     = document.getElementById('atl-m-trap');
    var $mNPC      = document.getElementById('atl-m-npc');
    var $zoomIn    = document.getElementById('atl-zoom-in');
    var $zoomOut   = document.getElementById('atl-zoom-out');
    var $playerBtn = document.getElementById('atl-player');

    if ($panBtn)    $panBtn.addEventListener('click',    function() { setTool('pan',    $panBtn); });
    if ($fogBtn)    $fogBtn.addEventListener('click',    function() { setTool('fog',    $fogBtn); });
    if ($mSecret)   $mSecret.addEventListener('click',  function() { setTool('secret', $mSecret); });
    if ($mTrap)     $mTrap.addEventListener('click',    function() { setTool('trap',   $mTrap); });
    if ($mNPC)      $mNPC.addEventListener('click',     function() { setTool('npc',    $mNPC); });

    if ($revealBtn) $revealBtn.addEventListener('click', function() {
      map.fog = map.fog.map(function() { return false; });
      atlasSave();
      atlasDrawFog(map, cols, rows, W, H);
    });
    if ($coverBtn)  $coverBtn.addEventListener('click', function() {
      map.fog = map.fog.map(function() { return true; });
      atlasSave();
      atlasDrawFog(map, cols, rows, W, H);
    });

    if ($zoomIn)  $zoomIn.addEventListener('click',  function() { atlasZoom(0.25); });
    if ($zoomOut) $zoomOut.addEventListener('click', function() { atlasZoom(-0.25); });

    if ($playerBtn) $playerBtn.addEventListener('click', function() { atlasBroadcastPlayer(map); });

    // Fog paint / marker place on canvas
    var $fog = document.getElementById('atlas-fog');
    if ($fog) {
      function fogCellAt(e) {
        var rect = $fog.getBoundingClientRect();
        var gs   = atlasState.gridSize * atlasState.zoom;
        var c    = Math.floor((e.clientX - rect.left)  / gs);
        var r    = Math.floor((e.clientY - rect.top)   / gs);
        if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
        return { c: c, r: r, i: r * cols + c };
      }

      $fog.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        if (atlasState.markerMode) {
          var cell = fogCellAt(e);
          if (!cell) return;
          var label = prompt('Marker label (optional):', '');
          if (label === null) return;
          map.markers.push({ type: atlasState.markerMode, x: cell.c, y: cell.r, label: label.trim() });
          atlasSave();
          atlasRenderMarkers(map);
          return;
        }
        if (!atlasState.paintMode) return;
        atlasState.isPainting = true;
        var cell = fogCellAt(e);
        if (cell) {
          atlasState._paintVal = !map.fog[cell.i]; // toggle based on first cell
          map.fog[cell.i] = atlasState._paintVal;
          atlasDrawFog(map, cols, rows, W, H);
        }
      });

      $fog.addEventListener('mousemove', function(e) {
        if (!atlasState.isPainting || !atlasState.paintMode) return;
        var cell = fogCellAt(e);
        if (cell && map.fog[cell.i] !== atlasState._paintVal) {
          map.fog[cell.i] = atlasState._paintVal;
          atlasDrawFog(map, cols, rows, W, H);
        }
      });

      document.addEventListener('mouseup', function() {
        if (atlasState.isPainting) {
          atlasState.isPainting = false;
          atlasSave();
        }
      });
    }

    // Start with pan tool active
    setTool('pan', $panBtn);
  }

  function atlasBindViewport($vp, $stage) {
    // Pan via drag (when in pan mode or middle-mouse)
    $vp.addEventListener('mousedown', function(e) {
      if (atlasState.paintMode || atlasState.markerMode) return;
      if (e.button === 1 || e.button === 0) {
        atlasState.isPanning = true;
        atlasState.panStart  = { x: e.clientX - atlasState.panX, y: e.clientY - atlasState.panY };
        $vp.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });

    document.addEventListener('mousemove', function(e) {
      if (!atlasState.isPanning) return;
      atlasState.panX = e.clientX - atlasState.panStart.x;
      atlasState.panY = e.clientY - atlasState.panStart.y;
      atlasApplyTransform($stage);
    });

    document.addEventListener('mouseup', function() {
      if (atlasState.isPanning) {
        atlasState.isPanning = false;
        $vp.style.cursor = atlasState.paintMode ? 'crosshair' : 'grab';
      }
    });

    // Scroll-to-zoom
    $vp.addEventListener('wheel', function(e) {
      e.preventDefault();
      var delta = e.deltaY > 0 ? -0.1 : 0.1;
      atlasZoom(delta);
    }, { passive: false });
  }

  function atlasZoom(delta) {
    atlasState.zoom = Math.max(0.2, Math.min(4, atlasState.zoom + delta));
    var $stage = document.getElementById('atlas-stage');
    if ($stage) atlasApplyTransform($stage);
  }

  function atlasApplyTransform($stage) {
    if (!$stage) return;
    $stage.style.transform = 'translate(' + atlasState.panX + 'px,' + atlasState.panY + 'px) scale(' + atlasState.zoom + ')';
  }

  // ── Map upload ────────────────────────────────────────────
  var $uploadMapBtn = document.getElementById('upload-map');
  var _mapFileInput = document.createElement('input');
  _mapFileInput.type   = 'file';
  _mapFileInput.accept = 'image/*';
  _mapFileInput.hidden = true;
  document.body.appendChild(_mapFileInput);

  if ($uploadMapBtn) {
    $uploadMapBtn.addEventListener('click', function() { _mapFileInput.click(); });
  }
  _mapFileInput.addEventListener('change', function() {
    var file = _mapFileInput.files[0];
    if (!file) return;
    var name = prompt('Map name:', file.name.replace(/\.[^.]+$/, '') || 'Untitled Map');
    if (name === null) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      var id  = atlasUID();
      var map = { id: id, name: name.trim() || 'Untitled Map', fog: [], markers: [] };
      atlasMapSaveImg(id, e.target.result);
      atlasState.maps.push(map);
      atlasState.activeId = id;
      atlasSave();
      renderAtlasMapList();
      atlasOpenMap(id);
    };
    reader.readAsDataURL(file);
    _mapFileInput.value = '';
  });

  // Player Screen launch
  var $launchPlayer = document.getElementById('launch-player-screen');
  if ($launchPlayer) {
    $launchPlayer.addEventListener('click', function() {
      window.open('/dndm/?view=player', 'grimoire-player');
    });
  }

  // ── BroadcastChannel — player screen ─────────────────────
  var _playerChannel = null;
  try { _playerChannel = new BroadcastChannel('dndm-player'); } catch(e) {}

  function atlasBroadcastPlayer(map) {
    if (!_playerChannel) { showToast('BroadcastChannel not supported in this browser'); return; }
    var dataUrl = atlasMapDataUrl(map.id);
    _playerChannel.postMessage({
      type:      'map-update',
      mapName:   map.name,
      imageData: dataUrl,
      fog:       map.fog,
      cols:      Math.ceil(0 / atlasState.gridSize), // recalculated on player side
      gridSize:  atlasState.gridSize
    });
    showToast('Map sent to player screen');
  }

  // ── Player view (second tab) ──────────────────────────────
  if (new URLSearchParams(window.location.search).get('view') === 'player') {
    document.getElementById('welcome').hidden = true;
    document.getElementById('app').hidden     = true;
    var $player = document.createElement('div');
    $player.id  = 'player-screen';
    $player.className = 'player-screen';
    $player.innerHTML = '<div class="player-screen__title" id="player-title"></div>'
      + '<canvas class="player-screen__canvas" id="player-canvas"></canvas>'
      + '<div class="player-screen__waiting">Waiting for DM to send map…</div>';
    document.body.appendChild($player);

    try {
      var _pc = new BroadcastChannel('dndm-player');
      _pc.onmessage = function(e) {
        var msg = e.data;
        if (msg.type !== 'map-update') return;
        var $waiting = $player.querySelector('.player-screen__waiting');
        if ($waiting) $waiting.remove();
        var $title = document.getElementById('player-title');
        if ($title) { $title.textContent = msg.mapName || ''; }
        var $canvas = document.getElementById('player-canvas');
        if (!$canvas) return;
        var img = new Image();
        img.onload = function() {
          $canvas.width  = img.naturalWidth;
          $canvas.height = img.naturalHeight;
          var ctx = $canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          // Apply fog
          var gs   = msg.gridSize || 40;
          var fog  = msg.fog || [];
          var cols = Math.ceil(img.naturalWidth / gs);
          fog.forEach(function(fogged, i) {
            if (!fogged) return;
            var c = i % cols, r = Math.floor(i / cols);
            ctx.fillStyle = 'rgba(10,7,5,0.92)';
            ctx.fillRect(c * gs, r * gs, gs, gs);
          });
        };
        img.src = msg.imageData;
      };
    } catch(e) {}
    return; // stop the rest of app init for player tab
  }

  renderAtlasMapList();
  if (atlasState.activeId) atlasOpenMap(atlasState.activeId);
  else atlasShowPlaceholder();

  // ══════════════════════════════════════════════════════════
  // SOUNDSCAPE — scene presets + audio playback
  // ══════════════════════════════════════════════════════════

  var soundState = {
    activeScene: null,
    audio:       null,   // active HTMLAudioElement
    scenes:      {}      // { [sceneKey]: { src: objectUrl|null, vol: 0.7, loop: true } }
  };

  var SCENE_KEYS = ['tavern','dungeon','forest','combat','silence','custom'];

  function soundLoad() {
    try {
      var raw = localStorage.getItem('dndm_sound');
      if (raw) soundState.scenes = JSON.parse(raw);
    } catch(e) {}
    SCENE_KEYS.forEach(function(k) {
      if (!soundState.scenes[k]) soundState.scenes[k] = { src: null, vol: 0.7, loop: true };
    });
  }

  function soundSave() {
    // Don't save object URLs (they die with the tab) — save only vol/loop
    var slim = {};
    SCENE_KEYS.forEach(function(k) {
      slim[k] = { src: null, vol: soundState.scenes[k].vol, loop: soundState.scenes[k].loop };
    });
    try { localStorage.setItem('dndm_sound', JSON.stringify(slim)); } catch(e) {}
  }

  soundLoad();

  function soundPlay(sceneKey) {
    var scene = soundState.scenes[sceneKey];
    if (!scene) return;

    // Stop current
    if (soundState.audio) {
      soundState.audio.pause();
      soundState.audio = null;
    }

    // Update active card
    document.querySelectorAll('.scene-card').forEach(function(c) {
      c.classList.toggle('scene-card--active', c.dataset.scene === sceneKey);
    });
    soundState.activeScene = sceneKey;

    if (sceneKey === 'silence' || !scene.src) {
      soundRenderMixer(sceneKey);
      return;
    }

    var audio = new Audio(scene.src);
    audio.loop   = scene.loop;
    audio.volume = scene.vol;
    audio.play().catch(function() { showToast('Audio playback blocked — interact with the page first'); });
    soundState.audio = audio;
    soundRenderMixer(sceneKey);
  }

  function soundRenderMixer(sceneKey) {
    var $body = document.querySelector('.soundscape-mixer__body');
    if (!$body) return;
    var scene = soundState.scenes[sceneKey] || {};
    var isPlaying = soundState.audio && !soundState.audio.paused;
    var label = sceneKey.charAt(0).toUpperCase() + sceneKey.slice(1);

    $body.innerHTML =
      '<div class="mixer-scene-name">' + esc(label) + (isPlaying ? ' <span class="mixer-playing">▶ PLAYING</span>' : '') + '</div>'
      + '<div class="mixer-row">'
        + '<label class="mixer-label" for="mixer-vol">Volume</label>'
        + '<input class="mixer-slider" type="range" id="mixer-vol" min="0" max="1" step="0.05" value="' + (scene.vol || 0.7) + '" />'
      + '</div>'
      + '<div class="mixer-row">'
        + '<label class="mixer-label">'
          + '<input type="checkbox" id="mixer-loop"' + (scene.loop !== false ? ' checked' : '') + ' /> Loop'
        + '</label>'
      + '</div>'
      + (sceneKey !== 'silence'
        ? '<div class="mixer-row">'
            + '<button class="mixer-upload-btn" id="mixer-upload">Upload audio…</button>'
            + (scene.src ? '<button class="mixer-stop-btn" id="mixer-stop">■ Stop</button>' : '')
          + '</div>'
        : '')
      + (sceneKey !== 'silence' && !scene.src
        ? '<p class="mixer-hint">No audio file loaded. Upload to enable this scene.</p>'
        : '');

    var $vol  = document.getElementById('mixer-vol');
    var $loop = document.getElementById('mixer-loop');
    var $stop = document.getElementById('mixer-stop');
    var $uploadSnd = document.getElementById('mixer-upload');

    if ($vol) $vol.addEventListener('input', function() {
      scene.vol = parseFloat($vol.value);
      if (soundState.audio) soundState.audio.volume = scene.vol;
      soundSave();
    });
    if ($loop) $loop.addEventListener('change', function() {
      scene.loop = $loop.checked;
      if (soundState.audio) soundState.audio.loop = scene.loop;
      soundSave();
    });
    if ($stop) $stop.addEventListener('click', function() {
      if (soundState.audio) { soundState.audio.pause(); soundState.audio = null; }
      soundState.activeScene = null;
      document.querySelectorAll('.scene-card').forEach(function(c) { c.classList.remove('scene-card--active'); });
      soundRenderMixer(sceneKey);
    });
    if ($uploadSnd) $uploadSnd.addEventListener('click', function() {
      var inp = document.createElement('input');
      inp.type   = 'file';
      inp.accept = 'audio/*';
      inp.addEventListener('change', function() {
        var file = inp.files[0];
        if (!file) return;
        var url = URL.createObjectURL(file);
        scene.src = url;
        soundSave();
        showToast('Audio loaded: ' + file.name);
        soundPlay(sceneKey); // auto-play on upload
      });
      inp.click();
    });
  }

  // Wire scene cards
  document.querySelectorAll('.scene-card').forEach(function(card) {
    card.addEventListener('click', function() {
      var key = card.dataset.scene;
      if (!key) return;
      soundPlay(key);
    });
  });

  // ══════════════════════════════════════════════════════════
  // ORACLE — nano-gpt rules assistant
  // ══════════════════════════════════════════════════════════

  var ORACLE_API    = 'https://nano-gpt.com/api/v1';
  var ORACLE_MODEL  = 'gpt-4o-mini';
  var ORACLE_SYSTEM = 'You are a 5th Edition Dungeons & Dragons rules expert and Dungeon Master consultant. '
    + 'You answer rules questions, adjudicate edge cases, suggest rulings, and reference the 5e SRD. '
    + 'You speak with authority and clarity. You do not discuss topics unrelated to D&D 5e. '
    + 'Keep responses concise and actionable. Format with markdown when helpful.';

  var oracleHistory = []; // { role, content }[]
  var oracleBusy    = false;

  // API key — persisted to localStorage
  var $apiKeyInput = document.getElementById('api-key-input');
  var $apiKeySave  = document.getElementById('api-key-save');
  var _oracleKey   = localStorage.getItem('dndm_ng_key') || '';
  if ($apiKeyInput) $apiKeyInput.value = _oracleKey;
  if ($apiKeySave) $apiKeySave.addEventListener('click', function() {
    _oracleKey = ($apiKeyInput ? $apiKeyInput.value.trim() : '');
    localStorage.setItem('dndm_ng_key', _oracleKey);
    showToast('API key saved');
  });

  // Minimal markdown renderer — bold, italic, inline code, code blocks, lists, headings
  function renderOracleMarkdown(text) {
    var escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks (``` ... ```)
    escaped = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, function(_, lang, code) {
      return '<pre class="oracle-code"><code>' + code.trim() + '</code></pre>';
    });

    // Process line by line for headings and lists
    var lines   = escaped.split('\n');
    var out     = [];
    var inList  = false;

    lines.forEach(function(line) {
      // Headings
      if (/^###\s/.test(line))      { if (inList) { out.push('</ul>'); inList = false; } out.push('<h4 class="oracle-h">' + line.replace(/^###\s/, '') + '</h4>'); return; }
      if (/^##\s/.test(line))       { if (inList) { out.push('</ul>'); inList = false; } out.push('<h3 class="oracle-h">' + line.replace(/^##\s/, '')  + '</h3>'); return; }
      if (/^#\s/.test(line))        { if (inList) { out.push('</ul>'); inList = false; } out.push('<h2 class="oracle-h">' + line.replace(/^#\s/, '')   + '</h2>'); return; }
      // Lists
      if (/^[-*]\s/.test(line))     { if (!inList) { out.push('<ul class="oracle-list">'); inList = true; } out.push('<li>' + inlineMd(line.replace(/^[-*]\s/, '')) + '</li>'); return; }
      if (/^\d+\.\s/.test(line))    { if (!inList) { out.push('<ol class="oracle-list">'); inList = true; } out.push('<li>' + inlineMd(line.replace(/^\d+\.\s/, '')) + '</li>'); return; }
      // Blank line closes list
      if (line.trim() === '')       { if (inList) { out.push(inList ? '</ul>' : '</ol>'); inList = false; } out.push(''); return; }
      // Normal paragraph line — close list if open
      if (inList)                   { out.push('</ul>'); inList = false; }
      out.push('<p>' + inlineMd(line) + '</p>');
    });
    if (inList) out.push('</ul>');

    return out.join('');
  }

  function inlineMd(text) {
    return text
      .replace(/`([^`]+)`/g, '<code class="oracle-inline-code">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/_([^_]+)_/g, '<em>$1</em>');
  }

  function oracleAppendMessage(role, html, isStreaming) {
    var $history = document.getElementById('oracle-history');
    if (!$history) return null;

    // Hide intro on first message
    var $intro = $history.querySelector('.oracle-intro');
    if ($intro) $intro.style.display = 'none';

    var $msg = document.createElement('div');
    $msg.className = 'oracle-msg oracle-msg--' + role + (isStreaming ? ' oracle-msg--streaming' : '');

    var $bubble = document.createElement('div');
    $bubble.className = 'oracle-msg__bubble';
    if (html) $bubble.innerHTML = html;
    $msg.appendChild($bubble);
    $history.appendChild($msg);
    $msg.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return $bubble;
  }

  function oracleSetStatus(busy) {
    oracleBusy = busy;
    var $btn = document.querySelector('#oracle-form .oracle-input__send');
    if ($btn) $btn.disabled = busy;
    var $field = document.getElementById('oracle-field');
    if ($field) $field.disabled = busy;
  }

  function oracleShowTyping() {
    var $history = document.getElementById('oracle-history');
    if (!$history) return null;
    var $intro = $history.querySelector('.oracle-intro');
    if ($intro) $intro.style.display = 'none';
    var $t = document.createElement('div');
    $t.className = 'oracle-msg oracle-msg--assistant oracle-typing';
    $t.innerHTML = '<div class="oracle-msg__bubble"><span class="oracle-dot"></span><span class="oracle-dot"></span><span class="oracle-dot"></span></div>';
    $history.appendChild($t);
    $t.scrollIntoView({ behavior: 'smooth', block: 'end' });
    return $t;
  }

  async function oracleSend(userText) {
    if (oracleBusy || !userText.trim()) return;
    if (!_oracleKey) {
      showToast('Add your nano-gpt API key in Settings first');
      return;
    }

    oracleSetStatus(true);
    oracleAppendMessage('user', '<p>' + esc(userText) + '</p>', false);
    oracleHistory.push({ role: 'user', content: userText });

    var $typing = oracleShowTyping();

    try {
      var res = await fetch(ORACLE_API + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + _oracleKey
        },
        body: JSON.stringify({
          model:    ORACLE_MODEL,
          stream:   true,
          messages: [{ role: 'system', content: ORACLE_SYSTEM }].concat(oracleHistory)
        })
      });

      if (!res.ok) {
        var errText = await res.text();
        throw new Error('API error ' + res.status + ': ' + errText.slice(0, 120));
      }

      if ($typing) $typing.remove();
      var $bubble = oracleAppendMessage('assistant', '', true);
      var $msg    = $bubble ? $bubble.closest('.oracle-msg') : null;

      var reader  = res.body.getReader();
      var decoder = new TextDecoder();
      var full    = '';

      while (true) {
        var _ref = await reader.read();
        if (_ref.done) break;
        var chunk = decoder.decode(_ref.value, { stream: true });
        chunk.split('\n').forEach(function(line) {
          line = line.trim();
          if (!line || line === 'data: [DONE]') return;
          if (line.startsWith('data: ')) {
            try {
              var delta = JSON.parse(line.slice(6));
              var token = (delta.choices[0].delta || {}).content || '';
              full += token;
              if ($bubble) $bubble.innerHTML = renderOracleMarkdown(full);
              var $h = document.getElementById('oracle-history');
              if ($h) $h.scrollTop = $h.scrollHeight;
            } catch(e) {}
          }
        });
      }

      if ($msg) $msg.classList.remove('oracle-msg--streaming');
      if ($bubble) $bubble.innerHTML = renderOracleMarkdown(full);
      oracleHistory.push({ role: 'assistant', content: full });

    } catch(err) {
      if ($typing) $typing.remove();
      oracleAppendMessage('assistant', '<p class="oracle-error">Error: ' + esc(err.message) + '</p>', false);
    }

    oracleSetStatus(false);
    var $field = document.getElementById('oracle-field');
    if ($field) { $field.focus(); }
  }

  var $oracleForm = document.getElementById('oracle-form');
  if ($oracleForm) {
    $oracleForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var $field = document.getElementById('oracle-field');
      var text   = $field ? $field.value.trim() : '';
      if (!text) return;
      if ($field) $field.value = '';
      oracleSend(text);
    });
  }

  // Clear oracle history when leaving the module (chips re-appear on fresh open)
  // — intentionally NOT clearing on module switch; history persists for the session

}); // end DOMContentLoaded
