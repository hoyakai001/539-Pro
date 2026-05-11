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
  if (!res.success || !Array.isArray(res.data) || res.data.length !== 39) throw new Error('number analysis API must return 39 summary rows');
  const required = ['rank', 'number', 'normalized_score', 'count100', 'last10_count', 'last20_count', 'last30_count', 'last10_miss', 'last20_miss', 'last30_miss', 'gap', 'simple_reason_text'];
  for (const row of res.data) {
    for (const field of required) {
      if (!(field in row)) throw new Error(`missing number analysis summary field ${field}`);
    }
  }
  const card = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/PredictionCard.tsx'), 'utf8');
  if (!card.includes('查看全部 01~39')) throw new Error('Dashboard card must expose number analysis 01-39');
  if (!card.includes('api.getNumberAnalysis')) throw new Error('number analysis UI must call backend API when expanded');
  for (const label of ['10期', '20期', '30期', '未開']) {
    if (!card.includes(label)) throw new Error(`number analysis UI missing recent label ${label}`);
  }
  if (card.includes('JSON.stringify')) throw new Error('number analysis UI must not render raw JSON');
  if (card.includes('Math.random')) throw new Error('number analysis UI must not use random');
  console.log('[PASS] number analysis UI expands via backend API, returns 39 summary rows, and renders recent 10/20/30 stats');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
