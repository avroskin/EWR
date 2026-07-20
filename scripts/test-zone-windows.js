'use strict';

const assert = require('assert/strict');
const { normalizeZoneWindows, applyZoneWindowsToLegacy, windowSummary } = require('../server/domain/zoneWindows');

function main() {
  const imsVoyage = {
    zone: 'gulf_of_aden',
    zoneEntry: '2026-01-10T20:00:00.000Z',
    zoneEntryConfirmed: false,
    zoneExit: '2026-01-12T20:00:00.000Z',
    zoneExitConfirmed: true,
    zoneEntryReturn: '2026-01-22T08:00:00.000Z',
    zoneEntryReturnConfirmed: false,
    zoneExitReturn: '2026-01-24T08:00:00.000Z',
    zoneExitReturnConfirmed: true
  };
  assert.deepEqual(windowSummary(normalizeZoneWindows(imsVoyage)), [
    {
      key: 'hra_outbound',
      enabled: true,
      entry: '2026-01-10T20:00:00.000Z',
      entryConfirmed: false,
      exit: '2026-01-12T20:00:00.000Z',
      exitConfirmed: true
    },
    {
      key: 'hra_inbound',
      enabled: true,
      entry: '2026-01-22T08:00:00.000Z',
      entryConfirmed: false,
      exit: '2026-01-24T08:00:00.000Z',
      exitConfirmed: true
    }
  ]);

  const masVoyage = {
    zone: 'mas_combined',
    zoneEntry: '2026-02-10T02:00:00.000Z',
    zoneEntryConfirmed: false,
    zoneExit: '2026-02-14T04:00:00.000Z',
    zoneExitConfirmed: false
  };
  assert.deepEqual(windowSummary(normalizeZoneWindows(masVoyage)), [
    {
      key: 'main',
      enabled: true,
      entry: '2026-02-10T02:00:00.000Z',
      entryConfirmed: false,
      exit: '2026-02-14T04:00:00.000Z',
      exitConfirmed: false
    }
  ]);

  const zeynepNoZone = { zone: 'zeynep_c', isZeynepC: true, portCalls: [] };
  assert.deepEqual(normalizeZoneWindows(zeynepNoZone), []);

  const zeynepManual = {
    zone: 'zeynep_c',
    isZeynepC: true,
    zoneWindows: [
      { key: 'main', label: 'Manual Area', enabled: true, entry: '2026-08-02T00:00:00.000Z', entryConfirmed: true, exit: '2026-08-03T22:00:00.000Z', exitConfirmed: false }
    ]
  };
  assert.deepEqual(windowSummary(normalizeZoneWindows(zeynepManual)), [
    {
      key: 'main',
      enabled: true,
      entry: '2026-08-02T00:00:00.000Z',
      entryConfirmed: true,
      exit: '2026-08-03T22:00:00.000Z',
      exitConfirmed: false
    }
  ]);

  const roundTrip = applyZoneWindowsToLegacy({}, normalizeZoneWindows(imsVoyage));
  assert.equal(roundTrip.zoneEntry, '2026-01-10T20:00:00.000Z');
  assert.equal(roundTrip.zoneExitConfirmed, true);
  assert.equal(roundTrip.zoneEntryReturn, '2026-01-22T08:00:00.000Z');
  assert.equal(roundTrip.zoneExitReturnConfirmed, true);

  const disabledClears = applyZoneWindowsToLegacy({ zoneEntry: 'old', zoneExit: 'old' }, [
    { key: 'main', enabled: false, entry: '2026-01-01T00:00:00.000Z', exit: '2026-01-02T00:00:00.000Z' }
  ]);
  assert.equal(disabledClears.zoneEntry, null);
  assert.equal(disabledClears.zoneExit, null);
  assert.equal(disabledClears.zoneEntryConfirmed, false);
  assert.equal(disabledClears.zoneExitConfirmed, false);

  console.log('Zone window compatibility fixtures OK: 5 focused checks.');
}

main();
