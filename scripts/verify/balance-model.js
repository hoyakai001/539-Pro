#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const PORT = process.env.PORT || 3001;

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${pathname}`, { timeout: 8000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

(async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/src/engine/BalanceModel.ts'), 'utf8');
  if (!source.includes('slice(0, 100)')) throw new Error('BalanceModel does not use recent 100 draws');
  if (/2\s*[:=]\s*3|3\s*[:=]\s*2|fixedOdd|fixedBigSmall/i.test(source)) throw new Error('BalanceModel appears to hardcode a fixed ratio');
  if (!source.includes('repeatOverlap')) throw new Error('repeat overlap distribution missing');
  const pred = await request('/api/prediction/today');
  if (!pred.success || !pred.data) throw new Error('prediction missing');
  if (!pred.data.balance_summary) throw new Error('balance_summary missing');
  const scores = pred.data.number_scores || [];
  if (!scores.length || scores.some(s => typeof s.balance_reason_text !== 'string' || !s.balance_reason_text)) throw new Error('balance_reason_text missing');
  console.log('[PASS] balance model uses recent 100-draw distributions and exposes balance reasons');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
