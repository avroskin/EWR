'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const sqliteStore = require('./storage/sqliteStore');
const { createBackupService, formatLocalDate, hashFile } = require('./backupEngine');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOCAL_BACKUP_DIR = process.env.EWR_LOCAL_BACKUP_DIR || path.join(DATA_DIR, 'backups');
const DEFAULT_WINDOWS_NETWORK_DIR = "\\\\10.70.48.9\\Emes File Share1\\Genel Datalar\\DTFilo\\Backup\\02- OPERASYON SATINALMA VE TEDARİK\\999-DTFOPSDB\\EWRDB";
const NETWORK_BACKUP_DIR = process.env.EWR_NETWORK_BACKUP_DIR || (process.platform === 'win32' ? DEFAULT_WINDOWS_NETWORK_DIR : '');
const BACKUP_KEEP_DAYS = parseInt(process.env.EWR_BACKUP_KEEP_DAYS || '30', 10);
const ALLOWED_DATA_FILE_RE = /^ewr\.sqlite$/i;

async function prepareSqliteSnapshot() {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ewr-backup-'));
  const snapshotPath = path.join(tempDir, 'ewr.sqlite');
  try {
    await sqliteStore.createSnapshot(snapshotPath);
    const stat = await fs.promises.stat(snapshotPath);
    return {
      files: [{
        name: 'ewr.sqlite', fullPath: snapshotPath,
        archivePath: 'data/ewr.sqlite', size: stat.size,
        sha256: hashFile(snapshotPath)
      }],
      cleanup: () => fs.promises.rm(tempDir, { recursive: true, force: true })
    };
  } catch (err) {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    throw err;
  }
}

const backupService = createBackupService({
  appName: 'EWR',
  backupVersion: 2,
  dataDir: DATA_DIR,
  localBackupDir: LOCAL_BACKUP_DIR,
  networkBackupDir: NETWORK_BACKUP_DIR,
  keepDays: BACKUP_KEEP_DAYS,
  allowedDataFileRe: ALLOWED_DATA_FILE_RE,
  prepareBackupFiles: prepareSqliteSnapshot,
  backupFilePrefix: 'ewr-data-backup',
  logFileName: 'backup-log.jsonl'
});

async function createDataBackup(options = {}) {
  return backupService.createBackup(options);
}

async function createDailyDataBackup() {
  return backupService.createDailyBackup();
}

module.exports = {
  DATA_DIR,
  LOCAL_BACKUP_DIR,
  NETWORK_BACKUP_DIR,
  BACKUP_KEEP_DAYS,
  collectAllowedDataFiles: backupService.collectAllowedDataFiles,
  createDataBackup,
  createDailyDataBackup,
  formatLocalDate
};
