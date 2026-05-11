#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../../docs/CLOUD_DEPLOY_FIREBASE_VERCEL.md');
if (!fs.existsSync(file)) throw new Error('docs/CLOUD_DEPLOY_FIREBASE_VERCEL.md is missing');
const text = fs.readFileSync(file, 'utf8');

for (const token of [
  'SQLite',
  'Vercel',
  'Firebase Firestore',
  'local mode',
  'cloud mode',
  '完全移植',
  'draws',
  'predictions',
  'observation_logs',
  'admin',
  'sync_logs',
  'quota',
  '--dry-run',
  '--yes',
  '--recent=150',
  '--year=2026',
  '--all-history',
  'APP_MODE=cloud',
  'HISTORY_MODE=year',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY',
  'CRON_SECRET',
  '0 14 * * *',
  'Firebase quota exceeded',
  'Vercel 500',
  'tsc not found',
  'sample_insufficient',
  '至少 120 期',
  '200 期',
]) {
  if (!text.includes(token)) throw new Error(`cloud deploy docs missing ${token}`);
}

console.log('[PASS] Firebase/Vercel deployment documentation is complete');
