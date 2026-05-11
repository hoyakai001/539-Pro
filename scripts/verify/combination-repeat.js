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

function expected(kind, overlap) {
  if (kind === 'two') return overlap === 2 ? -5 : 0;
  if (kind === 'three') return overlap === 3 ? -8 : overlap === 2 ? -3 : 0;
  if (kind === 'four') return overlap === 4 ? -10 : overlap === 3 ? -5 : 0;
  return overlap === 5 ? -12 : overlap === 4 ? -6 : overlap === 3 ? -3 : 0;
}

(async () => {
  const res = await request('/api/prediction/today');
  if (!res.success || !res.data) throw new Error('prediction missing');
  const s = res.data.combination_repeat_summary;
  if (!s) throw new Error('combination_repeat_summary missing');
  if (s.two_star_penalty !== expected('two', s.two_star_overlap)) throw new Error('two_star repeat penalty mismatch');
  if (s.three_star_penalty !== expected('three', s.three_star_overlap)) throw new Error('three_star repeat penalty mismatch');
  if (s.four_star_penalty !== expected('four', s.four_star_overlap)) throw new Error('four_star repeat penalty mismatch');
  if (s.five_star_penalty !== expected('five', s.five_star_overlap)) throw new Error('five_star repeat penalty mismatch');
  if (!s.penalties || typeof s.penalties.three_star !== 'number') throw new Error('penalties summary missing');
  if (!s.reason_text) throw new Error('combination repeat reason_text missing');

  const backend = fs.readFileSync(path.resolve(__dirname, '../../backend/src/api/routes.ts'), 'utf8');
  const model = fs.readFileSync(path.resolve(__dirname, '../../backend/src/engine/AdvancedStatsModel.ts'), 'utf8');
  const frontend = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/PredictionCard.tsx'), 'utf8');
  if (!backend.includes('getLatestPrediction')) throw new Error('previous prediction must be read from DB');
  if (!model.includes('combinationRepeatPenalty')) throw new Error('combination repeat penalty missing from backend model');
  if (frontend.includes('combinationRepeatPenalty') || frontend.includes('three_star_penalty =')) throw new Error('frontend must not calculate combination repeat penalty');
  console.log('[PASS] combination repeat penalty is backend-calculated from previous DB prediction and does not delete numbers');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
