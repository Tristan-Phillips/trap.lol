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

  function initBestiarySearch() {
    var $search = document.getElementById('bestiary-search');
    if (!$search) return;
    $search.addEventListener('input', function() {
      var q = $search.value.toLowerCase().trim();
      var filtered = q
        ? state.bestiary.monsters.filter(function(m) { return m.name.toLowerCase().includes(q); })
        : state.bestiary.monsters;
      state.bestiary.filtered = filtered;
      renderMonsterList(filtered);
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
      + '</div></div>';

    $panel.querySelectorAll('.stat-block__roll-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { rollFromAction(btn.dataset.action, m); });
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

  function initSpellSearch() {
    var $search = document.getElementById('spell-search');
    if (!$search) return;
    $search.addEventListener('input', function() {
      var q = $search.value.toLowerCase().trim();
      var filtered = q
        ? state.spells.spells.filter(function(s) { return s.name.toLowerCase().includes(q); })
        : state.spells.spells;
      renderSpellList(filtered);
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
      + '</div>';
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

  // Party state persisted in sessionStorage (lost on tab close, not page refresh)
  var party = [];

  function partyLoad() {
    try {
      var raw = sessionStorage.getItem('dndm_party');
      if (raw) party = JSON.parse(raw);
    } catch(e) { party = []; }
  }

  function partySave() {
    try { sessionStorage.setItem('dndm_party', JSON.stringify(party)); } catch(e) {}
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
      id:         partyUid(),
      name:       name,
      cls:        document.getElementById('char-class').value.trim(),
      race:       document.getElementById('char-race').value.trim(),
      player:     document.getElementById('char-player').value.trim(),
      hp:         hpMax,
      hpMax:      hpMax,
      ac:         parseInt(document.getElementById('char-ac').value) || null,
      initBonus:  parseInt(document.getElementById('char-init-bonus').value) || 0,
      conditions: [],
      dsSucc:     0,
      dsFail:     0,
      deaths:     0
    };

    party.push(pc);
    partySave();
    closeModal($charModal);

    // Clear fields
    ['char-name','char-class','char-race','char-player','char-hp-max','char-ac','char-init-bonus']
      .forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });

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
