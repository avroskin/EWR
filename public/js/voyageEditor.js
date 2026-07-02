'use strict';

// VoyageEditor keeps add/edit voyage form logic, port-call collection,
// and risk-zone rule helpers isolated from the dashboard code.
window.VoyageEditor = (() => {
  const zoneEventDefaults = {
    gulf_of_aden: { enabled: true, split: false, pinExitToEnd: false, label: 'HRA' },
    southwest_africa: { enabled: true, split: true, pinExitToEnd: true, label: 'EWR' },
    mas_combined: { enabled: true, split: true, pinExitToEnd: false, label: 'EWR' },
    black_sea: { enabled: true, split: true, pinExitToEnd: false, label: 'EWR' },
    east_med: { enabled: false, split: false, pinExitToEnd: false, label: 'EWR' },
    north_africa: { enabled: false, split: false, pinExitToEnd: false, label: 'EWR' },
    zeynep_c: { enabled: false, split: false, pinExitToEnd: false, label: 'EWR' }
  };

  const activeZoneKeys = ['gulf_of_aden', 'mas_combined', 'black_sea', 'north_africa', 'zeynep_c'];
  const routeDefaultPorts = {
    gulf_of_aden: [
      { port: 'Jeddah', role: 'jeddah_departure', visibleLabel: 'Jeddah Departure', arrivalEnabled: false, departureEnabled: true },
      { port: 'Nhava Sheva' },
      { port: 'Mundra' },
      { port: 'Jeddah', role: 'jeddah_arrival', visibleLabel: 'Jeddah Arrival', arrivalEnabled: true, departureEnabled: false }
    ],
    mas_combined: [{ port: 'Beirut' }, { port: 'Lattakia' }, { port: 'Tincan' }, { port: 'Apapa' }, { port: 'Cotonou' }],
    black_sea: [{ port: 'Novorossiysk' }],
    north_africa: [{ port: 'Misurata' }, { port: 'Benghazi' }, { port: 'Tripoli (Libya)' }, { port: 'Al Khums' }],
    zeynep_c: []
  };

  function riskZones(config) {
    return Array.isArray(config?.riskZones) ? config.riskZones : [];
  }

  function getZone(config, zoneKey) {
    return riskZones(config).find(zone => zone.key === zoneKey) || null;
  }

  function getZoneEventSettings(config, zoneOrKey) {
    const key = typeof zoneOrKey === 'string' ? zoneOrKey : zoneOrKey?.key;
    const configured = typeof zoneOrKey === 'string'
      ? getZone(config, key)?.zoneEvents
      : zoneOrKey?.zoneEvents;
    return { ...(zoneEventDefaults[key] || { enabled: false, split: false, pinExitToEnd: false, label: 'EWR' }), ...(configured || {}) };
  }

  function describeZoneCalculation(config, zoneKey) {
    const zone = getZone(config, zoneKey);
    if (!zone) return '';
    const formula = zone.formula || { type: 'manual' };
    if (zone.isZeynepOption || zone.key === 'zeynep_c') {
      return 'Rule: Zeynep C is manual and risk-zone free by default.';
    }
    if (formula.type === 'manual') {
      return 'Rule: Manual dates. No automatic zone calculation.';
    }
    if (formula.type === 'first_last_offset') {
      const ports = Array.isArray(formula.formulaPorts) && formula.formulaPorts.length
        ? formula.formulaPorts.join(' / ')
        : (zone.ports || []).join(' / ');
      const entry = Number(formula.entryOffsetHours || 0);
      const exit = Number(formula.exitOffsetHours || 0);
      const entryText = entry === 0 ? 'same as first ETA' : 'first ETA ' + (entry > 0 ? '+' : '-') + ' ' + Math.abs(entry) + 'h';
      const exitText = exit === 0 ? 'same as last ETD' : 'last ETD ' + (exit > 0 ? '+' : '-') + ' ' + Math.abs(exit) + 'h';
      return 'Rule: ' + (ports || 'selected ports') + ' calculate zone times. Entry = ' + entryText + '; Exit = ' + exitText + '.';
    }
    if (formula.type === 'jeddah_hra') {
      return 'Rule: ' + (formula.anchorPort || 'Jeddah') + ' calculates standard HRA. If the usual Jeddah outbound call is missing, enter HRA outbound manually.';
    }
    return '';
  }

  function vesselProfilesForZone(config, zoneKey) {
    return (Array.isArray(config?.vesselProfiles) ? config.vesselProfiles : [])
      .filter(profile => !zoneKey || (profile.zones || []).includes(zoneKey))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  function findVesselProfile(config, name, zoneKey = '') {
    const profiles = Array.isArray(config?.vesselProfiles) ? config.vesselProfiles : [];
    return profiles.find(profile =>
      profile.name === name && (!zoneKey || (profile.zones || []).includes(zoneKey))
    ) || profiles.find(profile => profile.name === name) || null;
  }

  function zoneWindowFields(windowName) {
    return windowName === 'return' ? ['EntryReturn', 'ExitReturn'] : ['Entry', 'Exit'];
  }

  function selectableRiskZones(config, includeZoneKey = '') {
    return riskZones(config).filter(zone => activeZoneKeys.includes(zone.key) || zone.key === includeZoneKey);
  }

  function defaultPortCall(port = '') {
    const definition = typeof port === 'string' ? { port } : (port || {});
    return {
      port: definition.port || '',
      role: definition.role || '',
      visibleLabel: definition.visibleLabel || definition.port || '',
      eta: null,
      ets: null,
      omit: false,
      etaConfirmed: false,
      etsConfirmed: false,
      arrivalEnabled: definition.arrivalEnabled !== false,
      departureEnabled: definition.departureEnabled !== false
    };
  }

  function defaultPortCallsForZone(zoneOrPorts, fallbackPorts) {
    const zoneDefaults = typeof zoneOrPorts === 'string' ? routeDefaultPorts[zoneOrPorts] : null;
    const ports = zoneDefaults || (Array.isArray(zoneOrPorts) ? zoneOrPorts : fallbackPorts);
    return (Array.isArray(ports) ? ports : []).map(port => defaultPortCall(port));
  }

  function collectPortCalls(container, localToISO) {
    if (!container) return [];
    return [...container.querySelectorAll('.port-row')].map(row => {
      const omit = row.querySelector('.port-omit-btn')?.classList.contains('omit-active') || false;
      const displayPort = row.querySelector('.port-name')?.value.trim() || '';
      const role = row.dataset.role || '';
      const visibleLabel = row.dataset.visibleLabel || '';
      const basePort = row.dataset.basePort || '';
      const usesDefaultRole = !!role && (!visibleLabel || displayPort === visibleLabel);
      const arrivalEnabled = row.dataset.arrivalEnabled !== 'false';
      const departureEnabled = row.dataset.departureEnabled !== 'false';
      const portCall = {
        port: usesDefaultRole ? basePort : displayPort,
        eta: arrivalEnabled ? (localToISO(row.querySelector('.eta-field')?.value) || null) : null,
        etaConfirmed: arrivalEnabled && !!row.querySelector('.eta-confirmed-cb')?.checked,
        ets: departureEnabled ? (localToISO(row.querySelector('.ets-field')?.value) || null) : null,
        etsConfirmed: departureEnabled && !!row.querySelector('.ets-confirmed-cb')?.checked,
        omit
      };
      if (usesDefaultRole) {
        portCall.role = role;
        portCall.visibleLabel = visibleLabel || displayPort;
        if (!arrivalEnabled) portCall.arrivalEnabled = false;
        if (!departureEnabled) portCall.departureEnabled = false;
      }
      return portCall;
    });
  }

  function clearMainZoneWindow(payload) {
    payload.zoneEntry = null;
    payload.zoneExit = null;
    payload.zoneEntryConfirmed = false;
    payload.zoneExitConfirmed = false;
  }

  function clearReturnZoneWindow(payload) {
    payload.zoneEntryReturn = null;
    payload.zoneExitReturn = null;
    payload.zoneEntryReturnConfirmed = false;
    payload.zoneExitReturnConfirmed = false;
  }

  function buildVoyagePayload(options) {
    const doc = options.document || document;
    const localToISO = options.localToISO;
    const selectedZone = doc.getElementById('f-zone-select')?.value || null;
    const payload = {
      year: parseInt(doc.getElementById('f-year-form')?.value, 10) || options.currentYear,
      vesselName: doc.getElementById('f-vesselName')?.value.trim() || '',
      charterer: doc.getElementById('f-charterer-form')?.value.trim() || '',
      service: doc.getElementById('f-service')?.value.trim() || '',
      zone: selectedZone,
      isZeynepC: selectedZone === 'zeynep_c',
      portCalls: collectPortCalls(doc.getElementById('port-calls-list'), localToISO),
      zoneEntry: localToISO(doc.getElementById('f-zoneEntry')?.value),
      zoneEntryConfirmed: !!doc.getElementById('f-zoneEntryConfirmed')?.checked,
      zoneExit: localToISO(doc.getElementById('f-zoneExit')?.value),
      zoneExitConfirmed: !!doc.getElementById('f-zoneExitConfirmed')?.checked,
      zoneEntryReturn: localToISO(doc.getElementById('f-zoneEntryReturn')?.value),
      zoneEntryReturnConfirmed: !!doc.getElementById('f-zoneEntryReturnConfirmed')?.checked,
      zoneExitReturn: localToISO(doc.getElementById('f-zoneExitReturn')?.value),
      zoneExitReturnConfirmed: !!doc.getElementById('f-zoneExitReturnConfirmed')?.checked,
      notes: doc.getElementById('f-notes')?.value.trim() || '',
      zeynepZoneName: doc.getElementById('f-zeynep-zone-name')?.value.trim() || '',
      status: doc.getElementById('f-status')?.value || 'active'
    };

    if (!options.isZoneWindowEnabled?.('main')) clearMainZoneWindow(payload);
    if (!options.isZoneWindowEnabled?.('return')) clearReturnZoneWindow(payload);

    const zeynepHasHraPort = payload.zone === 'zeynep_c' && !!options.hasZeynepHraPorts?.(payload);
    const zeynepNoZone = !!doc.getElementById('f-zeynep-no-zone')?.checked;
    if (payload.zone === 'zeynep_c' && !zeynepHasHraPort && zeynepNoZone) {
      clearMainZoneWindow(payload);
      clearReturnZoneWindow(payload);
    }

    return payload;
  }

  return {
    getZoneEventSettings,
    describeZoneCalculation,
    vesselProfilesForZone,
    findVesselProfile,
    zoneWindowFields,
    selectableRiskZones,
    defaultPortCall,
    defaultPortCallsForZone,
    collectPortCalls,
    buildVoyagePayload
  };
})();
