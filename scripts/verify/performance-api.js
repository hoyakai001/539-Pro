#!/usr/bin/env node
'use strict';
const http = require('http');
const PORT = process.env.PORT || 3001;

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${pathname}`, { timeout: 10000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data) }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

(async () => {
  const res = await request('/api/strategy/performance?window=30');
  if (res.status !== 200 || !res.json.success) throw new Error('performance API failed');
  const data = res.json.data;
  for (const field of ['sample_size', 'pending_count', 'byAdvice', 'recent_records']) {
    if (data[field] === undefined) throw new Error(`${field} missing`);
  }
  for (const field of [
    'hitRateSingle',
    'hitRateTwo',
    'hitRateThree',
    'hitRateFour',
    'hitRateFive',
    'single_hit_count',
    'two_star_hit_count',
    'three_star_hit_count',
    'four_star_hit_count',
    'five_star_hit_count',
  ]) {
    if (data[field] === undefined) throw new Error(`${field} missing`);
  }
  if (!data.periods?.week || !data.periods?.previous_week || !data.periods?.month || !data.periods?.previous_month) {
    throw new Error('weekly/previous_week/monthly/previous_month period stats missing');
  }
  for (const period of [data.periods.week, data.periods.previous_week, data.periods.month, data.periods.previous_month]) {
    for (const field of [
      'sample_size',
      'avgHits',
      'maxHits',
      'maxLoseStreak',
      'single_hit_count',
      'two_star_hit_count',
      'three_star_hit_count',
      'four_star_hit_count',
      'five_star_hit_count',
      'hitRateSingle',
      'hitRateTwo',
      'hitRateThree',
      'hitRateFour',
      'hitRateFive',
      'byAdvice',
      'recent_records',
    ]) {
      if (period[field] === undefined) throw new Error(`period.${field} missing`);
    }
    if (!Array.isArray(period.recent_records)) throw new Error('period.recent_records must be an array');
  }
  if (data.sample_size > 0) {
    for (const field of ['hitRateSingle', 'hitRateTwo', 'hitRateThree', 'hitRateFour', 'hitRateFive', 'avgHits', 'maxLoseStreak']) {
      if (typeof data[field] !== 'number') throw new Error(`${field} must be numeric when sample_size > 0`);
    }
    const first = data.recent_records[0];
    if (first) {
      for (const field of ['single', 'two_star', 'three_star', 'four_star', 'five_star', 'actual_numbers', 'hit_count', 'single_hit', 'two_star_hit', 'three_star_hit', 'four_star_hit', 'five_star_hit']) {
        if (first[field] === undefined) throw new Error(`recent_records.${field} missing`);
      }
    }
  }
  for (const key of ['STRONG', 'SMALL', 'WATCH', 'AVOID']) {
    if (!data.byAdvice[key]) throw new Error(`byAdvice.${key} missing`);
  }
  console.log('[PASS] performance API returns evaluated-only strict hit statistics and advice buckets');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
