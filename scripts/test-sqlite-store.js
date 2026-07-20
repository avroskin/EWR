'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqliteStore = require('../server/storage/sqliteStore');

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ewr-store-test-'));
  const dbPath = path.join(tempDir, 'test.sqlite');
  const snapshotPath = path.join(tempDir, 'snapshot.sqlite');

  try {
    sqliteStore.closeDatabase();
    sqliteStore.openDatabase({ dbPath });
    const active = [{ id: 'active-1', year: 2026, vesselName: 'ACTIVE', status: 'active' }];
    const archived = [{ id: 'archive-1', year: 2026, vesselName: 'ARCHIVED', status: 'active', archivedAt: '2026-07-20T00:00:00.000Z' }];

    sqliteStore.replaceYearAndArchive(2026, active, archived);
    assert.deepEqual(sqliteStore.readVoyages(2026).map(item => item.id), ['active-1']);
    assert.deepEqual(sqliteStore.readArchive(2026).map(item => item.id), ['archive-1']);
    assert.deepEqual(new Set(sqliteStore.readYearRecords(2026).map(item => item.id)), new Set(['active-1', 'archive-1']));

    await sqliteStore.createSnapshot(snapshotPath);
    assert.equal(fs.existsSync(snapshotPath), true);
    assert.equal(sqliteStore.integrityCheck(), 'ok');
  } finally {
    sqliteStore.closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('SQLite store fixtures OK: atomic archive replacement, unified reads, and validated snapshots.');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
