#!/usr/bin/env node
/**
 * verify:no-mock — 掃描所有 src/ TS 檔案，確認不含假資料或 Math.random() 主預測邏輯
 */
const fs = require('fs');
const path = require('path');

const FORBIDDEN = [
  { pattern: /Math\.random\(\)/g,             label: 'Math.random()（禁止用於預測主邏輯）' },
  { pattern: /\bfakeData\b/g,                 label: 'fakeData 變數' },
  { pattern: /\bmockDraw\b/g,                 label: 'mockDraw 變數' },
  { pattern: /MOCK_NUMBERS/g,                 label: 'MOCK_NUMBERS 常數' },
  { pattern: /\[1,\s*2,\s*3,\s*4,\s*5\]/g,   label: '[1,2,3,4,5] 硬編碼號碼' },
];

function walkDir(dir, ext = '.ts') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...walkDir(full, ext));
    } else if (entry.isFile() && full.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

const srcDir = path.resolve(__dirname, '..', 'src');
const files = walkDir(srcDir);

let found = false;
for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8');
  const rel = path.relative(srcDir, file);
  for (const { pattern, label } of FORBIDDEN) {
    const matches = content.match(pattern);
    if (matches) {
      console.error(`[FAIL] ${rel}: 含有「${label}」(${matches.length} 處)`);
      found = true;
    }
  }
}

if (found) {
  console.error('\n驗證失敗：請移除上述假資料或隨機邏輯');
  process.exit(1);
} else {
  console.log(`[PASS] 掃描 ${files.length} 個 TS 檔案，未發現假資料或 Math.random() 主邏輯`);
}
