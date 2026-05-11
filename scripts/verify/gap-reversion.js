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
  const res = await request('/api/prediction/today');
  if (!res.success || !res.data) throw new Error('prediction missing');
  for (const row of res.data.number_scores) {
    if (!['正常', '接近回補', '偏冷觀察', '過冷不追'].includes(row.gap_status)) throw new Error(`invalid gap_status for ${row.number}`);
    if (typeof row.gap_reversion_bonus !== 'number' || row.gap_reversion_bonus > 8) throw new Error('gap bonus must be capped');
    if (row.gap_status === '過冷不追' && row.gap_reversion_bonus > 2) throw new Error('extreme cold must not receive top bonus');
  }
  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/src/engine/AdvancedStatsModel.ts'), 'utf8');
  if (!source.includes('evaluateGap')) throw new Error('evaluateGap backend function missing');
  if (source.includes('GAP_HARDCODE_PICK')) throw new Error('hardcoded gap pick found');
  console.log('[PASS] gap reversion comes from DB-derived gaps and caps extreme cold numbers');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
