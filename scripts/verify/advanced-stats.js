#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const PORT = process.env.PORT || 3001;

function request(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${PORT}${pathname}`, { method, timeout: 120000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const latest = await request('/api/latest-draw');
  const backtest = await request('/api/backtest/advanced', 'POST');
  if (!backtest.success || !backtest.data) throw new Error('advanced backtest missing');
  const data = backtest.data;
  if (data.sample_size !== 100) throw new Error(`sample_size must be 100, got ${data.sample_size}`);
  if (data.latest_included_draw_no !== latest.data.draw_no) {
    throw new Error(`latest draw not included: ${data.latest_included_draw_no} != ${latest.data.draw_no}`);
  }
  for (const side of ['base_model', 'advanced_model']) {
    for (const field of ['hitRateTwo', 'hitRateThree', 'hitRateFour', 'hitRateFive', 'avgHits', 'maxLoseStreak', 'sample_size']) {
      if (typeof data[side]?.[field] !== 'number' || !Number.isFinite(data[side][field])) {
        throw new Error(`${side}.${field} missing or invalid`);
      }
    }
  }
  if (data.improvement === false && data.decision !== 'disabled') throw new Error('no improvement must disable advanced stats');
  if (!['enabled', 'disabled'].includes(data.decision)) throw new Error(`invalid decision ${data.decision}`);

  const analysis = await request('/api/stats/number-analysis?window=100');
  if (!analysis.success || !Array.isArray(analysis.data) || analysis.data.length !== 39) throw new Error('number analysis must return 39 rows');
  for (const row of analysis.data) {
    for (const field of ['count100', 'mean100', 'std100', 'gap', 'consecutive_hit_count', 'consecutive_penalty', 'hotness_penalty', 'overheat_score', 'advanced_score_adjusted', 'total_score', 'rank']) {
      if (typeof row[field] !== 'number' || !Number.isFinite(row[field])) throw new Error(`analysis field invalid: ${field}`);
    }
    if (row.overheat_score > 0) throw new Error('overheat_score must not be positive');
  }

  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/src/engine/AdvancedStatsModel.ts'), 'utf8');
  if (!source.includes('allDraws.slice(index + 1')) throw new Error('walk-forward training slice must start after target index');
  if (source.includes('Math.random')) throw new Error('Math.random found in advanced stats model');
  console.log('[PASS] advanced stats A/B backtest uses 100 samples, includes latest draw, has no future leak, and exposes 01-39 analysis');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
