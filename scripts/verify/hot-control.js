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
  const h = res.data.hot_control_summary;
  if (!h) throw new Error('hot_control_summary missing');
  if (typeof h.top10_hot_count !== 'number') throw new Error('top10_hot_count missing');
  if (h.threshold !== 6 || h.max_allowed_hot_count !== 6) throw new Error('v6.1 hot threshold must be 6');
  if (typeof h.adjusted !== 'boolean') throw new Error('adjusted flag missing');
  if (!h.reason_text) throw new Error('hot control reason missing');
  const scores = res.data.number_scores;
  if (!Array.isArray(scores) || scores.length !== 39) throw new Error('hot control must not delete numbers');
  if (h.adjusted && !scores.some(row => row.hot_control_penalty < 0)) throw new Error('adjusted hot control must apply backend penalty');
  console.log('[PASS] hot control counts Top10 hot numbers, adjusts by score, and does not delete numbers');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
