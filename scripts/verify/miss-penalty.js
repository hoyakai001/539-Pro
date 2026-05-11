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
  const miss = res.data.miss_penalty_summary;
  const repeat = res.data.combination_repeat_summary;
  if (!miss) throw new Error('miss_penalty_summary missing');
  for (const field of ['two_star_miss_penalty', 'three_star_miss_penalty', 'four_star_miss_penalty', 'five_star_miss_penalty']) {
    if (typeof miss[field] !== 'number' || miss[field] > 0) throw new Error(`${field} invalid`);
  }
  if (!miss.previous_result_available) {
    const total = miss.two_star_miss_penalty + miss.three_star_miss_penalty + miss.four_star_miss_penalty + miss.five_star_miss_penalty;
    if (total !== 0) throw new Error('unpublished previous result must not trigger miss penalty');
  } else {
    if (!miss.previous_hits) throw new Error('previous_hits missing when result is available');
    if (miss.previous_hits.two === 0 && repeat.two_star_overlap === 2 && miss.two_star_miss_penalty !== -3) throw new Error('two-star miss penalty mismatch');
    if (miss.previous_hits.three === 0 && repeat.three_star_overlap === 3 && miss.three_star_miss_penalty !== -4) throw new Error('three-star miss penalty mismatch');
    if (miss.previous_hits.four === 0 && repeat.four_star_overlap >= 3 && miss.four_star_miss_penalty !== -3) throw new Error('four-star miss penalty mismatch');
    if (miss.previous_hits.five === 0 && repeat.five_star_overlap >= 4 && miss.five_star_miss_penalty !== -4) throw new Error('five-star miss penalty mismatch');
  }
  if (!miss.reason_text) throw new Error('miss penalty reason_text missing');

  const model = fs.readFileSync(path.resolve(__dirname, '../../backend/src/engine/AdvancedStatsModel.ts'), 'utf8');
  if (!model.includes('!previous?.actual_numbers')) throw new Error('backend must guard against assuming misses before draw is published');
  if (model.includes('UPDATE predictions')) throw new Error('miss penalty must not rewrite old predictions');
  console.log('[PASS] miss penalty only applies after an actual draw exists and never assumes unpublished misses');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
