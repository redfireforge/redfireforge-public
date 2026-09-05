/**
 * Build a RedfireForge CSV template from a JSON dump of query rows.
 *
 * Usage (from the directory that contains `_raw_<ENV>.json`):
 *   ENV=test COUNT=100 node scripts/generate-csv-from-db.cjs
 *   ENV=prod COUNT=50  node scripts/generate-csv-from-db.cjs
 *   ENV=test COUNT=100 URL_PATTERN="https://order-api.example.com/v1/vehicles/{{vin}}" node scripts/generate-csv-from-db.cjs
 *
 * Each raw element needs a VIN and a JSON payload string:
 *   { vin | vin_nbr, payload, createdAt? | created_timstm? }
 *
 * Output: sample_<ENV>_<COUNT>.csv
 */
const fs = require('fs');
const path = require('path');

const ENV = process.env.ENV || 'test';
const COUNT = parseInt(process.env.COUNT || '100', 10);
const PROJECT = process.cwd();

const URL_PATTERNS = {
  test: 'https://order-api.example.com/v1/vehicles/{{vin}}',
  prod: 'https://order-api.example.com/v1/vehicles/{{vin}}',
};

const urlPattern = process.env.URL_PATTERN || URL_PATTERNS[ENV];
if (!urlPattern) {
  console.error(`No URL pattern for ENV=${ENV}. Set URL_PATTERN=https://host/path/{{vin}}`);
  process.exit(1);
}

const rawPath = path.resolve(PROJECT, `_raw_${ENV}.json`);
if (!fs.existsSync(rawPath)) {
  console.error(`Missing input: ${rawPath}`);
  console.error('Query the database via MCP and save results to this file first.');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
console.log(`Total raw rows from ${ENV}: ${raw.length}`);

function offerCode(offer) {
  return offer.code || offer.offerCode || '';
}

function offerName(offer) {
  return offer.name || offer.offerName || '';
}

const rows = [];
const seenVins = new Set();

for (const r of raw) {
  const vin = r.vin || r.vin_nbr;
  if (!vin || seenVins.has(vin)) continue;
  try {
    const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload || {});
    const offers = Array.isArray(p.offers) ? p.offers : [];
    if (offers.length === 0) continue;
    if (!offers.some((o) => offerCode(o) || offerName(o))) continue;
    seenVins.add(vin);
    rows.push({
      vin,
      country: p.country || '',
      channel: p.channel || '',
      offers,
      ts: r.createdAt || r.created_timstm || '',
    });
  } catch { /* skip bad JSON */ }
}

console.log(`Unique VINs with non-empty offers: ${rows.length}`);

const buckets = {};
for (const r of rows) {
  const key = r.country || 'unknown';
  if (!buckets[key]) buckets[key] = [];
  buckets[key].push(r);
}

console.log('\nBuckets:');
for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${k}: ${v.length}`);
}

const COUNTRY_QUOTAS = [
  { key: 'US', max: 40 },
  { key: 'CA', max: 25 },
  { key: 'MX', max: 15 },
];

const selected = [];
const usedVins = new Set();

for (const { key, max } of COUNTRY_QUOTAS) {
  const pool = buckets[key] || [];
  let count = 0;
  for (const r of pool) {
    if (selected.length >= COUNT) break;
    if (count >= max) break;
    usedVins.add(r.vin);
    selected.push(r);
    count++;
  }
}

if (selected.length < COUNT) {
  for (const r of rows) {
    if (selected.length >= COUNT) break;
    if (usedVins.has(r.vin)) continue;
    usedVins.add(r.vin);
    selected.push(r);
  }
}

console.log(`\nSelected: ${selected.length}`);

let maxOffers = 0;
for (const r of selected) {
  if (r.offers.length > maxOffers) maxOffers = r.offers.length;
}
console.log(`Max offers per row: ${maxOffers}`);

const baseHeader = ['name', 'path:vin', 'param:channel', 'param:country'];
const validateHeader = [];
for (let i = 0; i < maxOffers; i++) {
  validateHeader.push(`validate:$.offers[${i}].code`);
  validateHeader.push(`validate:$.offers[${i}].name`);
}
const header = [...baseHeader, ...validateHeader];

function esc(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

const meta = {
  version: 1,
  method: 'GET',
  urlPattern,
  headers: [
    { key: 'Accept-Language', value: 'en-US' },
    { key: 'Content-Type', value: 'application/json' },
  ],
  body: '',
  auth: { type: 'inherit' },
  validationMode: 'selective',
  unorderedArrays: true,
  pathVariables: ['vin'],
};

const csvLines = ['#META:' + JSON.stringify(meta), header.map(esc).join(',')];

for (const r of selected) {
  const nameLabel = [r.country, r.channel, r.vin].filter(Boolean).join('-');
  const vals = [nameLabel, r.vin, r.channel, r.country];
  for (let i = 0; i < maxOffers; i++) {
    vals.push(offerCode(r.offers[i]) || '');
    vals.push(offerName(r.offers[i]) || '');
  }
  csvLines.push(vals.map(esc).join(','));
}

const outFile = path.resolve(PROJECT, `sample_${ENV}_${COUNT}.csv`);
fs.writeFileSync(outFile, csvLines.join('\n') + '\n', 'utf8');

const stats = {};
for (const r of selected) {
  const key = r.country || 'unknown';
  stats[key] = (stats[key] || 0) + 1;
}

console.log(`\nWrote ${selected.length} rows to ${outFile}`);
console.log('Distribution:', JSON.stringify(stats, null, 2));
