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
  if (!res.success || !res.data?.bet_advice) throw new Error('bet advice missing');
  const advice = res.data.bet_advice;
  if (typeof advice.score !== 'number' || advice.score < 0 || advice.score > 100) throw new Error('advice_score must be 0..100');
  if (!['強攻', '小攻', '觀望', '不建議'].includes(advice.label)) throw new Error('advice label must be localized');
  if (!['高', '中', '低'].includes(advice.confidence)) throw new Error('confidence must be localized');
  if (!advice.reason_text) throw new Error('reason_text missing');
  if (!Array.isArray(advice.risk_flags)) throw new Error('risk_flags must be an array');
  const profile = res.data.draw_profile;
  const three = res.data.three_star_summary;
  const hot = res.data.hot_control_summary;
  const extreme =
    profile?.type !== 'normal' &&
    ((hot?.top10_hot_count ?? 0) >= 9 || (profile?.hot_count ?? 0) >= 4 || (profile?.cold_count ?? 0) >= 3);
  const weakThree = !three || three.three_star_score < 55 || three.main_pair_score < 45;
  if (advice.label === '不建議' && !(extreme && weakThree && advice.score < 42)) {
    throw new Error('v6.1 must reserve 不建議 for extreme weak structures only');
  }
  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/src/engine/statisticalPrediction.ts'), 'utf8');
  for (const token of ['threeStrength', 'pairStrength', 'concentration', 'balanceScore', 'overheatControl', 'repeatControl', 'backtestEffective']) {
    if (!source.includes(token)) throw new Error(`advice score missing component ${token}`);
  }
  if (source.includes('downgrade(')) throw new Error('advice must not be downgraded by a single risk gate');
  if (!source.includes('score >= 82') || !source.includes('score >= 62') || !source.includes('score >= 42')) {
    throw new Error('v6.1 deployment thresholds must be 82/62/42');
  }
  console.log('[PASS] bet advice uses balanced 0-100 backend score and localized output');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
