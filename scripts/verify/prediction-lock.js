#!/usr/bin/env node
'use strict';
const http = require('http');
const PORT = process.env.PORT || 3001;

function request(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${PORT}${path}`, { method, timeout: 8000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const first = await request('/api/prediction/today');
  if (!first.success || !first.data) throw new Error('prediction/today did not return a locked row');
  if (!first.data.prediction_id && !first.data.id) throw new Error('prediction_id missing');
  if (first.data.locked !== true) throw new Error('prediction is not locked');
  const second = await request('/api/prediction/today');
  if (!second.cached) throw new Error('same-day prediction did not return cached result');
  const regen = await request('/api/prediction/regenerate', 'POST');
  if (regen.success && (!regen.data || regen.data.version <= first.data.version)) throw new Error('regenerate did not create a new version');
  console.log('[PASS] prediction lock, cache, and version rules are enforced');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
