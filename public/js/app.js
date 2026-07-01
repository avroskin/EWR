'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let voyages = [];
let currentYear = new Date().getFullYear();
let archivedYears = [];
let partialArchivedYears = [];
let isArchivedYear = false;
let config = { vessels: [], charterers: [], services: [], vesselProfiles: [], riskZones: [] };
let legacyServices = [];
let adminRiskZonesSnapshot = '';
let adminEditingRiskZones = [];
let adminEditingVesselProfiles = [];
let adminRemovedVesselNames = new Set();
let filterTimer = null;
let confirmCallback = null;

// ── Zone metadata ─────────────────────────────────────────────────────────────
let ZONE_LABELS = {
  gulf_of_aden:     'IMS - Gulf of Aden (HRA)',
  southwest_africa: 'SW Africa (HRA)',
  mas_combined:     'MAS - East Med & SW Africa (EWR // K&R)',
  black_sea:        'Black Sea (EWR)',
  east_med:         'E. Mediterranean (EWR)',
  north_africa:     'N. Africa / Libya (LTS)',
  zeynep_c:         'Zeynep C'
};

let ZONE_PORTS = {
  gulf_of_aden:     ['Jeddah', 'Nhava Sheva', 'Mundra'],
  southwest_africa: ['Tincan', 'Apapa', 'Cotonou', 'Lekki'],
  black_sea:        ['Novorossiysk', 'Odessa'],
  east_med:         ['Tartous', 'Beirut', 'Lattakia', 'Tripoli (Lebanon)'],
  north_africa:     ['Misurata', 'Tripoli (Libya)', 'Benghazi', 'Al Khums', 'El Khoms'],
  zeynep_c:         ['Zeynep C']
};

// Zones where calculation is automatic
let AUTO_CALC_ZONES = ['gulf_of_aden', 'southwest_africa', 'mas_combined', 'black_sea', 'east_med'];
let ZONE_EVENT_SETTINGS = {};
const NO_ZONE_TIME_ZONES = ['north_africa'];

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadConfig(), loadArchives()]);
  populateYearSelectors();
  await loadLegacyDropdown();
  await loadVoyages();
});

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    config = await res.json();
    applyRiskZoneConfig();
    renderRiskZoneControls();
    adminRiskZonesSnapshot = JSON.stringify(config.riskZones || [], null, 2);
    adminEditingRiskZones = JSON.parse(adminRiskZonesSnapshot || '[]');
    adminEditingVesselProfiles = JSON.parse(JSON.stringify(config.vesselProfiles || []));
    adminRemovedVesselNames = new Set();
    renderVesselProfileSelect();
    renderVesselProfileEditor();
    renderFormulaZoneSelect();
    renderFormulaEditor();
    updateDatalistOptions();
    renderVesselOptions(document.getElementById('f-zone-select')?.value || '', document.getElementById('f-vesselName')?.value || '');
    updateCalcRuleNote();
  } catch { /* ignore */ }
}

function applyRiskZoneConfig() {
  if (!Array.isArray(config.riskZones) || !config.riskZones.length) return;
  ZONE_LABELS = {};
  ZONE_PORTS = {};
  AUTO_CALC_ZONES = [];
  ZONE_EVENT_SETTINGS = {};
  config.riskZones.forEach(zone => {
    if (!zone.key) return;
    ZONE_LABELS[zone.key] = zone.label || zone.key;
    ZONE_PORTS[zone.key] = Array.isArray(zone.ports) ? zone.ports : [];
    ZONE_EVENT_SETTINGS[zone.key] = getZoneEventSettings(zone);
    if (zone.formula && zone.formula.type && zone.formula.type !== 'manual') AUTO_CALC_ZONES.push(zone.key);
  });
}

function getZoneEventSettings(zoneOrKey) {
  return VoyageEditor.getZoneEventSettings(config, zoneOrKey);
}

function describeZoneCalculation(zoneKey) {
  return VoyageEditor.describeZoneCalculation(config, zoneKey);
}

function vesselProfilesForZone(zoneKey) {
  return VoyageEditor.vesselProfilesForZone(config, zoneKey);
}

function renderVesselOptions(zoneKey, selectedName = '') {
  const select = document.getElementById('f-vesselName');
  if (!select) return;
  const profiles = vesselProfilesForZone(zoneKey);
  const options = profiles.map(profile => profile.name);
  if (selectedName && !options.includes(selectedName)) options.unshift(selectedName);
  select.innerHTML = '<option value="">' + (zoneKey ? 'Select vessel...' : 'Select risk zone first...') + '</option>' +
    options.map(name => '<option value="' + escAttr(name) + '">' + esc(name) + '</option>').join('');
  select.value = selectedName && options.includes(selectedName) ? selectedName : '';
}

function findVesselProfile(name, zoneKey = '') {
  return VoyageEditor.findVesselProfile(config, name, zoneKey);
}

function onVesselProfileChange() {
  const vessel = document.getElementById('f-vesselName')?.value || '';
  const zone = document.getElementById('f-zone-select')?.value || '';
  const profile = findVesselProfile(vessel, zone);
  if (profile && profile.charterer) document.getElementById('f-charterer-form').value = profile.charterer;
}

function setZoneTimesDisabled(disabled) {
  const section = document.getElementById('zone-times-section');
  if (section) section.classList.toggle('zone-times-disabled', disabled);
  ['Entry', 'Exit', 'EntryReturn', 'ExitReturn'].forEach(which => {
    const input = document.getElementById('f-zone' + which);
    const cb = document.getElementById('f-zone' + which + 'Confirmed');
    if (input) {
      input.disabled = disabled;
      refreshDateTime24(input);
    }
    if (cb) cb.disabled = disabled;
  });
}

function zoneWindowFields(windowName) {
  return VoyageEditor.zoneWindowFields(windowName);
}

function zoneWindowToggle(windowName) {
  return document.getElementById(windowName === 'return' ? 'f-zone-return-enabled' : 'f-zone-main-enabled');
}

function zoneWindowHasValues(windowName) {
  return zoneWindowFields(windowName).some(which => !!document.getElementById('f-zone' + which)?.value);
}

function setZoneWindowEnabled(windowName, enabled, options = {}) {
  const toggle = zoneWindowToggle(windowName);
  if (toggle) toggle.checked = !!enabled;
  zoneWindowFields(windowName).forEach(which => {
    const input = document.getElementById('f-zone' + which);
    const cb = document.getElementById('f-zone' + which + 'Confirmed');
    if (!input) return;
    input.disabled = !enabled;
    if (!enabled && options.clear !== false) {
      input.value = '';
      input.classList.remove('field-confirmed', 'field-warning');
      if (cb) cb.checked = false;
    }
    if (cb) cb.disabled = !enabled;
    refreshDateTime24(input);
  });
}

function applyZoneWindowToggles(options = {}) {
  setZoneWindowEnabled('main', !!zoneWindowToggle('main')?.checked, options);
  setZoneWindowEnabled('return', !!zoneWindowToggle('return')?.checked, options);
}

function onZoneWindowToggle(windowName) {
  const enabled = !!zoneWindowToggle(windowName)?.checked;
  setZoneWindowEnabled(windowName, enabled);
  applyEditWarningHighlights();
  if (enabled) triggerCalc();
}

function updateZoneWindowToggleLabels(zone) {
  const main = document.getElementById('zone-main-toggle-label');
  const ret = document.getElementById('zone-return-toggle-label');
  if (main) main.textContent = zone === 'gulf_of_aden' ? 'Show HRA outbound' : 'Show EWR entry / exit';
  if (ret) ret.textContent = zone === 'gulf_of_aden' ? 'Show HRA inbound' : 'Show return zone';
}

function updateZeynepMode() {
  const zone = document.getElementById('f-zone-select')?.value || '';
  const isZeynep = zone === 'zeynep_c';
  const zeynepSection = document.getElementById('zeynep-zone-section');
  const noZoneWrap = document.getElementById('zeynep-no-zone-wrap');
  const noZone = document.getElementById('f-zeynep-no-zone');
  if (zeynepSection) zeynepSection.style.display = isZeynep ? '' : 'none';
  if (noZoneWrap) noZoneWrap.style.display = isZeynep ? '' : 'none';
  if (!isZeynep) {
    setZoneTimesDisabled(false);
    applyZoneWindowToggles({ clear: false });
    return;
  }
  const hasHraPort = hasZeynepHraPorts({ zone: 'zeynep_c', portCalls: getPortCallsFromForm() });
  if (hasHraPort && noZone) noZone.checked = false;
  document.getElementById('zone-times-section').style.display = '';
  const disabled = !hasHraPort && !!noZone?.checked;
  setZoneTimesDisabled(disabled);
  if (!disabled) applyZoneWindowToggles({ clear: false });
}

function onZeynepZoneToggle() {
  updateZeynepMode();
  applyEditWarningHighlights();
}

function updateCalcRuleNote() {
  const note = document.getElementById('calc-rule-note');
  if (!note) return;
  const zone = document.getElementById('f-zone-select')?.value || '';
  const text = describeZoneCalculation(zone);
  note.textContent = text;
  note.style.display = text ? '' : 'none';
}

function renderRiskZoneControls() {
  const dashboardZoneKeys = ['', 'gulf_of_aden', 'mas_combined', 'black_sea', 'north_africa', 'zeynep_c'];
  const dashboardZones = dashboardZoneKeys
    .filter(key => key === '' || (config.riskZones || []).some(z => z.key === key))
    .map(key => key === '' ? { key: '', label: 'All Zones' } : (config.riskZones || []).find(z => z.key === key));
  const tabs = document.querySelector('.zone-tabs-scroll');
  if (tabs) {
    tabs.innerHTML = dashboardZones.map(z => {
      const zoneClass = z.key ? `zone-tab-${esc(z.key)}` : 'zone-tab-all';
      const activeClass = z.key === '' ? ' active' : '';
      return `<button class="zone-tab ${zoneClass}${activeClass}" data-zone="${esc(z.key)}" onclick="setZoneTab(this, '${esc(z.key)}')">${esc(z.label || z.key)}</button>`;
    }).join('');
  }

  const select = document.getElementById('f-zone-select');
  if (select) {
    const current = select.value;
    const selectableZones = VoyageEditor.selectableRiskZones(config, current);
    select.innerHTML = '<option value="">Select...</option>' +
      selectableZones.map(z => `<option value="${esc(z.key)}">${esc(z.label || z.key)}</option>`).join('');
    select.value = current;
  }
}

async function loadArchives() {
  try {
    const res = await fetch('/api/archives');
    const data = await res.json();
    archivedYears = data.archivedYears || [];
    partialArchivedYears = data.partialArchivedYears || [];
  } catch { /* ignore */ }
}

async function loadLegacyDropdown() {
  try {
    const res = await fetch(`/api/voyages?year=${currentYear}&status=legacy`);
    const data = await res.json();
    const legacyList = data.voyages || [];
    const el = document.getElementById('f-legacy');
    if (!el) return;
    const currentVal = el.value;
    const services = new Map();
    legacyList.forEach(v => {
      const service = (v.service || v.zone || '').trim();
      if (!service) return;
      services.set(service, (services.get(service) || 0) + 1);
    });
    const serviceOptions = [...services.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([service, count]) => `<option value="${esc(service)}">${esc(service)} (${count})</option>`)
      .join('');
    legacyServices = [...services.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([service, count]) => ({ service, count }));
    el.innerHTML = '<option value="">Legacy off...</option>' + 
      serviceOptions;
    if (services.has(currentVal)) el.value = currentVal;
    renderLegacyContext();
  } catch {}
}

async function loadVoyages() {
  const params = getFilterParams();
  try {
    const res = await fetch('/api/voyages?' + new URLSearchParams(params));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Data could not be loaded.');
    voyages = data.voyages || [];
    isArchivedYear = data.archived || false;
    renderTable(voyages);
    renderLegacyContext();
    const yearIndicator = document.getElementById('year-indicator');
    if (yearIndicator) yearIndicator.textContent = currentYear;
    document.getElementById('archive-notice').style.display = isArchivedYear ? '' : 'none';
    document.body.classList.toggle('archive-mode', isArchivedYear);
    const addBtn = document.getElementById('btn-add-voyage');
    if (addBtn) {
      addBtn.disabled = isArchivedYear;
      addBtn.title = isArchivedYear ? 'Archived years are read-only.' : '';
    }
    document.getElementById('result-count').textContent = `${voyages.length} records`;
    updateDashboardLastUpdated(voyages);
  } catch {
    showToast('Data could not be loaded.', 'error');
  }
}

// ── Year selectors ────────────────────────────────────────────────────────────
function populateYearSelectors() {
  const yearSet = new Set([currentYear, ...archivedYears, ...partialArchivedYears]);
  const allYears = [...yearSet].sort((a, b) => b - a);
  const fYear = document.getElementById('f-year');
  const adminYear = document.getElementById('admin-archive-year');
  const formYear = document.getElementById('f-year-form');

  fYear.innerHTML = allYears.map(y => {
    const suffix = archivedYears.includes(y) ? ' (Archive)' : (partialArchivedYears.includes(y) ? ' (Partial archive)' : '');
    return `<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}${suffix}</option>`;
  }).join('');

  // Admin: only non-archived years
  const activeYears = allYears.filter(y => !archivedYears.includes(y));
  adminYear.innerHTML = '<option value="">Select...</option>' +
    activeYears.map(y => `<option value="${y}">${y}</option>`).join('');

  if (formYear) formYear.value = currentYear;
}

function onYearChange() {
  currentYear = parseInt(document.getElementById('f-year').value) || new Date().getFullYear();
  loadLegacyDropdown().then(() => loadVoyages());
}

// ── Filters ───────────────────────────────────────────────────────────────────
function getFilterParams() {
  const params = { year: currentYear };
  const legacyService = document.getElementById('f-legacy')?.value;
  
  if (legacyService) {
    params.status = 'legacy';
    params.service = legacyService;
  } else {
    params.status = 'active'; // Only show active by default
  }
  
  const vessel    = document.getElementById('f-vessel')?.value.trim();
  const charterer = document.getElementById('f-charterer')?.value.trim();
  const zone      = document.getElementById('f-zone')?.value;
  const port      = document.getElementById('f-port')?.value.trim();
  const confirmed = document.getElementById('f-confirmed')?.value;
  const dateFrom  = displayDateToIso(document.getElementById('f-date-from')?.value);
  const dateTo    = displayDateToIso(document.getElementById('f-date-to')?.value);

  if (vessel)    params.vessel    = vessel;
  if (charterer) params.charterer = charterer;
  if (!legacyService && zone === 'zeynep_c') { params.zeynepC = '1'; }
  else if (!legacyService && zone) { params.zone = zone; }
  if (port)      params.port      = port;
  if (confirmed) params.confirmed = confirmed;
  if (dateFrom)  params.dateFrom  = dateFrom;
  if (dateTo)    params.dateTo    = dateTo;

  return params;
}

function scheduleFilter() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(loadVoyages, 300);
}

function onLegacyServiceChange() {
  const legacyService = document.getElementById('f-legacy')?.value;
  if (legacyService) {
    document.getElementById('f-zone').value = '';
    document.querySelectorAll('.zone-tab').forEach(t => t.classList.remove('active'));
    const allTab = document.querySelector('.zone-tab[data-zone=""]');
    if (allTab) allTab.classList.add('active');
  }
  scheduleFilter();
  renderLegacyContext();
}

function clearFilters() {
  document.getElementById('f-vessel').value    = '';
  document.getElementById('f-charterer').value = '';
  const fLegacy = document.getElementById('f-legacy');
  if (fLegacy) fLegacy.value = '';
  document.getElementById('f-zone').value      = '';
  
  // reset zone tabs
  document.querySelectorAll('.zone-tab').forEach(t => t.classList.remove('active'));
  const allTab = document.querySelector('.zone-tab[data-zone=""]');
  if (allTab) allTab.classList.add('active');

  document.getElementById('f-port').value      = '';
  document.getElementById('f-confirmed').value = '';
  document.getElementById('f-date-from').value = '';
  document.getElementById('f-date-to').value   = '';
  document.getElementById('f-date-preset').value = '';
  renderLegacyContext();
  loadVoyages();
}

function setZoneTab(btn, zone) {
  document.querySelectorAll('.zone-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('f-zone').value = zone;
  const legacy = document.getElementById('f-legacy');
  if (legacy) legacy.value = '';
  clearTimelineFiltersForZoneTab();
  scheduleFilter();
  renderLegacyContext();
}

function clearTimelineFiltersForZoneTab() {
  ['f-vessel', 'f-charterer', 'f-port', 'f-confirmed', 'f-date-from', 'f-date-to', 'f-date-preset'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function setLegacyService(service) {
  const legacy = document.getElementById('f-legacy');
  if (!legacy) return;
  legacy.value = service;
  onLegacyServiceChange();
}

function renderLegacyContext() {
  const context = document.getElementById('legacy-context');
  const tabs = document.getElementById('legacy-service-tabs');
  const title = document.getElementById('legacy-context-title');
  const count = document.getElementById('legacy-context-count');
  const selected = document.getElementById('f-legacy')?.value || '';
  if (!context || !tabs || !title || !count) return;

  if (!selected) {
    context.style.display = 'none';
    tabs.innerHTML = '';
    return;
  }

  const current = legacyServices.find(item => item.service === selected);
  context.style.display = '';
  title.textContent = selected;
  count.textContent = `${voyages.length} record${voyages.length === 1 ? '' : 's'}`;
  tabs.innerHTML = legacyServices.map(item => {
    const active = item.service === selected ? ' active' : '';
    return `<button class="legacy-service-tab${active}" data-service="${escAttr(item.service)}" onclick="setLegacyService(this.dataset.service)">
      <span>${esc(item.service)}</span>
      <small>${item.count}</small>
    </button>`;
  }).join('');

  if (!current && selected) {
    tabs.insertAdjacentHTML('afterbegin', `<button class="legacy-service-tab active" data-service="${escAttr(selected)}" onclick="setLegacyService(this.dataset.service)">
      <span>${esc(selected)}</span>
      <small>${voyages.length}</small>
    </button>`);
  }
}

function applyDatePreset() {
  const days = parseInt(document.getElementById('f-date-preset').value);
  if (!days) return;
  const to   = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  document.getElementById('f-date-from').value = isoDateToDisplay(from.toISOString().slice(0, 10));
  document.getElementById('f-date-to').value   = isoDateToDisplay(to.toISOString().slice(0, 10));
  scheduleFilter();
}

function buildDashboardTimeline(voyage) {
  const zoneKey = voyage.isZeynepC ? 'zeynep_c' : (voyage.zone || '');
  const zoneEvents = ZONE_EVENT_SETTINGS[zoneKey] || getZoneEventSettings(zoneKey);
  const splitZone = !!zoneEvents.split || zoneKey === 'zeynep_c';
  const timeline = TimelineEvents.buildTimelineEvents(voyage, config).flatMap(event => {
    if (event.kind === 'zone_window') {
      const eventLabel = event.label || zoneEvents.label || 'EWR';
      if (splitZone && zoneKey !== 'gulf_of_aden') {
        const points = [];
        if (event.entry) points.push({ type: 'zonePoint', zoneKey, eventLabel, title: eventLabel + ' ENTRY', label: 'Entry', date: event.entry, confirmed: !!event.entryConfirmed });
        if (event.exit) points.push({ type: 'zonePoint', zoneKey, eventLabel, title: eventLabel + ' EXIT', label: 'Exit', date: event.exit, confirmed: !!event.exitConfirmed, pinEnd: !!zoneEvents.pinExitToEnd });
        return points;
      }
      return [{
        type: 'zoneRange',
        zoneKey,
        eventLabel,
        title: event.title,
        entry: event.entry,
        entryConfirmed: !!event.entryConfirmed,
        exit: event.exit,
        exitConfirmed: !!event.exitConfirmed,
        manualNeeded: false
      }];
    }
    if (event.kind === 'manual_needed') {
      return [{
        type: 'zoneRange',
        zoneKey,
        eventLabel: event.label || zoneEvents.label || 'EWR',
        title: event.title,
        entry: null,
        entryConfirmed: false,
        exit: null,
        exitConfirmed: false,
        manualNeeded: true,
        manualSortTime: event.sortTime || null
      }];
    }
    if (event.kind === 'port_call') {
      return [{
        type: 'port',
        port: event.port,
        eta: event.eta,
        ets: event.ets,
        etaConfirmed: event.etaConfirmed,
        etsConfirmed: event.etsConfirmed,
        omit: event.omitted
      }];
    }
    return [];
  });
  return timeline.sort((a, b) => {
    if (!!a.pinEnd !== !!b.pinEnd) return a.pinEnd ? 1 : -1;
    const getTime = item => {
      if (item.manualSortTime) return item.manualSortTime;
      if (item.type === 'zoneRange') return item.entry ? new Date(item.entry).getTime() : (item.exit ? new Date(item.exit).getTime() : Infinity);
      if (item.type === 'zonePoint') return item.date ? new Date(item.date).getTime() : Infinity;
      return item.eta ? new Date(item.eta).getTime() : (item.ets ? new Date(item.ets).getTime() : Infinity);
    };
    return getTime(a) - getTime(b);
  });
}

// ── Table render ──────────────────────────────────────────────────────────────
function renderTable(list) {
  const tbody = document.getElementById('voyages-body');
  const table = document.getElementById('voyages-table');
  const showZoneColumn = false;
  if (table) table.classList.toggle('show-zone-column', false);
  if (table) table.classList.toggle('archive-readonly', isArchivedYear);

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${showZoneColumn ? 6 : 5}" class="loading-cell">No records found.</td></tr>`;
    return;
  }

  // Sort list in descending order (newest/future events first)
  list.sort((a, b) => {
    const getEarliest = (v) => {
      let dates = [];
      if (v.zoneEntry) dates.push(new Date(v.zoneEntry).getTime());
      if (v.portCalls && v.portCalls.length > 0) {
        v.portCalls.forEach(p => {
          if (p.eta) dates.push(new Date(p.eta).getTime());
          if (p.ets) dates.push(new Date(p.ets).getTime());
        });
      }
      return dates.length > 0 ? Math.min(...dates) : new Date(v.createdAt || 0).getTime();
    };
    return getEarliest(b) - getEarliest(a);
  });

  tbody.innerHTML = list.map(v => {
    const zoneKey  = v.isZeynepC ? 'zeynep_c' : (v.zone || '');
    const voyageWarnings = buildVoyageWarnings(v);
    const issueMessages = voyageWarnings.map(w => w.message + (w.context ? ' | ' + w.context : ''));
    const issueCount = voyageWarnings.length;
    const issuePill = issueCount
      ? `<span class="import-flag-pill" title="${escAttr(issueMessages.join(' | '))}" aria-label="Check warning">!</span>`
      : '';
    const timeline = buildDashboardTimeline(v);

    const timelineHtml = timeline.map(item => {
      if (item.type === 'zoneRange') {
        const completed = !item.manualNeeded && (!!item.entry || !!item.exit) && (!item.entry || item.entryConfirmed) && (!item.exit || item.exitConfirmed);
        const entryDone = !!item.entryConfirmed;
        const exitDone = !!item.exitConfirmed;
        const inProgress = entryDone && !!item.exit && !exitDone;
        const entryHtml = item.entry
          ? `<span class="zone-card-time ${entryDone ? 'confirmed' : ''}">Entry: ${fmtDate(item.entry)}</span>`
          : (item.manualNeeded ? '<span class="zone-card-time manual-needed-text">Entry: manual needed</span>' : '');
        const exitHtml = item.exit
          ? `<span class="zone-card-time ${exitDone ? 'confirmed' : ''}">Exit: ${fmtDate(item.exit)}</span>`
          : (item.manualNeeded ? '<span class="zone-card-time manual-needed-text">Exit: manual needed</span>' : '');
        const separator = entryHtml && exitHtml ? '<span class="timeline-separator">//</span>' : '';
        return `<div class="port-card zone-card zone-range-card zone-card-${esc(item.zoneKey || '')} event-label-${eventLabelClass(item.eventLabel)} ${completed ? 'confirmed-card' : ''} ${inProgress ? 'in-zone-card' : ''} ${item.manualNeeded ? 'manual-needed-card' : ''}">
          <div class="zone-card-title">${item.title}</div>
          <div class="timeline-card-line">
            ${entryHtml}
            ${separator}
            ${exitHtml}
          </div>
        </div>`;
      } else if (item.type === 'zonePoint') {
        const completed = !!item.confirmed;
        return `<div class="port-card zone-card zone-card-${esc(item.zoneKey || '')} event-label-${eventLabelClass(item.eventLabel)} ${completed ? 'confirmed-card' : ''}">
          <div class="zone-card-title">${item.title}</div>
          <div class="timeline-card-line">
            <span class="zone-card-time ${completed ? 'confirmed' : ''}">${item.label}: ${fmtDate(item.date)}</span>
          </div>
        </div>`;
      } else {
        if (item.omit) {
          const etaDone = !!item.etaConfirmed;
          const etsDone = !!item.etsConfirmed;
          const etaText = etaDone ? 'ATA' : 'ETA';
          const etsText = etsDone ? 'ATD' : 'ETD';
          let html = `<div class="port-card omit">
            <div class="port-card-title port-card-title-row">
              <span>${esc(item.port || '—')}</span>
              <span class="port-card-omit-inline">OMIT</span>
            </div>
            <div class="timeline-card-line">`;
          if (item.eta) html += `<span class="port-card-time">${etaText}: <span style="text-decoration:line-through">${fmtDate(item.eta)}</span></span>`;
          if (item.eta && item.ets) html += '<span class="timeline-separator">//</span>';
          if (item.ets) html += `<span class="port-card-time">${etsText}: <span style="text-decoration:line-through">${fmtDate(item.ets)}</span></span>`;
          html += `</div></div>`;
          return html;
        }
        const etaDone = !!item.etaConfirmed;
        const etsDone = !!item.etsConfirmed;
        const isConf = (!!item.eta || !!item.ets) && (!item.eta || etaDone) && (!item.ets || etsDone);
        const etaClass = etaDone ? 'confirmed' : '';
        const etsClass = etsDone ? 'confirmed' : '';
        const etaText = etaDone ? 'ATA' : 'ETA';
        const etsText = etsDone ? 'ATD' : 'ETD';
        
        let html = `<div class="port-card ${isConf ? 'confirmed-card' : ''}">
          <div class="port-card-title">${esc(item.port || '—')}</div>
          <div class="timeline-card-line">`;
          
        if (item.eta || item.etaConfirmed) {
          html += `<span class="port-card-time ${etaClass}">${etaText}: ${fmtDate(item.eta)}</span>`;
        }
        if ((item.eta || item.etaConfirmed) && (item.ets || item.etsConfirmed)) html += '<span class="timeline-separator">//</span>';
        if (item.ets || item.etsConfirmed) {
          html += `<span class="port-card-time ${etsClass}">${etsText}: ${fmtDate(item.ets)}</span>`;
        }
        
        html += `</div></div>`;
        return html;
      }
    }).join('');

    const timelineCell = `<td class="ports-timeline-cell"><div class="ports-timeline">${timelineHtml || '—'}</div></td>`;
    const notesText = (v.notes || '').trim();
    const notesCell = notesText
      ? `<td class="notes-cell"><div class="notes-preview" title="${escAttr(notesText)}">${esc(notesText)}</div></td>`
      : '<td class="notes-cell notes-empty">—</td>'; 

    const rowWarningClass = issueCount ? ' warning-row' : '';
    const readOnlyRow = isArchivedYear || v.status === 'legacy';
    return `<tr class="row-zone-${zoneKey}${rowWarningClass}${readOnlyRow ? ' archived-row' : ''}"${readOnlyRow ? '' : ` onclick="openEditForm('${v.id}')"`}> 
      <td class="vessel-cell"><div class="name-cell-wrap">${nameFitHtml(v.vesselName || '—', 'vessel-name-fit')}${issuePill}</div></td>
      <td class="charterer-cell">${nameFitHtml(normalizeChartererName(v.charterer) || '—', 'charterer-name-fit')}</td>
      ${timelineCell}
      ${notesCell}
      <td class="row-actions-cell" onclick="event.stopPropagation()">
        <div class="action-btns">
          ${!(isArchivedYear || v.status === 'legacy') ? `<button class="btn-icon del" onclick="deleteVoyage('${v.id}')" title="Delete">🗑</button>` : ''}
          ${(isArchivedYear || v.status === 'legacy') ? '<span class="readonly-pill">Read only</span>' : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function normalizePortNameForRisk(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .trim();
}

function hasZeynepHraPorts(voyage) {
  if ((voyage.zoneEntry || voyage.zoneExit || voyage.zoneEntryReturn || voyage.zoneExitReturn) && voyage.zone === 'zeynep_c') return true;
  return (voyage.portCalls || []).some(port => {
    const name = normalizePortNameForRisk(port.port);
    return name.includes('odessa') || name.includes('odesa') || name.includes('chornomorsk') || name.includes('chernomorsk') || name.includes('chronomork') || name.includes('gulf of aden hra');
  });
}

function getVoyageFirstEventTime(voyage) {
  const times = [];
  (voyage.portCalls || []).forEach(port => {
    if (port.eta) times.push(new Date(port.eta).getTime());
    if (port.ets) times.push(new Date(port.ets).getTime());
  });
  ['zoneEntry', 'zoneExit', 'zoneEntryReturn', 'zoneExitReturn'].forEach(field => {
    if (voyage[field]) times.push(new Date(voyage[field]).getTime());
  });
  return times.filter(Number.isFinite).sort((a, b) => a - b)[0] || null;
}

// ── Date formatting ───────────────────────────────────────────────────────────
function getVoyageLastEventTime(voyage) {
  const times = [];
  (voyage.portCalls || []).forEach(port => {
    if (port.eta) times.push(new Date(port.eta).getTime());
    if (port.ets) times.push(new Date(port.ets).getTime());
  });
  ['zoneEntry', 'zoneExit', 'zoneEntryReturn', 'zoneExitReturn'].forEach(field => {
    if (voyage[field]) times.push(new Date(voyage[field]).getTime());
  });
  return times.filter(Number.isFinite).sort((a, b) => b - a)[0] || null;
}

function fmtUpdated(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `Updated ${dd}/${mm} ${hh}:${min}`;
}

function normalizeChartererName(value) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.toLowerCase() === 'cma' ? 'CMA CGM' : clean;
}

function nameFitHtml(value, className) {
  const text = value || '-';
  return `<span class="${className}" title="${escAttr(text)}">${esc(text)}</span>`;
}

function updateDashboardLastUpdated(list) {
  const el = document.getElementById('dashboard-last-updated');
  if (!el) return;
  const latest = (list || [])
    .map(v => new Date(v.updatedAt || v.createdAt || 0).getTime())
    .filter(t => Number.isFinite(t) && t > 0)
    .sort((a, b) => b - a)[0];
  el.textContent = latest ? fmtUpdated(new Date(latest).toISOString()) : 'Updated -';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh   = String(d.getHours()).padStart(2, '0');
  const min  = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function isoToLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoDateToDisplay(value) {
  if (!value) return '';
  const isoDate = String(value).slice(0, 10);
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return match[3] + '/' + match[2] + '/' + match[1];
}

function displayDateToIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  const compact = raw.replace(/\D/g, '');
  let dd = '', mm = '', yyyy = '';
  if (compact.length === 8) {
    dd = compact.slice(0, 2);
    mm = compact.slice(2, 4);
    yyyy = compact.slice(4, 8);
  } else {
    const parts = raw.split(/[^0-9]/).filter(Boolean);
    if (parts.length !== 3) return '';
    [dd, mm, yyyy] = parts;
    if (yyyy.length === 2) yyyy = '20' + yyyy;
  }
  dd = dd.padStart(2, '0');
  mm = mm.padStart(2, '0');
  if (!/^\d{4}$/.test(yyyy)) return '';
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (date.getFullYear() !== Number(yyyy) || date.getMonth() !== Number(mm) - 1 || date.getDate() !== Number(dd)) return '';
  return yyyy + '-' + mm + '-' + dd;
}

function normalizeDateDisplayInput(input) {
  if (!input) return;
  const iso = displayDateToIso(input.value);
  if (iso) input.value = isoDateToDisplay(iso);
}
function enhanceDateTimeInputs(scope = document) {
  const inputs = scope.querySelectorAll('input[type="datetime-local"]:not([data-dt24-ready])');
  inputs.forEach(input => {
    input.dataset.dt24Ready = '1';
    input.classList.add('dt24-source');

    const wrap = document.createElement('div');
    wrap.className = 'dt24-control';
    const date = document.createElement('input');
    date.type = 'text';
    date.className = 'dt24-date';
    date.placeholder = 'dd/mm/yyyy';
    date.inputMode = 'numeric';
    date.maxLength = 10;
    const time = document.createElement('input');
    time.type = 'text';
    time.className = 'dt24-time';
    time.placeholder = 'HH:MM';
    time.inputMode = 'numeric';
    time.maxLength = 5;
    wrap.append(date, time);
    input.insertAdjacentElement('afterend', wrap);

    const syncFromSource = () => {
      const [datePart, timePart = '00:00'] = (input.value || '').split('T');
      date.value = isoDateToDisplay(datePart);
      const [hh = '00', mm = '00'] = timePart.split(':');
      time.value = `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
      const disabled = input.disabled;
      date.disabled = disabled;
      time.disabled = disabled;
      wrap.classList.toggle('field-confirmed', input.classList.contains('field-confirmed'));
      wrap.classList.toggle('field-warning', input.classList.contains('field-warning'));
      wrap.style.opacity = input.style.opacity || '';
    };

    const syncToSource = () => {
      const normalized = normalizeTime24(time.value);
      const isoDate = displayDateToIso(date.value);
      time.value = normalized;
      if (isoDate) date.value = isoDateToDisplay(isoDate);
      input.value = isoDate ? isoDate + 'T' + normalized : '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    time.addEventListener('input', () => {
      const digits = time.value.replace(/\D/g, '').slice(0, 4);
      if (digits.length <= 2) time.value = digits;
      else time.value = `${digits.slice(0, 2)}:${digits.slice(2)}`;
      if (digits.length === 4 && displayDateToIso(date.value)) syncToSource();
    });
    date.addEventListener('input', () => {
      const digits = date.value.replace(/\D/g, '').slice(0, 8);
      if (digits.length <= 2) date.value = digits;
      else if (digits.length <= 4) date.value = digits.slice(0, 2) + '/' + digits.slice(2);
      else date.value = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
    });
    date.addEventListener('change', syncToSource);
    date.addEventListener('blur', syncToSource);
    time.addEventListener('change', syncToSource);
    time.addEventListener('blur', syncToSource);
    input._syncDateTime24 = syncFromSource;
    syncFromSource();
  });
}

function normalizeTime24(value) {
  const digits = String(value || '').replace(/\D/g, '').padEnd(4, '0').slice(0, 4);
  const hour = Math.min(23, Number(digits.slice(0, 2) || 0));
  const minute = Math.min(59, Number(digits.slice(2, 4) || 0));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function refreshDateTime24(input) {
  if (input && typeof input._syncDateTime24 === 'function') input._syncDateTime24();
}

function zoneInput(which) {
  return document.getElementById('f-zone' + which);
}

function setZoneCalculatedValue(which, iso) {
  const input = zoneInput(which);
  if (!input) return;
  input.dataset.calculatedValue = isoToLocal(iso) || '';
}

function clearZoneInputTracking() {
  ['Entry', 'Exit', 'EntryReturn', 'ExitReturn'].forEach(which => {
    const input = zoneInput(which);
    if (!input) return;
    delete input.dataset.autoValue;
    delete input.dataset.calculatedValue;
    delete input.dataset.manualEdited;
  });
}

function hasManualZoneEdit(which) {
  const input = zoneInput(which);
  if (!input || !input.value) return false;
  if (input.dataset.manualEdited === '1') return true;
  const calculatedValue = input.dataset.calculatedValue || '';
  const autoValue = input.dataset.autoValue || '';
  return !!calculatedValue && input.value !== calculatedValue && input.value !== autoValue;
}

function applyCalculatedZoneValue(which, iso) {
  const input = zoneInput(which);
  const confirmed = document.getElementById('f-zone' + which + 'Confirmed')?.checked;
  if (!input || confirmed || hasManualZoneEdit(which)) return;
  input.value = isoToLocal(iso);
  input.dataset.autoValue = input.value;
  input.dataset.manualEdited = '0';
  refreshDateTime24(input);
}

function localToISO(local) {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function getMasEwrExitForTimeline(voyage) {
  const HOURS = 60 * 60 * 1000;
  const candidates = (voyage.portCalls || [])
    .filter(p => !p.omit && p.port && ['tincan', 'apapa'].includes(p.port.trim().toLowerCase()) && p.ets);
  if (!candidates.length) return voyage.zoneExit || null;
  const last = candidates[candidates.length - 1];
  const ets = new Date(last.ets);
  if (isNaN(ets.getTime())) return voyage.zoneExit || null;
  return new Date(ets.getTime() + 10 * HOURS).toISOString();
}

function buildVoyageFormIssueState(voyage) {
  const state = { ports: new Map(), zone: [] };
  const dayMs = 24 * 60 * 60 * 1000;
  const parse = iso => {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  };
  const addPortIssue = (index, message) => {
    if (!state.ports.has(index)) state.ports.set(index, []);
    state.ports.get(index).push(message);
  };
  const addZoneIssue = (fields, message) => {
    state.zone.push({ fields, message });
  };

  (voyage.portCalls || []).forEach((pc, idx) => {
    const eta = parse(pc.eta);
    const ets = parse(pc.ets);
    const port = pc.port || 'Port ' + (idx + 1);
    if (!eta || !ets) return;
    const diff = ets.getTime() - eta.getTime();
    if (diff < 0) addPortIssue(idx, port + ': ETD is before ETA.');
    else if (diff > 5 * dayMs) addPortIssue(idx, port + ': stay is longer than 5 days (' + Math.round(diff / dayMs) + ' days).');
  });

  [
    ['zoneEntry', 'zoneExit', 'Zone entry/exit', ['Entry', 'Exit']],
    ['zoneEntryReturn', 'zoneExitReturn', 'Return entry/exit', ['EntryReturn', 'ExitReturn']]
  ].forEach(([entryField, exitField, label, fieldKeys]) => {
    const entry = parse(voyage[entryField]);
    const exit = parse(voyage[exitField]);
    if (!entry || !exit) return;
    const diff = exit.getTime() - entry.getTime();
    if (diff < 0) addZoneIssue(fieldKeys, label + ': exit is before entry.');
    else if (diff > 45 * dayMs) addZoneIssue(fieldKeys, label + ': range is longer than 45 days (' + Math.round(diff / dayMs) + ' days).');
  });

  return state;
}

function getVoyageDraftFromForm() {
  return {
    id: document.getElementById('f-id')?.value || '',
    vesselName: document.getElementById('f-vesselName')?.value || '',
    charterer: document.getElementById('f-charterer-form')?.value || '',
    zone: document.getElementById('f-zone-select')?.value || null,
    portCalls: getPortCallsFromForm(),
    zoneEntry: localToISO(document.getElementById('f-zoneEntry')?.value),
    zoneExit: localToISO(document.getElementById('f-zoneExit')?.value),
    zoneEntryReturn: localToISO(document.getElementById('f-zoneEntryReturn')?.value),
    zoneExitReturn: localToISO(document.getElementById('f-zoneExitReturn')?.value)
  };
}

function fieldHintId(which) {
  return 'calc-' + which.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '') + '-hint';
}

function applyEditWarningHighlights(voyage = null) {
  const form = document.getElementById('voyage-form');
  if (!form) return;
  const draft = voyage || getVoyageDraftFromForm();
  const issueState = buildVoyageFormIssueState(draft);

  document.querySelectorAll('#port-calls-list .port-row').forEach((row, idx) => {
    const messages = issueState.ports.get(idx) || [];
    row.classList.toggle('port-row-warning', messages.length > 0);
    let messageEl = row.querySelector('.port-warning-msg');
    if (!messageEl) {
      messageEl = document.createElement('div');
      messageEl.className = 'port-warning-msg';
      row.appendChild(messageEl);
    }
    messageEl.textContent = messages.join(' ');
  });

  document.querySelectorAll('.zone-warning-msg').forEach(el => el.remove());
  ['Entry', 'Exit', 'EntryReturn', 'ExitReturn'].forEach(which => {
    const input = document.getElementById('f-zone' + which);
    if (!input) return;
    input.classList.remove('field-warning');
    refreshDateTime24(input);
  });

  issueState.zone.forEach(issue => {
    issue.fields.forEach(which => {
      const input = document.getElementById('f-zone' + which);
      if (!input) return;
      input.classList.add('field-warning');
      refreshDateTime24(input);
    });
    const target = document.getElementById(fieldHintId(issue.fields[1])) || document.getElementById('calc-exit-hint');
    if (target) {
      const msg = document.createElement('small');
      msg.className = 'zone-warning-msg';
      msg.textContent = issue.message;
      target.insertAdjacentElement('afterend', msg);
    }
  });
}

function buildVoyageWarnings(voyage) {
  const warnings = [];
  const dayMs = 24 * 60 * 60 * 1000;
  const add = (severity, type, message, context = '') => warnings.push({ severity, type, message, context });
  const parse = iso => {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  };

  (voyage.portCalls || []).forEach((pc, idx) => {
    const eta = parse(pc.eta);
    const ets = parse(pc.ets);
    const port = pc.port || `Port ${idx + 1}`;
    if (!eta || !ets) return;
    const diff = ets.getTime() - eta.getTime();
    if (diff < 0) add('high', 'Reversed port dates', `${port} ETD is before ETA.`, `${fmtDate(pc.eta)} -> ${fmtDate(pc.ets)}`);
    else if (diff > 5 * dayMs) add('medium', 'Long port stay', `${port} stay is longer than 5 days.`, `${Math.round(diff / dayMs)} days`);
  });

  [
    ['zoneEntry', 'zoneExit', 'Zone entry/exit'],
    ['zoneEntryReturn', 'zoneExitReturn', 'Return entry/exit']
  ].forEach(([entryField, exitField, label]) => {
    const entry = parse(voyage[entryField]);
    const exit = parse(voyage[exitField]);
    if (!entry || !exit) return;
    const diff = exit.getTime() - entry.getTime();
    if (diff < 0) add('high', 'Reversed zone dates', `${label} is reversed.`, `${fmtDate(voyage[entryField])} -> ${fmtDate(voyage[exitField])}`);
    else if (diff > 45 * dayMs) add('medium', 'Long zone range', `${label} is longer than 45 days.`, `${Math.round(diff / dayMs)} days`);
  });

  return warnings;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(str) {
  return esc(str).replace(/'/g, '&#39;');
}

function eventLabelClass(label) {
  return String(label || 'zone').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'zone';
}

function isCompletedDate(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  return !isNaN(d.getTime()) && d.getTime() <= Date.now();
}

function areAllDatedEventsCompleted(dates) {
  const validDates = dates.filter(Boolean);
  return validDates.length > 0 && validDates.every(isCompletedDate);
}

// ── Autocomplete ──────────────────────────────────────────────────────────────
function updateDatalistOptions() {
  setDatalist('list-charterers', config.charterers || []);

  setSelectOptions('f-vessel', 'All', config.vessels || []);
  setSelectOptions('f-charterer', 'All', config.charterers || []);
  setSelectOptions('f-service', 'Select service...', config.services || []);
}

function setDatalist(id, values) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = values.map(v => `<option value="${esc(v)}">`).join('');
}

function setSelectOptions(id, placeholder, values) {
  const el = document.getElementById(id);
  if (el && el.tagName === 'SELECT') {
    const currentVal = el.value;
    const options = Array.isArray(values) ? [...values] : [];
    if (currentVal && !options.includes(currentVal)) options.unshift(currentVal);
    el.innerHTML = `<option value="">${placeholder}</option>` + options.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    el.value = currentVal;
  }
}

// ── Add/Edit Form ─────────────────────────────────────────────────────────────
let editingId = null;

function openAddForm() {
  editingId = null;
  document.getElementById('form-title').textContent = 'Add New Voyage';
  document.getElementById('f-id').value = '';
  document.getElementById('f-status').value = 'active';
  document.getElementById('f-is-zeynep').value = '0';
  renderVesselOptions('', '');
  document.getElementById('f-charterer-form').value = '';
  document.getElementById('f-service').value    = '';
  document.getElementById('f-notes').value = '';
  document.getElementById('f-zeynep-zone-name').value = '';
  document.getElementById('f-zeynep-no-zone').checked = true;
  document.getElementById('f-zone-select').value = '';
  updateCalcRuleNote();
  updateZeynepMode();
  document.getElementById('f-zoneEntry').value  = '';
  document.getElementById('f-zoneExit').value   = '';
  document.getElementById('f-zoneEntryConfirmed').checked = false;
  document.getElementById('f-zoneExitConfirmed').checked  = false;
  document.getElementById('f-zoneEntryReturn').value  = '';
  document.getElementById('f-zoneExitReturn').value   = '';
  document.getElementById('f-zoneEntryReturnConfirmed').checked = false;
  document.getElementById('f-zoneExitReturnConfirmed').checked  = false;
  document.getElementById('calc-entry-hint').textContent = '';
  document.getElementById('calc-exit-hint').textContent  = '';
  document.getElementById('calc-entry-return-hint').textContent = '';
  document.getElementById('calc-exit-return-hint').textContent  = '';
  document.getElementById('f-zoneEntry').classList.remove('field-confirmed');
  document.getElementById('f-zoneExit').classList.remove('field-confirmed');
  document.getElementById('f-zoneEntryReturn').classList.remove('field-confirmed');
  document.getElementById('f-zoneExitReturn').classList.remove('field-confirmed');
  clearZoneInputTracking();

  // Set year form to current active year
  const formYear = document.getElementById('f-year-form');
  if (formYear) formYear.value = currentYear;

  // Zone times are calculated from ports while adding; editing is where actual times are confirmed.
  document.getElementById('zone-group').style.display = '';
  document.getElementById('zone-return-head').style.display = 'none';
  document.getElementById('zone-return-times').style.display = 'none';
  document.getElementById('zone-times-section').style.display = 'none';
  updateZoneWindowToggleLabels('');
  setZoneWindowEnabled('main', false, { clear: false });
  setZoneWindowEnabled('return', false, { clear: false });

  // Port calls
  renderPortCalls([]);
  enhanceDateTimeInputs(document.getElementById('voyage-form'));
  applyEditWarningHighlights();

  openModal('voyage-modal');
}

async function openEditForm(id) {
  try {
    const res = await fetch(`/api/voyages/${id}?year=${currentYear}`);
    if (!res.ok) throw new Error();
    const v = await res.json();

    editingId = id;
    document.getElementById('form-title').textContent = 'Edit Voyage';
    document.getElementById('f-id').value = id;
    document.getElementById('f-status').value = v.status || 'active';
    document.getElementById('f-is-zeynep').value = v.isZeynepC ? '1' : '0';
    renderVesselOptions(v.zone || '', v.vesselName || '');
    document.getElementById('f-charterer-form').value = normalizeChartererName(v.charterer) || '';
    document.getElementById('f-service').value    = v.service    || '';
    document.getElementById('f-notes').value = v.notes || '';
    document.getElementById('f-zeynep-zone-name').value = v.zeynepZoneName || '';
    document.getElementById('f-zeynep-no-zone').checked = v.zone === 'zeynep_c' && !(v.zoneEntry || v.zoneExit || v.zoneEntryReturn || v.zoneExitReturn);
    document.getElementById('f-zone-select').value = v.zone || '';
    renderVesselOptions(v.zone || '', v.vesselName || '');
    updateCalcRuleNote();
    updateZeynepMode();
    document.getElementById('f-zoneEntry').value  = isoToLocal(v.zoneEntry);
    document.getElementById('f-zoneExit').value   = isoToLocal(v.zoneExit);
    document.getElementById('f-zoneEntryConfirmed').checked = !!v.zoneEntryConfirmed;
    document.getElementById('f-zoneExitConfirmed').checked  = !!v.zoneExitConfirmed;
    document.getElementById('f-zoneEntryReturn').value  = isoToLocal(v.zoneEntryReturn);
    document.getElementById('f-zoneExitReturn').value   = isoToLocal(v.zoneExitReturn);
    document.getElementById('f-zoneEntryReturnConfirmed').checked = !!v.zoneEntryReturnConfirmed;
    document.getElementById('f-zoneExitReturnConfirmed').checked  = !!v.zoneExitReturnConfirmed;
    document.getElementById('f-year-form').value = v.year || currentYear;
    updateZoneWindowToggleLabels(v.zone || '');
    setZoneWindowEnabled('main', !!(v.zoneEntry || v.zoneExit), { clear: false });
    setZoneWindowEnabled('return', !!(v.zoneEntryReturn || v.zoneExitReturn), { clear: false });

    // Update confirmed visual
    toggleConfirmedStyle('Entry', !!v.zoneEntryConfirmed);
    toggleConfirmedStyle('Exit',  !!v.zoneExitConfirmed);
    toggleConfirmedStyle('EntryReturn', !!v.zoneEntryReturnConfirmed);
    toggleConfirmedStyle('ExitReturn',  !!v.zoneExitReturnConfirmed);

    document.getElementById('zone-group').style.display = '';
    document.getElementById('zone-return-head').style.display = v.zone === 'gulf_of_aden' ? '' : 'none';
    document.getElementById('zone-return-times').style.display = v.zone === 'gulf_of_aden' ? '' : 'none';
    document.getElementById('zone-times-section').style.display = NO_ZONE_TIME_ZONES.includes(v.zone) ? 'none' : '';
    updateZeynepMode();

    updateCalcHints(v.zoneEntryCalculated, v.zoneExitCalculated, v.zoneEntryReturnCalculated, v.zoneExitReturnCalculated);
    renderPortCalls(v.portCalls || []);
    updateZeynepMode();
    enhanceDateTimeInputs(document.getElementById('voyage-form'));
    applyEditWarningHighlights(v);

    openModal('voyage-modal');
  } catch {
    showToast('Record could not be loaded.', 'error');
  }
}

function onZoneChange() {
  const zone = document.getElementById('f-zone-select').value;
  updateCalcRuleNote();
  updateZoneWindowToggleLabels(zone);
  document.getElementById('zone-return-head').style.display = zone === 'gulf_of_aden' ? '' : 'none';
  document.getElementById('zone-return-times').style.display = zone === 'gulf_of_aden' ? '' : 'none';
  if (zone !== 'gulf_of_aden') setZoneWindowEnabled('return', false);
  document.getElementById('zone-times-section').style.display = (!NO_ZONE_TIME_ZONES.includes(zone) && (zone === 'gulf_of_aden' || editingId || (zone && !AUTO_CALC_ZONES.includes(zone)))) ? '' : 'none';
  document.getElementById('f-is-zeynep').value = zone === 'zeynep_c' ? '1' : '0';
  renderVesselOptions(zone, zone === 'zeynep_c' ? 'ZEYNEP C' : '');
  onVesselProfileChange();
  if (zone === 'zeynep_c' && !editingId) renderPortCalls([]);
  updateZeynepMode();

  // Suggest default ports for this zone
  if (zone && zone !== 'zeynep_c' && ZONE_PORTS[zone]) {
    const existing = getPortCallsFromForm();
    if (existing.length === 0) {
      renderPortCalls(VoyageEditor.defaultPortCallsForZone(zone, ZONE_PORTS[zone]));
    }
  }

  triggerCalc();
}

function triggerCalc() {
  const zone      = document.getElementById('f-zone-select').value;
  applyEditWarningHighlights();
  if (NO_ZONE_TIME_ZONES.includes(zone)) {
    document.getElementById('zone-times-section').style.display = 'none';
    updateZeynepMode();
    return;
  }
  if (!zone || !AUTO_CALC_ZONES.includes(zone)) {
    document.getElementById('zone-times-section').style.display = zone ? '' : 'none';
    updateZeynepMode();
    return;
  }

  const portCalls = getPortCallsFromForm();

  fetch('/api/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone, portCalls })
  }).then(r => r.json()).then(data => {
    const statuses = data.statuses || {};
    updateCalcHints(data.zoneEntry, data.zoneExit, data.zoneEntryReturn, data.zoneExitReturn, statuses);
    const hasCalculatedTimes = !!(data.zoneEntry || data.zoneExit || data.zoneEntryReturn || data.zoneExitReturn);
    const needsManualTiming = statuses.main === 'missing_anchor' || statuses.return === 'missing_anchor';
    document.getElementById('zone-times-section').style.display = (zone === 'gulf_of_aden' || editingId || !hasCalculatedTimes || needsManualTiming) ? '' : 'none';
    if (!editingId) {
      if (data.zoneEntry || data.zoneExit || statuses.main === 'missing_anchor') setZoneWindowEnabled('main', true, { clear: false });
      if (data.zoneEntryReturn || data.zoneExitReturn || statuses.return === 'missing_anchor') setZoneWindowEnabled('return', true, { clear: false });
    }

    const canApplyMain = !statuses.main || statuses.main === 'ok';
    const canApplyReturn = !statuses.return || statuses.return === 'ok';
    if (canApplyMain && zoneWindowToggle('main')?.checked) applyCalculatedZoneValue('Entry', data.zoneEntry);
    if (canApplyMain && zoneWindowToggle('main')?.checked) applyCalculatedZoneValue('Exit', data.zoneExit);
    if (canApplyReturn && zoneWindowToggle('return')?.checked) applyCalculatedZoneValue('EntryReturn', data.zoneEntryReturn);
    if (canApplyReturn && zoneWindowToggle('return')?.checked) applyCalculatedZoneValue('ExitReturn', data.zoneExitReturn);
    applyEditWarningHighlights();
    updateZeynepMode();
  }).catch(() => {});
}

function updateCalcHints(entry, exit, entryReturn, exitReturn, statuses = {}) {
  setZoneCalculatedValue('Entry', entry);
  setZoneCalculatedValue('Exit', exit);
  setZoneCalculatedValue('EntryReturn', entryReturn);
  setZoneCalculatedValue('ExitReturn', exitReturn);
  const manualText = 'Manual needed';
  document.getElementById('calc-entry-hint').textContent = entry ? `Hesaplanan: ${fmtDate(entry)}` : (statuses.main === 'missing_anchor' ? manualText : '');
  document.getElementById('calc-exit-hint').textContent  = exit  ? `Hesaplanan: ${fmtDate(exit)}`  : (statuses.main === 'missing_anchor' ? manualText : '');
  document.getElementById('calc-entry-return-hint').textContent = entryReturn ? `Hesaplanan: ${fmtDate(entryReturn)}` : (statuses.return === 'missing_anchor' ? manualText : '');
  document.getElementById('calc-exit-return-hint').textContent  = exitReturn  ? `Hesaplanan: ${fmtDate(exitReturn)}`  : (statuses.return === 'missing_anchor' ? manualText : '');
}

function onZoneManualEdit(which) {
  const input = zoneInput(which);
  if (input) input.dataset.manualEdited = input.value && input.value !== (input.dataset.autoValue || '') ? '1' : '0';
  applyEditWarningHighlights();
}

function onConfirmToggle(which) {
  const cb = document.getElementById(`f-zone${which}Confirmed`);
  toggleConfirmedStyle(which, cb.checked);
}

function toggleConfirmedStyle(which, confirmed) {
  const input = document.getElementById(`f-zone${which}`);
  if (confirmed) {
    input.classList.add('field-confirmed');
  } else {
    input.classList.remove('field-confirmed');
  }
  refreshDateTime24(input);
}

// ── Port Calls ────────────────────────────────────────────────────────────────
let dragSrcIndex = null;

function renderPortCalls(portCalls) {
  const container = document.getElementById('port-calls-list');
  container.innerHTML = '';
  portCalls.forEach((pc, i) => addPortRow(pc, i));
}

function addPortRow(pc, idx) {
  pc = pc || { port: '', eta: null, ets: null, omit: false, etaConfirmed: false, etsConfirmed: false };
  const container = document.getElementById('port-calls-list');
  const i = idx !== undefined ? idx : container.children.length;
  const showConfirmControls = !!editingId;

  const row = document.createElement('div');
  row.className = 'port-row' + (pc.etaConfirmed ? ' eta-confirmed' : '') + (pc.etsConfirmed ? ' ets-confirmed' : '') + (pc.omit ? ' omit-row' : '');
  row.draggable = true;
  row.dataset.index = i;
  if (pc.role) row.dataset.role = pc.role;
  if (pc.port) row.dataset.basePort = pc.port;
  if (pc.visibleLabel) row.dataset.visibleLabel = pc.visibleLabel;
  row.dataset.arrivalEnabled = pc.arrivalEnabled === false ? 'false' : 'true';
  row.dataset.departureEnabled = pc.departureEnabled === false ? 'false' : 'true';
  const portDisplayValue = pc.visibleLabel || pc.port || '';
  const arrivalDisabledAttr = pc.arrivalEnabled === false ? ' disabled' : '';
  const departureDisabledAttr = pc.departureEnabled === false ? ' disabled' : '';

  row.innerHTML = `
    <span class="port-drag-handle" title="Drag">⠿</span>
    <div class="port-row-fields">
      <input type="text" class="port-name" placeholder="Port name" value="${esc(portDisplayValue)}"
        oninput="triggerCalc(); updateZeynepMode(); applyEditWarningHighlights()" list="port-suggestions">
      <div class="port-time-group">
        <input type="datetime-local" lang="en-GB" class="eta-field${pc.etaConfirmed ? ' field-confirmed' : ''}" value="${isoToLocal(pc.eta)}"${arrivalDisabledAttr}
          oninput="triggerCalc(); applyEditWarningHighlights()">
        <div class="port-confirm-cb ${showConfirmControls ? '' : 'hidden-confirm'}" title="ETA completed">
          <input type="checkbox" class="eta-confirmed-cb" ${pc.etaConfirmed ? 'checked' : ''}${arrivalDisabledAttr}
            onchange="onPortConfirmChange(this,'eta')">
        </div>
      </div>
      <div class="port-time-group">
        <input type="datetime-local" lang="en-GB" class="ets-field${pc.etsConfirmed ? ' field-confirmed' : ''}" value="${isoToLocal(pc.ets)}"${departureDisabledAttr}
          oninput="triggerCalc(); applyEditWarningHighlights()">
        <div class="port-confirm-cb ${showConfirmControls ? '' : 'hidden-confirm'}" title="ETD completed">
          <input type="checkbox" class="ets-confirmed-cb" ${pc.etsConfirmed ? 'checked' : ''}${departureDisabledAttr}
            onchange="onPortConfirmChange(this,'ets')">
        </div>
      </div>
    </div>
    <button type="button" class="port-omit-btn ${pc.omit ? 'omit-active' : ''}"
      onclick="togglePortOmit(this)" title="OMIT - Vessel did not call this port">
      OMIT
    </button>
    <button type="button" class="port-remove-btn" onclick="removePortRow(this)" title="Delete port call">Delete</button>
  `;

  // Drag events
  row.addEventListener('dragstart', onDragStart);
  row.addEventListener('dragover',  onDragOver);
  row.addEventListener('drop',      onDrop);
  row.addEventListener('dragend',   onDragEnd);

  container.appendChild(row);
  enhanceDateTimeInputs(row);
}

function onPortConfirmChange(cb, field) {
  const row = cb.closest('.port-row');
  const input = row.querySelector(`.${field}-field`);
  if (cb.checked) {
    input.classList.add('field-confirmed');
    row.classList.add(`${field}-confirmed`);
  } else {
    input.classList.remove('field-confirmed');
    row.classList.remove(`${field}-confirmed`);
  }
  refreshDateTime24(input);
}

function togglePortOmit(btn) {
  btn.classList.toggle('omit-active');
  const isOmit = btn.classList.contains('omit-active');
  btn.textContent = 'OMIT';
  const row = btn.closest('.port-row');
  row.classList.toggle('omit-row', isOmit);
  row.querySelectorAll('input[type="datetime-local"]').forEach(refreshDateTime24);
  triggerCalc();
  updateZeynepMode();
  applyEditWarningHighlights();
}

function removePortRow(btn) {
  btn.closest('.port-row').remove();
  triggerCalc();
  updateZeynepMode();
  applyEditWarningHighlights();
}

// ── Drag & Drop port reordering ───────────────────────────────────────────────
function onDragStart(e) {
  dragSrcIndex = [...this.parentElement.children].indexOf(this);
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.port-row').forEach(r => r.classList.remove('drag-over'));
  this.classList.add('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  const container = document.getElementById('port-calls-list');
  const rows = [...container.children];
  const destIndex = rows.indexOf(this);
  if (dragSrcIndex === destIndex) return;

  const src = rows[dragSrcIndex];
  container.removeChild(src);

  const newRows = [...container.children];
  if (destIndex >= newRows.length) {
    container.appendChild(src);
  } else {
    container.insertBefore(src, newRows[destIndex]);
  }

  triggerCalc();
  applyEditWarningHighlights();
}

function onDragEnd() {
  this.classList.remove('dragging');
  document.querySelectorAll('.port-row').forEach(r => r.classList.remove('drag-over'));
}

function getPortCallsFromForm() {
  return VoyageEditor.collectPortCalls(document.getElementById('port-calls-list'), localToISO);
}

// ── Submit voyage ─────────────────────────────────────────────────────────────
async function submitVoyage(e) {
  e.preventDefault();

  const id = document.getElementById('f-id').value;
  const payload = VoyageEditor.buildVoyagePayload({
    document,
    currentYear,
    localToISO,
    isZoneWindowEnabled: windowName => !!zoneWindowToggle(windowName)?.checked,
    hasZeynepHraPorts
  });

  if (!payload.vesselName) {
    showToast('Vessel name is required.', 'error');
    return;
  }
  if (!payload.zone) {
    showToast('Risk zone is required.', 'error');
    return;
  }

  try {
    const url    = id ? `/api/voyages/${id}` : '/api/voyages';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Record could not be saved.');
    }

    closeModal('voyage-modal');
    showToast(id ? 'Record updated.' : 'New voyage added.', 'success');
    await loadLegacyDropdown();
    await loadVoyages();
  } catch (err) {
    showToast(err.message || 'An error occurred.', 'error');
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
function deleteVoyage(id) {
  const voyage = voyages.find(v => v.id === id);
  const name = voyage ? `${voyage.vesselName} - ${ZONE_LABELS[voyage.zone] || voyage.zone || 'Zeynep C'}` : 'this record';

  showConfirm(
    'Seferi Sil',
    `Are you sure you want to delete "${name}"? This action cannot be undone.`,
    async () => {
      try {
        const res = await fetch(`/api/voyages/${id}?year=${currentYear}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        showToast('Record deleted.', 'success');
        await loadLegacyDropdown();
        await loadVoyages();
      } catch {
        showToast('Delete failed.', 'error');
      }
    }
  );
}

// ── Export ────────────────────────────────────────────────────────────────────
function doExport() {
  const params = getFilterParams();
  const url = '/api/export?' + new URLSearchParams(params);
  window.location.href = url;
}

// ── Admin ─────────────────────────────────────────────────────────────────────
let settingsUnlocked = false;
let adminToken = '';

function adminHeaders(extra = {}) {
  return { ...extra, ...(adminToken ? { 'x-admin-token': adminToken } : {}) };
}

async function unlockSettings() {
  const entered = window.prompt('Settings password');
  if (!entered) return false;
  try {
    const res = await fetch('/api/admin/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: entered })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Settings password is incorrect.');
    adminToken = data.token || '';
    settingsUnlocked = !!adminToken;
    return settingsUnlocked;
  } catch (err) {
    showToast(err.message || 'Settings password is incorrect.', 'error');
    return false;
  }
}

async function openAdmin() {
  if (!settingsUnlocked && !(await unlockSettings())) return;

  const cfg = config;
  adminRiskZonesSnapshot = JSON.stringify(cfg.riskZones || [], null, 2);
  adminEditingRiskZones = JSON.parse(adminRiskZonesSnapshot || '[]');
  adminEditingVesselProfiles = JSON.parse(JSON.stringify(cfg.vesselProfiles || []));
  adminRemovedVesselNames = new Set();
  renderVesselProfileSelect();
  renderVesselProfileEditor();
  renderFormulaZoneSelect();
  renderFormulaEditor();
  document.getElementById('admin-archive-result').textContent = '';
  document.getElementById('admin-config-result').textContent  = '';
  setAdminResult('', '');
  loadServiceLifecycle();
  openModal('admin-modal');
}

async function loadServiceLifecycle() {
  const summaryEl = document.getElementById('service-summary');
  if (!summaryEl) return;
  summaryEl.innerHTML = '<div class="service-summary-muted">Loading services...</div>';

  try {
    const res = await fetch('/api/services?' + new URLSearchParams({ year: currentYear }));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    renderServiceLifecycle(data.services || []);
  } catch (err) {
    summaryEl.innerHTML = '<div class="service-summary-muted error">Services could not be loaded.</div>';
  }
}

function renderServiceLifecycle(items) {
  const summaryEl = document.getElementById('service-summary');
  const closeSelect = document.getElementById('admin-close-service');
  if (!summaryEl || !closeSelect) return;

  const activeItems = items.filter(item => Number(item.active || 0) > 0);
  closeSelect.innerHTML = '<option value="">Select...</option>' + activeItems.map(item =>
    `<option value="${escAttr(item.service)}">${esc(item.service)} (${item.active} active)</option>`
  ).join('');

  if (!items.length) {
    summaryEl.innerHTML = '<div class="service-summary-muted">No services yet.</div>';
    return;
  }

  summaryEl.innerHTML = items.map(item => {
    const active = Number(item.active || 0);
    const legacy = Number(item.legacy || 0);
    const status = active > 0 ? 'Active' : (legacy > 0 ? 'Legacy only' : 'Open');
    const statusClass = active > 0 ? 'active' : (legacy > 0 ? 'legacy' : 'open');
    return `
      <div class="service-summary-row">
        <div>
          <strong>${esc(item.service)}</strong>
          <span class="service-status-pill ${statusClass}">${status}</span>
        </div>
        <div class="service-counts">
          <span>${active} active</span>
          <span>${legacy} legacy</span>
        </div>
      </div>
    `;
  }).join('');
}

function setAdminResult(message, type = '') {
  const el = document.getElementById('admin-service-result');
  if (!el) return;
  el.textContent = message || '';
  el.className = 'admin-result' + (type ? ' ' + type : '');
}

async function openServiceFromAdmin() {
  const input = document.getElementById('admin-service-name');
  const service = (input?.value || '').trim();
  if (!service) {
    setAdminResult('Please enter a service name.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/services/open', {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ service, year: currentYear })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (input) input.value = '';
    await loadConfig();
    renderServiceLifecycle(data.services || []);
    setAdminResult(`${data.service} is ready for new voyages.`, 'success');
    showToast('Service opened.', 'success');
  } catch (err) {
    setAdminResult(err.message || 'Service could not be opened.', 'error');
  }
}

async function closeServiceFromAdmin() {
  const select = document.getElementById('admin-close-service');
  const service = (select?.value || '').trim();
  if (!service) {
    setAdminResult('Please select an active service.', 'error');
    return;
  }

  showConfirm(
    'Move Service to Legacy',
    `All active ${service} records for ${currentYear} will move to legacy. They will stay available from the legacy selector and export. Continue?`,
    async () => {
      try {
        const res = await fetch('/api/services/close', {
          method: 'POST',
          headers: adminHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ service, year: currentYear })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        await loadConfig();
        await loadLegacyDropdown();
        await loadVoyages();
        renderServiceLifecycle(data.services || []);
        setAdminResult(`${data.service}: moved ${data.changed} active records to legacy.`, 'success');
        showToast('Service moved to legacy.', 'success');
      } catch (err) {
        setAdminResult(err.message || 'Service could not be moved to legacy.', 'error');
      }
    }
  );
}

async function doArchive() {
  const year = parseInt(document.getElementById('admin-archive-year').value);
  if (!year) {
    document.getElementById('admin-archive-result').textContent = 'Please select a year.';
    document.getElementById('admin-archive-result').className = 'admin-result error';
    return;
  }

  showConfirm(
    'Archive Until 20.10',
    `${year} records ending before 20.10.${year} will move to read-only archive storage. Records on 20.10.${year} and later stay active. Do you want to continue?`,
    async () => {
      try {
        const res = await fetch(`/api/archive/${year}`, { method: 'POST', headers: adminHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        document.getElementById('admin-archive-result').textContent = `${year}: archived ${data.count} records before 20.10; ${data.remaining} records remain active.`;
        document.getElementById('admin-archive-result').className = 'admin-result success';
        await loadArchives();
        populateYearSelectors();
        await loadVoyages();
      } catch (err) {
        document.getElementById('admin-archive-result').textContent = err.message || 'Archive failed.';
        document.getElementById('admin-archive-result').className = 'admin-result error';
      }
    }
  );
}

function normalizeVesselNameForSettings(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function allAdminVesselNames() {
  const names = new Set([...(config.vessels || []), ...adminEditingVesselProfiles.map(profile => profile.name).filter(Boolean)]);
  adminRemovedVesselNames.forEach(name => names.delete(name));
  return [...names].sort((a, b) => a.localeCompare(b));
}

function findEditableVesselProfile(name) {
  return adminEditingVesselProfiles.find(item => item.name === name) || null;
}

function getEditableVesselProfile(name) {
  const cleanName = normalizeVesselNameForSettings(name);
  if (!cleanName) return null;
  adminRemovedVesselNames.delete(cleanName);
  let profile = findEditableVesselProfile(cleanName);
  if (!profile) {
    const existing = (config.vesselProfiles || []).find(item => item.name === cleanName) || {};
    profile = { name: cleanName, charterer: existing.charterer || '', zones: Array.isArray(existing.zones) ? [...existing.zones] : [] };
    adminEditingVesselProfiles.push(profile);
    adminEditingVesselProfiles.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }
  if (!Array.isArray(profile.zones)) profile.zones = [];
  return profile;
}

function renderVesselProfileSelect(selectedName) {
  const select = document.getElementById('vessel-profile-select');
  if (!select) return;
  const names = allAdminVesselNames();
  const current = normalizeVesselNameForSettings(selectedName || select.value || names[0] || '');
  select.innerHTML = names.map(name => {
    const profile = findEditableVesselProfile(name);
    const count = profile && Array.isArray(profile.zones) ? profile.zones.length : 0;
    return `<option value="${escAttr(name)}">${esc(name)}${count ? ' (' + count + ')' : ''}</option>`;
  }).join('');
  select.value = names.includes(current) ? current : (names[0] || '');
}

function renderVesselProfileEditor() {
  const select = document.getElementById('vessel-profile-select');
  const title = document.getElementById('vessel-profile-title');
  const subtitle = document.getElementById('vessel-profile-subtitle');
  const container = document.getElementById('vessel-zone-checkboxes');
  const removeBtn = document.getElementById('vessel-profile-remove');
  if (!select || !title || !subtitle || !container) return;
  const name = select.value;
  if (!name) {
    title.textContent = 'No vessel selected';
    subtitle.textContent = 'Add a vessel or select one from the list';
    container.innerHTML = '';
    if (removeBtn) removeBtn.disabled = true;
    return;
  }
  const profile = getEditableVesselProfile(name);
  title.textContent = name;
  subtitle.textContent = (profile.zones || []).length + ' zone' + ((profile.zones || []).length === 1 ? '' : 's');
  if (removeBtn) removeBtn.disabled = false;
  container.innerHTML = (config.riskZones || []).map(zone => {
    const checked = (profile.zones || []).includes(zone.key) ? ' checked' : '';
    return `<label class="vessel-zone-check"><input type="checkbox" value="${escAttr(zone.key)}"${checked} onchange="onVesselZoneCheckboxChange()"> <span>${esc(zone.label || zone.key)}</span></label>`;
  }).join('');
}

function onVesselProfileSelectChange() {
  renderVesselProfileEditor();
}

function onVesselProfileNameKeydown(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  addVesselProfileFromSettings();
}

function addVesselProfileFromSettings() {
  const input = document.getElementById('vessel-profile-new-name');
  const name = normalizeVesselNameForSettings(input?.value || '');
  const result = document.getElementById('admin-config-result');
  if (!name) {
    if (result) {
      result.textContent = 'Enter a vessel name first.';
      result.className = 'admin-result error';
    }
    return;
  }
  getEditableVesselProfile(name);
  if (input) input.value = '';
  renderVesselProfileSelect(name);
  renderVesselProfileEditor();
  if (result) {
    result.textContent = 'Vessel added. Choose zones, then save settings.';
    result.className = 'admin-result';
  }
}

function removeSelectedVesselProfile() {
  const select = document.getElementById('vessel-profile-select');
  const name = select?.value || '';
  if (!name) return;
  adminRemovedVesselNames.add(name);
  adminEditingVesselProfiles = adminEditingVesselProfiles.filter(profile => profile.name !== name);
  renderVesselProfileSelect();
  renderVesselProfileEditor();
  const result = document.getElementById('admin-config-result');
  if (result) {
    result.textContent = 'Vessel removed from zone assignments. Save settings to keep this change.';
    result.className = 'admin-result';
  }
}

function onVesselZoneCheckboxChange() {
  const select = document.getElementById('vessel-profile-select');
  const name = select?.value || '';
  if (!name) return;
  const profile = getEditableVesselProfile(name);
  profile.zones = [...document.querySelectorAll('#vessel-zone-checkboxes input[type="checkbox"]:checked')]
    .map(input => input.value)
    .filter(Boolean);
  renderVesselProfileSelect(name);
  renderVesselProfileEditor();
}

function collectVesselProfilesForSave() {
  return allAdminVesselNames().map(name => {
    const edited = getEditableVesselProfile(name);
    const existing = (config.vesselProfiles || []).find(item => item.name === name) || {};
    return {
      name,
      charterer: edited?.charterer || existing.charterer || '',
      zones: Array.isArray(edited?.zones) ? edited.zones : []
    };
  }).filter(profile => profile.name);
}

function collectVesselsForSave() {
  return allAdminVesselNames();
}

function renderFormulaZoneSelect(selectedKey) {
  const select = document.getElementById('formula-zone-select');
  if (!select) return;
  const current = selectedKey || select.value || adminEditingRiskZones[0]?.key || '';
  select.innerHTML = adminEditingRiskZones.map(zone =>
    `<option value="${escAttr(zone.key)}">${esc(zone.label || zone.key)}</option>`
  ).join('');
  select.value = adminEditingRiskZones.some(zone => zone.key === current) ? current : (adminEditingRiskZones[0]?.key || '');
}

function onFormulaZoneSelectChange() {
  const desiredKey = document.getElementById('formula-zone-select')?.value;
  saveVisibleFormulaCard();
  renderFormulaZoneSelect(desiredKey);
  renderFormulaEditor();
}

function renderFormulaEditor() {
  const editor = document.getElementById('formula-editor');
  if (!editor) return;
  const selectedKey = document.getElementById('formula-zone-select')?.value;
  const zone = adminEditingRiskZones.find(item => item.key === selectedKey) || adminEditingRiskZones[0];
  editor.innerHTML = zone ? renderFormulaCard(zone) : '';
  editor.querySelectorAll('[data-field="type"]').forEach(onFormulaTypeChange);
}

function renderFormulaCard(zone) {
  const formula = zone.formula || { type: 'manual' };
  const type = formula.type || 'manual';
  const zoneEvents = getZoneEventSettings(zone);
  const isZeynepOption = !!zone.isZeynepOption || zone.key === 'zeynep_c';
  const typeClass = type === 'first_last_offset' ? 'first-last' : (type === 'jeddah_hra' ? 'jeddah' : 'manual');
  const keyLocked = (config.riskZones || []).some(saved => saved.key === zone.key);
  const keyAttrs = keyLocked ? ' readonly title="Existing zone keys are locked to protect saved voyages."' : '';
  return '<div class="formula-card type-' + typeClass + '" data-key="' + escAttr(zone.key) + '">' +
    '<div class="formula-card-head"><div><strong>' + esc(zone.label || zone.key) + '</strong><span>' + esc(zone.key) + '</span></div>' +
    '<label class="formula-check compact"><input type="checkbox" data-field="zoneEventsEnabled"' + (zoneEvents.enabled ? ' checked' : '') + '> Show zone entry/exit on timeline</label></div>' +
    '<div class="formula-grid simple-rule-grid">' +
      '<label>Zone Key<input data-field="key" value="' + escAttr(zone.key || '') + '"' + keyAttrs + '></label>' +
      '<label>Display Name<input data-field="label" value="' + escAttr(zone.label || '') + '"></label>' +
      '<label>Formula<select data-field="type" onchange="onFormulaTypeChange(this)">' +
        '<option value="manual"' + (type === 'manual' ? ' selected' : '') + '>Manual</option>' +
        '<option value="first_last_offset"' + (type === 'first_last_offset' ? ' selected' : '') + '>First/last port offset</option>' +
        '<option value="jeddah_hra"' + (type === 'jeddah_hra' ? ' selected' : '') + '>Jeddah HRA</option>' +
      '</select></label>' +
      '<label class="full-span">Default Ports<textarea data-field="ports" rows="2">' + esc((zone.ports || []).join('\n')) + '</textarea></label>' +
      '<label>Timeline Label<input data-field="zoneEventsLabel" value="' + escAttr(zoneEvents.label || 'EWR') + '"></label>' +
      '<label class="formula-check"><input type="checkbox" data-field="zoneEventsSplit"' + (zoneEvents.split ? ' checked' : '') + '> Separate entry and exit cards</label>' +
      '<label class="formula-check"><input type="checkbox" data-field="zoneEventsPinExit"' + (zoneEvents.pinExitToEnd ? ' checked' : '') + '> Place exit at end</label>' +
      '<label class="formula-check"><input type="checkbox" data-field="isZeynepOption"' + (isZeynepOption ? ' checked' : '') + '> Zeynep C / special manual zone</label>' +
      '<label class="formula-field formula-first-last full-span">Formula Ports<textarea data-field="formulaPorts" rows="2">' + esc((formula.formulaPorts || []).join('\n')) + '</textarea></label>' +
      '<label class="formula-field formula-first-last">Entry Offset Hours<input type="number" data-field="entryOffsetHours" value="' + escAttr(formula.entryOffsetHours ?? 0) + '"></label>' +
      '<label class="formula-field formula-first-last">Exit Offset Hours<input type="number" data-field="exitOffsetHours" value="' + escAttr(formula.exitOffsetHours ?? 0) + '"></label>' +
      '<label class="formula-field formula-jeddah">Anchor Port<input data-field="anchorPort" value="' + escAttr(formula.anchorPort || 'Jeddah') + '"></label>' +
      '<label class="formula-field formula-jeddah">Outbound After ETD<input type="number" data-field="outboundAfterEtsHours" value="' + escAttr(formula.outboundAfterEtsHours ?? 14) + '"></label>' +
      '<label class="formula-field formula-jeddah">Transit Hours<input type="number" data-field="transitHours" value="' + escAttr(formula.transitHours ?? 48) + '"></label>' +
      '<label class="formula-field formula-jeddah">Inbound Before ETA<input type="number" data-field="inboundBeforeEtaHours" value="' + escAttr(formula.inboundBeforeEtaHours ?? 62) + '"></label>' +
      '<label class="formula-field formula-jeddah">Inbound Exit Before ETA<input type="number" data-field="inboundExitBeforeEtaHours" value="' + escAttr(formula.inboundExitBeforeEtaHours ?? 14) + '"></label>' +
    '</div></div>';
}

function addFormulaZone() {
  saveVisibleFormulaCard();
  const key = `new_zone_${adminEditingRiskZones.length + 1}`;
  adminEditingRiskZones.push({
    key,
    label: 'New Zone',
    ports: [],
    formula: { type: 'manual' },
    zoneEvents: { enabled: false, split: false, pinExitToEnd: false, label: 'EWR' }
  });
  renderFormulaZoneSelect(key);
  renderFormulaEditor();
}

function onFormulaTypeChange(select) {
  const card = select.closest('.formula-card');
  if (!card) return;
  const type = select.value;
  card.classList.toggle('type-first-last', type === 'first_last_offset');
  card.classList.toggle('type-jeddah', type === 'jeddah_hra');
}

function collectFormulaCard(card) {
    const get = field => card.querySelector(`[data-field="${field}"]`)?.value || '';
    const checked = field => !!card.querySelector(`[data-field="${field}"]`)?.checked;
    const list = field => get(field).split('\n').map(s => s.trim()).filter(Boolean);
    const number = field => Number(get(field) || 0);
    const type = get('type') || 'manual';
    const zone = {
      key: get('key').trim() || card.dataset.key,
      label: get('label').trim() || card.dataset.key,
      ports: list('ports'),
      formula: { type },
      zoneEvents: {
        enabled: checked('zoneEventsEnabled'),
        split: checked('zoneEventsSplit'),
        pinExitToEnd: checked('zoneEventsPinExit'),
        label: get('zoneEventsLabel').trim() || 'EWR'
      }
    };
    if (checked('isZeynepOption')) zone.isZeynepOption = true;
    if (type === 'first_last_offset') {
      const formulaPorts = list('formulaPorts');
      if (formulaPorts.length) zone.formula.formulaPorts = formulaPorts;
      zone.formula.entryOffsetHours = number('entryOffsetHours');
      zone.formula.exitOffsetHours = number('exitOffsetHours');
    }
    if (type === 'jeddah_hra') {
      zone.formula.anchorPort = get('anchorPort').trim() || 'Jeddah';
      zone.formula.outboundAfterEtsHours = number('outboundAfterEtsHours');
      zone.formula.transitHours = number('transitHours');
      zone.formula.inboundBeforeEtaHours = number('inboundBeforeEtaHours');
      zone.formula.inboundExitBeforeEtaHours = number('inboundExitBeforeEtaHours');
    }
    return zone;
}

function saveVisibleFormulaCard() {
  const card = document.querySelector('#formula-editor .formula-card');
  if (!card) return;
  const originalKey = card.dataset.key;
  const updated = collectFormulaCard(card);
  const idx = adminEditingRiskZones.findIndex(zone => zone.key === originalKey);
  if (idx >= 0) adminEditingRiskZones[idx] = updated;
  else adminEditingRiskZones.push(updated);
  renderFormulaZoneSelect(updated.key);
}

function collectFormulaEditorRules() {
  saveVisibleFormulaCard();
  const seen = new Set();
  for (const zone of adminEditingRiskZones) {
    if (seen.has(zone.key)) throw new Error('Risk zone keys must be unique: ' + zone.key);
    seen.add(zone.key);
  }
  return adminEditingRiskZones;
}

async function saveAdminConfig() {
  let riskZones;
  try {
    riskZones = collectFormulaEditorRules();
  } catch (err) {
    document.getElementById('admin-config-result').textContent = err.message || 'Rule validation failed.';
    document.getElementById('admin-config-result').className = 'admin-result error';
    return;
  }
  if (!Array.isArray(riskZones) || !riskZones.length) {
    document.getElementById('admin-config-result').textContent = 'At least one rule is required.';
    document.getElementById('admin-config-result').className = 'admin-result error';
    return;
  }

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ riskZones, vesselProfiles: collectVesselProfilesForSave() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed.');
    config = data;
    applyRiskZoneConfig();
    renderRiskZoneControls();
    adminEditingVesselProfiles = JSON.parse(JSON.stringify(config.vesselProfiles || []));
    adminRemovedVesselNames = new Set();
    renderVesselProfileSelect();
    renderVesselProfileEditor();
    renderFormulaZoneSelect();
    renderFormulaEditor();
    updateDatalistOptions();
    renderVesselOptions(document.getElementById('f-zone-select')?.value || '', document.getElementById('f-vesselName')?.value || '');
    document.getElementById('admin-config-result').textContent = 'Saved.';
    document.getElementById('admin-config-result').className = 'admin-result success';
  } catch (err) {
    document.getElementById('admin-config-result').textContent = err.message || 'Save failed.';
    document.getElementById('admin-config-result').className = 'admin-result error';
  }
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
  document.body.style.overflow = '';
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
function showConfirm(title, message, onAccept) {
  document.getElementById('confirm-title').textContent   = title;
  document.getElementById('confirm-message').textContent = message;
  confirmCallback = onAccept;
  openModal('confirm-modal');
}

function confirmAccept() {
  closeModal('confirm-modal');
  if (confirmCallback) confirmCallback();
  confirmCallback = null;
}

function confirmReject() {
  closeModal('confirm-modal');
  confirmCallback = null;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ` ${type}` : '');
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

// Close modals on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['confirm-modal', 'voyage-modal', 'admin-modal'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.style.display !== 'none') closeModal(id);
    });
  }
});
