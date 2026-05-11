#!/usr/bin/env node
/**
 * verify:backtest-no-future-leak — 靜態分析 walk-forward 實作
 *
 * allDraws 排列：新→舊（index 0 = 最新，index N = 最舊）
 * 預測 allDraws[i] 時，訓練資料必須是 allDraws.slice(i+1, i+1+window)
 * 即「index > i」的更舊資料，嚴禁偷看 index <= i 的更新資料
 *
 * 退出碼：
 *   0 = 通過
 *   1 = 發現可疑洩漏
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const BACKTEST_FILE = path.resolve(__dirname, '../../backend/src/backtest/walkForwardBacktest.ts');

if (!fs.existsSync(BACKTEST_FILE)) {
  console.error('[FAIL] 找不到 walkForwardBacktest.ts');
  process.exit(1);
}

const src = fs.readFileSync(BACKTEST_FILE, 'utf-8');
let passed = true;

// 1. 必須有 slice(i + 1, ...) 作為訓練資料
if (/slice\s*\(\s*i\s*\+\s*1/.test(src)) {
  console.log('[PASS] slice(i + 1, ...) — 訓練資料從目標期之後的更舊資料取');
} else {
  console.error('[FAIL] 未找到 slice(i + 1, ...) 訓練取法');
  passed = false;
}

// 2. 目標期必須用 allDraws[i]
if (/(?:target|actual).*=.*allDraws\[i\]|allDraws\[i\]/.test(src)) {
  console.log('[PASS] allDraws[i] — 目標期明確');
} else {
  console.error('[FAIL] 未找到 allDraws[i] — 目標期取法不明確');
  passed = false;
}

// 3. 確保沒有 slice(0, i) 取更新資料做訓練（那樣是未來洩漏）
if (/trainingDraws\s*=\s*allDraws\.slice\s*\(\s*0\s*,\s*i\b/.test(src)) {
  console.error('[FAIL] 發現 trainingDraws = allDraws.slice(0, i) — 這在新→舊排列下包含了目標期的更新資料（未來洩漏）');
  passed = false;
} else {
  console.log('[PASS] 未發現 slice(0, i) 用於訓練（正確）');
}

// 4. 確認有 window_size 控制（不是全量訓練）
if (/windowSize|window_size/.test(src)) {
  console.log('[PASS] 有 windowSize 控制訓練資料量');
} else {
  console.warn('[WARN] 未發現 windowSize，可能使用全量訓練（可接受但建議確認）');
}

// 5. 確認有最小資料量保護
if (/\.length\s*<\s*\d+/.test(src)) {
  console.log('[PASS] 有 .length < N 資料量保護');
} else {
  console.warn('[WARN] 未發現明確的最小資料量檢查');
}

if (!passed) {
  console.error('\n[FAIL] 回測邏輯疑有未來資料洩漏，請人工審查 walkForwardBacktest.ts');
  process.exit(1);
} else {
  console.log('\n[PASS] Walk-forward 回測無明顯未來資料洩漏');
}
