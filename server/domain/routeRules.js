'use strict';

const HOUR_MS = 60 * 60 * 1000;

const STATUSES = Object.freeze({
  OK: 'ok',
  MISSING_ANCHOR: 'missing_anchor',
  MANUAL_NEEDED: 'manual_needed',
  DISABLED: 'disabled',
  NOT_APPLICABLE: 'not_applicable'
});

const FIELD_MAP = Object.freeze({
  'main.entry': ['zoneEntry', 'zoneEntryConfirmed'],
  'main.exit': ['zoneExit', 'zoneExitConfirmed'],
  'hra_outbound.entry': ['zoneEntry', 'zoneEntryConfirmed'],
  'hra_outbound.exit': ['zoneExit', 'zoneExitConfirmed'],
  'hra_inbound.entry': ['zoneEntryReturn', 'zoneEntryReturnConfirmed'],
  'hra_inbound.exit': ['zoneExitReturn', 'zoneExitReturnConfirmed']
});

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toISO(date) {
  return date ? date.toISOString() : null;
}

function addHours(value, hours) {
  const date = parseDate(value);
  return date ? toISO(new Date(date.getTime() + (Number(hours) || 0) * HOUR_MS)) : null;
}

function samePort(actual, expected) {
  return String(actual || '').trim().toLowerCase() === String(expected || '').trim().toLowerCase();
}

function isOmitted(portCall) {
  return !!(portCall && portCall.omit);
}

function isEnabledWindow(windowState) {
  return windowState ? windowState.enabled !== false : true;
}

function findWindow(voyage, key) {
  return (voyage.zoneWindows || []).find(window => window && window.key === key) || null;
}

function findPortByRoleOrName(portCalls, role, fallbackPort) {
  return (portCalls || []).find(portCall => portCall.role === role && !isOmitted(portCall))
    || (portCalls || []).find(portCall => samePort(portCall.port, fallbackPort) && !isOmitted(portCall))
    || null;
}

function findFormulaPortCalls(portCalls, formulaPorts) {
  const calls = Array.isArray(portCalls) ? portCalls : [];
  if (!Array.isArray(formulaPorts) || formulaPorts.length === 0) {
    return calls.filter(portCall => !isOmitted(portCall));
  }
  return calls.filter(portCall =>
    !isOmitted(portCall) && formulaPorts.some(formulaPort => samePort(portCall.port, formulaPort))
  );
}

function firstWithTime(portCalls, field) {
  return (portCalls || []).find(portCall => parseDate(portCall[field])) || null;
}

function lastWithTime(portCalls, field) {
  let match = null;
  for (const portCall of portCalls || []) {
    if (parseDate(portCall[field])) match = portCall;
  }
  return match;
}

function suggestion(windowKey, label, entry, exit, status, reason) {
  return {
    windowKey,
    label,
    entry: entry || null,
    exit: exit || null,
    status,
    reason: reason || ''
  };
}

function buildMessages(suggestions) {
  return suggestions
    .filter(item => item.status !== STATUSES.OK)
    .map(item => ({
      windowKey: item.windowKey,
      status: item.status,
      message: item.reason
    }));
}

function calculateJeddahHra(voyage, zoneRule) {
  const formula = zoneRule.formula || {};
  const portCalls = voyage.portCalls || [];
  const anchorPort = formula.anchorPort || 'Jeddah';
  const outboundWindow = findWindow(voyage, 'hra_outbound');
  const inboundWindow = findWindow(voyage, 'hra_inbound');
  const outboundEnabled = isEnabledWindow(outboundWindow);
  const inboundEnabled = isEnabledWindow(inboundWindow);
  const outboundAnchor = findPortByRoleOrName(portCalls, 'jeddah_departure', anchorPort);
  const inboundAnchor = findPortByRoleOrName(portCalls, 'jeddah_arrival', anchorPort);

  const outboundAfter = Number(formula.outboundAfterEtsHours ?? 14);
  const transit = Number(formula.transitHours ?? 48);
  const inboundBefore = Number(formula.inboundBeforeEtaHours ?? 62);
  const inboundExitBefore = Number(formula.inboundExitBeforeEtaHours ?? 14);
  const suggestions = [];

  if (!outboundEnabled) {
    suggestions.push(suggestion('hra_outbound', 'HRA Outbound', null, null, STATUSES.DISABLED, 'HRA outbound window is disabled.'));
  } else if (!outboundAnchor || !parseDate(outboundAnchor.ets)) {
    suggestions.push(suggestion('hra_outbound', 'HRA Outbound', null, null, STATUSES.MISSING_ANCHOR, 'Jeddah departure is missing, so outbound HRA must be entered manually.'));
  } else {
    const entry = addHours(outboundAnchor.ets, outboundAfter);
    suggestions.push(suggestion('hra_outbound', 'HRA Outbound', entry, addHours(entry, transit), STATUSES.OK));
  }

  if (!inboundEnabled) {
    suggestions.push(suggestion('hra_inbound', 'HRA Inbound', null, null, STATUSES.DISABLED, 'HRA inbound window is disabled.'));
  } else if (!inboundAnchor || !parseDate(inboundAnchor.eta)) {
    suggestions.push(suggestion('hra_inbound', 'HRA Inbound', null, null, STATUSES.MISSING_ANCHOR, 'Jeddah arrival is missing, so inbound HRA must be entered manually.'));
  } else {
    suggestions.push(suggestion(
      'hra_inbound',
      'HRA Inbound',
      addHours(inboundAnchor.eta, -inboundBefore),
      addHours(inboundAnchor.eta, -inboundExitBefore),
      STATUSES.OK
    ));
  }

  return suggestions;
}

function calculateFirstLastOffset(voyage, zoneRule) {
  const formula = zoneRule.formula || {};
  const windowState = findWindow(voyage, 'main');
  if (!isEnabledWindow(windowState)) {
    return [suggestion('main', zoneRule.zoneEvents?.label || 'EWR', null, null, STATUSES.DISABLED, 'Zone window is disabled.')];
  }

  const formulaPortCalls = findFormulaPortCalls(voyage.portCalls || [], formula.formulaPorts);
  const firstEtaPort = firstWithTime(formulaPortCalls, 'eta');
  const lastEtsPort = lastWithTime(formulaPortCalls, 'ets');

  if (!firstEtaPort || !lastEtsPort) {
    return [suggestion('main', zoneRule.zoneEvents?.label || 'EWR', null, null, STATUSES.MISSING_ANCHOR, 'Required formula port times are missing.')];
  }

  return [suggestion(
    'main',
    zoneRule.zoneEvents?.label || 'EWR',
    addHours(firstEtaPort.eta, Number(formula.entryOffsetHours ?? 0)),
    addHours(lastEtsPort.ets, Number(formula.exitOffsetHours ?? 0)),
    STATUSES.OK
  )];
}

function calculateManual(voyage, zoneRule) {
  if (zoneRule.key === 'zeynep_c' || zoneRule.isZeynepOption) {
    const manualWindows = Array.isArray(voyage.zoneWindows)
      ? voyage.zoneWindows.filter(window => window && window.enabled)
      : [];
    if (manualWindows.length === 0 && !(voyage.zoneEntry || voyage.zoneExit || voyage.zoneEntryReturn || voyage.zoneExitReturn)) {
      return [suggestion('main', 'EWR', null, null, STATUSES.DISABLED, 'Zeynep C is risk-free by default.')];
    }
    return manualWindows.length
      ? manualWindows.map(window => suggestion(window.key || 'main', window.label || 'Manual Zone', window.entry || null, window.exit || null, STATUSES.MANUAL_NEEDED, 'Manual zone timing is enabled.'))
      : [suggestion('main', voyage.zeynepZoneName || 'Manual Zone', voyage.zoneEntry || null, voyage.zoneExit || null, STATUSES.MANUAL_NEEDED, 'Manual zone timing is enabled.')];
  }

  return [suggestion('main', zoneRule.zoneEvents?.label || 'Manual Zone', null, null, STATUSES.NOT_APPLICABLE, 'No automatic zone calculation applies.')];
}

function calculateRouteSuggestions(voyage, config) {
  const zoneKey = voyage && voyage.zone;
  const zoneRule = (config?.riskZones || []).find(zone => zone.key === zoneKey);
  if (!zoneRule) {
    const suggestions = [suggestion('main', 'Zone', null, null, STATUSES.NOT_APPLICABLE, 'Unknown risk zone.')];
    return { zone: zoneKey || null, suggestions, messages: buildMessages(suggestions) };
  }

  const formula = zoneRule.formula || { type: 'manual' };
  let suggestions;
  if (formula.type === 'jeddah_hra') {
    suggestions = calculateJeddahHra(voyage, zoneRule);
  } else if (formula.type === 'first_last_offset') {
    suggestions = calculateFirstLastOffset(voyage, zoneRule);
  } else {
    suggestions = calculateManual(voyage, zoneRule);
  }

  return { zone: zoneKey, suggestions, messages: buildMessages(suggestions) };
}

function canApplySuggestion(target) {
  return !target.confirmed;
}

function isManualOverride(currentValue, previousCalculatedValue, nextCalculatedValue) {
  if (!currentValue) return false;
  if (currentValue === nextCalculatedValue) return false;
  return previousCalculatedValue ? currentValue !== previousCalculatedValue : true;
}

function applyRouteSuggestions(voyage, suggestions) {
  const next = { ...voyage };
  for (const item of suggestions || []) {
    if (item.status !== STATUSES.OK) continue;
    for (const side of ['entry', 'exit']) {
      const mapping = FIELD_MAP[`${item.windowKey}.${side}`];
      if (!mapping) continue;
      const [field, confirmedField] = mapping;
      if (canApplySuggestion({
        confirmed: !!next[confirmedField],
        manuallyEdited: !!next[`${field}ManuallyEdited`] || isManualOverride(next[field], next[`${field}Calculated`], item[side] || null)
      })) {
        next[field] = item[side] || null;
      }
      next[`${field}Calculated`] = item[side] || null;
    }
  }
  return next;
}

module.exports = {
  STATUSES,
  calculateRouteSuggestions,
  applyRouteSuggestions,
  canApplySuggestion
};
