#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const routes = fs.readFileSync(path.join(ROOT, 'backend/src/api/routes.ts'), 'utf8');
const client = fs.readFileSync(path.join(ROOT, 'frontend/src/api/client.ts'), 'utf8');
const settings = fs.readFileSync(path.join(ROOT, 'frontend/src/components/SettingsPage.tsx'), 'utf8');
const vercel = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');

for (const token of [
  "router.get('/docs/strategy'",
  "router.get('/docs/cloud-deploy'",
  'STRATEGY_FULL.md',
  'CLOUD_DEPLOY_FIREBASE_VERCEL.md',
  'sendMarkdownDoc',
]) {
  if (!routes.includes(token)) throw new Error(`docs API route missing ${token}`);
}

for (const token of [
  "getStrategyDoc",
  "getCloudDeployDoc",
  "'/docs/strategy'",
  "'/docs/cloud-deploy'",
]) {
  if (!client.includes(token)) throw new Error(`frontend docs client missing ${token}`);
}

for (const token of ['開啟策略全貌', '開啟 Firebase / Vercel 部署指南', '文件無法載入']) {
  if (!settings.includes(token)) throw new Error(`settings docs UI missing ${token}`);
}

if (/fetch\(\s*['"`]\/docs\/[^'"`]+\.md/.test(client + settings)) {
  throw new Error('frontend must not fetch /docs/*.md directly');
}

if (!vercel.includes('"includeFiles"') || !vercel.includes('docs/**')) {
  throw new Error('vercel.json must include docs/** for serverless docs API');
}

console.log('[PASS] markdown docs are served through API routes and included for Vercel');
