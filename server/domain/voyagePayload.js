'use strict';

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function cleanString(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function normalizeChartererName(value) {
  const clean = cleanString(value).replace(/\s+/g, ' ');
  return clean.toLowerCase() === 'cma' ? 'CMA CGM' : clean;
}

function validateISODate(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw inputError(`${fieldName} must be a valid date.`);
  return date.toISOString();
}

function normalizePortCall(portCall, index) {
  const port = cleanString(portCall.port);
  const eta = validateISODate(portCall.eta, `Port ${index + 1} ETA`);
  const ets = validateISODate(portCall.ets, `Port ${index + 1} ETS`);
  const role = cleanString(portCall.role);
  const visibleLabel = cleanString(portCall.visibleLabel);
  const normalized = {
    port,
    eta,
    etaConfirmed: !!portCall.etaConfirmed,
    ets,
    etsConfirmed: !!portCall.etsConfirmed,
    omit: !!portCall.omit
  };

  if (role) normalized.role = role;
  if (visibleLabel) normalized.visibleLabel = visibleLabel;
  if (portCall.arrivalEnabled === false) normalized.arrivalEnabled = false;
  if (portCall.departureEnabled === false) normalized.departureEnabled = false;

  return normalized;
}

function isMeaningfulPortCall(portCall) {
  return !!(
    portCall.port ||
    portCall.eta ||
    portCall.ets ||
    portCall.omit ||
    portCall.role ||
    portCall.visibleLabel
  );
}

function normalizePortCalls(portCalls) {
  if (portCalls === undefined || portCalls === null) return [];
  if (!Array.isArray(portCalls)) throw inputError('Port calls must be a list.');
  return portCalls
    .map(normalizePortCall)
    .filter(isMeaningfulPortCall);
}

function normalizeZoneWindow(window, index) {
  const key = cleanString(window.key) || `window_${index + 1}`;
  return {
    key,
    label: cleanString(window.label),
    kind: cleanString(window.kind) || key,
    enabled: window.enabled !== false,
    entry: validateISODate(window.entry, `Zone window ${index + 1} entry`),
    entryConfirmed: !!window.entryConfirmed,
    exit: validateISODate(window.exit, `Zone window ${index + 1} exit`),
    exitConfirmed: !!window.exitConfirmed,
    mode: cleanString(window.mode) || 'manual'
  };
}

function isMeaningfulZoneWindow(window) {
  return !!(window.key || window.entry || window.exit || window.enabled === false);
}

function normalizeZoneWindows(zoneWindows) {
  if (zoneWindows === undefined || zoneWindows === null) return undefined;
  if (!Array.isArray(zoneWindows)) throw inputError('Zone windows must be a list.');
  return zoneWindows
    .map(normalizeZoneWindow)
    .filter(isMeaningfulZoneWindow);
}

function normalizeVoyagePayload(body, existing = {}) {
  const zone = body.zone !== undefined ? (cleanString(body.zone) || null) : (existing.zone || null);
  const vesselName = body.vesselName !== undefined ? cleanString(body.vesselName) : cleanString(existing.vesselName);
  const payload = {
    vesselName,
    charterer: body.charterer !== undefined ? normalizeChartererName(body.charterer) : normalizeChartererName(existing.charterer),
    service: body.service !== undefined ? cleanString(body.service) : cleanString(existing.service),
    zone,
    isZeynepC: body.isZeynepC !== undefined ? !!body.isZeynepC : !!existing.isZeynepC,
    portCalls: body.portCalls !== undefined ? normalizePortCalls(body.portCalls) : normalizePortCalls(existing.portCalls || []),
    zoneEntry: body.zoneEntry !== undefined ? validateISODate(body.zoneEntry, 'Zone entry') : (existing.zoneEntry || null),
    zoneEntryConfirmed: body.zoneEntryConfirmed !== undefined ? !!body.zoneEntryConfirmed : !!existing.zoneEntryConfirmed,
    zoneExit: body.zoneExit !== undefined ? validateISODate(body.zoneExit, 'Zone exit') : (existing.zoneExit || null),
    zoneExitConfirmed: body.zoneExitConfirmed !== undefined ? !!body.zoneExitConfirmed : !!existing.zoneExitConfirmed,
    zoneEntryReturn: body.zoneEntryReturn !== undefined ? validateISODate(body.zoneEntryReturn, 'Return entry') : (existing.zoneEntryReturn || null),
    zoneEntryReturnConfirmed: body.zoneEntryReturnConfirmed !== undefined ? !!body.zoneEntryReturnConfirmed : !!existing.zoneEntryReturnConfirmed,
    zoneExitReturn: body.zoneExitReturn !== undefined ? validateISODate(body.zoneExitReturn, 'Return exit') : (existing.zoneExitReturn || null),
    zoneExitReturnConfirmed: body.zoneExitReturnConfirmed !== undefined ? !!body.zoneExitReturnConfirmed : !!existing.zoneExitReturnConfirmed,
    notes: body.notes !== undefined ? cleanString(body.notes) : cleanString(existing.notes),
    zeynepZoneName: body.zeynepZoneName !== undefined ? cleanString(body.zeynepZoneName) : cleanString(existing.zeynepZoneName),
    status: body.status !== undefined ? cleanString(body.status) || 'active' : (existing.status || 'active')
  };

  if (body.zoneWindows !== undefined) payload.zoneWindows = normalizeZoneWindows(body.zoneWindows);
  else if (existing.zoneWindows !== undefined) payload.zoneWindows = normalizeZoneWindows(existing.zoneWindows);

  return payload;
}

module.exports = {
  normalizeVoyagePayload,
  normalizePortCalls,
  normalizeZoneWindows,
  validateISODate,
  inputError
};
