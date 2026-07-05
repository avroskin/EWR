'use strict';

window.TimelineEvents = (() => {
  function parseTime(iso) {
    if (!iso) return Infinity;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? Infinity : date.getTime();
  }

  function zoneRuleFor(voyage, config) {
    return (config?.riskZones || []).find(zone => zone.key === voyage.zone) || null;
  }

  function zoneLabelFor(voyage, zoneRule) {
    if (voyage.zone === 'zeynep_c') return voyage.zeynepZoneName || zoneRule?.label || 'Zeynep C';
    return zoneRule?.zoneEvents?.label || zoneRule?.label || voyage.zone || 'Zone';
  }

  function findPortByRoleOrName(portCalls, role, fallbackPort) {
    return (portCalls || []).find(port => port.role === role && !port.omit)
      || (portCalls || []).find(port => String(port.port || '').trim().toLowerCase() === String(fallbackPort || '').trim().toLowerCase() && !port.omit)
      || null;
  }

  function imsSuggestions(voyage, zoneRule) {
    const formula = zoneRule?.formula || {};
    const anchorPort = formula.anchorPort || 'Jeddah';
    const outbound = findPortByRoleOrName(voyage.portCalls || [], 'jeddah_departure', anchorPort);
    const inbound = findPortByRoleOrName(voyage.portCalls || [], 'jeddah_arrival', anchorPort);
    const suggestions = [];
    suggestions.push({
      windowKey: 'hra_outbound',
      label: 'HRA',
      status: voyage.zoneEntry || voyage.zoneExit ? 'ok' : (!outbound || !outbound.ets ? 'missing_anchor' : 'ok'),
      entry: voyage.zoneEntry || null,
      exit: voyage.zoneExit || null
    });
    suggestions.push({
      windowKey: 'hra_inbound',
      label: 'HRA',
      status: voyage.zoneEntryReturn || voyage.zoneExitReturn ? 'ok' : (!inbound || !inbound.eta ? 'missing_anchor' : 'ok'),
      entry: voyage.zoneEntryReturn || null,
      exit: voyage.zoneExitReturn || null
    });
    return suggestions;
  }

  function samePort(actual, expected) {
    return String(actual || '').trim().toLowerCase() === String(expected || '').trim().toLowerCase();
  }

  function addHours(iso, hours) {
    const time = parseTime(iso);
    if (!Number.isFinite(time)) return null;
    return new Date(time + (Number(hours) || 0) * 60 * 60 * 1000).toISOString();
  }

  function formulaPortCalls(voyage, formula) {
    const calls = (voyage.portCalls || []).filter(port => !port.omit);
    if (!Array.isArray(formula.formulaPorts) || formula.formulaPorts.length === 0) return calls;
    return calls.filter(port => formula.formulaPorts.some(name => samePort(port.port, name)));
  }

  function firstWithTime(portCalls, field) {
    return (portCalls || []).find(port => Number.isFinite(parseTime(port[field]))) || null;
  }

  function lastWithTime(portCalls, field) {
    let match = null;
    for (const port of portCalls || []) {
      if (Number.isFinite(parseTime(port[field]))) match = port;
    }
    return match;
  }

  function calculatedMainWindow(voyage, zoneRule) {
    const formula = zoneRule?.formula || {};
    const savedEntry = voyage.zoneEntry || null;
    const savedExit = voyage.zoneExit || null;
    if (formula.type !== 'first_last_offset') return { entry: savedEntry, exit: savedExit, status: savedEntry || savedExit ? 'ok' : 'disabled' };
    const calls = formulaPortCalls(voyage, formula);
    const firstEta = firstWithTime(calls, 'eta');
    const lastEts = lastWithTime(calls, 'ets');
    if (!firstEta || !lastEts) return { entry: savedEntry, exit: savedExit, status: savedEntry || savedExit ? 'ok' : 'disabled' };
    return {
      entry: savedEntry || addHours(firstEta.eta, Number(formula.entryOffsetHours ?? 0)),
      exit: savedExit || addHours(lastEts.ets, Number(formula.exitOffsetHours ?? 0)),
      status: 'ok'
    };
  }

  function mainSuggestion(voyage, zoneRule) {
    if (voyage.zone === 'north_africa') return [];
    if (voyage.zone === 'zeynep_c' && !(voyage.zoneEntry || voyage.zoneExit || voyage.zoneEntryReturn || voyage.zoneExitReturn)) return [];
    if (!zoneRule?.zoneEvents?.enabled && voyage.zone !== 'zeynep_c') return [];
    const calculated = calculatedMainWindow(voyage, zoneRule);
    return [{
      windowKey: 'main',
      label: zoneRule?.zoneEvents?.label || zoneLabelFor(voyage, zoneRule),
      status: calculated.status,
      entry: calculated.entry || null,
      exit: calculated.exit || null
    }];
  }

  function routeSuggestions(voyage, config) {
    const zoneRule = zoneRuleFor(voyage, config);
    if (voyage.zone === 'gulf_of_aden') return imsSuggestions(voyage, zoneRule);
    return mainSuggestion(voyage, zoneRule);
  }

  function windowTitle(voyage, suggestion) {
    if (voyage.zone === 'gulf_of_aden' && suggestion.windowKey === 'hra_outbound') return 'HRA OUTBOUND';
    if (voyage.zone === 'gulf_of_aden' && suggestion.windowKey === 'hra_inbound') return 'HRA INBOUND';
    return suggestion.label || 'Zone';
  }

  function confirmedPair(voyage, key) {
    if (key === 'hra_inbound') {
      return { entryConfirmed: !!voyage.zoneEntryReturnConfirmed, exitConfirmed: !!voyage.zoneExitReturnConfirmed };
    }
    return { entryConfirmed: !!voyage.zoneEntryConfirmed, exitConfirmed: !!voyage.zoneExitConfirmed };
  }

  function buildZoneEvents(voyage, config, suggestions) {
    return (suggestions || []).flatMap(item => {
      if (item.status === 'disabled' || item.status === 'not_applicable') return [];
      if (item.status === 'missing_anchor') {
        return [{
          kind: 'manual_needed',
          windowKey: item.windowKey,
          title: windowTitle(voyage, item),
          label: item.label,
          status: item.status,
          message: 'Manual timing needed.',
          sortTime: item.windowKey === 'hra_inbound' ? lastEventTime(voyage) : firstEventTime(voyage)
        }];
      }
      if (!item.entry && !item.exit) return [];
      return [{
        kind: 'zone_window',
        windowKey: item.windowKey,
        title: windowTitle(voyage, item),
        label: item.label || 'Zone',
        status: item.status,
        entry: item.entry || null,
        exit: item.exit || null,
        ...confirmedPair(voyage, item.windowKey)
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
        const arrivalEnabled = legacyJeddahRole === 'departure' ? false : port.arrivalEnabled !== false;
        const departureEnabled = legacyJeddahRole === 'arrival' ? false : port.departureEnabled !== false;
        return {
          kind: 'port_call',
          index,
          port: legacyJeddahRole === 'departure' ? 'Jeddah Departure' : (legacyJeddahRole === 'arrival' ? 'Jeddah Arrival' : (port.visibleLabel || port.port || `Port ${index + 1}`)),
          role: port.role || (legacyJeddahRole ? `jeddah_${legacyJeddahRole}` : ''),
          eta: arrivalEnabled ? (port.eta || null) : null,
          ets: departureEnabled ? (port.ets || null) : null,
          etaConfirmed: arrivalEnabled && !!port.etaConfirmed,
          etsConfirmed: departureEnabled && !!port.etsConfirmed,
          arrivalEnabled,
          departureEnabled,
          omitted: !!port.omit
        };
      });
  }

  function eventTime(event) {
    if (event.kind === 'zone_window') return parseTime(event.entry || event.exit);
    if (event.kind === 'manual_needed') return event.sortTime || Infinity;
    return Math.min(parseTime(event.eta), parseTime(event.ets));
  }

  function firstEventTime(voyage) {
    const times = [];
    (voyage.portCalls || []).forEach(port => {
      if (port.eta) times.push(parseTime(port.eta));
      if (port.ets) times.push(parseTime(port.ets));
    });
    return times.filter(Number.isFinite).sort((a, b) => a - b)[0] || null;
  }

  function lastEventTime(voyage) {
    const times = [];
    (voyage.portCalls || []).forEach(port => {
      if (port.eta) times.push(parseTime(port.eta));
      if (port.ets) times.push(parseTime(port.ets));
    });
    return times.filter(Number.isFinite).sort((a, b) => b - a)[0] || null;
  }

  function buildTimelineEvents(voyage, config) {
    const events = [
      ...buildZoneEvents(voyage, config, routeSuggestions(voyage, config)),
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

  return { buildTimelineEvents };
})();
