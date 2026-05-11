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

(async () => {
  const top = await request('/api/stats/two-star?top=741');
  if (!Array.isArray(top.data) || top.data.length !== 741) throw new Error(`expected C(39,2)=741 rows, got ${top.data?.length}`);
  const pair = await request('/api/stats/two-star?numbers=08,25');
  if (!pair.data || pair.data.key !== '08,25') throw new Error('specified two-star pair lookup failed');
  const bt = await request('/api/backtest/summary');
  if (bt.data.length && !('hit_rate_two' in bt.data[0])) throw new Error('backtest summary has no two-star hit rate');
  console.log('[PASS] two-star combination stats and hit-rate fields are available');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
