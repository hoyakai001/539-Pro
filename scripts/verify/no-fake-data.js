#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const dirs = [path.join(ROOT, 'backend', 'src'), path.join(ROOT, 'frontend', 'src')];
const banned = [/Math\.random/, /hardcoded prediction/i, /fake prediction/i, /mock data/i, /demo data/i, /sample prediction/i];

function walk(dir) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js)$/.test(item.name)) out.push(full);
  }
  return out;
}

let failures = 0;
for (const file of dirs.flatMap(walk)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of banned) {
    if (pattern.test(text)) {
      console.error(`[FAIL] ${path.relative(ROOT, file)} contains ${pattern}`);
      failures++;
    }
  }
}
if (failures) process.exit(1);
console.log('[PASS] no fake/mock/demo/sample prediction text, hardcoded prediction marker, or Math.random found');
