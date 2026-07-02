'use strict';

const assert = require('assert/strict');
const config = require('../data/config.json');
const fixtures = require('../server/domain/routeFixtures');
const { calculateRouteSuggestions } = require('../server/domain/routeRules');
const { buildTimelineEvents, buildExportRows } = require('../server/domain/timelineEvents');

function fixture(name) {
  const match = fixtures.find(item => item.name === name);
  assert.ok(match, `Missing fixture: ${name}`);
  return match;
}

function routeResult(item) {
  return calculateRouteSuggestions(item.voyage, config);
}

function eventSummary(events) {
  return events.map(event => {
    if (event.kind === 'zone_window') return `${event.kind}:${event.title}:${event.entry || ''}:${event.exit || ''}:${event.status}`;
    if (event.kind === 'manual_needed') return `${event.kind}:${event.title}:${event.status}`;
    return `${event.kind}:${event.port}:${event.eta || ''}:${event.ets || ''}:${event.omitted ? 'omit' : 'call'}`;
  });
}

function main() {
  const imsNormal = fixture('IMS normal with Jeddah departure and arrival');
  assert.deepEqual(eventSummary(buildTimelineEvents(imsNormal.voyage, config, routeResult(imsNormal))), [
    'port_call:Jeddah Departure::2026-01-10T06:00:00.000Z:call',
    'zone_window:HRA OUTBOUND:2026-01-10T20:00:00.000Z:2026-01-12T20:00:00.000Z:ok',
    'port_call:Nhava Sheva:2026-01-15T08:00:00.000Z:2026-01-16T18:00:00.000Z:call',
    'port_call:Mundra:2026-01-17T08:00:00.000Z:2026-01-18T18:00:00.000Z:call',
    'zone_window:HRA INBOUND:2026-01-22T08:00:00.000Z:2026-01-24T08:00:00.000Z:ok',
    'port_call:Jeddah Arrival:2026-01-24T22:00:00.000Z::call'
  ]);

  const imsLegacyJeddah = {
    voyage: {
      zone: 'gulf_of_aden',
      portCalls: [
        { port: 'Jeddah', eta: null, ets: '2026-01-10T06:00:00.000Z', omit: false },
        { port: 'Nhava Sheva', eta: '2026-01-15T08:00:00.000Z', ets: '2026-01-16T18:00:00.000Z', omit: false },
        { port: 'Jeddah', eta: '2026-01-24T22:00:00.000Z', ets: null, omit: false }
      ],
      zoneEntry: '2026-01-10T20:00:00.000Z',
      zoneExit: '2026-01-12T20:00:00.000Z',
      zoneEntryReturn: '2026-01-22T08:00:00.000Z',
      zoneExitReturn: '2026-01-24T08:00:00.000Z'
    }
  };
  const imsLegacyEvents = buildTimelineEvents(imsLegacyJeddah.voyage, config, routeResult(imsLegacyJeddah));
  assert.equal(imsLegacyEvents.some(event => event.kind === 'port_call' && event.port === 'Jeddah Departure'), true);
  assert.equal(imsLegacyEvents.some(event => event.kind === 'port_call' && event.port === 'Jeddah Arrival'), true);

  const imsMissingDeparture = fixture('IMS missing Jeddah departure');
  const imsMissingEvents = buildTimelineEvents(imsMissingDeparture.voyage, config, routeResult(imsMissingDeparture));
  assert.equal(imsMissingEvents.some(event => event.kind === 'manual_needed' && event.title === 'HRA OUTBOUND'), true);
  assert.equal(imsMissingEvents.some(event => event.kind === 'zone_window' && event.title === 'HRA INBOUND'), true);

  const masBeirutOnly = {
    voyage: {
      zone: 'mas_combined',
      portCalls: [
        { port: 'Beirut', eta: '2026-05-30T20:00:00.000Z', ets: '2026-05-31T17:00:00.000Z', omit: false }
      ]
    }
  };
  const masBeirutOnlyEvents = buildTimelineEvents(masBeirutOnly.voyage, config, routeResult(masBeirutOnly));
  assert.deepEqual(masBeirutOnlyEvents.map(event => event.kind), ['port_call']);

  const masOmitted = fixture('MAS omitted Apapa');
  const masRows = buildExportRows(masOmitted.voyage, config, routeResult(masOmitted));
  const omittedApapa = masRows.find(row => row.routeItem === 'Apapa');
  assert.ok(omittedApapa, 'MAS omitted Apapa should remain exportable');
  assert.equal(omittedApapa.omitted, true);
  assert.equal(omittedApapa.entryTime, 'OMIT - ETA 12/03/2026 09:00');
  assert.equal(omittedApapa.exitTime, 'OMIT - ETS 13/03/2026 21:00');

  const masSavedZoneWithoutFormulaAnchor = {
    voyage: {
      zone: 'mas_combined',
      zoneEntry: '2026-05-20T03:00:00.000Z',
      zoneEntryConfirmed: true,
      zoneExit: '2026-05-25T11:40:00.000Z',
      zoneExitConfirmed: true,
      portCalls: [
        { port: 'Lekki', eta: '2026-05-20T13:00:00.000Z', ets: '2026-05-24T23:40:00.000Z', etaConfirmed: true, etsConfirmed: true, omit: false },
        { port: 'Cotonou', eta: null, ets: null, omit: true }
      ]
    }
  };
  const masSavedZoneRows = buildExportRows(masSavedZoneWithoutFormulaAnchor.voyage, config, routeResult(masSavedZoneWithoutFormulaAnchor));
  const masSavedZoneRow = masSavedZoneRows.find(row => row.kind === 'zone_window' && row.routeItem === 'EWR');
  assert.ok(masSavedZoneRow, 'MAS saved EWR times should export even when formula ports are missing');
  assert.equal(masSavedZoneRow.entryTime, 'Actual Entry 20/05/2026 06:00');
  assert.equal(masSavedZoneRow.exitTime, 'Actual Exit 25/05/2026 14:40');

  const masManualOverride = {
    voyage: {
      zone: 'mas_combined',
      zoneEntry: '2026-02-09T20:00:00.000Z',
      zoneExit: '2026-02-14T08:00:00.000Z',
      portCalls: [
        { port: 'Tincan', eta: '2026-02-10T12:00:00.000Z', ets: '2026-02-11T14:00:00.000Z', omit: false },
        { port: 'Apapa', eta: '2026-02-12T06:00:00.000Z', ets: '2026-02-13T18:00:00.000Z', omit: false }
      ]
    }
  };
  const masManualEvents = buildTimelineEvents(masManualOverride.voyage, config, routeResult(masManualOverride));
  const masManualWindow = masManualEvents.find(event => event.kind === 'zone_window');
  assert.equal(masManualWindow.entry, '2026-02-09T20:00:00.000Z', 'Dashboard timeline should prefer saved manual entry over recalculation');
  assert.equal(masManualWindow.exit, '2026-02-14T08:00:00.000Z', 'Dashboard timeline should prefer saved manual exit over recalculation');

  const eastMedSavedZone = {
    voyage: {
      zone: 'east_med',
      zoneEntry: '2025-07-27T18:15:00.000Z',
      zoneExit: '2025-07-30T06:00:00.000Z',
      portCalls: [
        { port: 'Beirut', eta: '2025-07-27T18:15:00.000Z', ets: '2025-07-29T06:40:00.000Z', etaConfirmed: true, etsConfirmed: true, omit: false },
        { port: 'Lattakia', eta: '2025-07-29T15:00:00.000Z', ets: '2025-07-30T06:00:00.000Z', etaConfirmed: true, etsConfirmed: true, omit: false }
      ]
    }
  };
  const eastMedRows = buildExportRows(eastMedSavedZone.voyage, config, routeResult(eastMedSavedZone));
  assert.equal(eastMedRows.some(row => row.kind === 'zone_window' && row.routeItem === 'EWR'), true, 'East Med saved EWR times should export even when zone events are disabled');
  const libya = fixture('Libya port-only');
  const libyaEvents = buildTimelineEvents(libya.voyage, config, routeResult(libya));
  assert.deepEqual(libyaEvents.map(event => event.kind), ['port_call', 'port_call']);

  const zeynepNoZone = fixture('Zeynep C no-zone record');
  const zeynepNoZoneEvents = buildTimelineEvents(zeynepNoZone.voyage, config, routeResult(zeynepNoZone));
  assert.deepEqual(zeynepNoZoneEvents.map(event => event.kind), ['port_call']);

  const zeynepManual = fixture('Zeynep C flexible manual zone record');
  const zeynepManualRows = buildExportRows(zeynepManual.voyage, config, routeResult(zeynepManual));
  assert.equal(zeynepManualRows[0].routeItem, 'Black Sea EWR');
  assert.equal(zeynepManualRows[0].entryTime, 'Entry 02/08/2026 03:00');
  assert.equal(zeynepManualRows[0].exitTime, 'Exit 04/08/2026 01:00');

  console.log('Timeline/export event fixtures OK: 7 focused checks.');
}

main();
