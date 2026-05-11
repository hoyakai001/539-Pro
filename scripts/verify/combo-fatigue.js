#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const advancedSrc = fs.readFileSync(path.join(ROOT, 'backend/src/engine/AdvancedStatsModel.ts'), 'utf8');
const predictionSrc = fs.readFileSync(path.join(ROOT, 'backend/src/engine/statisticalPrediction.ts'), 'utf8');
const routesSrc = fs.readFileSync(path.join(ROOT, 'backend/src/api/routes.ts'), 'utf8');
const predictionCardSrc = fs.readFileSync(path.join(ROOT, 'frontend/src/components/PredictionCard.tsx'), 'utf8');

function check(ok, message) {
  if (!ok) {
    console.error('[FAIL] ' + message);
    process.exit(1);
  }
}

for (const token of [
  'recent_weighted_scoring_single_rotation_structure_fatigue_v1',
  'pair_fatigue_factor',
  'triple_fatigue_factor',
  'pair_repeat_count',
  'triple_repeat_count',
  'consecutivePairRepeatCount',
  'consecutiveTripleRepeatCount',
  'fatigueRelationshipPenalty',
]) {
  check(advancedSrc.includes(token) || predictionSrc.includes(token) || routesSrc.includes(token), token + ' is missing');
}

check(advancedSrc.includes('if (repeatCount >= 5) return 0.80'), 'pair fatigue max factor 0.80 is missing');
check(advancedSrc.includes('if (repeatCount >= 4) return 0.88'), 'pair fatigue 4-repeat factor 0.88 is missing');
check(advancedSrc.includes('if (repeatCount >= 3) return 0.92'), 'pair fatigue 3-repeat factor 0.92 is missing');
check(advancedSrc.includes('if (repeatCount >= 5) return 0.75'), 'triple fatigue max factor 0.75 is missing');
check(advancedSrc.includes('if (repeatCount >= 4) return 0.85'), 'triple fatigue 4-repeat factor 0.85 is missing');
check(advancedSrc.includes('if (repeatCount >= 3) return 0.90'), 'triple fatigue 3-repeat factor 0.90 is missing');
check(advancedSrc.includes('if (!predicate(obs)) break'), 'fatigue must recover when the combo is not selected again');
check(routesSrc.includes('adapter.getObservations(12)'), 'cloud prediction must read only bounded recent observations for fatigue');
check(predictionSrc.includes('comboFatigueAdjusted') && predictionSrc.includes('risk_flags.push'), 'user-facing combo repeat wording is missing');
check(!predictionCardSrc.toLowerCase().includes('fatigue'), 'formal UI must not show fatigue wording');
check(!advancedSrc.includes('blocked') && !advancedSrc.includes('gate.blocked.has'), 'fatigue must not block candidates');
check(!/Math\.random/.test(advancedSrc + predictionSrc + routesSrc), 'Math.random must not be used');

const diff = spawnSync('git', ['diff', '--name-only'], { cwd: ROOT, encoding: 'utf8' });
const changed = diff.stdout.split(/\r?\n/).filter(Boolean).map(s => s.replace(/\\/g, '/'));
check(!changed.some(file => /history/i.test(file) && /frontend\/src/.test(file)), 'history draw UI must not be modified');

const distEntry = path.join(ROOT, 'backend/dist/engine/statisticalPrediction.js');
if (fs.existsSync(distEntry)) {
  const { buildStatisticalPrediction } = require(distEntry);
  const draws = [];
  for (let i = 0; i < 100; i++) {
    const base = i % 6;
    const nums = [1, 2, 3, 10 + base, 20 + base].sort((a, b) => a - b);
    draws.push({ draw_no: String(1000 - i), draw_date: '2026-01-' + String(31 - (i % 28)).padStart(2, '0'), numbers: nums });
  }
  const repeated = [0, 1, 2].map(i => ({ target_draw_no: String(900 - i), target_date: '2026-02-0' + String(i + 1), selected_two_star: [1, 2], selected_three_star: [1, 2, 3], selected_four_star: [1, 2, 3, 4], selected_five_star: [1, 2, 3, 4, 5] }));
  const rested = [
    { target_draw_no: '901', target_date: '2026-02-01', selected_two_star: [1, 2], selected_three_star: [1, 2, 3], selected_four_star: [1, 2, 3, 4], selected_five_star: [1, 2, 3, 4, 5] },
    { target_draw_no: '900', target_date: '2026-02-02', selected_two_star: [6, 7], selected_three_star: [6, 7, 8], selected_four_star: [6, 7, 8, 9], selected_five_star: [6, 7, 8, 9, 10] },
  ];
  const fatiguePrediction = buildStatisticalPrediction(draws, '2026-03-01', [], undefined, { prediction_id: 1, target_date: '2026-02-28', target_draw_no: '901', two_star: [1, 2], three_star: [1, 2, 3], four_star: [1, 2, 3, 4], five_star: [1, 2, 3, 4, 5], actual_numbers: null, recent_observations: repeated });
  check(fatiguePrediction.number_scores.length === 39, 'all 01-39 numbers must remain eligible');
  check(fatiguePrediction.strategy_scores.pair_repeat_count >= 3, 'pair repeat count must reach fatigue threshold');
  check(fatiguePrediction.strategy_scores.triple_repeat_count >= 3, 'triple repeat count must reach fatigue threshold');
  check(fatiguePrediction.strategy_scores.pair_fatigue_factor < 1, 'pair fatigue factor must reduce repeated combo score');
  check(fatiguePrediction.strategy_scores.triple_fatigue_factor < 1, 'triple fatigue factor must reduce repeated combo score');
  const restedPrediction = buildStatisticalPrediction(draws, '2026-03-02', [], undefined, { prediction_id: 2, target_date: '2026-02-28', target_draw_no: '902', two_star: [1, 2], three_star: [1, 2, 3], four_star: [1, 2, 3, 4], five_star: [1, 2, 3, 4, 5], actual_numbers: null, recent_observations: rested });
  check(restedPrediction.strategy_scores.pair_fatigue_factor === 1, 'pair fatigue must recover after a non-selection');
  check(restedPrediction.strategy_scores.triple_fatigue_factor === 1, 'triple fatigue must recover after a non-selection');
}

console.log('[PASS] pair/triple fatigue is soft, recoverable, bounded, and display-safe');

