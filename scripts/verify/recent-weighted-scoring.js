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
  'RECENT_SCORING_WEIGHTS',
  'count10: 0.25',
  'count20: 0.30',
  'count30: 0.30',
  'count50: 0.10',
  'count100: 0.05',
  'REDUCED_ADVANCED_STATS_WEIGHT',
  'recent_weighted_scoring_single_rotation_structure_fatigue_v1',
]) {
  check(advancedSrc.includes(token) || predictionSrc.includes(token) || routesSrc.includes(token), token + ' is missing');
}

check(/count50\s*=\s*countInWindow\(statEntries,\s*stat\.number,\s*50\)/.test(advancedSrc), '50-draw stabilizer count is missing');
check(advancedSrc.includes('(stat.count100 / 100) * RECENT_SCORING_WEIGHTS.count100'), '100-draw weight must remain as background input');
check(!advancedSrc.includes('stat.count100 * 0.32'), 'old 100-draw-heavy frequency formula must not remain');
check(predictionSrc.includes('recent-window-fallback-base'), 'conservative mode must use recent-window wording internally');
check(!predictionSrc.includes('100-draw-fallback-base'), 'old fallback strategy name must not remain');
check(predictionCardSrc.includes('advancedEnabled') && predictionCardSrc.includes('!advancedEnabled'), 'UI must have stable-mode user notice');
check(predictionSrc.includes('selectionPenalty.enabled') && predictionSrc.includes('risk_flags.push'), 'soft penalty wording must be user-facing');
check(!advancedSrc.includes('ANTIHOT_SELECTION_BLOCK_HITS'), 'anti-hot must not use hard-block env');
check(!advancedSrc.includes('selectionCandidatesForGate'), 'anti-hot must not filter candidates');
check(!advancedSrc.includes('gate.blocked.has'), 'anti-hot must not block candidates');
check(!/Math\.random/.test(advancedSrc + predictionSrc), 'Math.random must not be used');

const diff = spawnSync('git', ['diff', '--name-only'], { cwd: ROOT, encoding: 'utf8' });
const changed = diff.stdout.split(/\r?\n/).filter(Boolean).map(s => s.replace(/\\/g, '/'));
const historyTouched = changed.some(file => /history/i.test(file) && /frontend\/src/.test(file));
check(!historyTouched, 'history draw UI files must not be modified by this change');

console.log('[PASS] recent-weighted scoring, stable wording, soft anti-hot, and untouched history UI verified');

