#!/usr/bin/env node
'use strict';
const http = require('http');
const PORT = process.env.PORT || 3001;
function request(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${PORT}${path}`, { method, timeout: 20000 }, res => {
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
  const res = await request('/api/run-backtest', 'POST');
  if (!res.success || !Array.isArray(res.data) || !res.data.length) throw new Error('run-backtest returned no metrics');
  for (const m of res.data) {
    for (const field of ['hitRateTwo','hitRateThree','hitRateFour','hitRateFive','sample_size','tested_draws','audit_status']) {
      if (!(field in m)) throw new Error(`missing backtest field ${field}`);
    }
    const record = m.records?.[0];
    if (record && record.latest_used_draw_date >= record.target_draw_date) throw new Error('walk-forward record uses future data');
  }
  console.log('[PASS] backtest integrity fields and walk-forward records are present');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
