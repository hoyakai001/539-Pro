#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../frontend/src');
const dashboard = fs.readFileSync(path.join(root, 'components', 'Dashboard.tsx'), 'utf8');
const client = fs.readFileSync(path.join(root, 'api', 'client.ts'), 'utf8');

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

for (const route of ['/admin/setup', '/admin/login', '/admin/logout', '/admin/status']) {
  if (!client.includes(route)) fail(`admin API route missing in client: ${route}`);
}
if (!dashboard.includes('管理員')) fail('admin entry is missing from header');
if (!dashboard.includes('sessionStorage.setItem') || !dashboard.includes('sessionStorage.removeItem')) {
  fail('admin token must use sessionStorage');
}
if (!dashboard.includes('{admin &&')) fail('admin pages are not gated by admin state');
if (dashboard.includes('localStorage.setItem') || client.includes('localStorage.getItem')) fail('admin token uses localStorage');

console.log('[PASS] admin setup/login/logout UI exists and debug pages are admin-gated');
