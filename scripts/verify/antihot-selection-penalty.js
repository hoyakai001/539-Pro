#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const advancedSrc = fs.readFileSync(path.join(ROOT, 'backend/src/engine/AdvancedStatsModel.ts'), 'utf8');
const predictionSrc = fs.readFileSync(path.join(ROOT, 'backend/src/engine/statisticalPrediction.ts'), 'utf8');
const routesSrc = fs.readFileSync(path.join(ROOT, 'backend/src/api/routes.ts'), 'utf8');

function check(ok, message) {
  if (!ok) {
    console.error('[FAIL] ' + message);
    process.exit(1);
  }
}

for (const token of [
  'ANTIHOT_SELECTION_PENALTY_ENABLED',
  'ANTIHOT_SELECTION_WINDOW',
  'ANTIHOT_SELECTION_MIN_FACTOR',
  'recent_weighted_scoring_single_rotation_structure_fatigue_v1',
  'selection_score_before_penalty',
  'selection_score_after_penalty',
  'selection_penalty_factor',
  'recent_selection_window_hit_count',
]) {
  check(advancedSrc.includes(token) || predictionSrc.includes(token) || routesSrc.includes(token), token + ' is missing');
}

check(!advancedSrc.includes('ANTIHOT_SELECTION_BLOCK_HITS'), 'hard block env must not be used');
check(!advancedSrc.includes('selectionCandidatesForGate'), 'candidate filtering helper must be removed');
check(!advancedSrc.includes('gate.blocked.has'), 'selection must not skip blocked numbers');
check(predictionSrc.includes('selectionPenalty.enabled') && predictionSrc.includes('risk_flags.push'), 'user-facing soft penalty risk flag is missing');
check(routesSrc.includes('PREDICTION_CACHE_SCHEMA'), 'prediction cache must use exported schema guard');
check(!/Math\.random/.test(advancedSrc), 'Math.random must not be used');

const distEntry = path.join(ROOT, 'backend/dist/engine/statisticalPrediction.js');
if (fs.existsSync(distEntry)) {
  process.env.ANTIHOT_SELECTION_PENALTY_ENABLED = 'true';
  process.env.ANTIHOT_SELECTION_WINDOW = '4';
  process.env.ANTIHOT_SELECTION_MIN_FACTOR = '0.50';
  const { buildStatisticalPrediction } = require(distEntry);
  const draws = [];
  for (let i = 0; i < 100; i++) {
    const nums = [0, 7, 14, 21, 28].map(offset => ((i + offset) % 39) + 1).sort((a, b) => a - b);
    draws.push({ draw_no: String(1000 - i), draw_date: '2026-01-' + String(Math.max(1, 31 - (i % 31))).padStart(2, '0'), numbers: nums });
  }
  draws[0].numbers = [1, 2, 3, 4, 5];
  draws[1].numbers = [1, 6, 7, 8, 9];
  draws[2].numbers = [1, 10, 11, 12, 13];
  draws[3].numbers = [14, 15, 16, 17, 18];
  const prediction = buildStatisticalPrediction(draws, '2026-02-01', [], undefined, null);
  const one = prediction.number_scores.find(item => item.number === 1);
  check(prediction.strategy.includes('recent-window-fallback-base'), 'recent-window fallback base was not exercised');
  check(one && one.recent_selection_window_hit_count === 3, 'recent 4 hit count must be 3');
  check(one.selection_penalty_factor === 0.65, 'recent 4 hit count 3 must use factor 0.65');
  check(one.selection_score_after_penalty > 0, 'soft penalty must not zero the selection score');
  check(prediction.number_scores.length === 39, 'all 01-39 numbers must remain in score diagnostics');
  draws[3].numbers = [1, 15, 16, 17, 18];
  const predictionFourHits = buildStatisticalPrediction(draws, '2026-02-01', [], undefined, null);
  const oneFourHits = predictionFourHits.number_scores.find(item => item.number === 1);
  check(oneFourHits && oneFourHits.selection_penalty_factor === 0.5, 'recent 4 hit count 4 must use factor 0.50');
}

console.log('[PASS] anti-hot selection soft penalty keeps all numbers eligible and applies to fallback/core selection scores');

