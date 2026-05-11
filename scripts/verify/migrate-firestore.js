#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const scriptPath = path.join(ROOT, 'backend', 'scripts', 'migrate-firestore.js');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const source = fs.readFileSync(scriptPath, 'utf8');

if (pkg.scripts['migrate:firestore'] !== 'cd backend && node scripts/migrate-firestore.js') {
  throw new Error('migrate:firestore npm script is missing');
}
for (const token of [
  '--dry-run',
  '--yes',
  'refusing to write Firestore without --yes',
  '539.db',
  'draws',
  'predictions',
  'observation_logs',
  'sync_logs',
  'system_status',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'validateFirestore',
  'resolveMigrationScope',
  '--recent',
  '--year',
  '--all-history',
  '--confirm-all-history',
  'refusing all-history Firestore migration',
  'HISTORY_MODE',
  'HISTORY_RECENT_LIMIT',
  'HISTORY_START_YEAR',
  'sorted.slice(0, Math.min(scope.recent, 150))',
  'yearRows.length >= 100 ? yearRows : sorted.slice(0, 150)',
  'entries.length >= 200',
  'sample_insufficient',
  'full 100-sample A/B backtest skipped because fewer than 200 verified draws were migrated',
  'recent_120_available',
  'backtest_status',
  'backtest_sample_size',
]) {
  if (!source.includes(token)) throw new Error(`migration script missing ${token}`);
}
if (!/entries\.length\s*>=\s*200\s*\?\s*advanced\.runAdvancedBacktest\(entries\)/.test(source)) {
  throw new Error('migration must only run A/B backtest when at least 200 draws are available');
}
if (!/number_analysis_count:[\s\S]*prediction_readiness:[\s\S]*backtest_status/.test(source)) {
  throw new Error('migration must keep number-analysis and prediction readiness separate from backtest status');
}
if (/tableRows\(db, 'draws'\)\s*\.map/.test(source)) {
  throw new Error('migration must filter draws before mapping documents');
}
if (/Math\.random|hardcoded prediction|fake prediction|mock data|demo data|sample prediction/i.test(source)) {
  throw new Error('migration script contains forbidden text');
}

const hasFirebaseEnv = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'].every(k => process.env[k]);
const dbPath = process.env.DB_PATH || path.join(ROOT, 'backend', 'data', '539.db');
if (hasFirebaseEnv && fs.existsSync(dbPath)) {
  const result = spawnSync(process.execPath, [scriptPath, '--dry-run'], {
    cwd: path.join(ROOT, 'backend'),
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`dry-run failed: ${result.stderr || result.stdout}`);
  }
  const out = JSON.parse(result.stdout);
  if (!out.dry_run || out.counts.draws <= 0) throw new Error('dry-run did not report SQLite draw count');
} else {
  console.warn('[SKIP] live migration dry-run skipped because Firebase env or SQLite DB is unavailable');
}

console.log('[PASS] migrate:firestore is guarded, scoped to year/recent data, idempotent, and maps SQLite collections to Firestore');
