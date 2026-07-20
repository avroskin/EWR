'use strict';

const assert = require('assert/strict');
const config = require('../server/storage/sqliteStore').readConfig({});
const {
  createDraftForZone,
  createSelectableDrafts,
  defaultZoneWindowsForZone
} = require('../server/domain/voyageDraft');

function portLabels(draft) {
  return draft.portCalls.map(port => port.visibleLabel || port.port);
}

function windowKeys(draft) {
  return draft.zoneWindows.map(window => window.key);
}

function main() {
  const ims = createDraftForZone('gulf_of_aden');
  assert.equal(ims.zone, 'gulf_of_aden');
  assert.equal(ims.isZeynepC, false);
  assert.deepEqual(portLabels(ims), ['Jeddah Departure', 'Nhava Sheva', 'Mundra', 'Jeddah Arrival']);
  assert.deepEqual(windowKeys(ims), ['hra_outbound', 'hra_inbound']);
  assert.equal(ims.zoneWindows.every(window => window.enabled === false), true);

  const imsEnabled = createDraftForZone('gulf_of_aden', { enableZoneWindows: true });
  assert.equal(imsEnabled.zoneWindows.every(window => window.enabled === true), true);

  const mas = createDraftForZone('mas_combined');
  assert.deepEqual(portLabels(mas), ['Beirut', 'Lattakia', 'Tincan', 'Apapa', 'Cotonou']);
  assert.deepEqual(windowKeys(mas), ['main']);
  assert.equal(mas.zoneWindows[0].label, 'EWR');

  const blackSea = createDraftForZone('black_sea');
  assert.deepEqual(portLabels(blackSea), ['Novorossiysk']);
  assert.deepEqual(windowKeys(blackSea), ['main']);

  const libya = createDraftForZone('north_africa');
  assert.deepEqual(portLabels(libya), ['Misurata', 'Benghazi', 'Tripoli (Libya)', 'Al Khums']);
  assert.deepEqual(libya.zoneWindows, []);

  const zeynep = createDraftForZone('zeynep_c');
  assert.equal(zeynep.isZeynepC, true);
  assert.deepEqual(zeynep.portCalls, []);
  assert.deepEqual(zeynep.zoneWindows, []);

  assert.deepEqual(defaultZoneWindowsForZone('east_med'), []);

  const selectableDrafts = createSelectableDrafts(config);
  assert.deepEqual(selectableDrafts.map(item => item.zone), [
    'gulf_of_aden',
    'mas_combined',
    'black_sea',
    'north_africa',
    'zeynep_c'
  ]);
  assert.equal(selectableDrafts.some(item => item.zone === 'east_med'), false);
  assert.equal(selectableDrafts.some(item => item.zone === 'southwest_africa'), false);

  console.log('Voyage draft fixtures OK: add/edit draft shapes locked.');
}

main();
