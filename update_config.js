'use strict';

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const jsonPath = path.join(dataDir, 'voyages_2026.json');
const configPath = path.join(dataDir, 'config.json');

function readJSON(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJSON(filePath, data) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

const voyages = readJSON(jsonPath, []);
const existingConfig = readJSON(configPath, {});

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

writeJSON(configPath, config);
console.log('Config names updated; risk zone rules preserved.');
