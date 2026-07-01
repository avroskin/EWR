'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const ExcelJS = require('exceljs');
const { buildInsuranceExportWorkbook } = require('./server/exportWorkbook');
const { createDailyDataBackup } = require('./server/backupService');
const { calculateRouteSuggestions, applyRouteSuggestions } = require('./server/domain/routeRules');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3002;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SETTINGS_PASSWORD = process.env.EWR_SETTINGS_PASSWORD || '1881';
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const adminTokens = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function currentYear() {
  return new Date().getFullYear();
}

function voyagesFile(year) {
  return path.join(DATA_DIR, `voyages_${year}.json`);
}

function archiveFile(year) {
  return path.join(DATA_DIR, `archive_${year}.json`);
}

function configFile() {
  return path.join(DATA_DIR, 'config.json');
}

function readJSON(filePath, fallback = [], options = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Could not read JSON file ${filePath}:`, err.message);
    if (options.strict) throw err;
    return fallback;
  }
}

function writeJSON(filePath, data) {
  ensureDataDir();
  if (fs.existsSync(filePath)) {
    const parsed = path.parse(filePath);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(BACKUP_DIR, `${parsed.name}.${stamp}.json`);
    fs.copyFileSync(filePath, backup);
  }

  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function readVoyages(year) {
  const filePath = voyagesFile(year);
  return readJSON(filePath, [], { strict: fs.existsSync(filePath) });
}

function writeVoyages(year, voyages) {
  writeJSON(voyagesFile(year), voyages);
}

function hasArchive(year) {
  return fs.existsSync(archiveFile(year));
}

function isArchived(year) {
  return hasArchive(year) && !fs.existsSync(voyagesFile(year));
}

function archiveCutoffTime(year) {
  // 20.10 00:00 Europe/Istanbul. Records on 20.10 are excluded from the archive.
  return Date.UTC(year, 9, 20) - 3 * HOURS;
}

function getLatestVoyageTime(voyage) {
  const times = getVoyageEventTimes(voyage);
  return times.length ? Math.max(...times) : null;
}

function defaultRiskZones() {
  return [
    { key: 'gulf_of_aden', label: 'IMS - Gulf of Aden (HRA)', ports: ['Jeddah', 'Nhava Sheva', 'Mundra'], formula: { type: 'jeddah_hra', anchorPort: 'Jeddah', outboundAfterEtsHours: 14, transitHours: 48, inboundBeforeEtaHours: 62, inboundExitBeforeEtaHours: 14 }, zoneEvents: { enabled: true, split: false, pinExitToEnd: false, label: 'HRA' } },
    { key: 'southwest_africa', label: 'SW Africa (HRA)', ports: ['Tincan', 'Apapa', 'Cotonou', 'Lekki'], formula: { type: 'first_last_offset', entryOffsetHours: -10, exitOffsetHours: 10 }, zoneEvents: { enabled: true, split: true, pinExitToEnd: true, label: 'EWR' } },
    { key: 'mas_combined', label: 'MAS - East Med & SW Africa (EWR // K&R)', ports: ['Beirut', 'Lattakia', 'Tincan', 'Apapa', 'Cotonou'], formula: { type: 'first_last_offset', formulaPorts: ['Tincan', 'Apapa'], entryOffsetHours: -10, exitOffsetHours: 10 }, zoneEvents: { enabled: true, split: true, pinExitToEnd: false, label: 'EWR' } },
    { key: 'black_sea', label: 'Black Sea (EWR)', ports: ['Novorossiysk', 'Odessa'], formula: { type: 'first_last_offset', entryOffsetHours: -12, exitOffsetHours: 12 }, zoneEvents: { enabled: true, split: true, pinExitToEnd: false, label: 'EWR' } },
    { key: 'east_med', label: 'E. Mediterranean (EWR)', ports: ['Tartous', 'Beirut', 'Lattakia', 'Tripoli (Lebanon)'], formula: { type: 'first_last_offset', entryOffsetHours: 0, exitOffsetHours: 0 }, zoneEvents: { enabled: false, split: false, pinExitToEnd: false, label: 'EWR' } },
    { key: 'north_africa', label: 'N. Africa / Libya (LTS)', ports: ['Misurata', 'Tripoli (Libya)', 'Benghazi', 'Al Khums', 'El Khoms'], formula: { type: 'manual' }, zoneEvents: { enabled: false, split: false, pinExitToEnd: false, label: 'EWR' } },
    { key: 'zeynep_c', label: 'Zeynep C', ports: ['Zeynep C'], formula: { type: 'manual' }, zoneEvents: { enabled: false, split: false, pinExitToEnd: false, label: 'EWR' }, isZeynepOption: true }
  ];
}

function normalizeVesselProfiles(profiles) {
  if (!Array.isArray(profiles)) return [];
  return profiles.map(profile => ({
    name: String(profile.name || '').trim(),
    charterer: normalizeChartererName(profile.charterer),
    zones: sanitizeStringList(profile.zones || [])
  })).filter(profile => profile.name);
}

function normalizeConfig(cfg) {
  const normalized = {
    vessels: Array.isArray(cfg.vessels) ? cfg.vessels : [],
    charterers: sanitizeStringList((Array.isArray(cfg.charterers) ? cfg.charterers : []).map(normalizeChartererName)),
    services: Array.isArray(cfg.services) ? cfg.services : [],
    vesselProfiles: normalizeVesselProfiles(cfg.vesselProfiles || []),
    riskZones: Array.isArray(cfg.riskZones) && cfg.riskZones.length ? cfg.riskZones : defaultRiskZones()
  };
  return normalized;
}

function readConfig() {
  return normalizeConfig(readJSON(configFile(), { vessels: [], charterers: [], services: [], riskZones: defaultRiskZones() }));
}

function writeConfig(cfg) {
  writeJSON(configFile(), cfg);
}

function addToConfig(field, value) {
  if (!value || !value.trim()) return;
  const cfg = readConfig();
  if (!cfg[field]) cfg[field] = [];
  const val = value.trim();
  if (!cfg[field].includes(val)) {
    cfg[field].push(val);
    cfg[field].sort((a, b) => a.localeCompare(b));
    writeConfig(cfg);
  }
}

function inputError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function authError(message = 'Settings authorization is required.') {
  const err = new Error(message);
  err.statusCode = 401;
  return err;
}

function issueAdminToken() {
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
  return token;
}

function requireAdmin(req) {
  const token = String(req.get('x-admin-token') || '');
  const expiresAt = adminTokens.get(token);
  if (!token || !expiresAt || expiresAt < Date.now()) {
    if (token) adminTokens.delete(token);
    throw authError();
  }
  adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
}

function parseYear(value) {
  const year = parseInt(value, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return year;
}

function sanitizeStringList(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function validateISODate(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw inputError(fieldName + ' must be a valid date.');
  return d.toISOString();
}

function normalizePortCalls(portCalls) {
  if (!Array.isArray(portCalls)) throw inputError('Port calls must be a list.');
  return portCalls.map((portCall, index) => {
    const normalized = {
      port: String(portCall.port || '').trim(),
      eta: validateISODate(portCall.eta, 'Port ' + (index + 1) + ' ETA'),
      etaConfirmed: !!portCall.etaConfirmed,
      ets: validateISODate(portCall.ets, 'Port ' + (index + 1) + ' ETD'),
      etsConfirmed: !!portCall.etsConfirmed,
      omit: !!portCall.omit
    };
    const role = String(portCall.role || '').trim();
    const visibleLabel = String(portCall.visibleLabel || '').trim();
    if (role) normalized.role = role;
    if (visibleLabel) normalized.visibleLabel = visibleLabel;
    if (portCall.arrivalEnabled === false) normalized.arrivalEnabled = false;
    if (portCall.departureEnabled === false) normalized.departureEnabled = false;
    return normalized;
  }).filter(portCall => portCall.port || portCall.eta || portCall.ets || portCall.omit || portCall.role || portCall.visibleLabel);
}

function validateVoyagePayload(body, existing = {}) {
  const cfg = readConfig();
  const zone = body.zone !== undefined ? (body.zone || null) : existing.zone;
  const knownZones = new Set((cfg.riskZones || []).map(z => z.key));
  const vesselName = String(body.vesselName !== undefined ? body.vesselName : existing.vesselName || '').trim();
  if (!vesselName) throw inputError('Vessel name is required.');
  if (!zone || !knownZones.has(zone)) throw inputError('A valid risk zone is required.');

  const status = body.status !== undefined ? body.status : (existing.status || 'active');
  if (!['active', 'legacy'].includes(status)) throw inputError('Status must be active or legacy.');

  return {
    vesselName,
    charterer: normalizeChartererName(body.charterer !== undefined ? body.charterer : existing.charterer || ''),
    service: String(body.service !== undefined ? body.service : existing.service || '').trim(),
    zone,
    isZeynepC: body.isZeynepC !== undefined ? !!body.isZeynepC : !!existing.isZeynepC,
    portCalls: body.portCalls !== undefined ? normalizePortCalls(body.portCalls) : (existing.portCalls || []),
    zoneEntry: body.zoneEntry !== undefined ? validateISODate(body.zoneEntry, 'Zone entry') : (existing.zoneEntry || null),
    zoneEntryConfirmed: body.zoneEntryConfirmed !== undefined ? !!body.zoneEntryConfirmed : !!existing.zoneEntryConfirmed,
    zoneExit: body.zoneExit !== undefined ? validateISODate(body.zoneExit, 'Zone exit') : (existing.zoneExit || null),
    zoneExitConfirmed: body.zoneExitConfirmed !== undefined ? !!body.zoneExitConfirmed : !!existing.zoneExitConfirmed,
    zoneEntryReturn: body.zoneEntryReturn !== undefined ? validateISODate(body.zoneEntryReturn, 'Return entry') : (existing.zoneEntryReturn || null),
    zoneEntryReturnConfirmed: body.zoneEntryReturnConfirmed !== undefined ? !!body.zoneEntryReturnConfirmed : !!existing.zoneEntryReturnConfirmed,
    zoneExitReturn: body.zoneExitReturn !== undefined ? validateISODate(body.zoneExitReturn, 'Return exit') : (existing.zoneExitReturn || null),
    zoneExitReturnConfirmed: body.zoneExitReturnConfirmed !== undefined ? !!body.zoneExitReturnConfirmed : !!existing.zoneExitReturnConfirmed,
    notes: String(body.notes !== undefined ? body.notes : existing.notes || '').trim(),
    zeynepZoneName: String(body.zeynepZoneName !== undefined ? body.zeynepZoneName : existing.zeynepZoneName || '').trim(),
    status
  };
}

function normalizeRiskZones(riskZones) {
  if (!Array.isArray(riskZones)) throw inputError('Risk zone rules must be a list.');
  const seenKeys = new Set();
  return riskZones.map(zone => {
    if (!zone || !String(zone.key || '').trim()) throw inputError('Every risk zone needs a key.');
    const key = String(zone.key).trim();
    if (seenKeys.has(key)) throw inputError('Risk zone keys must be unique: ' + key);
    seenKeys.add(key);
    const formula = zone.formula && typeof zone.formula === 'object' ? zone.formula : { type: 'manual' };
    return {
      ...zone,
      key,
      label: String(zone.label || zone.key).trim(),
      ports: sanitizeStringList(zone.ports || []),
      formula: { ...formula, type: formula.type || 'manual' },
      zoneEvents: {
        enabled: !!(zone.zoneEvents && zone.zoneEvents.enabled),
        split: !!(zone.zoneEvents && zone.zoneEvents.split),
        pinExitToEnd: !!(zone.zoneEvents && zone.zoneEvents.pinExitToEnd),
        label: String((zone.zoneEvents && zone.zoneEvents.label) || 'EWR').trim()
      }
    };
  });
}

// ── Zone Calculation Logic ───────────────────────────────────────────────────

const HOURS = 60 * 60 * 1000;
const DAYS  = 24 * HOURS;

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function toISO(d) {
  return d ? d.toISOString() : null;
}

function fmtAuditDate(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildVoyageWarnings(voyage) {
  const warnings = [];
  const addWarning = (severity, type, message, context = '') => {
    warnings.push({
      voyageId: voyage.id,
      vesselName: voyage.vesselName || '',
      charterer: voyage.charterer || '',
      service: voyage.service || '',
      zone: voyage.zone || '',
      status: voyage.status || 'active',
      severity,
      type,
      message,
      context
    });
  };

  (voyage.portCalls || []).forEach((pc, idx) => {
    const eta = parseDate(pc.eta);
    const ets = parseDate(pc.ets);
    const port = pc.port || `Port ${idx + 1}`;
    if (eta && ets) {
      const diff = ets.getTime() - eta.getTime();
      if (diff < 0) {
        addWarning('high', 'Reversed port dates', `${port} ETD is before ETA.`, `${fmtAuditDate(pc.eta)} -> ${fmtAuditDate(pc.ets)}`);
      } else if (diff > 5 * DAYS) {
        addWarning('medium', 'Long port stay', `${port} stay is longer than 5 days.`, `${Math.round(diff / DAYS)} days`);
      }
    }
  });

  [
    ['zoneEntry', 'zoneExit', 'Zone entry/exit'],
    ['zoneEntryReturn', 'zoneExitReturn', 'Return entry/exit']
  ].forEach(([entryField, exitField, label]) => {
    const entry = parseDate(voyage[entryField]);
    const exit = parseDate(voyage[exitField]);
    if (!entry || !exit) return;
    const diff = exit.getTime() - entry.getTime();
    if (diff < 0) {
      addWarning('high', 'Reversed zone dates', `${label} is reversed.`, `${fmtAuditDate(voyage[entryField])} -> ${fmtAuditDate(voyage[exitField])}`);
    } else if (diff > 45 * DAYS) {
      addWarning('medium', 'Long zone range', `${label} is longer than 45 days.`, `${Math.round(diff / DAYS)} days`);
    }
  });

  return warnings;
}

function buildAuditReport(voyages) {
  const warnings = voyages.flatMap(buildVoyageWarnings);
  const bySeverity = warnings.reduce((acc, warning) => {
    acc[warning.severity] = (acc[warning.severity] || 0) + 1;
    return acc;
  }, {});
  const affectedVoyages = new Set(warnings.map(w => w.voyageId)).size;
  return {
    summary: {
      totalWarnings: warnings.length,
      affectedVoyages,
      high: bySeverity.high || 0,
      medium: bySeverity.medium || 0,
      low: bySeverity.low || 0
    },
    warnings
  };
}

function getPortTime(portCalls, portName, field) {
  const pc = portCalls.find(p => p.port && p.port.trim().toLowerCase() === portName.toLowerCase() && !p.omit);
  if (!pc) return null;
  return parseDate(pc[field]);
}

function getFirstPortETA(portCalls) {
  for (const pc of portCalls) {
    if (!pc.omit && pc.eta) return parseDate(pc.eta);
  }
  return null;
}

function getLastPortETS(portCalls) {
  let last = null;
  for (const pc of portCalls) {
    if (!pc.omit && pc.ets) last = parseDate(pc.ets);
  }
  return last;
}

function routeSuggestionsToLegacyFields(routeResult) {
  const legacy = {
    zoneEntry: null,
    zoneExit: null,
    zoneEntryReturn: null,
    zoneExitReturn: null,
    statuses: {},
    suggestions: routeResult.suggestions || [],
    messages: routeResult.messages || []
  };

  for (const item of routeResult.suggestions || []) {
    if (item.windowKey === 'hra_inbound') {
      legacy.statuses.return = item.status;
      if (item.status === 'ok') {
        legacy.zoneEntryReturn = item.entry || null;
        legacy.zoneExitReturn = item.exit || null;
      }
    } else {
      legacy.statuses.main = item.status;
      if (item.status === 'ok') {
        legacy.zoneEntry = item.entry || null;
        legacy.zoneExit = item.exit || null;
      }
    }
  }

  return legacy;
}

function calculateZoneTimes(zone, portCalls) {
  const routeResult = calculateRouteSuggestions({ zone, portCalls: portCalls || [] }, readConfig());
  return routeSuggestionsToLegacyFields(routeResult);
}

// ── Voyage helpers ───────────────────────────────────────────────────────────

function recalcVoyage(voyage) {
  if (voyage.isZeynepC) return voyage;

  const routeResult = calculateRouteSuggestions(voyage, readConfig());
  const calc = routeSuggestionsToLegacyFields(routeResult);
  voyage.zoneEntryCalculated = calc.zoneEntry;
  voyage.zoneExitCalculated  = calc.zoneExit;
  voyage.zoneEntryReturnCalculated = calc.zoneEntryReturn;
  voyage.zoneExitReturnCalculated  = calc.zoneExitReturn;
  voyage.calculationStatuses = calc.statuses;

  const applied = applyRouteSuggestions(voyage, routeResult.suggestions);
  voyage.zoneEntry = applied.zoneEntry || null;
  voyage.zoneExit = applied.zoneExit || null;
  voyage.zoneEntryReturn = applied.zoneEntryReturn || null;
  voyage.zoneExitReturn = applied.zoneExitReturn || null;

  return voyage;
}

function getVoyageEventTimes(voyage) {
  const times = [];
  ['zoneEntry', 'zoneExit', 'zoneEntryReturn', 'zoneExitReturn'].forEach(field => {
    const d = parseDate(voyage[field]);
    if (d) times.push(d.getTime());
  });
  (voyage.portCalls || []).forEach(port => {
    ['eta', 'ets'].forEach(field => {
      const d = parseDate(port[field]);
      if (d) times.push(d.getTime());
    });
  });
  return times;
}

function getEarliestVoyageTime(voyage) {
  const times = getVoyageEventTimes(voyage);
  if (times.length) return Math.min(...times);
  const created = parseDate(voyage.createdAt);
  return created ? created.getTime() : 0;
}

function hasConfirmedEvent(voyage) {
  return getVoyageEventTimes(voyage).some(t => t <= Date.now());
}

function hasEstimatedEvent(voyage) {
  return getVoyageEventTimes(voyage).some(t => t > Date.now());
}

function sortVoyagesByTimeline(voyages) {
  voyages.sort((a, b) => getEarliestVoyageTime(b) - getEarliestVoyageTime(a));
}

function getServiceSummary(year) {
  const cfg = readConfig();
  const configured = new Set((cfg.services || []).filter(Boolean));
  const voyages = readVoyages(year);
  const summary = new Map();

  configured.forEach(service => {
    summary.set(service, { service, active: 0, legacy: 0, total: 0 });
  });

  voyages.forEach(voyage => {
    const service = String(voyage.service || '').trim();
    if (!service) return;
    if (!summary.has(service)) summary.set(service, { service, active: 0, legacy: 0, total: 0 });
    const item = summary.get(service);
    if (voyage.status === 'legacy') item.legacy += 1;
    else item.active += 1;
    item.total += 1;
  });

  return [...summary.values()].sort((a, b) => a.service.localeCompare(b.service));
}

function normalizeServiceName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeFilterValue(value) {
  return normalizeServiceName(value).toLowerCase();
}

function normalizeChartererName(value) {
  const clean = normalizeServiceName(value);
  return clean.toLowerCase() === 'cma' ? 'CMA CGM' : clean;
}

function sameFilterValue(actual, expected) {
  return normalizeFilterValue(actual) === normalizeFilterValue(expected);
}

function filterValues(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return values.map(item => normalizeServiceName(item)).filter(Boolean);
}

function matchesAnyFilterValue(actual, expectedValues) {
  return expectedValues.some(expected => sameFilterValue(actual, expected));
}


function applyFilters(voyages, q) {
  let result = voyages;

  if (q.vessel) {
    const vessels = filterValues(q.vessel);
    if (vessels.length) result = result.filter(v => matchesAnyFilterValue(v.vesselName, vessels));
  }
  if (q.charterer)   result = result.filter(v => sameFilterValue(normalizeChartererName(v.charterer), normalizeChartererName(q.charterer)));
  if (q.service)     result = result.filter(v => sameFilterValue(v.service, q.service));
  if (q.zone) {
    if (q.zone === 'southwest_africa' || q.zone === 'east_med') {
      result = result.filter(v => v.zone === q.zone || v.zone === 'mas_combined');
    } else {
      result = result.filter(v => v.zone === q.zone);
    }
  }
  if (q.zeynepC)     result = result.filter(v => v.isZeynepC);
  if (q.id)          result = result.filter(v => v.id === q.id);

  if (q.port) {
    const p = q.port.toLowerCase();
    result = result.filter(v => v.portCalls && v.portCalls.some(pc => pc.port && pc.port.toLowerCase().includes(p)));
  }

  const from = q.dateFrom ? new Date(q.dateFrom) : null;
  const to = q.dateTo ? new Date(q.dateTo) : null;
  const fromMs = from && !Number.isNaN(from.getTime()) ? from.getTime() : null;
  let toMs = null;
  if (to && !Number.isNaN(to.getTime())) {
    to.setHours(23, 59, 59, 999);
    toMs = to.getTime();
  }
  if (fromMs !== null || toMs !== null) {
    result = result.filter(v => getVoyageEventTimes(v).some(t =>
      (fromMs === null || t >= fromMs) && (toMs === null || t <= toMs)
    ));
  }

  if (q.confirmed === 'confirmed') {
    result = result.filter(hasConfirmedEvent);
  } else if (q.confirmed === 'estimated') {
    result = result.filter(hasEstimatedEvent);
  }

  if (q.status) {
    if (q.status === 'active') {
      result = result.filter(v => !v.status || v.status === 'active');
    } else {
      result = result.filter(v => v.status === q.status);
    }
  }

  return result;
}

// ── API Routes ───────────────────────────────────────────────────────────────

// POST /api/admin/unlock
app.post('/api/admin/unlock', (req, res) => {
  try {
    if (String(req.body.password || '') !== SETTINGS_PASSWORD) throw authError('Settings password is incorrect.');
    res.json({ token: issueAdminToken(), expiresInMs: ADMIN_TOKEN_TTL_MS });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Settings unlock failed.' });
  }
});

// GET /api/voyages
app.get('/api/voyages', (req, res) => {
  try {
    ensureDataDir();
    const year = parseInt(req.query.year) || currentYear();

    const archiveOnly = req.query.archive === '1';
    let voyages;
    if (archiveOnly) {
      voyages = readJSON(archiveFile(year), [], { strict: hasArchive(year) });
    } else if (isArchived(year)) {
      voyages = readJSON(archiveFile(year), []);
    } else {
      voyages = readVoyages(year);
    }

    sortVoyagesByTimeline(voyages);

    const filtered = applyFilters(voyages, req.query);
    res.json({ voyages: filtered, archived: isArchived(year) || archiveOnly, archiveOnly, hasArchive: hasArchive(year), year });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Data could not be loaded.' });
  }
});

// GET /api/voyages/:id
app.get('/api/voyages/:id', (req, res) => {
  try {
    ensureDataDir();
    const year = parseInt(req.query.year) || currentYear();
    const archiveOnly = req.query.archive === '1';
    const voyages = archiveOnly || isArchived(year) ? readJSON(archiveFile(year), []) : readVoyages(year);
    const voyage = voyages.find(v => v.id === req.params.id);
    if (!voyage) return res.status(404).json({ error: 'Record not found.' });
    res.json(voyage);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Record could not be loaded.' });
  }
});

// POST /api/voyages
app.post('/api/voyages', (req, res) => {
  try {
    ensureDataDir();
    const year = parseYear(req.body.year) || currentYear();

    if (isArchived(year)) return res.status(403).json({ error: 'Records cannot be added to an archived year.' });

    const normalized = validateVoyagePayload(req.body);
    const voyage = {
      id: uuidv4(),
      year,
      ...normalized,
      zoneEntryCalculated: null,
      zoneExitCalculated: null,
      zoneEntryReturnCalculated: null,
      zoneExitReturnCalculated: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    recalcVoyage(voyage);

    // Update config with new values
    addToConfig('vessels', voyage.vesselName);
    addToConfig('charterers', voyage.charterer);
    addToConfig('services', voyage.service);

    const voyages = readVoyages(year);
    voyages.push(voyage);
    writeVoyages(year, voyages);

    res.status(201).json(voyage);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Record could not be created.' });
  }
});

// PUT /api/voyages/:id
app.put('/api/voyages/:id', (req, res) => {
  try {
    ensureDataDir();
    const year = parseYear(req.body.year) || currentYear();

    if (isArchived(year)) return res.status(403).json({ error: 'Archived records cannot be edited.' });

    const voyages = readVoyages(year);
    const idx = voyages.findIndex(v => v.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Record not found.' });

    const existing = voyages[idx];
    if (existing.status === 'legacy') return res.status(403).json({ error: 'Legacy records are read-only.' });
    const normalized = validateVoyagePayload(req.body, existing);
    const updated = {
      ...existing,
      ...normalized,
      importFlags: [],
      updatedAt: new Date().toISOString()
    };

    recalcVoyage(updated);

    addToConfig('vessels', updated.vesselName);
    addToConfig('charterers', updated.charterer);
    addToConfig('services', updated.service);

    voyages[idx] = updated;
    writeVoyages(year, voyages);

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Record could not be updated.' });
  }
});

// DELETE /api/voyages/:id
app.delete('/api/voyages/:id', (req, res) => {
  try {
    ensureDataDir();
    const year = parseInt(req.query.year) || currentYear();

    if (isArchived(year)) return res.status(403).json({ error: 'Archived records cannot be deleted.' });

    const voyages = readVoyages(year);
    const idx = voyages.findIndex(v => v.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Record not found.' });
    if (voyages[idx].status === 'legacy') return res.status(403).json({ error: 'Legacy records are read-only.' });

    voyages.splice(idx, 1);
    writeVoyages(year, voyages);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Record could not be deleted.' });
  }
});

// GET /api/services
app.get('/api/services', (req, res) => {
  try {
    ensureDataDir();
    const year = parseYear(req.query.year) || currentYear();
    res.json({ year, services: getServiceSummary(year) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Services could not be loaded.' });
  }
});

// POST /api/services/open
app.post('/api/services/open', (req, res) => {
  try {
    requireAdmin(req);
    const service = normalizeServiceName(req.body.service);
    if (!service) throw inputError('Service name is required.');
    addToConfig('services', service);
    const year = parseYear(req.body.year) || currentYear();
    res.status(201).json({ service, year, services: getServiceSummary(year) });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Service could not be opened.' });
  }
});

// POST /api/services/close
app.post('/api/services/close', (req, res) => {
  try {
    requireAdmin(req);
    ensureDataDir();
    const year = parseYear(req.body.year) || currentYear();
    if (isArchived(year)) return res.status(403).json({ error: 'Archived years cannot be changed.' });

    const service = normalizeServiceName(req.body.service);
    if (!service) throw inputError('Service name is required.');

    const serviceKey = service.toLowerCase();
    const voyages = readVoyages(year);
    let changed = 0;
    voyages.forEach(voyage => {
      if (String(voyage.service || '').trim().toLowerCase() === serviceKey && voyage.status !== 'legacy') {
        voyage.status = 'legacy';
        voyage.updatedAt = new Date().toISOString();
        changed += 1;
      }
    });

    if (changed) writeVoyages(year, voyages);
    res.json({ service, year, changed, services: getServiceSummary(year) });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Service could not be closed.' });
  }
});

// GET /api/archives
app.get('/api/archives', (req, res) => {
  try {
    ensureDataDir();
    const files = fs.readdirSync(DATA_DIR);
    const years = files
      .filter(f => /^archive_\d{4}\.json$/.test(f))
      .map(f => parseInt(f.replace('archive_', '').replace('.json', '')))
      .sort((a, b) => b - a);
    const archivedYears = years.filter(y => isArchived(y));
    const partialArchivedYears = years.filter(y => !isArchived(y));
    res.json({ archivedYears, partialArchivedYears });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Archive list could not be loaded.' });
  }
});

// POST /api/archive/:year
app.post('/api/archive/:year', (req, res) => {
  try {
    requireAdmin(req);
    ensureDataDir();
    const year = parseInt(req.params.year);
    if (!year) return res.status(400).json({ error: 'Invalid year.' });
    if (isArchived(year)) return res.status(400).json({ error: 'This year is already fully archived.' });

    const voyages = readVoyages(year);
    const cutoff = archiveCutoffTime(year);
    const toArchive = [];
    const remaining = [];

    for (const voyage of voyages) {
      const latest = getLatestVoyageTime(voyage);
      if (latest !== null && latest < cutoff) {
        toArchive.push({
          ...voyage,
          archivedAt: new Date().toISOString(),
          archiveCutoff: new Date(cutoff).toISOString()
        });
      } else {
        remaining.push(voyage);
      }
    }

    const existingArchive = readJSON(archiveFile(year), []);
    const existingIds = new Set(existingArchive.map(v => v.id));
    const mergedArchive = [
      ...existingArchive,
      ...toArchive.filter(v => !existingIds.has(v.id))
    ];

    writeJSON(archiveFile(year), mergedArchive);
    writeVoyages(year, remaining);

    res.json({
      success: true,
      year,
      count: toArchive.length,
      remaining: remaining.length,
      cutoff: new Date(cutoff).toISOString()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Archive failed.' });
  }
});

// GET /api/config
app.get('/api/config', (req, res) => {
  try {
    ensureDataDir();
    res.json(readConfig());
  } catch (err) {
    res.status(500).json({ error: 'Settings could not be loaded.' });
  }
});

// POST /api/config
app.post('/api/config', (req, res) => {
  try {
    requireAdmin(req);
    ensureDataDir();
    const cfg = readConfig();
    if (req.body.vessels)    cfg.vessels    = sanitizeStringList(req.body.vessels);
    if (req.body.charterers) cfg.charterers = sanitizeStringList(req.body.charterers);
    if (req.body.services)   cfg.services   = sanitizeStringList(req.body.services);
    if (req.body.vesselProfiles) cfg.vesselProfiles = normalizeVesselProfiles(req.body.vesselProfiles);
    if (req.body.riskZones)  cfg.riskZones  = normalizeRiskZones(req.body.riskZones);
    const normalized = normalizeConfig(cfg);
    writeConfig(normalized);
    res.json(normalized);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Settings could not be saved.' });
  }
});

// GET /api/calculate — preview zone times without saving
app.post('/api/calculate', (req, res) => {
  try {
    const { zone, portCalls } = req.body;
    const result = calculateZoneTimes(zone, portCalls || []);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Calculation failed.' });
  }
});

// GET /api/audit
app.get('/api/audit', (req, res) => {
  try {
    ensureDataDir();
    const year = parseInt(req.query.year) || currentYear();
    const voyages = isArchived(year) ? readJSON(archiveFile(year), []) : readVoyages(year);
    res.json({ year, archived: isArchived(year), ...buildAuditReport(voyages) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Audit could not be loaded.' });
  }
});

// GET /api/audit/export
app.get('/api/audit/export', async (req, res) => {
  try {
    ensureDataDir();
    const year = parseInt(req.query.year) || currentYear();
    const voyages = isArchived(year) ? readJSON(archiveFile(year), []) : readVoyages(year);
    const audit = buildAuditReport(voyages);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Audit');

    sheet.columns = [
      { header: 'Severity', key: 'severity', width: 12 },
      { header: 'Type', key: 'type', width: 22 },
      { header: 'Vessel', key: 'vesselName', width: 24 },
      { header: 'Charterer', key: 'charterer', width: 20 },
      { header: 'Service', key: 'service', width: 20 },
      { header: 'Zone', key: 'zone', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Message', key: 'message', width: 48 },
      { header: 'Context', key: 'context', width: 24 }
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } };
    audit.warnings.forEach(warning => sheet.addRow(warning));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Arfleet_RiskWatch_Audit_${year}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Audit export failed.' });
  }
});

// GET /api/export
app.get('/api/export', async (req, res) => {
  try {
    ensureDataDir();
    const year = parseInt(req.query.year) || currentYear();

    let voyages;
    if (isArchived(year)) {
      voyages = readJSON(archiveFile(year), []);
    } else {
      voyages = readVoyages(year);
    }

    sortVoyagesByTimeline(voyages);
    const filtered = applyFilters(voyages, req.query);
    const workbook = await buildInsuranceExportWorkbook({
      voyages: filtered,
      config: readConfig(),
      year,
      filters: req.query,
      buildVoyageWarnings
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Arfleet_RiskWatch_Insurance_Export_${year}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Export failed.' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

ensureDataDir();
app.listen(PORT, HOST, async () => {
  console.log(`Arfleet RiskWatch running: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0') console.log(`Local network access: http://<computer-IP>:${PORT}`);

  try {
    await createDailyDataBackup();
  } catch (err) {
    console.error('[BACKUP] Daily startup backup failed:', err && err.message ? err.message : err);
  }

  setInterval(() => {
    createDailyDataBackup().catch(err =>
      console.error('[BACKUP] Scheduled hourly check failed:', err && err.message ? err.message : err)
    );
  }, 60 * 60 * 1000);
});

