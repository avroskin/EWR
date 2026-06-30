'use strict';

const { calculateRouteSuggestions } = require('./routeRules');

function parseTime(iso) {
  if (!iso) return Infinity;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? Infinity : date.getTime();
}

function fmtDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = value => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function zoneRuleFor(voyage, config) {
  return (config?.riskZones || []).find(zone => zone.key === voyage.zone) || null;
}

function zoneLabelFor(voyage, zoneRule) {
  if (voyage.zone === 'zeynep_c') return voyage.zeynepZoneName || zoneRule?.label || 'Zeynep C';
  return zoneRule?.zoneEvents?.label || zoneRule?.label || voyage.zone || 'Zone';
}

function areaNameFor(voyage, zoneRule) {
  if (voyage.zone === 'mas_combined') return 'MAS';
  if (voyage.zone === 'gulf_of_aden') return 'IMS / HRA';
  if (voyage.zone === 'black_sea') return 'Black Sea';
  if (voyage.zone === 'north_africa') return 'LTS';
  if (voyage.zone === 'zeynep_c') return voyage.zeynepZoneName || 'Zeynep C';
  return zoneRule?.label || voyage.zone || '';
}

function findSuggestion(suggestions, key) {
  return (suggestions || []).find(item => item.windowKey === key) || null;
}

function confirmedPair(voyage, key) {
  if (key === 'hra_inbound') {
    return { entryConfirmed: !!voyage.zoneEntryReturnConfirmed, exitConfirmed: !!voyage.zoneExitReturnConfirmed };
  }
  return { entryConfirmed: !!voyage.zoneEntryConfirmed, exitConfirmed: !!voyage.zoneExitConfirmed };
}

function legacyWindowValues(voyage, key) {
  if (key === 'hra_inbound') {
    return { entry: voyage.zoneEntryReturn || null, exit: voyage.zoneExitReturn || null };
  }
  return { entry: voyage.zoneEntry || null, exit: voyage.zoneExit || null };
}

function eventTime(event) {
  if (event.pinEnd) return Number.MAX_SAFE_INTEGER;
  if (event.kind === 'zone_window') return parseTime(event.entry || event.exit);
  if (event.kind === 'manual_needed') return event.sortTime || Infinity;
  return Math.min(parseTime(event.eta), parseTime(event.ets));
}

function windowTitle(voyage, suggestion) {
  if (voyage.zone === 'gulf_of_aden' && suggestion.windowKey === 'hra_outbound') return 'HRA OUTBOUND';
  if (voyage.zone === 'gulf_of_aden' && suggestion.windowKey === 'hra_inbound') return 'HRA INBOUND';
  return suggestion.label || 'Zone';
}

function buildZoneEvents(voyage, config, suggestions) {
  const zoneRule = zoneRuleFor(voyage, config);
  const zoneEvents = zoneRule?.zoneEvents || {};
  const enabledByConfig = !!zoneEvents.enabled || voyage.zone === 'zeynep_c';
  const hasSavedZoneTimes = !!(voyage.zoneEntry || voyage.zoneExit || voyage.zoneEntryReturn || voyage.zoneExitReturn);
  if (!enabledByConfig && voyage.zone !== 'zeynep_c' && !hasSavedZoneTimes) return [];

  return (suggestions || []).flatMap(item => {
    if (item.status === 'disabled' || item.status === 'not_applicable') return [];
    const legacyValues = legacyWindowValues(voyage, item.windowKey);
    const confirmed = confirmedPair(voyage, item.windowKey);
    const entry = legacyValues.entry || item.entry || null;
    const exit = legacyValues.exit || item.exit || null;

    if (item.status === 'missing_anchor' && voyage.zone !== 'gulf_of_aden' && !entry && !exit) return [];
    if (item.status === 'missing_anchor' && !entry && !exit) {
      return [{
        kind: 'manual_needed',
        windowKey: item.windowKey,
        title: windowTitle(voyage, item),
        label: item.label,
        status: item.status,
        message: item.reason || 'Manual timing needed.',
        sortTime: Infinity
      }];
    }

    if (!entry && !exit && item.status !== 'manual_needed') return [];
    return [{
      kind: 'zone_window',
      windowKey: item.windowKey,
      title: windowTitle(voyage, item),
      label: item.label || zoneLabelFor(voyage, zoneRule),
      status: item.status,
      entry,
      exit,
      ...confirmed
    }];
  });
}

function imsJeddahRole(voyage, port, index) {
  if (voyage.zone !== 'gulf_of_aden') return null;
  if (port.role || port.visibleLabel || String(port.port || '').trim().toLowerCase() !== 'jeddah') return null;
  const calls = Array.isArray(voyage.portCalls) ? voyage.portCalls : [];
  const firstDepartureIndex = calls.findIndex(call => String(call.port || '').trim().toLowerCase() === 'jeddah' && !call.omit && call.ets);
  let lastArrivalIndex = -1;
  calls.forEach((call, callIndex) => {
    if (String(call.port || '').trim().toLowerCase() === 'jeddah' && !call.omit && call.eta) lastArrivalIndex = callIndex;
  });
  if (index === firstDepartureIndex) return 'departure';
  if (index === lastArrivalIndex) return 'arrival';
  return null;
}

function buildPortEvents(voyage) {
  return (Array.isArray(voyage.portCalls) ? voyage.portCalls : [])
    .filter(port => port && (port.port || port.eta || port.ets || port.omit))
    .map((port, index) => {
      const legacyJeddahRole = imsJeddahRole(voyage, port, index);
      return {
        kind: 'port_call',
        index,
        port: legacyJeddahRole === 'departure' ? 'Jeddah Departure' : (legacyJeddahRole === 'arrival' ? 'Jeddah Arrival' : (port.visibleLabel || port.port || `Port ${index + 1}`)),
        role: port.role || (legacyJeddahRole ? `jeddah_${legacyJeddahRole}` : ''),
        eta: legacyJeddahRole === 'departure' ? null : (port.eta || null),
        ets: legacyJeddahRole === 'arrival' ? null : (port.ets || null),
        etaConfirmed: legacyJeddahRole === 'departure' ? false : !!port.etaConfirmed,
        etsConfirmed: legacyJeddahRole === 'arrival' ? false : !!port.etsConfirmed,
        omitted: !!port.omit
      };
    });
}

function buildTimelineEvents(voyage, config, routeResult) {
  const result = routeResult || calculateRouteSuggestions(voyage, config);
  const events = [
    ...buildZoneEvents(voyage, config, result.suggestions),
    ...buildPortEvents(voyage)
  ];

  return events.sort((a, b) => {
    const aTime = eventTime(a);
    const bTime = eventTime(b);
    if (aTime !== bTime) return aTime - bTime;
    if (a.kind !== b.kind) return a.kind === 'zone_window' ? -1 : 1;
    return (a.index || 0) - (b.index || 0);
  });
}

function formatTime(prefix, iso, confirmed, actualLabel, omitted) {
  if (!iso) return '';
  const omitPrefix = omitted ? 'OMIT - ' : '';
  return `${omitPrefix}${confirmed ? actualLabel : prefix} ${fmtDate(iso)}`;
}

function buildExportRows(voyage, config, routeResult) {
  const zoneRule = zoneRuleFor(voyage, config);
  const area = areaNameFor(voyage, zoneRule);
  return buildTimelineEvents(voyage, config, routeResult).map(event => {
    if (event.kind === 'zone_window') {
      return {
        kind: event.kind,
        area,
        routeItem: event.title,
        entryTime: formatTime('Entry', event.entry, event.entryConfirmed, 'Actual Entry', false),
        exitTime: formatTime('Exit', event.exit, event.exitConfirmed, 'Actual Exit', false),
        omitted: false,
        status: event.status
      };
    }
    if (event.kind === 'manual_needed') {
      return {
        kind: event.kind,
        area,
        routeItem: event.title,
        entryTime: 'Manual needed',
        exitTime: 'Manual needed',
        omitted: false,
        status: event.status
      };
    }
    return {
      kind: event.kind,
      area,
      routeItem: event.port,
      entryTime: formatTime('ETA', event.eta, event.etaConfirmed, 'ATA', event.omitted),
      exitTime: formatTime('ETS', event.ets, event.etsConfirmed, 'ATS', event.omitted),
      omitted: event.omitted,
      status: event.omitted ? 'omitted' : 'called'
    };
  });
}

module.exports = {
  buildTimelineEvents,
  buildExportRows,
  fmtDate
};
