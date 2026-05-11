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
  'recommendationRepeatSample',
  'recommendedPairRepeatCount',
  'recommendedTripleRepeatCount',
  'pairRecommendationRepeatFactor',
  'tripleRecommendationRepeatFactor',
  'recommendationRepeatRelationshipPenalty',
  'recommendation_repeat_sample_size_insufficient',
]) {
  check(advancedSrc.includes(token) || predictionSrc.includes(token) || routesSrc.includes(token), token + ' is missing');
}

check(advancedSrc.includes('RECOMMENDATION_REPEAT_WINDOW = 5'), 'recommendation repeat window must be 5');
check(advancedSrc.includes('RECOMMENDATION_REPEAT_MIN_SAMPLE = 3'), 'insufficient sample threshold must be 3');
// single_rotation_structure_fatigue_v1: strengthened from 0.94/0.92 to 0.90/0.88
check(advancedSrc.includes('if (repeatCount === 3) return 0.90'), 'pair repeat count 3 must use factor 0.90');
check(advancedSrc.includes('if (repeatCount === 3) return 0.88'), 'triple repeat count 3 must use factor 0.88');
check(advancedSrc.includes('if (repeatCount === 4) return 0.86'), 'pair repeat count 4 must use factor 0.86');
check(advancedSrc.includes('if (repeatCount === 4) return 0.84'), 'triple repeat count 4 must use factor 0.84');
check(advancedSrc.includes('if (repeatCount >= 5) return 0.82'), 'pair repeat count 5+ must use factor 0.82');
check(advancedSrc.includes('if (repeatCount >= 5) return 0.80'), 'triple repeat count 5+ must use factor 0.80');
check(advancedSrc.includes('if (sampleSize < RECOMMENDATION_REPEAT_MIN_SAMPLE || repeatCount <= 1) return 1'), 'insufficient sample must use factor 1');
check(advancedSrc.includes('selected_two_star') && advancedSrc.includes('selected_three_star') && advancedSrc.includes('selected_four_star') && advancedSrc.includes('selected_five_star'), 'diversity must use previous recommendation records');
check(routesSrc.includes('getStrategyObservationLogs(12') && routesSrc.includes('adapter.getObservations(12)'), 'local/cloud prediction must use bounded observation logs');
check(!/recommendedPairRepeatCount[\s\S]{0,500}draws/.test(advancedSrc), 'pair recommendation repeat must not read draws');
check(!/recommendedTripleRepeatCount[\s\S]{0,500}draws/.test(advancedSrc), 'triple recommendation repeat must not read draws');
check(predictionSrc.includes('recommendationRepeatAdjusted') && predictionSrc.includes('risk_flags.push'), 'user-facing diversity wording is missing');
for (const term of ['diversity', 'recommendation repeat', 'penalty', 'schema', 'fallback', 'gate']) {
  check(!predictionCardSrc.toLowerCase().includes(term), 'formal UI must not show ' + term);
}
check(!predictionCardSrc.includes('cache=true'), 'formal UI must not show raw cache=true');
check(!advancedSrc.includes('blocked') && !advancedSrc.includes('gate.blocked.has'), 'diversity must not block candidates');
check(!/Math\.random/.test(advancedSrc + predictionSrc + routesSrc), 'Math.random must not be used');

const diff = spawnSync('git', ['diff', '--name-only'], { cwd: ROOT, encoding: 'utf8' });
const changed = diff.stdout.split(/\r?\n/).filter(Boolean).map(s => s.replace(/\\/g, '/'));
check(!changed.some(file => /history/i.test(file) && /frontend\/src/.test(file)), 'history draw UI must not be modified');

const distEntry = path.join(ROOT, 'backend/dist/engine/statisticalPrediction.js');
if (fs.existsSync(distEntry)) {
  const { buildStatisticalPrediction } = require(distEntry);
  const draws = [];
  for (let i = 0; i < 100; i++) {
    const nums = [1, 2, 3, 10 + (i % 8), 25 + (i % 8)].sort((a, b) => a - b);
    draws.push({ draw_no: String(1200 - i), draw_date: '2026-01-' + String(28 - (i % 27)).padStart(2, '0'), numbers: nums });
  }
  const baseline = buildStatisticalPrediction(draws, '2026-03-01', [], undefined, null);
  const selectedPair = baseline.three_star_summary.selected_three_star.slice(0, 2);
  const selectedTriple = baseline.three_star_summary.selected_three_star;
  const recommendationRecords = [[selectedPair, selectedTriple], [selectedPair, selectedTriple], [selectedPair, selectedTriple], [[4, 5], [4, 5, 6]], [[7, 8], [7, 8, 9]]].map((item, i) => ({ target_draw_no: String(900 - i), target_date: '2026-02-0' + String(i + 1), selected_two_star: item[0], selected_three_star: item[1], selected_four_star: item[1].concat([20 + i]), selected_five_star: item[1].concat([20 + i, 30 + i]) }));
  const prediction = buildStatisticalPrediction(draws, '2026-03-01', [], undefined, { prediction_id: 1, target_date: '2026-02-28', target_draw_no: '901', two_star: [1, 2], three_star: [1, 2, 3], four_star: [1, 2, 3, 4], five_star: [1, 2, 3, 4, 5], actual_numbers: null, recent_observations: recommendationRecords });
  check(prediction.number_scores.length === 39, 'all 01-39 numbers must remain eligible');
  check(prediction.strategy_scores.recommendation_repeat_sample_size === 5, 'sample size must be 5');
  check(prediction.strategy_scores.recommended_pair_repeat_count === 3, 'pair repeat count must be 3');
  check(prediction.strategy_scores.recommended_triple_repeat_count === 3, 'triple repeat count must be 3');
  check(prediction.strategy_scores.pair_recommendation_repeat_factor === 0.90, 'pair repeat factor must be 0.90');
  check(prediction.strategy_scores.triple_recommendation_repeat_factor === 0.88, 'triple repeat factor must be 0.88');
  const insufficient = buildStatisticalPrediction(draws, '2026-03-02', [], undefined, { prediction_id: 2, target_date: '2026-02-28', target_draw_no: '902', two_star: [1, 2], three_star: [1, 2, 3], four_star: [1, 2, 3, 4], five_star: [1, 2, 3, 4, 5], actual_numbers: null, recent_observations: recommendationRecords.slice(0, 2) });
  check(insufficient.strategy_scores.recommendation_repeat_sample_size_insufficient === true, 'insufficient sample flag must be true');
  check(insufficient.strategy_scores.pair_recommendation_repeat_factor === 1, 'insufficient pair factor must be 1');
  check(insufficient.strategy_scores.triple_recommendation_repeat_factor === 1, 'insufficient triple factor must be 1');
}

console.log('[PASS] recommendation diversity uses prior recommendations only, stays soft, and preserves all candidates');

