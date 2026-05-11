#!/usr/bin/env node
'use strict';
const http = require('http');
const PORT = process.env.PORT || 3001;

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${path}`, { timeout: 8000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function iso(input) {
  return String(input || '').replace(/\//g, '-');
}

(async () => {
  const first = await request('/api/prediction/today');
  if (!first.success || !first.data) throw new Error('prediction/today missing');
  const p = first.data;
  if (!p.latest_used_draw_no || !p.latest_used_draw_date) throw new Error('latest_used fields missing');
  if (p.target_draw_no && Number(p.target_draw_no) <= Number(p.latest_used_draw_no)) {
    throw new Error(`target_draw_no ${p.target_draw_no} is not after latest_used_draw_no ${p.latest_used_draw_no}`);
  }
  if (iso(p.target_date) <= iso(p.latest_used_draw_date)) {
    throw new Error(`target_date ${p.target_date} is not after latest_used_draw_date ${p.latest_used_draw_date}`);
  }
  const history = await request(`/api/history/draws?drawNo=${encodeURIComponent(p.target_draw_no || '')}`);
  if (p.target_draw_no && history.total > 0) throw new Error('target draw already exists in DB');
  const second = await request('/api/prediction/today');
  if (!second.cached) throw new Error('same target did not return cached prediction');
  if ((second.data.prediction_id || second.data.id) !== (p.prediction_id || p.id)) {
    throw new Error('same target returned a different prediction id');
  }
  console.log('[PASS] prediction target is the next unpublished draw and cache key is stable');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
