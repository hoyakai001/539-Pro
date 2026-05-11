#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const adapter = fs.readFileSync(path.join(ROOT, 'backend/src/db/adapters/FirestoreAdapter.ts'), 'utf8');
const routes = fs.readFileSync(path.join(ROOT, 'backend/src/api/routes.ts'), 'utf8');
const migration = fs.readFileSync(path.join(ROOT, 'backend/scripts/migrate-firestore.js'), 'utf8');

function requireText(text, token, label) {
  if (!text.includes(token)) throw new Error(`${label} missing ${token}`);
}

requireText(adapter, 'async getDraws(limit = 120)', 'FirestoreAdapter');
requireText(adapter, 'Math.min(Math.max(Math.trunc(limit || 120), 1), 120)', 'FirestoreAdapter draw limit clamp');
requireText(adapter, ".orderBy('draw_no', 'desc')", 'FirestoreAdapter draw order');
requireText(adapter, '.limit(safeLimit)', 'FirestoreAdapter draw query');

if (/collection\('draws'\)\s*\.get\(/.test(adapter)) {
  throw new Error('FirestoreAdapter must not get the whole draws collection');
}
if (/getDraws\((?:500|5000|1000)\)/.test(routes)) {
  throw new Error('cloud routes contain an unsafe high-limit getDraws call');
}

requireText(routes, 'await adapter.getDraws(120)', 'cloud prediction max draw read');
requireText(routes, 'await getDatabaseAdapter().getDraws(100)', 'cloud data/status or analysis read');
requireText(routes, "query['recent'] ?? query['limit'] ?? '30'", 'cloud history default');
requireText(routes, 'const readLimit = Math.min(100', 'cloud history hard cap');
requireText(routes, 'const safeWindow = Math.min(Math.max(window, 1), 60)', 'cloud performance hard cap');
requireText(routes, 'async function cloudSyncLogs', 'cloud sync logs query');
requireText(routes, 'const safeLimit = Math.min(Math.max(Math.trunc(limit || 20), 1), 50)', 'cloud sync logs hard cap');
requireText(routes, ".collection('sync_logs')", 'cloud sync logs collection');
requireText(routes, ".limit(safeLimit)", 'cloud sync logs limit');

requireText(migration, 'resolveMigrationScope', 'migration scope');
requireText(migration, '--recent', 'migration recent option');
requireText(migration, '--year', 'migration year option');
requireText(migration, '--all-history', 'migration all-history option');
requireText(migration, '--confirm-all-history', 'migration all-history confirmation');
requireText(migration, 'sorted.slice(0, Math.min(scope.recent, 150))', 'migration recent cap');
requireText(migration, 'sorted.slice(0, 150)', 'migration default fallback cap');

console.log('[PASS] Firestore queries are bounded and migration defaults avoid full-history writes');
