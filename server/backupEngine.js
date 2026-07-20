'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const archiver = require('archiver');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function formatLocalTimestamp(date = new Date()) {
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(value => String(value).padStart(2, '0'))
    .join('-');
  return formatLocalDate(date) + '_' + time + '-' + String(date.getMilliseconds()).padStart(3, '0');
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createBackupService(config) {
  const appName = config.appName || 'APP';
  const backupVersion = config.backupVersion || 1;
  const dataDir = config.dataDir;
  const localBackupDir = config.localBackupDir;
  const networkBackupDir = config.networkBackupDir || '';
  const keepDays = Number.isFinite(config.keepDays) ? config.keepDays : 30;
  const allowedDataFileRe = config.allowedDataFileRe;
  const prepareBackupFiles = config.prepareBackupFiles || null;
  const backupFilePrefix = config.backupFilePrefix || (appName.toLowerCase() + '-data-backup');
  const backupFileRe = config.backupFileRe || new RegExp('^' + escapeRegExp(backupFilePrefix) + '_\\d{4}-\\d{2}-\\d{2}(?:_\\d{2}-\\d{2}-\\d{2}(?:-\\d{3})?)?\\.zip$', 'i');
  const logFile = config.logFile || path.join(localBackupDir, config.logFileName || 'backup-log.jsonl');

  if (!dataDir) throw new Error('Backup dataDir is required.');
  if (!localBackupDir) throw new Error('Backup localBackupDir is required.');
  if (!allowedDataFileRe) throw new Error('Backup allowedDataFileRe is required.');

  function collectAllowedDataFiles() {
    ensureDir(dataDir);
    return fs.readdirSync(dataDir)
      .filter(name => allowedDataFileRe.test(name))
      .map(name => {
        const fullPath = path.join(dataDir, name);
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) return null;
        return {
          name,
          fullPath,
          archivePath: path.posix.join(path.basename(dataDir), name),
          size: stat.size,
          sha256: hashFile(fullPath)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function buildManifest(files, options = {}) {
    return {
      app: appName,
      backupVersion,
      createdAt: new Date().toISOString(),
      backupDate: options.backupDate || formatLocalDate(),
      reason: options.reason || 'daily',
      host: os.hostname(),
      includedFiles: files.map(file => ({
        path: file.archivePath,
        size: file.size,
        sha256: file.sha256
      }))
    };
  }

  function appendLog(entry) {
    try {
      ensureDir(localBackupDir);
      fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
    } catch (err) {
      console.warn('[BACKUP] Could not write backup log:', err && err.message ? err.message : err);
    }
  }

  async function writeZip(zipPath, files, manifest) {
    ensureDir(path.dirname(zipPath));
    const tmpPath = zipPath + '.tmp-' + process.pid + '-' + Date.now();

    try {
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(tmpPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);

        files.forEach(file => archive.file(file.fullPath, { name: file.archivePath }));
        archive.append(JSON.stringify(manifest, null, 2), { name: 'backup-manifest.json' });
        archive.finalize();
      });

      if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
      fs.renameSync(tmpPath, zipPath);
    } catch (err) {
      fs.rmSync(tmpPath, { force: true });
      throw err;
    }
  }

  async function copyBackupToNetworkShare(localZipPath, fileName) {
    if (!networkBackupDir) return { copied: false, skipped: true, destination: '' };

    const dest = path.join(networkBackupDir, fileName);
    const tmpDest = dest + '.tmp-' + process.pid + '-' + Date.now();
    try {
      ensureDir(networkBackupDir);
      await fs.promises.copyFile(localZipPath, tmpDest);
      await fs.promises.rm(dest, { force: true });
      await fs.promises.rename(tmpDest, dest);
      console.log('[BACKUP] Network copy saved: ' + dest);
      return { copied: true, destination: dest };
    } catch (err) {
      await fs.promises.rm(tmpDest, { force: true }).catch(() => {});
      console.warn('[BACKUP] Network copy failed (non-fatal): ' + (err && err.message ? err.message : err));
      return { copied: false, destination: dest, error: err && err.message ? err.message : String(err) };
    }
  }

  async function pruneOldLocalBackups() {
    ensureDir(localBackupDir);
    const cutoff = Date.now() - (keepDays * 24 * 60 * 60 * 1000);
    const removed = [];

    for (const name of fs.readdirSync(localBackupDir)) {
      if (!backupFileRe.test(name)) continue;
      const fullPath = path.join(localBackupDir, name);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) {
        fs.rmSync(fullPath, { force: true });
        removed.push(name);
      }
    }

    if (removed.length) console.log('[BACKUP] Removed old local backups: ' + removed.join(', '));
    return removed;
  }

  async function createBackup(options = {}) {
    const backupDate = options.backupDate || formatLocalDate();
    const backupTimestamp = options.backupTimestamp || formatLocalTimestamp();
    const fileName = backupFilePrefix + '_' + backupTimestamp + '.zip';
    const localZipPath = path.join(localBackupDir, fileName);
    const prepared = prepareBackupFiles ? await prepareBackupFiles() : null;
    const files = prepared ? prepared.files : collectAllowedDataFiles();

    try {
      if (!files.length) throw new Error('No data files found to back up.');

      const manifest = buildManifest(files, { backupDate, reason: options.reason || 'manual' });
      await writeZip(localZipPath, files, manifest);
      const network = await copyBackupToNetworkShare(localZipPath, fileName);
      const pruned = await pruneOldLocalBackups();

      appendLog({
        status: 'created', fileName, localZipPath, network, pruned,
        includedFiles: manifest.includedFiles
      });

      return {
        created: true, fileName, localZipPath,
        files: files.map(file => file.archivePath), network, pruned
      };
    } finally {
      if (prepared && prepared.cleanup) await prepared.cleanup();
    }
  }

  async function createDailyBackup() {
    return createBackup({ reason: 'daily' });
  }

  return {
    appName,
    backupVersion,
    dataDir,
    localBackupDir,
    networkBackupDir,
    keepDays,
    logFile,
    backupFilePrefix,
    collectAllowedDataFiles,
    createBackup,
    createDailyBackup,
    formatLocalDate,
    formatLocalTimestamp
  };
}

module.exports = {
  createBackupService,
  formatLocalDate,
  formatLocalTimestamp,
  hashFile
};
