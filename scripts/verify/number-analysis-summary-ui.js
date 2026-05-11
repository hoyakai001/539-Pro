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
  const res = await request('/api/stats/number-analysis?window=100&view=summary');
  if (!res.success || res.view !== 'summary' || !Array.isArray(res.data) || res.data.length !== 39) throw new Error('summary number analysis must return 39 rows');
  const allowed = ['rank', 'number', 'normalized_score', 'count100', 'last10_count', 'last20_count', 'last30_count', 'last10_miss', 'last20_miss', 'last30_miss', 'gap', 'simple_reason_text'];
  for (const row of res.data) {
    for (const field of allowed) if (!(field in row)) throw new Error(`missing summary field ${field}`);
    if ('mean100' in row || 'std100' in row || 'raw_total_score' in row) throw new Error('summary view must not expose admin fields');
  }
  const card = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/PredictionCard.tsx'), 'utf8');
  const client = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/api/client.ts'), 'utf8');
  if (!client.includes('view=summary')) throw new Error('general UI API client must request summary view');
  if (card.includes('raw_total_score')) throw new Error('general UI must not render raw_total_score');
  if (card.includes('JSON.stringify')) throw new Error('general UI must not render raw JSON');
  console.log('[PASS] number analysis summary UI shows simplified fields only and no raw JSON');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
