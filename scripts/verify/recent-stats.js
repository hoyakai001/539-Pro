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
  const res = await request('/api/stats/number-analysis?window=100');
  if (!res.success || !Array.isArray(res.data) || res.data.length !== 39) throw new Error('number analysis must return 39 rows');
  for (const row of res.data) {
    for (const field of ['count10', 'count20', 'count30', 'count100']) {
      if (typeof row[field] !== 'number' || row[field] < 0) throw new Error(`${field} invalid for ${row.number}`);
    }
    if (row.count10 > row.count20 || row.count20 > row.count30 || row.count30 > row.count100) throw new Error(`recent counts are inconsistent for ${row.number}`);
  }
  const card = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/PredictionCard.tsx'), 'utf8');
  if (!card.includes('10期') || !card.includes('20期') || !card.includes('30期')) throw new Error('UI must show 10/20/30 recent stats');
  if (card.includes('300期') || card.includes('200期')) throw new Error('main UI must not show 200/300 period stats');
  console.log('[PASS] recent 10/20/30/100 stats are backend-provided and main UI excludes 200/300 periods');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
