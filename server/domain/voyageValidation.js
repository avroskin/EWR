'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const PORT_STAY_WARNING_DAYS = 5;
const ZONE_RANGE_WARNING_DAYS = 45;

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addIssue(issues, issue) {
  issues.push({
    severity: issue.severity || 'medium',
    type: issue.type || 'Check',
    message: issue.message || '',
    field: issue.field || '',
    index: Number.isInteger(issue.index) ? issue.index : null,
    context: issue.context || ''
  });
}

function fmtDays(ms) {
  return `${Math.round(ms / DAY_MS)} days`;
}

function validatePortCalls(voyage, issues) {
  (Array.isArray(voyage.portCalls) ? voyage.portCalls : []).forEach((portCall, index) => {
    const portName = String(portCall.port || portCall.visibleLabel || '').trim();
    const port = portName || `Port ${index + 1}`;
    const eta = parseDate(portCall.eta);
    const ets = parseDate(portCall.ets);

    if (!portName && (eta || ets || portCall.omit)) {
      addIssue(issues, {
        severity: 'medium',
        type: 'Missing port name',
        message: 'Port row has timing or omit data but no port name.',
        field: 'portCalls',
        index
      });
    }

    if (eta && ets) {
      const diff = ets.getTime() - eta.getTime();
      if (diff < 0) {
        addIssue(issues, {
          severity: 'high',
          type: 'Reversed port dates',
          message: `${port} departure is before arrival.`,
          field: 'portCalls',
          index,
          context: `${portCall.eta} -> ${portCall.ets}`
        });
      } else if (diff > PORT_STAY_WARNING_DAYS * DAY_MS) {
        addIssue(issues, {
          severity: 'medium',
          type: 'Long port stay',
          message: `${port} stay is longer than ${PORT_STAY_WARNING_DAYS} days.`,
          field: 'portCalls',
          index,
          context: fmtDays(diff)
        });
      }
    }
  });
}

function validateLegacyZonePair(voyage, issues, entryField, exitField, label) {
  const entry = parseDate(voyage[entryField]);
  const exit = parseDate(voyage[exitField]);
  if (!entry || !exit) return;

  const diff = exit.getTime() - entry.getTime();
  if (diff < 0) {
    addIssue(issues, {
      severity: 'high',
      type: 'Reversed zone dates',
      message: `${label} is reversed.`,
      field: entryField,
      context: `${voyage[entryField]} -> ${voyage[exitField]}`
    });
  } else if (diff > ZONE_RANGE_WARNING_DAYS * DAY_MS) {
    addIssue(issues, {
      severity: 'medium',
      type: 'Long zone range',
      message: `${label} is longer than ${ZONE_RANGE_WARNING_DAYS} days.`,
      field: entryField,
      context: fmtDays(diff)
    });
  }
}

function validateZoneWindows(voyage, issues) {
  if (Array.isArray(voyage.zoneWindows) && voyage.zoneWindows.length) {
    voyage.zoneWindows.forEach((window, index) => {
      if (window.enabled === false) return;
      const entry = parseDate(window.entry);
      const exit = parseDate(window.exit);
      if (!entry || !exit) return;
      const diff = exit.getTime() - entry.getTime();
      const label = window.label || window.key || `Zone window ${index + 1}`;
      if (diff < 0) {
        addIssue(issues, {
          severity: 'high',
          type: 'Reversed zone dates',
          message: `${label} is reversed.`,
          field: 'zoneWindows',
          index,
          context: `${window.entry} -> ${window.exit}`
        });
      } else if (diff > ZONE_RANGE_WARNING_DAYS * DAY_MS) {
        addIssue(issues, {
          severity: 'medium',
          type: 'Long zone range',
          message: `${label} is longer than ${ZONE_RANGE_WARNING_DAYS} days.`,
          field: 'zoneWindows',
          index,
          context: fmtDays(diff)
        });
      }
    });
    return;
  }

  validateLegacyZonePair(voyage, issues, 'zoneEntry', 'zoneExit', 'Zone entry/exit');
  validateLegacyZonePair(voyage, issues, 'zoneEntryReturn', 'zoneExitReturn', 'Return entry/exit');
}

function validateVoyageDraft(voyage) {
  const issues = [];

  if (!String(voyage.vesselName || '').trim()) {
    addIssue(issues, {
      severity: 'high',
      type: 'Missing vessel',
      message: 'Vessel name is required.',
      field: 'vesselName'
    });
  }

  if (!String(voyage.zone || '').trim()) {
    addIssue(issues, {
      severity: 'high',
      type: 'Missing risk zone',
      message: 'Risk zone is required.',
      field: 'zone'
    });
  }

  validatePortCalls(voyage, issues);
  validateZoneWindows(voyage, issues);

  return {
    ok: !issues.some(issue => issue.severity === 'high'),
    issues
  };
}

module.exports = {
  validateVoyageDraft,
  PORT_STAY_WARNING_DAYS,
  ZONE_RANGE_WARNING_DAYS
};
