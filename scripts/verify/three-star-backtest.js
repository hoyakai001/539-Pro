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
  const backtest = await request('/api/backtest/three-star-main', 'POST');
  if (!backtest.success || !backtest.data) throw new Error('three-star main backtest missing');
  const data = backtest.data;
  if (data.sample_size !== 100) throw new Error(`sample_size must be 100, got ${data.sample_size}`);
  if (data.latest_included_draw_no !== latest.data.draw_no) throw new Error('latest opened draw must be included in 100-draw backtest');
  if (data.base_model.sample_size !== 100 || data.three_star_main_model.sample_size !== 100) throw new Error('both A/B models must use 100 samples');
  const improved = data.three_star_main_model.hitRateThree > data.base_model.hitRateThree || data.three_star_main_model.avgHits > data.base_model.avgHits;
  if (data.improvement !== improved) throw new Error('improvement decision must follow three-star or avgHits improvement');
  if (improved && data.three_star_main_model.maxLoseStreak > data.base_model.maxLoseStreak + 2 && data.decision !== 'disabled') {
    throw new Error('max losing streak deterioration must disable model');
  }
  if (!improved && data.decision !== 'disabled') throw new Error('non-improved model must be disabled');

  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/src/engine/AdvancedStatsModel.ts'), 'utf8');
  if (!source.includes('allDraws.slice(index + 1, index + 1 + MODEL_WINDOW)')) throw new Error('walk-forward training must start after each target');
  if (source.includes('allDraws.slice(0, MODEL_WINDOW).map(target')) throw new Error('backtest source hints at target leakage');
  console.log('[PASS] three-star main A/B backtest is 100-draw walk-forward and gates enablement by improvement');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
