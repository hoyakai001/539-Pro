#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const advancedSrc = fs.readFileSync(path.join(ROOT, 'backend/src/engine/AdvancedStatsModel.ts'), 'utf8');
const routesSrc = fs.readFileSync(path.join(ROOT, 'backend/src/api/routes.ts'), 'utf8');
const predictionCardSrc = fs.readFileSync(path.join(ROOT, 'frontend/src/components/PredictionCard.tsx'), 'utf8');
const typesSrc = fs.readFileSync(path.join(ROOT, 'frontend/src/types.ts'), 'utf8');

function check(ok, message) {
  if (!ok) {
    console.error(`[FAIL] ${message}`);
    process.exit(1);
  }
}

for (const token of [
  'recent_weighted_scoring_single_rotation_structure_fatigue_v1',
  'COMBO_SUPPORT_SMOOTHING_THRESHOLD',
  'COMBO_SUPPORT_SMOOTHING_SLOPE',
  'smoothComboSupportScore',
  'pair_score_before_smoothing',
  'pair_score_after_smoothing',
  'triple_score_before_smoothing',
  'triple_score_after_smoothing',
]) {
  check(advancedSrc.includes(token) || routesSrc.includes(token) || typesSrc.includes(token), `${token} is missing`);
}

check(advancedSrc.includes('if (score <= COMBO_SUPPORT_SMOOTHING_THRESHOLD) return round(score)'), 'low and mid combo support scores must remain unchanged');
check(advancedSrc.includes('COMBO_SUPPORT_SMOOTHING_THRESHOLD + (score - COMBO_SUPPORT_SMOOTHING_THRESHOLD) * COMBO_SUPPORT_SMOOTHING_SLOPE'), 'high combo support scores must use soft cap smoothing');
check(/pair_score_after_smoothing\s*\*\s*pair_fatigue_factor\s*\*\s*pair_recommendation_repeat_factor/.test(advancedSrc), 'three-star main pair score must use smoothed pair score');
check(/triple_score_after_smoothing\s*\*\s*triple_fatigue_factor\s*\*\s*triple_recommendation_repeat_factor/.test(advancedSrc), 'three-star triple score must use smoothed triple score');
check(advancedSrc.includes('const smoothedRelationship = relationship.total_after_smoothing'), 'final combination relationship must use smoothed relationship score');
check(routesSrc.includes('PREDICTION_CACHE_SCHEMA'), 'cache guard must use the exported schema constant');
check(!advancedSrc.includes('gate.blocked.has') && !advancedSrc.includes('selectionCandidatesForGate'), 'smoothing must not block or filter candidates');
check(!/Math\.random/.test(advancedSrc + routesSrc), 'Math.random must not be used');

for (const term of ['smoothing', 'soft cap', 'log smoothing', 'schema=', 'fallback']) {
  check(!predictionCardSrc.toLowerCase().includes(term), `formal UI must not show ${term}`);
}
check(!predictionCardSrc.includes('cache=true'), 'formal UI must not show raw cache=true');

const diff = spawnSync('git', ['diff', '--name-only'], {
  cwd: ROOT,
  encoding: 'utf8',
});
const changed = diff.stdout.split(/\r?\n/).filter(Boolean).map(s => s.replace(/\\/g, '/'));
check(!changed.some(file => /history/i.test(file) && /frontend\/src/.test(file)), 'history draw UI must not be modified');

const distEntry = path.join(ROOT, 'backend/dist/engine/statisticalPrediction.js');
if (fs.existsSync(distEntry)) {
  const { buildStatisticalPrediction, PREDICTION_CACHE_SCHEMA } = require(distEntry);
  const draws = [];
  for (let i = 0; i < 100; i++) {
    draws.push({
      draw_no: String(2000 - i),
      draw_date: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`,
      numbers: [1, 2, 3, 10 + (i % 10), 25 + (i % 10)].sort((a, b) => a - b),
    });
  }
  const prediction = buildStatisticalPrediction(draws, '2026-03-01', [], undefined, null);
  const summary = prediction.three_star_summary;
  check(PREDICTION_CACHE_SCHEMA === 'recent_weighted_scoring_single_rotation_structure_fatigue_v1', 'prediction cache schema must be single_rotation_structure_fatigue_v1');
  check(summary.pair_score_before_smoothing > summary.pair_score_after_smoothing, 'high pair score must be smoothed down');
  check(summary.triple_score_before_smoothing > summary.triple_score_after_smoothing, 'high triple score must be smoothed down');
  check(summary.pair_score_after_smoothing > 0, 'pair score must not be zeroed');
  check(summary.triple_score_after_smoothing > 0, 'triple score must not be zeroed');
  check(prediction.number_scores.length === 39, 'all 01-39 numbers must remain eligible');
  check(!prediction.number_scores.some(row => Object.prototype.hasOwnProperty.call(row, 'pair_score_before_smoothing')), 'number_scores must not receive smoothing diagnostics');
  check(prediction.two_star.length === 2 && prediction.three_star.length === 3 && prediction.four_star.length === 4 && prediction.five_star.length === 5, 'all combo outputs must remain present');
}

console.log('[PASS] pair/triple smoothing is soft, combo-only, diagnostic-visible, and UI-safe');

