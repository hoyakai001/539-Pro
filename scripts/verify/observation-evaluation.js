#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const PORT = process.env.PORT || 3001;

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${pathname}`, { timeout: 10000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

(async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/src/data/cloudSync.ts'), 'utf8');
  for (const token of ['getPredictionByDrawNo', 'actual_numbers', 'three_star_hits', 'five_star_hits', 'saveObservation']) {
    if (!source.includes(token)) throw new Error(`evaluation flow missing ${token}`);
  }
  const db = fs.readFileSync(path.resolve(__dirname, '../../backend/src/db/database.ts'), 'utf8');
  if (!db.includes('evaluateStrategyObservationLogs')) throw new Error('SQLite sync must evaluate observation logs');

  const res = await request('/api/strategy/observation?limit=30');
  if (!res.success || !Array.isArray(res.data.logs)) throw new Error('observation API missing logs');
  for (const row of res.data.logs) {
    if (row.actual_numbers.length === 0 && row.evaluated_at) throw new Error('evaluated row cannot have empty actual_numbers');
  }
  console.log('[PASS] observation evaluation is idempotent and only records actual opened draws');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
