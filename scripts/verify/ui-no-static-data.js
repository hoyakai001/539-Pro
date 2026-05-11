#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../frontend/src');
const forbidden = [
  /11500010[78]/,
  /\b2026[/-]05[/-]0[12]\b/,
  /\[\s*9\s*,\s*8\s*,\s*38\s*,\s*25\s*,\s*17\s*\]/,
  /\[\s*2\s*,\s*3\s*,\s*14\s*,\s*16\s*,\s*20\s*\]/,
  /hardcoded prediction/i,
  /demo data/i,
  /mock data/i,
];

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : [p];
  }).filter(p => /\.(tsx?|jsx?)$/.test(p));
}

let failures = 0;
for (const file of files(root)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const re of forbidden) {
    if (re.test(text)) {
      console.error(`[FAIL] static data pattern ${re} in ${path.relative(root, file)}`);
      failures++;
    }
  }
}

if (failures) process.exit(1);
console.log(`[PASS] frontend has no static draw numbers/statistics/prediction fixtures (${files(root).length} files scanned)`);
