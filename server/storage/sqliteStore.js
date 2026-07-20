'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync, backup } = require('node:sqlite');

const DEFAULT_DB_NAME = 'ewr.sqlite';

let db = null;
let dbPath = null;

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stringifyPayload(value) {
  return JSON.stringify(value || {});
}

function parsePayload(row, fallback) {
  if (!row || !row.payload_json) return jsonClone(fallback);
  return JSON.parse(row.payload_json);
}

function scalar(value) {
  return value === undefined || value === null ? '' : String(value);
}

function voyageParams(voyage, year) {
  return {
    id: scalar(voyage.id),
    year: Number(voyage.year || year),
    vessel_name: scalar(voyage.vesselName),
    charterer: scalar(voyage.charterer),
    service: scalar(voyage.service),
    zone: scalar(voyage.zone),
    status: scalar(voyage.status),
    updated_at: scalar(voyage.updatedAt || voyage.createdAt || new Date().toISOString()),
    archived_at: scalar(voyage.archivedAt),
    payload_json: stringifyPayload({ ...voyage, year: Number(voyage.year || year) })
  };
}

function openDatabase(options = {}) {
  if (db) return db;
  const dataDir = options.dataDir || path.join(__dirname, '..', '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  dbPath = options.dbPath || path.join(dataDir, DEFAULT_DB_NAME);
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = DELETE');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  ensureSchema();
  return db;
}

function getDatabase() {
  return openDatabase();
}

function closeDatabase() {
  if (db) db.close();
  db = null;
}

function ensureSchema() {
  const database = db;
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS voyages (
      id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      vessel_name TEXT NOT NULL DEFAULT '',
      charterer TEXT NOT NULL DEFAULT '',
      service TEXT NOT NULL DEFAULT '',
      zone TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS archives (
      id TEXT NOT NULL,
      year INTEGER NOT NULL,
      vessel_name TEXT NOT NULL DEFAULT '',
      charterer TEXT NOT NULL DEFAULT '',
      service TEXT NOT NULL DEFAULT '',
      zone TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      archived_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      PRIMARY KEY (id, year)
    );

    CREATE INDEX IF NOT EXISTS idx_voyages_year ON voyages(year);
    CREATE INDEX IF NOT EXISTS idx_voyages_lookup ON voyages(year, status, zone, service, vessel_name);
    CREATE INDEX IF NOT EXISTS idx_archives_year ON archives(year);
  `);
  database.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('schema_version', '1');
}

function readConfig(fallback = {}) {
  const row = getDatabase().prepare('SELECT payload_json FROM config WHERE id = 1').get();
  return parsePayload(row, fallback || {});
}

function writeConfig(config) {
  getDatabase().prepare(`
    INSERT INTO config (id, payload_json, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at
  `).run(stringifyPayload(config), new Date().toISOString());
}

function readVoyages(year) {
  return getDatabase().prepare('SELECT payload_json FROM voyages WHERE year = ? ORDER BY rowid').all(Number(year))
    .map(row => JSON.parse(row.payload_json));
}

function writeVoyages(year, voyages) {
  const database = getDatabase();
  const items = voyages || [];
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM voyages WHERE year = ?').run(Number(year));
    const insert = database.prepare(`
      INSERT INTO voyages (id, year, vessel_name, charterer, service, zone, status, updated_at, payload_json)
      VALUES (@id, @year, @vessel_name, @charterer, @service, @zone, @status, @updated_at, @payload_json)
    `);
    for (const voyage of items) {
      const params = voyageParams(voyage, year);
      insert.run({
        id: params.id,
        year: params.year,
        vessel_name: params.vessel_name,
        charterer: params.charterer,
        service: params.service,
        zone: params.zone,
        status: params.status,
        updated_at: params.updated_at,
        payload_json: params.payload_json
      });
    }
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}
function hasVoyages(year) {
  const row = getDatabase().prepare('SELECT COUNT(*) AS count FROM voyages WHERE year = ?').get(Number(year));
  return Number(row.count) > 0;
}

function readArchive(year) {
  return getDatabase().prepare('SELECT payload_json FROM archives WHERE year = ? ORDER BY rowid').all(Number(year))
    .map(row => JSON.parse(row.payload_json));
}

function readYearRecords(year) {
  const archived = readArchive(year);
  const active = readVoyages(year);
  const activeIds = new Set(active.map(voyage => voyage.id));
  return [...archived.filter(voyage => !activeIds.has(voyage.id)), ...active];
}

function writeArchive(year, voyages) {
  const database = getDatabase();
  const items = voyages || [];
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM archives WHERE year = ?').run(Number(year));
    const insert = database.prepare(`
      INSERT INTO archives (id, year, vessel_name, charterer, service, zone, status, archived_at, updated_at, payload_json)
      VALUES (@id, @year, @vessel_name, @charterer, @service, @zone, @status, @archived_at, @updated_at, @payload_json)
    `);
    for (const voyage of items) {
      const params = voyageParams(voyage, year);
      insert.run({
        id: params.id,
        year: params.year,
        vessel_name: params.vessel_name,
        charterer: params.charterer,
        service: params.service,
        zone: params.zone,
        status: params.status,
        updated_at: params.updated_at,
        payload_json: params.payload_json
      });
    }
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}
function hasArchive(year) {
  const row = getDatabase().prepare('SELECT COUNT(*) AS count FROM archives WHERE year = ?').get(Number(year));
  return Number(row.count) > 0;
}

function replaceYearAndArchive(year, activeVoyages, archivedVoyages) {
  const database = getDatabase();
  const numericYear = Number(year);
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM voyages WHERE year = ?').run(numericYear);
    database.prepare('DELETE FROM archives WHERE year = ?').run(numericYear);
    const activeInsert = database.prepare(`
      INSERT INTO voyages (id, year, vessel_name, charterer, service, zone, status, updated_at, payload_json)
      VALUES (@id, @year, @vessel_name, @charterer, @service, @zone, @status, @updated_at, @payload_json)
    `);
    const archiveInsert = database.prepare(`
      INSERT INTO archives (id, year, vessel_name, charterer, service, zone, status, archived_at, updated_at, payload_json)
      VALUES (@id, @year, @vessel_name, @charterer, @service, @zone, @status, @archived_at, @updated_at, @payload_json)
    `);

    for (const voyage of activeVoyages || []) {
      const params = voyageParams(voyage, numericYear);
      activeInsert.run({
        id: params.id, year: params.year, vessel_name: params.vessel_name,
        charterer: params.charterer, service: params.service, zone: params.zone,
        status: params.status, updated_at: params.updated_at, payload_json: params.payload_json
      });
    }
    for (const voyage of archivedVoyages || []) {
      const params = voyageParams(voyage, numericYear);
      archiveInsert.run({
        id: params.id, year: params.year, vessel_name: params.vessel_name,
        charterer: params.charterer, service: params.service, zone: params.zone,
        status: params.status, archived_at: params.archived_at,
        updated_at: params.updated_at, payload_json: params.payload_json
      });
    }
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

function isArchived(year) {
  return hasArchive(year) && !hasVoyages(year);
}

function listArchiveYears() {
  return getDatabase().prepare('SELECT year, COUNT(*) AS count FROM archives GROUP BY year ORDER BY year DESC').all();
}

function writeMeta(key, value) {
  getDatabase().prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(key), String(value));
}

function readMeta(key) {
  const row = getDatabase().prepare('SELECT value FROM meta WHERE key = ?').get(String(key));
  return row ? row.value : null;
}

function integrityCheck() {
  return getDatabase().prepare('PRAGMA integrity_check').get().integrity_check;
}

function getDbPath() {
  openDatabase();
  return dbPath;
}

async function createSnapshot(destinationPath) {
  const source = getDatabase();
  await backup(source, destinationPath);
  const snapshot = new DatabaseSync(destinationPath, { readOnly: true });
  try {
    const result = snapshot.prepare('PRAGMA integrity_check').get().integrity_check;
    if (result !== 'ok') throw new Error(`SQLite snapshot integrity check failed: ${result}`);
  } finally {
    snapshot.close();
  }
  return destinationPath;
}

module.exports = {
  DEFAULT_DB_NAME,
  openDatabase,
  closeDatabase,
  getDatabase,
  getDbPath,
  readConfig,
  writeConfig,
  readVoyages,
  writeVoyages,
  hasVoyages,
  readArchive,
  readYearRecords,
  writeArchive,
  replaceYearAndArchive,
  hasArchive,
  isArchived,
  listArchiveYears,
  writeMeta,
  readMeta,
  integrityCheck,
  createSnapshot
};
