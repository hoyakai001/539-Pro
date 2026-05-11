#!/usr/bin/env node
'use strict';
const http = require('http');
const PORT = process.env.PORT || 3001;

function request(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${PORT}${path}`, { method, timeout: 12000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const run = await request('/api/history/audit', 'POST');
  if (!run.success || !run.data) throw new Error('history audit endpoint failed');
  if (!['PASS', 'WARN'].includes(run.data.status)) throw new Error(`history audit blocked: ${run.data.status}`);
  const latest = await request('/api/history/audit/latest');
  if (!latest.data || latest.data.checked_count <= 0) throw new Error('latest audit result missing');
  console.log(`[PASS] history audit ${latest.data.status}, checked ${latest.data.checked_count} draws`);
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
