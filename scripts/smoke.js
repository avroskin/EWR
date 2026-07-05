'use strict';

const { spawn } = require('child_process');

const PORT = process.env.SMOKE_PORT || '3302';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SMOKE_ADMIN_PASSWORD = process.env.EWR_SMOKE_ADMIN_PASSWORD || '1881';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

async function postJSON(path, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

async function postStatus(path, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return res.status;
}

async function fetchBinary(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return {
    contentType: res.headers.get('content-type') || '',
    bytes: await res.arrayBuffer()
  };
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      await fetchJSON('/api/config');
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('Server did not become ready in time.');
}

async function main() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT, HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });

  try {
    await waitForServer();
    const config = await fetchJSON('/api/config');
    const voyages = await fetchJSON('/api/voyages?year=2026&status=active');
    const audit = await fetchJSON('/api/audit?year=2026');
    const imsCalc = await postJSON('/api/calculate', {
      zone: 'gulf_of_aden',
      portCalls: [
        { port: 'Jeddah', role: 'jeddah_departure', ets: '2026-01-10T06:00:00.000Z' },
        { port: 'Jeddah', role: 'jeddah_arrival', eta: '2026-01-24T22:00:00.000Z' }
      ]
    });
    const missingAnchorCalc = await postJSON('/api/calculate', {
      zone: 'gulf_of_aden',
      portCalls: [
        { port: 'Jeddah', role: 'jeddah_departure', ets: null },
        { port: 'Jeddah', role: 'jeddah_arrival', eta: '2026-01-24T22:00:00.000Z' }
      ]
    });
    const exportFile = await fetchBinary('/api/export?year=2026&status=active');
    const unauthWriteStatus = await postStatus('/api/voyages', { year: 2026 });
    const wrongUnlockStatus = await postStatus('/api/admin/unlock', { password: 'wrong-password' });
    const unlock = await postJSON('/api/admin/unlock', { password: SMOKE_ADMIN_PASSWORD });
    const authWriteValidationStatus = await postStatus('/api/voyages', { year: 2026 }, { 'x-admin-token': unlock.token });

    if (!Array.isArray(config.riskZones) || config.riskZones.length === 0) {
      throw new Error('Config has no risk zones.');
    }
    if (!Array.isArray(voyages.voyages)) {
      throw new Error('Voyages response is malformed.');
    }
    if (!audit.summary || typeof audit.summary.totalWarnings !== 'number') {
      throw new Error('Audit response is malformed.');
    }
    if (imsCalc.zoneEntry !== '2026-01-10T20:00:00.000Z' || imsCalc.zoneEntryReturn !== '2026-01-22T08:00:00.000Z') {
      throw new Error('IMS calculation response is malformed.');
    }
    if (!missingAnchorCalc.statuses || missingAnchorCalc.statuses.main !== 'missing_anchor') {
      throw new Error('Missing anchor calculation status is malformed.');
    }
    if (!exportFile.contentType.includes('spreadsheetml') || exportFile.bytes.byteLength < 1000) {
      throw new Error('Export response is malformed.');
    }
    if (unauthWriteStatus !== 401) {
      throw new Error(`Unauthenticated write returned ${unauthWriteStatus}, expected 401.`);
    }
    if (wrongUnlockStatus !== 401) {
      throw new Error(`Wrong admin password returned ${wrongUnlockStatus}, expected 401.`);
    }
    if (!unlock.token || unlock.token.length < 40) {
      throw new Error('Admin unlock did not return a usable token.');
    }
    if (authWriteValidationStatus !== 400) {
      throw new Error(`Authenticated invalid write returned ${authWriteValidationStatus}, expected validation 400.`);
    }

    console.log(`Smoke OK: ${voyages.voyages.length} active voyages, ${config.riskZones.length} risk zones, ${audit.summary.totalWarnings} audit warnings.`);
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  }

  if (output.includes('EADDRINUSE')) throw new Error(`Port ${PORT} is already in use.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
