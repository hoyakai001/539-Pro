#!/usr/bin/env node
/**
 * verify:no-hardcoded-data — 掃描是否有硬編碼的今彩539號碼或期號
 *
 * 疑似硬編碼的模式：
 * 1. 5 個介於 1~39 的整數陣列（如 [7, 14, 23, 31, 39]）
 * 2. 疑似硬編碼的 draw_no（12 位數字串）
 * 3. 疑似靜態 latestDrawNo / latestDrawDate 變數賦值
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = [
  path.join(ROOT, 'backend', 'src'),
  path.join(ROOT, 'frontend', 'src'),
];
const EXCLUDE = ['node_modules', 'dist', 'scripts', '.git'];

function walkDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (EXCLUDE.some(x => full.includes(x))) continue;
    if (e.isDirectory()) out.push(...walkDir(full));
    else if (e.isFile() && /\.(ts|tsx|js)$/.test(e.name)) out.push(full);
  }
  return out;
}

// 5 個 1~39 整數的陣列 literal（允許在驗證/測試腳本中）
const FIVE_NUM_ARR = /\[\s*(\d{1,2})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\]/g;
// 12 位純數字（可能的期號）
const DRAW_NO_LITERAL = /(?:draw_no|latestDrawNo|drawNo)\s*[=:]\s*['"](\d{10,12})['"]/g;

let violations = 0;
let filesScanned = 0;

for (const dir of SCAN_DIRS) {
  for (const file of walkDir(dir)) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines   = content.split('\n');
    const rel     = path.relative(ROOT, file);
    filesScanned++;

    // 檢查 5 個號碼陣列
    {
      let m;
      FIVE_NUM_ARR.lastIndex = 0;
      while ((m = FIVE_NUM_ARR.exec(content)) !== null) {
        const nums = [m[1], m[2], m[3], m[4], m[5]].map(Number);
        if (nums.every(n => n >= 1 && n <= 39)) {
          const lineNo   = content.slice(0, m.index).split('\n').length;
          const lineText = lines[lineNo - 1]?.trim() ?? '';
          if (lineText.startsWith('//') || lineText.startsWith('*')) continue;
          // 排除 verifyDraw 中的合法測試值
          if (rel.includes('verify') || rel.includes('spec') || rel.includes('test')) continue;
          // 排除 observation 統計用的 core-group 監測號碼（不是 prediction，是 metric 定義）
          // 必須在同一行有 CORE_GROUP / WATCH_GROUP / TRACKED_NUMBERS 命名 或 metric-config 標記
          if (/(CORE_GROUP|WATCH_GROUP|TRACKED_NUMBERS)/.test(lineText)) continue;
          if (/metric-config\b/i.test(lineText)) continue;
          console.error(`[FAIL] ${rel}:${lineNo} — 疑似硬編碼 539 號碼：[${nums.join(', ')}]`);
          console.error(`       ${lineText}`);
          violations++;
        }
      }
    }

    // 檢查硬編碼期號
    {
      let m;
      DRAW_NO_LITERAL.lastIndex = 0;
      while ((m = DRAW_NO_LITERAL.exec(content)) !== null) {
        const lineNo = content.slice(0, m.index).split('\n').length;
        const lineText = lines[lineNo - 1]?.trim() ?? '';
        if (lineText.startsWith('//') || lineText.startsWith('*')) continue;
        console.error(`[FAIL] ${rel}:${lineNo} — 疑似硬編碼期號：${m[0]}`);
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n驗證失敗：共發現 ${violations} 個疑似硬編碼資料（掃描 ${filesScanned} 檔案）`);
  process.exit(1);
} else {
  console.log(`[PASS] 未發現硬編碼開獎資料（掃描 ${filesScanned} 檔案）`);
}
