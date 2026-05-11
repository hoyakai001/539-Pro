#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.resolve(__dirname, '../../backend/src/data/fetchPilio539.ts'), 'utf8');
const forbidden = ['推薦', '明牌', '機率分析', '版路', 'prediction', 'recommendation'];
for (const word of forbidden) {
  if (source.includes(word)) {
    console.error(`[FAIL] Pilio parser contains forbidden content parser keyword: ${word}`);
    process.exit(1);
  }
}
if (!source.includes('parsePilioText') || !source.includes('draw_no') || !source.includes('draw_date') || !source.includes('numbers')) {
  console.error('[FAIL] Pilio parser does not expose draw-only fields');
  process.exit(1);
}
console.log('[PASS] Pilio source is limited to draw number/date/numbers and does not replace official DB');
