#!/usr/bin/env node
'use strict';
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
  const p = res.data;
  const scores = p.number_scores;
  if (!Array.isArray(scores) || scores.length !== 39) throw new Error('score rows must include all 39 numbers');
  for (const row of scores) {
    if (row.overheat_score > 0 || row.overheat_score < -10) throw new Error(`overheat out of bounds for ${row.number}`);
  }
  if (!p.balance_summary || !p.balance_summary.reason_text) throw new Error('balance_summary.reason_text missing');
  if (!p.five_star.every(n => scores.some(row => row.number === n))) throw new Error('selected numbers must remain in the 01-39 score table');
  console.log('[PASS] overheat is bounded and balance summary is generated from backend scoring');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
