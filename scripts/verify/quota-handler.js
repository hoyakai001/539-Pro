#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const routes = fs.readFileSync(path.join(ROOT, 'backend/src/api/routes.ts'), 'utf8');
const client = fs.readFileSync(path.join(ROOT, 'frontend/src/api/client.ts'), 'utf8');

for (const token of [
  'function sendApiError',
  'function isQuotaError',
  'RESOURCE_EXHAUSTED',
  'FIREBASE_QUOTA_EXCEEDED',
  "res.status(200).json",
  "message: '今日額度已用完'",
]) {
  if (!routes.includes(token)) throw new Error(`backend quota handler missing ${token}`);
}

if (!/RESOURCE_EXHAUSTED\|quota/i.test(routes)) {
  throw new Error('quota handler must detect RESOURCE_EXHAUSTED and quota messages');
}
if (!client.includes('FIREBASE_QUOTA_EXCEEDED') || !client.includes('系統今日額度已用完，請明天再試')) {
  throw new Error('frontend must show a friendly quota message');
}
if (/throw\s+new\s+Error\([^)]*FIREBASE_QUOTA_EXCEEDED/.test(routes)) {
  throw new Error('quota errors must be returned as JSON, not thrown through to 500');
}

console.log('[PASS] Firebase quota exhaustion is converted to a controlled non-crashing response');
