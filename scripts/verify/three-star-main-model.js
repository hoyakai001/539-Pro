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
  const s = res.data.three_star_summary;
  if (!s) throw new Error('three_star_summary missing');
  const mainEnabled = res.data.strategy_scores?.three_star_main_enabled === true;
  if (mainEnabled) {
    for (const source of ['historical100', 'topPairExtension', 'active30']) {
      if (!s.candidate_sources.includes(source)) throw new Error(`candidate source missing: ${source}`);
    }
  } else {
    if (!Array.isArray(s.candidate_sources) || !s.candidate_sources.includes('stableRecentMode')) {
      throw new Error('fallback mode must declare candidate source stableRecentMode');
    }
  }
  for (const field of ['main_pair_score', 'third_number_pair_support_score', 'triple_history_score', 'number_strength_score', 'gap_reversion_score', 'balance_overheat_score', 'three_star_score']) {
    if (typeof s[field] !== 'number') throw new Error(`${field} missing`);
  }
  if (s.weights_total !== 1) throw new Error('weights_total must equal 1');
  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/src/engine/AdvancedStatsModel.ts'), 'utf8');
  if (!source.includes('allDraws.slice(index + 1, index + 1 + MODEL_WINDOW)')) throw new Error('walk-forward future leak guard missing');
  if (source.includes('Math.random')) throw new Error('Math.random found');
  console.log('[PASS] three-star main model has required sources, components, weights, and no random/future leak');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
