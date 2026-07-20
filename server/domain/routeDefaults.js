'use strict';

const ACTIVE_ZONE_KEYS = Object.freeze([
  'gulf_of_aden',
  'mas_combined',
  'black_sea',
  'north_africa',
  'zeynep_c'
]);

const HIDDEN_ZONE_KEYS = Object.freeze([
  'southwest_africa',
  'east_med'
]);

const DEFAULT_PORTS = Object.freeze({
  gulf_of_aden: [
    {
      port: 'Jeddah',
      role: 'jeddah_departure',
      visibleLabel: 'Jeddah Departure',
      arrivalEnabled: false,
      departureEnabled: true
    },
    { port: 'Nhava Sheva' },
    { port: 'Mundra' },
    {
      port: 'Jeddah',
      role: 'jeddah_arrival',
      visibleLabel: 'Jeddah Arrival',
      arrivalEnabled: true,
      departureEnabled: false
    }
  ],
  mas_combined: [
    { port: 'Beirut' },
    { port: 'Lattakia' },
    { port: 'Tincan' },
    { port: 'Apapa' },
    { port: 'Cotonou' }
  ],
  black_sea: [
    { port: 'Novorossiysk' }
  ],
  north_africa: [
    { port: 'Misurata' },
    { port: 'Benghazi' },
    { port: 'Tripoli (Libya)' },
    { port: 'Al Khums' }
  ],
  zeynep_c: []
});

function defaultPortCall(definition) {
  return {
    port: definition.port || '',
    role: definition.role || '',
    visibleLabel: definition.visibleLabel || definition.port || '',
    eta: null,
    etaConfirmed: false,
    ets: null,
    etsConfirmed: false,
    omit: false,
    arrivalEnabled: definition.arrivalEnabled !== false,
    departureEnabled: definition.departureEnabled !== false
  };
}

function getDefaultPortCalls(zoneKey) {
  return (DEFAULT_PORTS[zoneKey] || []).map(defaultPortCall);
}

function getActiveZoneKeys() {
  return [...ACTIVE_ZONE_KEYS];
}

function getHiddenZoneKeys() {
  return [...HIDDEN_ZONE_KEYS];
}

function isActiveZone(zoneKey) {
  return ACTIVE_ZONE_KEYS.includes(zoneKey);
}

function isHiddenZone(zoneKey) {
  return HIDDEN_ZONE_KEYS.includes(zoneKey);
}

function getSelectableZones(config, options = {}) {
  const includeHidden = !!options.includeHidden;
  const allowed = new Set(includeHidden ? [...ACTIVE_ZONE_KEYS, ...HIDDEN_ZONE_KEYS] : ACTIVE_ZONE_KEYS);
  return (config?.riskZones || [])
    .filter(zone => allowed.has(zone.key))
    .map(zone => ({
      key: zone.key,
      label: zone.label || zone.key,
      active: isActiveZone(zone.key),
      hidden: isHiddenZone(zone.key)
    }));
}

module.exports = {
  ACTIVE_ZONE_KEYS,
  HIDDEN_ZONE_KEYS,
  getDefaultPortCalls,
  getActiveZoneKeys,
  getHiddenZoneKeys,
  getSelectableZones,
  isActiveZone,
  isHiddenZone
};
