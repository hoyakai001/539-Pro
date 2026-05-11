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
  const res = await request('/api/prediction/today');
  if (!res.success || !res.data) throw new Error('prediction missing');
  const advice = res.data.bet_advice;
  if (!advice) throw new Error('bet_advice missing');
  if (typeof advice.score !== 'number' || advice.score < 0 || advice.score > 100) throw new Error(`invalid advice score ${advice.score}`);
  if (!['STRONG', 'SMALL', 'WATCH', 'AVOID'].includes(advice.level)) throw new Error(`invalid bet_advice level ${advice.level}`);
  if (!['強攻', '小攻', '觀望', '不建議'].includes(advice.label)) throw new Error(`invalid bet_advice label ${advice.label}`);
  if (!['高', '中', '低'].includes(advice.confidence)) throw new Error(`invalid confidence ${advice.confidence}`);
  if (!advice.reason_text || advice.reason_text.length < 8) throw new Error('bet_advice reason_text is empty');
  if (!Array.isArray(advice.risk_flags)) throw new Error('bet_advice risk_flags must be an array');

  const frontend = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/PredictionCard.tsx'), 'utf8');
  for (const token of ['STRONG', 'SMALL', 'WATCH', 'AVOID']) {
    if (frontend.includes(token)) throw new Error(`frontend hardcodes bet advice token ${token}`);
  }
  console.log('[PASS] bet_advice is backend-generated, scored, localized, and rendered without frontend decision logic');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
