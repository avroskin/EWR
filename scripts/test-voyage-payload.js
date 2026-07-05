'use strict';

const assert = require('assert/strict');
const { normalizeVoyagePayload, normalizePortCalls, normalizeZoneWindows } = require('../server/domain/voyagePayload');

function main() {
  const portCalls = normalizePortCalls([
    { port: '   ', eta: '', ets: '', omit: false },
    { port: ' Apapa ', eta: '2026-03-12T06:00:00.000Z', ets: '2026-03-13T18:00:00.000Z', omit: true },
    { port: 'Jeddah', role: 'jeddah_departure', visibleLabel: 'Jeddah Departure', arrivalEnabled: false, ets: '2026-01-10T06:00:00.000Z' }
  ]);
  assert.equal(portCalls.length, 2);
  assert.deepEqual(portCalls[0], {
    port: 'Apapa',
    eta: '2026-03-12T06:00:00.000Z',
    etaConfirmed: false,
    ets: '2026-03-13T18:00:00.000Z',
    etsConfirmed: false,
    omit: true
  });
  assert.equal(portCalls[1].role, 'jeddah_departure');
  assert.equal(portCalls[1].visibleLabel, 'Jeddah Departure');
  assert.equal(portCalls[1].arrivalEnabled, false);

  const payload = normalizeVoyagePayload({
    vesselName: ' TEST VESSEL ',
    charterer: ' ARKAS LINE ',
    service: ' MAS ',
    zone: ' mas_combined ',
    portCalls,
    zoneEntry: '2026-02-10T02:00:00.000Z',
    zoneEntryConfirmed: false,
    zoneExit: '2026-02-14T04:00:00.000Z',
    zoneExitConfirmed: true,
    notes: '  note text  ',
    status: ''
  });
  assert.equal(payload.vesselName, 'TEST VESSEL');
  assert.equal(payload.charterer, 'ARKAS LINE');
  assert.equal(payload.service, 'MAS');
  assert.equal(payload.zone, 'mas_combined');
  assert.equal(payload.zoneExitConfirmed, true);
  assert.equal(payload.notes, 'note text');
  assert.equal(payload.status, 'active');

  const existingFallback = normalizeVoyagePayload({ notes: ' changed ' }, {
    vesselName: 'OLD VESSEL',
    charterer: 'OLD CHARTER',
    service: 'OLD SERVICE',
    zone: 'black_sea',
    portCalls: [{ port: 'Novorossiysk', eta: '2026-05-05T12:00:00.000Z' }],
    status: 'legacy'
  });
  assert.equal(existingFallback.vesselName, 'OLD VESSEL');
  assert.equal(existingFallback.charterer, 'OLD CHARTER');
  assert.equal(existingFallback.zone, 'black_sea');
  assert.equal(existingFallback.notes, 'changed');
  assert.equal(existingFallback.status, 'legacy');

  const windows = normalizeZoneWindows([
    { key: ' main ', label: ' EWR ', enabled: true, entry: '2026-08-02T00:00:00.000Z', entryConfirmed: true, exit: '2026-08-03T22:00:00.000Z' }
  ]);
  assert.deepEqual(windows, [{
    key: 'main',
    label: 'EWR',
    kind: 'main',
    enabled: true,
    entry: '2026-08-02T00:00:00.000Z',
    entryConfirmed: true,
    exit: '2026-08-03T22:00:00.000Z',
    exitConfirmed: false,
    mode: 'manual'
  }]);

  assert.throws(
    () => normalizePortCalls([{ port: 'Bad Date', eta: 'not-a-date' }]),
    /Port 1 ETA must be a valid date\./
  );
  assert.throws(
    () => normalizeVoyagePayload({ vesselName: 'X', zone: 'black_sea', portCalls: 'bad' }),
    /Port calls must be a list\./
  );

  console.log('Voyage payload fixtures OK: normalization, preservation, fallback, and date rejection.');
}

main();
