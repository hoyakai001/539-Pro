#!/usr/bin/env node
'use strict';
const http = require('http');
const PORT = process.env.PORT || 3001;
const fields = 'number,count10,count20,count30,count100,total_score,frequency_score,gap_score,tail_score,pair_score,repeat_score,balance_score,backtest_score,overheat_score,advanced_score_adjusted,tracking_score,odd_even_balance_score,big_small_balance_score,zone_balance_score,tail_balance_score,consecutive_score,repeat_overlap_score,total_balance_score,rank,selected_in_single,selected_in_two_star,selected_in_three_star,selected_in_four_star,selected_in_five_star,overlap_with_latest,overlap_with_previous,reason_text,balance_reason_text'.split(',');

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${path}`, { timeout: 5000 }, res => {
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
  const scores = res.data.number_scores;
  if (!Array.isArray(scores) || scores.length !== 39) throw new Error(`expected 39 score rows, got ${scores?.length}`);
  for (const row of scores) {
    for (const field of fields) {
      if (!(field in row)) throw new Error(`missing score field ${field}`);
      if (typeof row[field] === 'number' && !Number.isFinite(row[field])) throw new Error(`invalid numeric score ${field}`);
    }
  }
  console.log('[PASS] score breakdown has complete 01-39 rows');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
