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
  const prediction = await request('/api/prediction/today');
  if (!prediction.success || !prediction.data) throw new Error('prediction/today missing');
  if (prediction.data.model_version !== 'v6.1-three-star-stable') throw new Error('model_version must be fixed v6.1');
  if (!prediction.data.observation_status) throw new Error('prediction must include observation_status');
  if (prediction.data.observation_status.target_count !== 30) throw new Error('observation target_count must be 30');

  const res = await request('/api/strategy/observation?limit=30');
  if (!res.success || !res.data) throw new Error('strategy observation API missing');
  if (res.data.model_version !== 'v6.1-three-star-stable') throw new Error('observation model_version mismatch');
  if (res.data.target_count !== 30) throw new Error('observation API target_count must be 30');
  if (!['觀察中', '已完成'].includes(res.data.status)) throw new Error('observation status must be localized');
  if (!Array.isArray(res.data.logs) || res.data.logs.length > 30) throw new Error('observation logs must return <=30 rows');
  if (res.data.observed_count < 1) throw new Error('prediction generation must create an observation log');

  const current = res.data.logs.find(row =>
    row.model_version === prediction.data.model_version &&
    row.target_draw_no === prediction.data.target_draw_no
  );
  if (!current) throw new Error('current prediction must be present in observation logs');
  for (const field of ['selected_two_star', 'selected_three_star', 'selected_four_star', 'selected_five_star']) {
    if (!Array.isArray(current[field]) || current[field].length === 0) throw new Error(`${field} must be stored as numbers`);
  }

  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/src/engine/statisticalPrediction.ts'), 'utf8');
  if (!source.includes('v6.1-three-star-stable')) throw new Error('fixed v6.1 model_version missing');
  if (source.includes('Math.random')) throw new Error('Math.random found');
  console.log('[PASS] v6.1 observation logs record fixed model predictions and expose 30-draw status');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
