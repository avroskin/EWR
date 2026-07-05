'use strict';

const path = require('path');
const { createBackupService, formatLocalDate } = require('./backupEngine');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOCAL_BACKUP_DIR = process.env.EWR_LOCAL_BACKUP_DIR || path.join(DATA_DIR, 'backups');
const NETWORK_BACKUP_DIR = process.env.EWR_NETWORK_BACKUP_DIR || "\\\\10.70.48.9\\Emes File Share1\\Genel Datalar\\DTFilo\\Backup\\02- OPERASYON SATINALMA VE TEDARİK\\999-DTFOPSDB\\EWRDB";
const BACKUP_KEEP_DAYS = parseInt(process.env.EWR_BACKUP_KEEP_DAYS || '30', 10);
const ALLOWED_DATA_FILE_RE = /^(?:voyages_\d{4}|archive_\d{4}|config)\.json$/i;

const backupService = createBackupService({
  appName: 'EWR',
  backupVersion: 1,
  dataDir: DATA_DIR,
  localBackupDir: LOCAL_BACKUP_DIR,
  networkBackupDir: NETWORK_BACKUP_DIR,
  keepDays: BACKUP_KEEP_DAYS,
  allowedDataFileRe: ALLOWED_DATA_FILE_RE,
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
