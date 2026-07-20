'use strict';

const WINDOW_DEFS = Object.freeze({
  main: {
    key: 'main',
    label: 'EWR',
    kind: 'main',
    entryField: 'zoneEntry',
    entryConfirmedField: 'zoneEntryConfirmed',
    exitField: 'zoneExit',
    exitConfirmedField: 'zoneExitConfirmed'
  },
  hra_outbound: {
    key: 'hra_outbound',
    label: 'HRA Outbound',
    kind: 'hra_outbound',
    entryField: 'zoneEntry',
    entryConfirmedField: 'zoneEntryConfirmed',
    exitField: 'zoneExit',
    exitConfirmedField: 'zoneExitConfirmed'
  },
  hra_inbound: {
    key: 'hra_inbound',
    label: 'HRA Inbound',
    kind: 'hra_inbound',
    entryField: 'zoneEntryReturn',
    entryConfirmedField: 'zoneEntryReturnConfirmed',
    exitField: 'zoneExitReturn',
    exitConfirmedField: 'zoneExitReturnConfirmed'
  }
});

function isHraZone(voyage) {
  return voyage && voyage.zone === 'gulf_of_aden';
}

function isZeynep(voyage) {
  return voyage && (voyage.zone === 'zeynep_c' || voyage.isZeynepC);
}

function hasLegacyWindow(voyage, def) {
  return !!(voyage[def.entryField] || voyage[def.exitField] || voyage[def.entryConfirmedField] || voyage[def.exitConfirmedField]);
}

function cloneExistingWindow(window) {
  return {
    key: window.key || 'main',
    label: window.label || 'Zone',
    kind: window.kind || window.key || 'main',
    enabled: window.enabled !== false,
    entry: window.entry || null,
    entryConfirmed: !!window.entryConfirmed,
    exit: window.exit || null,
    exitConfirmed: !!window.exitConfirmed,
    mode: window.mode || 'manual'
  };
}

function fromLegacyWindow(voyage, def, options = {}) {
  const enabled = options.enabled !== undefined ? !!options.enabled : hasLegacyWindow(voyage, def);
  return {
    key: def.key,
    label: options.label || def.label,
    kind: def.kind,
    enabled,
    entry: voyage[def.entryField] || null,
    entryConfirmed: !!voyage[def.entryConfirmedField],
    exit: voyage[def.exitField] || null,
    exitConfirmed: !!voyage[def.exitConfirmedField],
    mode: options.mode || 'manual'
  };
}

function defaultWindowKeysForVoyage(voyage) {
  if (isHraZone(voyage)) return ['hra_outbound', 'hra_inbound'];
  return ['main'];
}

function normalizeZoneWindows(voyage, options = {}) {
  if (Array.isArray(voyage.zoneWindows) && voyage.zoneWindows.length) {
    return voyage.zoneWindows.map(cloneExistingWindow);
  }

  if (isZeynep(voyage) && !(voyage.zoneEntry || voyage.zoneExit || voyage.zoneEntryReturn || voyage.zoneExitReturn)) {
    return [];
  }

  return defaultWindowKeysForVoyage(voyage).map(key => {
    const def = WINDOW_DEFS[key];
    const label = options.labels && options.labels[key];
    const enabled = options.enableEmptyWindows ? true : undefined;
    return fromLegacyWindow(voyage, def, { label, enabled, mode: options.mode || 'manual' });
  });
}

function applyZoneWindowsToLegacy(voyage, zoneWindows) {
  const next = { ...voyage };
  const windows = Array.isArray(zoneWindows) ? zoneWindows : [];
  const clearFields = [
    'zoneEntry',
    'zoneEntryConfirmed',
    'zoneExit',
    'zoneExitConfirmed',
    'zoneEntryReturn',
    'zoneEntryReturnConfirmed',
    'zoneExitReturn',
    'zoneExitReturnConfirmed'
  ];

  for (const field of clearFields) {
    next[field] = field.endsWith('Confirmed') ? false : null;
  }

  for (const window of windows) {
    const def = WINDOW_DEFS[window.key] || WINDOW_DEFS.main;
    if (window.enabled === false) continue;
    next[def.entryField] = window.entry || null;
    next[def.entryConfirmedField] = !!window.entryConfirmed;
    next[def.exitField] = window.exit || null;
    next[def.exitConfirmedField] = !!window.exitConfirmed;
  }

  return next;
}

function windowSummary(zoneWindows) {
  return (zoneWindows || []).map(window => ({
    key: window.key,
    enabled: window.enabled,
    entry: window.entry,
    entryConfirmed: window.entryConfirmed,
    exit: window.exit,
    exitConfirmed: window.exitConfirmed
  }));
}

module.exports = {
  WINDOW_DEFS,
  normalizeZoneWindows,
  applyZoneWindowsToLegacy,
  windowSummary
};
