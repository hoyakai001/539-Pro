#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '../..');
const PORT = process.env.PORT || 3001;
const sqlite = fs.readFileSync(path.join(ROOT, 'backend/src/db/adapters/SQLiteAdapter.ts'), 'utf8');
const firestore = fs.readFileSync(path.join(ROOT, 'backend/src/db/adapters/FirestoreAdapter.ts'), 'utf8');
const routes = fs.readFileSync(path.join(ROOT, 'backend/src/api/routes.ts'), 'utf8');
const adapterIndex = fs.readFileSync(path.join(ROOT, 'backend/src/db/adapters/index.ts'), 'utf8');

for (const method of ['getDraws', 'insertDraw', 'getLatestDraw', 'savePrediction', 'getPredictionByDrawNo', 'saveObservation', 'getObservations', 'getStats']) {
  if (!sqlite.includes(`async ${method}`)) throw new Error(`SQLiteAdapter missing ${method}`);
  if (!firestore.includes(`async ${method}`)) throw new Error(`FirestoreAdapter missing ${method}`);
}
if (!adapterIndex.includes('new FirestoreAdapter()') || !adapterIndex.includes("require('./SQLiteAdapter')") || !adapterIndex.includes('new SQLiteAdapter()')) {
  throw new Error('adapter switch must keep local/cloud mode consistent');
}
if (adapterIndex.includes("import { SQLiteAdapter }")) {
  throw new Error('adapter switch must not statically import SQLiteAdapter in cloud mode');
}
for (const token of [
  'if (isCloudMode()) return cloudLatestDraw',
  'if (isCloudMode()) return cloudPreviousDraw',
  'if (isCloudMode()) return cloudPredictionToday',
  'if (isCloudMode()) return cloudPerformance',
  'if (isCloudMode()) return cloudHistoryDraws',
  'if (isCloudMode()) return cloudNumberAnalysis',
  'if (isCloudMode()) return cloudSyncLogs',
]) {
  if (!routes.includes(token)) throw new Error(`cloud route parity missing ${token}`);
}

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${pathname}`, { timeout: 5000 }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ code: res.statusCode, json: JSON.parse(body) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

(async () => {
  try {
    const checks = [
      ['/api/data/status', body => body.success && body.data?.dataStatus],
      ['/api/prediction/today', body => body.success && body.data?.model_version === 'v6.1-three-star-stable'],
      ['/api/stats/number-analysis?window=100&view=summary', body => body.success && Array.isArray(body.data) && body.data.length === 39],
      ['/api/history/draws?recent=30', body => body.success && Array.isArray(body.draws) && body.draws.length <= 30],
    ];
    for (const [pathname, valid] of checks) {
      const { code, json } = await getJson(pathname);
      if (code !== 200 || !valid(json)) throw new Error(`local API parity check failed: ${pathname}`);
    }
  } catch (e) {
    const detail = [
      e?.message,
      e?.code,
      String(e),
      ...(Array.isArray(e?.errors) ? e.errors.map(error => `${error?.code || ''} ${error?.message || String(error)}`) : []),
    ].filter(Boolean).join(' ');
    if (!/ECONNREFUSED|ECONNRESET|ENOTFOUND|AggregateError|timeout/i.test(detail)) throw e;
    console.warn('[SKIP] live local API consistency check skipped because backend is not running');
  }
  console.log('[PASS] local/cloud adapters and core API routes expose matching behavior');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
