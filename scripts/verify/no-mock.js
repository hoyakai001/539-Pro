#!/usr/bin/env node
/**
 * verify:no-mock — 掃描 backend/src 和 frontend/src，確認無假資料/假預測
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

// 要掃描的目錄
const SCAN_DIRS = [
  path.join(ROOT, 'backend', 'src'),
  path.join(ROOT, 'frontend', 'src'),
];

// 禁止的 pattern（reg + 標籤）
const FORBIDDEN = [
  { re: /Math\.random\s*\(\)/g,                      label: 'Math.random()（禁止用於預測主邏輯）' },
  { re: /\bfakeData\b/g,                             label: 'fakeData 變數' },
  { re: /\bmockDraw\b/g,                             label: 'mockDraw 變數' },
  { re: /\bdemoNumbers?\b/g,                         label: 'demoNumbers 變數' },
  { re: /MOCK_NUMBERS/g,                             label: 'MOCK_NUMBERS 常數' },
  { re: /static_prediction/gi,                       label: 'static_prediction' },
  { re: /hardcoded.*prediction/gi,                   label: 'hardcoded prediction 注解' },
  { re: /fallback.*prediction/gi,                    label: 'fallback prediction 注解' },
  { re: /bundled.*database/gi,                       label: 'bundled database 注解' },
];

// 排除的路徑（verify 腳本本身、README、測試資料）
const EXCLUDE_PATHS = [
  path.join(ROOT, 'scripts'),
  'node_modules',
  '.git',
  'dist',
];

function shouldExclude(filePath) {
  return EXCLUDE_PATHS.some(ex => filePath.includes(ex));
}

function walkDir(dir, exts = ['.ts', '.tsx', '.js']) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (shouldExclude(full)) continue;
    if (entry.isDirectory()) {
      results.push(...walkDir(full, exts));
    } else if (entry.isFile() && exts.some(e => full.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

let violations = 0;
let filesScanned = 0;

for (const dir of SCAN_DIRS) {
  const files = walkDir(dir);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines   = content.split('\n');
    filesScanned++;
    for (const { re, label } of FORBIDDEN) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(content)) !== null) {
        // 計算行號
        const lineNo = content.slice(0, m.index).split('\n').length;
        const lineText = lines[lineNo - 1]?.trim() ?? '';
        // 排除純注解行（// 開頭）
        if (lineText.startsWith('//') || lineText.startsWith('*')) continue;
        const rel = path.relative(ROOT, file);
        console.error(`[FAIL] ${rel}:${lineNo} — 發現「${label}」`);
        console.error(`       ${lineText}`);
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n驗證失敗：共發現 ${violations} 個假資料/假預測問題（掃描 ${filesScanned} 個檔案）`);
  process.exit(1);
} else {
  console.log(`[PASS] 未發現假資料（掃描 ${filesScanned} 個檔案）`);
}
