#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../../docs/STRATEGY_FULL.md');
if (!fs.existsSync(file)) throw new Error('docs/STRATEGY_FULL.md is missing');
const text = fs.readFileSync(file, 'utf8');

for (const token of [
  'v6.1-three-star-stable',
  'target_draw_no',
  'latest_used_draw_no',
  'cache key',
  'frequency',
  'gap',
  'tail',
  'pair',
  'repeat',
  'balance',
  'backtest',
  'overheat',
  'anti-hot',
  '三星主力模型',
  '二星骨架',
  '補碼',
  '三中三只是加分',
  '四星',
  '五星',
  'GAP 冷號補分',
  '下注建議',
  'observation logs',
  'maxLoseStreak',
  '不是保證中獎',
]) {
  if (!text.includes(token)) throw new Error(`strategy docs missing ${token}`);
}

console.log('[PASS] strategy documentation is complete');
