'use strict';

const ExcelJS = require('exceljs');
const { buildTimelineEvents } = require('./domain/timelineEvents');

const COLORS = {
  header: 'FF9DC3E6',
  border: 'FFD9E2EC',
  zone: 'FFEAF2F8',
  omit: 'FFFDE2E2',
  actual: 'FFE2F0D9',
  warning: 'FFFFF2CC',
  warningText: 'FF9A3412',
  spacer: 'FFF7F7F7'
};

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function parseTime(iso) {
  if (!iso) return Infinity;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? Infinity : d.getTime();
}

function getZoneLabel(voyage, config) {
  const zone = (config.riskZones || []).find(item => item.key === voyage.zone);
  if (voyage.zone === 'zeynep_c') return voyage.zeynepZoneName || zone?.label || 'Zeynep C';
  return zone?.label || voyage.zone || '';
}

function getAreaShortName(voyage, config) {
  const label = getZoneLabel(voyage, config);
  if (voyage.zone === 'mas_combined') return 'MAS';
  if (voyage.zone === 'gulf_of_aden') return 'IMS / HRA';
  if (voyage.zone === 'black_sea') return 'Black Sea';
  if (voyage.zone === 'north_africa') return 'LTS';
  if (voyage.zone === 'zeynep_c') return 'Zeynep C';
  return label;
}

function getPortCalls(voyage) {
  return Array.isArray(voyage.portCalls) ? voyage.portCalls : [];
}

function warningText(warnings) {
  return (warnings || []).map(warning => {
    const context = warning.context ? ' | ' + warning.context : '';
    return (warning.type || 'Check') + ': ' + (warning.message || '') + context;
  }).join('\n');
}

function importFlagText(voyage) {
  return (voyage.importFlags || []).map(flag => {
    const context = flag.context ? ' | ' + flag.context : '';
    return (flag.type || 'Import check') + ': ' + (flag.message || '') + context;
  }).join('\n');
}

function formatPortTime(iso, confirmed, estimatedLabel, actualLabel, omitted) {
  if (!iso) return '';
  const prefix = omitted ? 'OMIT - ' : '';
  return prefix + (confirmed ? actualLabel : estimatedLabel) + ' ' + fmtDate(iso);
}

function setFill(cell, argb) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function addExportEvent(events, event) {
  events.push(event);
}

function addZonePointRows(events, event, order) {
  if (event.entry) {
    addExportEvent(events, {
      kind: 'zone',
      order,
      name: event.title + ' Entry',
      entry: (event.entryConfirmed ? 'Actual Entry ' : 'Entry ') + fmtDate(event.entry),
      exit: '',
      sortTime: parseTime(event.entry),
      actual: !!event.entryConfirmed,
      actualEntry: !!event.entryConfirmed,
      actualExit: false,
      omitted: false
    });
  }
  if (event.exit) {
    addExportEvent(events, {
      kind: 'zone',
      order: order + 1,
      name: event.title + ' Exit',
      entry: '',
      exit: (event.exitConfirmed ? 'Actual Exit ' : 'Exit ') + fmtDate(event.exit),
      sortTime: parseTime(event.exit),
      actual: !!event.exitConfirmed,
      actualEntry: false,
      actualExit: !!event.exitConfirmed,
      omitted: false
    });
  }
}

function buildVoyageEvents(voyage, config) {
  const events = [];
  buildTimelineEvents(voyage, config).forEach((event, index) => {
    if (event.kind === 'zone_window') {
      addZonePointRows(events, event, 10 + index * 10);
      return;
    }
    if (event.kind === 'manual_needed') {
      addExportEvent(events, {
        kind: 'zone',
        order: 10 + index * 10,
        name: event.title,
        entry: 'Manual needed',
        exit: 'Manual needed',
        sortTime: event.sortTime || Infinity,
        actual: false,
        actualEntry: false,
        actualExit: false,
        omitted: false
      });
      return;
    }
    if (event.kind === 'port_call') {
      addExportEvent(events, {
        kind: 'port',
        order: 50 + index,
        name: (event.port || '') + (event.omitted ? ' OMIT' : ''),
        entry: formatPortTime(event.eta, event.etaConfirmed, 'ETA', 'ATA', event.omitted),
        exit: formatPortTime(event.ets, event.etsConfirmed, 'ETS', 'ATS', event.omitted),
        sortTime: Math.min(parseTime(event.eta), parseTime(event.ets)),
        actualEntry: !!event.etaConfirmed,
        actualExit: !!event.etsConfirmed,
        omitted: !!event.omitted
      });
    }
  });

  return events.sort((a, b) => {
    if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
    return a.order - b.order;
  });
}

function styleWorksheet(sheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const lastFilterCell = sheet.getRow(Math.max(sheet.rowCount, 1)).getCell(sheet.columnCount).address;
  sheet.autoFilter = { from: 'A1', to: lastFilterCell };
  sheet.eachRow((row, rowNumber) => {
    row.eachCell(cell => {
      cell.border = {
        top: { style: 'thin', color: { argb: COLORS.border } },
        left: { style: 'thin', color: { argb: COLORS.border } },
        bottom: { style: 'thin', color: { argb: COLORS.border } },
        right: { style: 'thin', color: { argb: COLORS.border } }
      };
      cell.alignment = { vertical: 'top', wrapText: true };
      if (rowNumber === 1) {
        cell.font = { bold: true, color: { argb: 'FF000000' }, size: 11 };
        setFill(cell, COLORS.header);
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      }
    });
  });
}

function addInsuranceSheet(workbook, voyages, config, warningsById) {
  const showNotesOrWarnings = voyages.some(voyage => {
    const warnings = warningsById.get(voyage.id) || [];
    return String(voyage.notes || '').trim() || warnings.length || (voyage.importFlags || []).length;
  });

  const sheet = workbook.addWorksheet('Insurance Export');
  sheet.columns = [
    { header: 'Vessel Name', key: 'vesselName', width: 24 },
    { header: 'Charter', key: 'charterer', width: 22 },
    { header: 'HRA / K&R AREA', key: 'area', width: 24 },
    { header: 'Port Name / Risk Zone', key: 'routeItem', width: 34 },
    { header: 'Entry Time / ETA / ATA', key: 'entryTime', width: 25 },
    { header: 'Exit Time / ETS / ATS', key: 'exitTime', width: 25 }
  ];
  if (showNotesOrWarnings) sheet.columns = [...sheet.columns, { header: 'Notes / Check', key: 'notesCheck', width: 50 }];

  voyages.forEach((voyage, voyageIndex) => {
    const events = buildVoyageEvents(voyage, config);
    const warnings = warningsById.get(voyage.id) || [];
    const notesCheck = [voyage.notes || '', warningText(warnings), importFlagText(voyage)].filter(Boolean).join('\n');

    if (!events.length) {
      events.push({ kind: 'empty', name: '', entry: '', exit: '', sortTime: Infinity });
    }

    events.forEach((event, index) => {
      const rowData = {
        vesselName: voyage.vesselName || '',
        charterer: voyage.charterer || '',
        area: getAreaShortName(voyage, config),
        routeItem: event.name || '',
        entryTime: event.entry || '',
        exitTime: event.exit || ''
      };
      if (showNotesOrWarnings) rowData.notesCheck = index === 0 ? notesCheck : '';
      const row = sheet.addRow(rowData);

      if (event.kind === 'zone') {
        [4, 5, 6].forEach(col => setFill(row.getCell(col), COLORS.zone));
        if (event.actual) setFill(row.getCell(5), COLORS.actual);
      }
      if (event.omitted) {
        [4, 5, 6].forEach(col => setFill(row.getCell(col), COLORS.omit));
      }
      if (event.actualEntry) setFill(row.getCell(5), COLORS.actual);
      if (event.actualExit) setFill(row.getCell(6), COLORS.actual);
      if (showNotesOrWarnings && index === 0 && notesCheck) {
        const cell = row.getCell('notesCheck');
        setFill(cell, COLORS.warning);
        cell.font = { color: { argb: COLORS.warningText } };
      }
    });

  });

  styleWorksheet(sheet);
}

async function buildInsuranceExportWorkbook({ voyages, config, buildVoyageWarnings }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Arfleet RiskWatch';
  workbook.created = new Date();
  workbook.modified = new Date();

  const warningsById = new Map();
  voyages.forEach(voyage => {
    warningsById.set(voyage.id, typeof buildVoyageWarnings === 'function' ? buildVoyageWarnings(voyage) : []);
  });

  addInsuranceSheet(workbook, voyages, config || {}, warningsById);
  return workbook;
}

module.exports = { buildInsuranceExportWorkbook };
