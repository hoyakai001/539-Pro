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
  const rows = res.data.number_scores;
  if (!Array.isArray(rows) || rows.length !== 39) throw new Error('number_scores must include 39 rows');
  const ranks = new Set();
  for (const row of rows) {
    for (const field of ['frequency_score', 'gap_score', 'tail_score', 'pair_score', 'repeat_score', 'balance_score', 'backtest_score', 'overheat_score', 'advanced_score_adjusted', 'tracking_score', 'raw_total_score', 'normalized_score', 'total_score']) {
      if (typeof row[field] !== 'number' || !Number.isFinite(row[field])) throw new Error(`invalid score field ${field}`);
    }
    if (row.normalized_score < 0 || row.normalized_score > 100) throw new Error('normalized_score must be 0..100');
    if (row.overheat_score > 0 || row.overheat_score < -10) throw new Error('overheat score must be normalized -10..0');
    if (row.advanced_stats_weight > 0.2) throw new Error('advanced_stats_weight must not exceed 0.2');
    ranks.add(row.rank);
  }
  if (ranks.size !== 39 || Math.min(...ranks) !== 1 || Math.max(...ranks) !== 39) throw new Error('ranks must be exactly 1..39');
  console.log('[PASS] score rows are finite, ranked 1-39, and normalized within model bounds');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
