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

function consecutivePenalty(count) {
  if (count <= 0) return 0;
  if (count === 1) return -1;
  if (count === 2) return -3;
  if (count === 3) return -6;
  return -9;
}

(async () => {
  const res = await request('/api/stats/number-analysis?window=100');
  if (!res.success || !Array.isArray(res.data) || res.data.length !== 39) throw new Error('number analysis must return 39 rows');
  const counts = res.data.map(row => row.count100);
  const mean = counts.reduce((sum, n) => sum + n, 0) / counts.length;
  const std = Math.sqrt(counts.reduce((sum, n) => sum + (n - mean) ** 2, 0) / counts.length);

  for (const row of res.data) {
    const expectedConsecutive = consecutivePenalty(row.consecutive_hit_count);
    const expectedHotness = row.count100 > mean + 2 * std ? -3 : row.count100 > mean + std ? -1 : 0;
    const expectedOverheat = Math.max(-10, Math.min(0, expectedConsecutive + expectedHotness));
    if (row.consecutive_penalty !== expectedConsecutive) throw new Error(`consecutive penalty mismatch for ${row.number}`);
    if (row.hotness_penalty !== expectedHotness) throw new Error(`hotness penalty mismatch for ${row.number}`);
    if (row.overheat_score !== expectedOverheat) throw new Error(`overheat total mismatch for ${row.number}`);
    if (row.overheat_score > 0 || row.overheat_score < -10) throw new Error(`overheat_score must be within -10..0 for ${row.number}`);
    if (!row.overheat_reason) throw new Error(`overheat_reason missing for ${row.number}`);
  }
  console.log('[PASS] overheat penalty uses DB mean/std, final deduction rules, and never removes numbers');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
