#!/usr/bin/env node
'use strict';
const http = require('http');
const PORT = process.env.PORT || 3001;

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${path}`, { timeout: 5000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function assertSorted(label, nums) {
  if (!Array.isArray(nums)) return;
  const sorted = [...nums].sort((a, b) => a - b);
  if (JSON.stringify(nums) !== JSON.stringify(sorted)) throw new Error(`${label} is not sorted: ${nums.join(',')}`);
}

(async () => {
  const status = await request('/api/data/status');
  assertSorted('latest_numbers', status.data.latest_numbers);
  assertSorted('previous_numbers', status.data.previous_numbers);
  const latest = await request('/api/latest-draw');
  assertSorted('latest draw numbers', latest.data.numbers);
  const prediction = await request('/api/prediction/today');
  if (prediction.data) {
    for (const key of ['numbers', 'two_star', 'three_star', 'four_star', 'five_star']) assertSorted(key, prediction.data[key]);
  }
  console.log('[PASS] all API number arrays are sorted ascending');
})().catch(e => {
  console.error(`[FAIL] ${e.message}`);
  process.exit(1);
});
