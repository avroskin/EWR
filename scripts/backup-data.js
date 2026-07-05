'use strict';

const { createDataBackup, NETWORK_BACKUP_DIR } = require('../server/backupService');

async function main() {
  const force = process.argv.includes('--force');
  const result = await createDataBackup({ reason: force ? 'manual-force' : 'manual', force });

  console.log('[BACKUP] ' + (result.created ? 'Created' : 'Already existed') + ': ' + result.fileName);
  console.log('[BACKUP] Local: ' + result.localZipPath);
  console.log('[BACKUP] Included files: ' + result.files.join(', '));

  if (result.network && result.network.copied) {
    console.log('[BACKUP] Network: ' + result.network.destination);
  } else if (NETWORK_BACKUP_DIR) {
    const reason = result.network && result.network.error ? result.network.error : 'not copied';
    console.warn('[BACKUP] Network copy did not complete: ' + reason);
  }
}

main().catch(err => {
  console.error('[BACKUP] Failed:', err && err.message ? err.message : err);
  process.exitCode = 1;
});
