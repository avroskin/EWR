'use strict';

const { getDefaultPortCalls, isActiveZone } = require('./routeDefaults');

function cleanString(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function defaultWindow(key, label, enabled = false) {
  return {
    key,
    label,
    kind: key,
    enabled,
    entry: null,
    entryConfirmed: false,
    exit: null,
    exitConfirmed: false,
    mode: 'manual'
  };
}

function defaultZoneWindowsForZone(zoneKey, options = {}) {
  const enabled = !!options.enableZoneWindows;
  if (zoneKey === 'gulf_of_aden') {
    return [
      defaultWindow('hra_outbound', 'HRA Outbound', enabled),
      defaultWindow('hra_inbound', 'HRA Inbound', enabled)
    ];
  }
  if (zoneKey === 'mas_combined') return [defaultWindow('main', 'EWR', enabled)];
  if (zoneKey === 'black_sea') return [defaultWindow('main', 'EWR', enabled)];
  if (zoneKey === 'north_africa') return [];
  if (zoneKey === 'zeynep_c') return [];
  return [];
}

function createVoyageDraft(input = {}) {
  const zone = cleanString(input.zone);
  const isZeynepC = zone === 'zeynep_c' || !!input.isZeynepC;
  const portCalls = Array.isArray(input.portCalls)
    ? input.portCalls
    : getDefaultPortCalls(zone);

  return {
    vesselName: cleanString(input.vesselName),
    charterer: cleanString(input.charterer),
    service: cleanString(input.service),
    zone,
    isZeynepC,
    portCalls,
    zoneWindows: Array.isArray(input.zoneWindows)
      ? input.zoneWindows
      : defaultZoneWindowsForZone(zone, input),
    notes: cleanString(input.notes),
    zeynepZoneName: cleanString(input.zeynepZoneName),
    status: cleanString(input.status) || 'active'
  };
}

function createDraftForZone(zoneKey, options = {}) {
  return createVoyageDraft({ ...options, zone: zoneKey, isZeynepC: zoneKey === 'zeynep_c' });
}

function createSelectableDrafts(config, options = {}) {
  return (config?.riskZones || [])
    .filter(zone => isActiveZone(zone.key))
    .map(zone => ({
      zone: zone.key,
      label: zone.label || zone.key,
      draft: createDraftForZone(zone.key, options)
    }));
}

module.exports = {
  createVoyageDraft,
  createDraftForZone,
  createSelectableDrafts,
  defaultZoneWindowsForZone
};
