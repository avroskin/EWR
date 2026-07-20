'use strict';

const sqliteStore = require('./server/storage/sqliteStore');

const years = sqliteStore.getDatabase().prepare(`
  SELECT year FROM voyages UNION SELECT year FROM archives ORDER BY year
`).all().map(row => row.year);
const voyages = years.flatMap(year => sqliteStore.readYearRecords(year));
const existingConfig = sqliteStore.readConfig({});

const vessels = new Set(existingConfig.vessels || []);
const charterers = new Set(existingConfig.charterers || []);
const services = new Set(existingConfig.services || []);

for (const v of voyages) {
  if (v.vesselName) vessels.add(v.vesselName);
  if (v.charterer) charterers.add(v.charterer);
  if (v.service) services.add(v.service);
}

const config = {
  ...existingConfig,
  vessels: Array.from(vessels).sort((a, b) => a.localeCompare(b)),
  charterers: Array.from(charterers).sort((a, b) => a.localeCompare(b)),
  services: Array.from(services).sort((a, b) => a.localeCompare(b))
};

sqliteStore.writeConfig(config);
sqliteStore.closeDatabase();
console.log(`Config names updated from ${voyages.length} SQLite voyage records; risk zone rules preserved.`);
