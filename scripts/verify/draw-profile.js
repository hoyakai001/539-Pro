#!/usr/bin/env node
'use strict';
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
  if (!res.success || !res.data) throw new Error('prediction missing');
  const profile = res.data.draw_profile;
  if (!profile) throw new Error('draw_profile missing');
  if (!['hot', 'cold', 'normal'].includes(profile.type)) throw new Error(`invalid draw_profile type ${profile.type}`);
  if (typeof profile.hot_count !== 'number' || typeof profile.cold_count !== 'number') throw new Error('draw profile counts missing');
  if (!profile.reason_text) throw new Error('draw_profile reason_text missing');
  console.log('[PASS] draw profile is returned as hot/cold/normal with backend reason text');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
