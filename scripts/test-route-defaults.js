'use strict';

const assert = require('assert/strict');
const config = require('../data/config.json');
const {
  getActiveZoneKeys,
  getHiddenZoneKeys,
  getDefaultPortCalls,
  getSelectableZones,
  isActiveZone,
  isHiddenZone
} = require('../server/domain/routeDefaults');

function names(calls) {
  return calls.map(call => call.visibleLabel || call.port);
}

function main() {
  assert.deepEqual(getActiveZoneKeys(), [
    'gulf_of_aden',
    'mas_combined',
    'black_sea',
    'north_africa',
    'zeynep_c'
  ]);
  assert.deepEqual(getHiddenZoneKeys(), ['southwest_africa', 'east_med']);

  const ims = getDefaultPortCalls('gulf_of_aden');
  assert.deepEqual(names(ims), ['Jeddah Departure', 'Nhava Sheva', 'Mundra', 'Jeddah Arrival']);
  assert.equal(ims[0].role, 'jeddah_departure');
  assert.equal(ims[0].arrivalEnabled, false);
  assert.equal(ims[0].departureEnabled, true);
  assert.equal(ims[3].role, 'jeddah_arrival');
  assert.equal(ims[3].arrivalEnabled, true);
  assert.equal(ims[3].departureEnabled, false);

  assert.deepEqual(names(getDefaultPortCalls('mas_combined')), ['Beirut', 'Lattakia', 'Tincan', 'Apapa', 'Cotonou']);
  assert.deepEqual(names(getDefaultPortCalls('black_sea')), ['Novorossiysk']);
  assert.deepEqual(names(getDefaultPortCalls('north_africa')), ['Misurata', 'Benghazi', 'Tripoli (Libya)', 'Al Khums']);
  assert.deepEqual(getDefaultPortCalls('zeynep_c'), []);

  const selectable = getSelectableZones(config);
  assert.deepEqual(selectable.map(zone => zone.key), getActiveZoneKeys());
  assert.equal(selectable.every(zone => zone.active && !zone.hidden), true);

  const withHidden = getSelectableZones(config, { includeHidden: true });
  assert.equal(withHidden.some(zone => zone.key === 'southwest_africa' && zone.hidden), true);
  assert.equal(withHidden.some(zone => zone.key === 'east_med' && zone.hidden), true);
  assert.equal(isActiveZone('mas_combined'), true);
  assert.equal(isHiddenZone('east_med'), true);

  console.log('Route default fixtures OK: active zones and default port rows locked.');
}

main();
