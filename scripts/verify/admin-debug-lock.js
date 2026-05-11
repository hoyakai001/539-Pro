#!/usr/bin/env node
'use strict';
const http = require('http');
const PORT = process.env.PORT || 3001;

new Promise((resolve, reject) => {
  const req = http.get(`http://localhost:${PORT}/api/sync-logs`, { timeout: 5000 }, res => {
    res.resume();
    resolve(res.statusCode);
  });
  req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  req.on('error', reject);
}).then(code => {
  if (code !== 401) throw new Error(`expected /api/sync-logs to require admin token, got ${code}`);
  console.log('[PASS] debug sync logs require admin token');
}).catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
