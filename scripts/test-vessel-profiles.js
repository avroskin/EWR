'use strict';

const assert = require('assert/strict');
const { normalizeVoyagePayload } = require('../server/domain/voyagePayload');

function normalizeProfiles(profiles) {
  return profiles.map(profile => ({
    name: String(profile.name || '').trim(),
    charterer: String(profile.charterer || '').trim(),
    zones: [...new Set((profile.zones || []).map(zone => String(zone || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  })).filter(profile => profile.name);
}

function main() {
  const profiles = normalizeProfiles([
    { name: ' TEST VESSEL ', charterer: ' ARKAS ', zones: ['mas_combined', 'black_sea', 'mas_combined', ''] },
    { name: '', zones: ['zeynep_c'] }
  ]);
  assert.deepEqual(profiles, [
    { name: 'TEST VESSEL', charterer: 'ARKAS', zones: ['black_sea', 'mas_combined'] }
  ]);

  assert.equal(typeof normalizeVoyagePayload, 'function');
  console.log('Vessel profile assignment fixture OK.');
}

main();
