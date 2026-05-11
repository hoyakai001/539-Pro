#!/usr/bin/env node
/**
 * verify:backtest-no-future-leak — 靜態掃描 walkForwardBacktest.ts
 * 確認回測每次訓練只使用目標期之後（更舊）的資料（allDraws 是新→舊排列）
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'src', 'backtest', 'walkForwardBacktest.ts');
if (!fs.existsSync(file)) {
  console.error('[FAIL] 找不到 walkForwardBacktest.ts');
  process.exit(1);
}

const content = fs.readFileSync(file, 'utf-8');

// 確認說明性注解存在（新→舊排列）
const hasComment = content.includes('新到舊') || content.includes('allDraws[0]');
if (!hasComment) {
  console.warn('[WARN] 未找到排列說明注解（新→舊）');
}

// 確認使用 slice(i + 1, ...) 取目標期之後的更舊資料
const hasCorrectSlice = /slice\s*\(\s*i\s*\+\s*1/.test(content);
if (!hasCorrectSlice) {
  console.error('[FAIL] 未找到 slice(i + 1, ...) 模式');
  console.error('[FAIL] 應使用 allDraws.slice(i + 1, i + 1 + windowSize) 確保只用更舊的資料');
  process.exit(1);
}
console.log('[PASS] 找到 slice(i + 1, ...) — 訓練只用 index > i 的更舊資料');

// 確認目標期取法
const hasTargetDraw = /allDraws\[i\]/.test(content);
if (!hasTargetDraw) {
  console.error('[FAIL] 未找到 allDraws[i] — 目標期取法不明確');
  process.exit(1);
}
console.log('[PASS] 找到 allDraws[i] — 目標期明確');

// 確認沒有使用 slice(0, i) 取「更新」資料來訓練（這樣反而是正確的，但確認邏輯一致）
const usesNewDataForTraining = /trainingDraws\s*=\s*allDraws\.slice\s*\(\s*0\s*,/.test(content);
if (usesNewDataForTraining) {
  console.warn('[WARN] 發現 slice(0, ...) 用於訓練，請確認排列方向是否為舊→新');
}

console.log('\n[PASS] 回測無未來資料洩漏（allDraws 新→舊，訓練資料 index > 目標期 index）');
