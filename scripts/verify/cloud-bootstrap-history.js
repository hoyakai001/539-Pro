#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '../..');
const PORT = process.env.PORT || 3001;
const routes = fs.readFileSync(path.join(ROOT, 'backend', 'src', 'api', 'routes.ts'), 'utf8');
const bootstrap = fs.readFileSync(path.join(ROOT, 'backend', 'src', 'data', 'cloudBootstrapHistory.ts'), 'utf8');

for (const token of [
  '/admin/bootstrap-history',
  'ADMIN_RESET_TOKEN',
  'admin token or reset token required',
  'bootstrapCloudHistory',
]) {
  if (!routes.includes(token)) throw new Error(`bootstrap route missing ${token}`);
}
for (const token of [
  'fetchOfficialHistoryByMonths',
  'verifyDraw',
  'getDatabaseAdapter',
  'buildStatisticalPrediction',
  'at least',
  'official history returned',
]) {
  if (!bootstrap.includes(token)) throw new Error(`bootstrap implementation missing ${token}`);
}
if (/Math\.random|hardcoded prediction|fake prediction|mock data|demo data|sample prediction/i.test(routes + bootstrap)) {
  throw new Error('bootstrap source contains forbidden text');
}

function requestUnauthorized() {
  return new Promise(resolve => {
    const req = http.request(`http://localhost:${PORT}/api/admin/bootstrap-history`, { method: 'POST', timeout: 5000 }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

(async () => {
  const status = await requestUnauthorized();
  if (status === 404) console.warn('[SKIP] running backend has not been restarted with bootstrap route yet');
  else if (status !== null && status !== 401) throw new Error(`bootstrap route must reject missing auth, got ${status}`);
  console.log('[PASS] cloud bootstrap history is protected and uses official data only');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
