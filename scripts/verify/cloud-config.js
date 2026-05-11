#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const roots = [
  path.resolve(__dirname, '../../backend/src'),
  path.resolve(__dirname, '../../frontend/src'),
];
const forbidden = ['Telegram Desktop', '新增資料夾', 'localhost:3001'];
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}
for (const root of roots) {
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const token of forbidden) {
      if (text.includes(token)) {
        console.error(`[FAIL] non-portable token ${token} in ${file}`);
        process.exit(1);
      }
    }
  }
}
console.log('[PASS] cloud/desktop config uses env/config paths without local workspace constants');
