'use strict';

const assert = require('assert/strict');
const { validateVoyageDraft } = require('../server/domain/voyageValidation');

function types(result) {
  return result.issues.map(issue => issue.type);
}

function main() {
  const missingRequired = validateVoyageDraft({ portCalls: [] });
  assert.equal(missingRequired.ok, false);
  assert.deepEqual(types(missingRequired), ['Missing vessel', 'Missing risk zone']);

  const cleanOmittedPort = validateVoyageDraft({
    vesselName: 'TEST VESSEL',
    zone: 'mas_combined',
    portCalls: [
      { port: 'Apapa', eta: '2026-03-12T06:00:00.000Z', ets: '2026-03-13T18:00:00.000Z', omit: true }
    ]
  });
  assert.equal(cleanOmittedPort.ok, true);
  assert.deepEqual(cleanOmittedPort.issues, []);

  const unnamedTimedPort = validateVoyageDraft({
    vesselName: 'TEST VESSEL',
    zone: 'mas_combined',
    portCalls: [
      { port: '', eta: '2026-03-12T06:00:00.000Z', ets: null, omit: false }
    ]
  });
  assert.equal(unnamedTimedPort.ok, true);
  assert.equal(unnamedTimedPort.issues[0].type, 'Missing port name');
  assert.equal(unnamedTimedPort.issues[0].severity, 'medium');

  const reversedPort = validateVoyageDraft({
    vesselName: 'TEST VESSEL',
    zone: 'black_sea',
    portCalls: [
      { port: 'Novorossiysk', eta: '2026-05-07T18:00:00.000Z', ets: '2026-05-05T12:00:00.000Z', omit: false }
    ]
  });
  assert.equal(reversedPort.ok, false);
  assert.equal(reversedPort.issues[0].type, 'Reversed port dates');
  assert.equal(reversedPort.issues[0].severity, 'high');

  const longPortStay = validateVoyageDraft({
    vesselName: 'TEST VESSEL',
    zone: 'north_africa',
    portCalls: [
      { port: 'Misurata', eta: '2026-06-01T08:00:00.000Z', ets: '2026-06-08T08:00:00.000Z', omit: false }
    ]
  });
  assert.equal(longPortStay.ok, true);
  assert.equal(longPortStay.issues[0].type, 'Long port stay');
  assert.equal(longPortStay.issues[0].severity, 'medium');

  const reversedLegacyZone = validateVoyageDraft({
    vesselName: 'TEST VESSEL',
    zone: 'black_sea',
    zoneEntry: '2026-05-08T06:00:00.000Z',
    zoneExit: '2026-05-05T00:00:00.000Z'
  });
  assert.equal(reversedLegacyZone.ok, false);
  assert.equal(reversedLegacyZone.issues[0].type, 'Reversed zone dates');

  const longNormalizedWindow = validateVoyageDraft({
    vesselName: 'TEST VESSEL',
    zone: 'zeynep_c',
    zoneWindows: [
      { key: 'main', label: 'Manual Area', enabled: true, entry: '2026-01-01T00:00:00.000Z', exit: '2026-03-01T00:00:00.000Z' }
    ]
  });
  assert.equal(longNormalizedWindow.ok, true);
  assert.equal(longNormalizedWindow.issues[0].type, 'Long zone range');
  assert.equal(longNormalizedWindow.issues[0].field, 'zoneWindows');

  const disabledReversedWindow = validateVoyageDraft({
    vesselName: 'TEST VESSEL',
    zone: 'zeynep_c',
    zoneWindows: [
      { key: 'main', enabled: false, entry: '2026-03-01T00:00:00.000Z', exit: '2026-01-01T00:00:00.000Z' }
    ]
  });
  assert.equal(disabledReversedWindow.ok, true);
  assert.deepEqual(disabledReversedWindow.issues, []);

  console.log('Voyage validation fixtures OK: required fields, dates, omitted ports, and zone windows.');
}

main();
