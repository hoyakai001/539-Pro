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
const typesSrc = fs.readFileSync(path.join(ROOT, 'frontend/src/types.ts'), 'utf8');

function check(ok, message) {
  if (!ok) {
    console.error('[FAIL] ' + message);
    process.exit(1);
  }
}

for (const token of [
  'recent_weighted_scoring_single_rotation_structure_fatigue_v1',
  'extraShortTermOverheatFactor',
  'finalCombinationNumberScore',
  'pairFreshnessBonus',
  'tripleFreshnessBonus',
  'recommendationFreshnessRelationshipBonus',
  'extra_overheat_factor',
  'last10_overheat_triggered',
  'pair_freshness_bonus',
  'triple_freshness_bonus',
  'pair_recent_recommendation_count',
  'triple_recent_recommendation_count',
]) {
  check(
    advancedSrc.includes(token) || predictionSrc.includes(token) || routesSrc.includes(token) || typesSrc.includes(token),
    token + ' is missing',
  );
}

check(advancedSrc.includes('if (row.count10 >= 5) return 0.78'), 'last10_count >= 5 must use extra overheat factor 0.78');
check(advancedSrc.includes('if (row.count10 === 4) return 0.82'), 'last10_count = 4 must use extra overheat factor 0.82');
check(advancedSrc.includes('if (row.count10 === 3) return 0.87'), 'last10_count = 3 must use extra overheat factor 0.87');
check(advancedSrc.includes('if (row.count10 === 2) return 0.93'), 'last10_count = 2 must use extra overheat factor 0.93');
check(advancedSrc.includes('return round(row.selection_score_after_penalty * extraShortTermOverheatFactor(row))'), 'extra overheat must be applied as final combo-only score factor');
check(advancedSrc.includes('const scoreByNumber = new Map(rows.map(row => [row.number, finalCombinationNumberScore(row)]))'), 'combo selection must use finalCombinationNumberScore');
check(advancedSrc.includes('const comboScores = rowScores.map(finalCombinationNumberScore)'), 'three-star number strength must use combo-layer final score');
check(advancedSrc.includes('if (repeatCount === 0) return 1.05'), 'pair freshness 0-repeat bonus must be 1.05');
check(advancedSrc.includes('if (repeatCount === 1) return 1.02'), 'pair freshness 1-repeat bonus must be 1.02');
check(advancedSrc.includes('if (repeatCount === 0) return 1.06'), 'triple freshness 0-repeat bonus must be 1.06');
check(advancedSrc.includes('if (repeatCount === 1) return 1.03'), 'triple freshness 1-repeat bonus must be 1.03');
check(advancedSrc.includes('if (sampleSize < RECOMMENDATION_REPEAT_MIN_SAMPLE) return 1'), 'freshness must not apply when recommendation sample is insufficient');
check(advancedSrc.includes('recommendedPairRepeatCount(pair, previous)') && advancedSrc.includes('recommendedTripleRepeatCount(trio, previous)'), 'freshness must use prior recommendation records');
check(!/recommendationFreshnessRelationshipBonus[\s\S]{0,700}draws/.test(advancedSrc), 'freshness must not read draw results');
check(!advancedSrc.includes('selectionCandidatesForGate') && !advancedSrc.includes('gate.blocked.has'), 'freshness/overheat balance must not hard block candidates');
check(!/Math\.random/.test(advancedSrc + predictionSrc + routesSrc), 'Math.random must not be used');
check(!predictionCardSrc.includes('freshness') && !predictionCardSrc.includes('diversity') && !predictionCardSrc.includes('penalty') && !predictionCardSrc.includes('bonus'), 'formal UI must not expose engineering balance terms');
check(!predictionCardSrc.includes('schema') && !predictionCardSrc.includes('cache=true') && !predictionCardSrc.includes('fallback') && !predictionCardSrc.includes('gate'), 'formal UI must not expose schema/cache/fallback/gate wording');

const diff = spawnSync('git', ['diff', '--name-only'], { cwd: ROOT, encoding: 'utf8' });
const changed = diff.stdout.split(/\r?\n/).filter(Boolean).map(s => s.replace(/\\/g, '/'));
check(!changed.some(file => /history/i.test(file) && /frontend\/src/.test(file)), 'history draw UI must not be modified');

const distEntry = path.join(ROOT, 'backend/dist/engine/statisticalPrediction.js');
if (fs.existsSync(distEntry)) {
  const { buildStatisticalPrediction, PREDICTION_CACHE_SCHEMA } = require(distEntry);
  const draws = [];
  for (let i = 0; i < 100; i++) {
    const hotFront = i < 10 ? [1, 2, 3] : [1 + (i % 12), 14 + (i % 10), 27 + (i % 10)];
    const nums = Array.from(new Set([...hotFront, 20 + (i % 8), 32 + (i % 7)])).slice(0, 5).sort((a, b) => a - b);
    while (nums.length < 5) nums.push(39 - nums.length);
    draws.push({
      draw_no: String(3000 - i),
      draw_date: '2026-02-' + String(28 - (i % 27)).padStart(2, '0'),
      numbers: nums.sort((a, b) => a - b),
    });
  }
  const baseline = buildStatisticalPrediction(draws, '2026-04-01', [], undefined, null);
  check(PREDICTION_CACHE_SCHEMA === 'recent_weighted_scoring_single_rotation_structure_fatigue_v1', 'cache schema must force single_rotation_structure_fatigue_v1 rebuild');
  check(baseline.number_scores.length === 39, 'all 01-39 numbers must remain eligible');
  check(!baseline.number_scores.some(row => Object.prototype.hasOwnProperty.call(row, 'extra_overheat_factor')), 'number_scores must not receive extra overheat diagnostics');
  check(Array.isArray(baseline.two_star) && baseline.two_star.length === 2, 'two-star output must remain valid');
  check(Array.isArray(baseline.three_star) && baseline.three_star.length === 3, 'three-star output must remain valid');
  check(Array.isArray(baseline.four_star) && baseline.four_star.length === 4, 'four-star output must remain valid');
  check(Array.isArray(baseline.five_star) && baseline.five_star.length === 5, 'five-star output must remain valid');

  const unrelatedRecords = [0, 1, 2, 3, 4].map(i => ({
    target_draw_no: String(2000 - i),
    target_date: '2026-03-' + String(i + 1).padStart(2, '0'),
    selected_two_star: [30 + (i % 2), 35 + (i % 3)].sort((a, b) => a - b),
    selected_three_star: [30 + (i % 2), 35 + (i % 3), 38 - (i % 2)].sort((a, b) => a - b),
    selected_four_star: [10, 30 + (i % 2), 35 + (i % 3), 38 - (i % 2)].sort((a, b) => a - b),
    selected_five_star: [5, 10, 30 + (i % 2), 35 + (i % 3), 38 - (i % 2)].sort((a, b) => a - b),
  }));
  const fresh = buildStatisticalPrediction(draws, '2026-04-02', [], undefined, {
    prediction_id: 1,
    target_date: '2026-03-31',
    target_draw_no: '2999',
    two_star: [1, 2],
    three_star: [1, 2, 3],
    four_star: [1, 2, 3, 4],
    five_star: [1, 2, 3, 4, 5],
    actual_numbers: null,
    recent_observations: unrelatedRecords,
  });
  check(fresh.strategy_scores.recommendation_repeat_sample_size === 5, 'freshness sample size must use recent five recommendations');
  check(fresh.strategy_scores.pair_freshness_bonus >= 1 && fresh.strategy_scores.pair_freshness_bonus <= 1.05, 'pair freshness bonus must stay light');
  check(fresh.strategy_scores.triple_freshness_bonus >= 1 && fresh.strategy_scores.triple_freshness_bonus <= 1.06, 'triple freshness bonus must stay light');

  const insufficient = buildStatisticalPrediction(draws, '2026-04-03', [], undefined, {
    prediction_id: 2,
    target_date: '2026-03-31',
    target_draw_no: '2998',
    two_star: [1, 2],
    three_star: [1, 2, 3],
    four_star: [1, 2, 3, 4],
    five_star: [1, 2, 3, 4, 5],
    actual_numbers: null,
    recent_observations: unrelatedRecords.slice(0, 2),
  });
  check(insufficient.strategy_scores.pair_freshness_bonus === 1, 'insufficient pair freshness bonus must be 1');
  check(insufficient.strategy_scores.triple_freshness_bonus === 1, 'insufficient triple freshness bonus must be 1');
}

console.log('[PASS] short-term overheat balance and recommendation freshness are soft, combo-only, and UI-safe');
